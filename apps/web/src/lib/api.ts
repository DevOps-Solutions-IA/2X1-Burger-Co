const AUTH_SESSION_EXPIRED_EVENT = 'auth:session-expired';
export type SessionExpiredReason = 'expired' | 'cash_closed';

export interface OperationalRealtimeEvent {
  type:
    | 'operational.refresh'
    | 'order.updated'
    | 'delivery.location.received'
    | 'delivery.location.pending'
    | 'delivery.workflow.updated'
    | 'operational.alert.updated';
  at: string;
  scope?: 'orders' | 'tables' | 'all';
  entityId?: string;
  entityType?: string | null;
  orderType?: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY' | 'COUNTER';
  status?:
    | 'OPEN'
    | 'IN_PREPARATION'
    | 'SERVED'
    | 'PAYMENT_PENDING'
    | 'PAID'
    | 'CANCELLED'
    | 'ACKNOWLEDGED'
    | 'RESOLVED';
  workflowStatus?: 'PENDING_ASSIGNMENT' | 'ASSIGNED' | 'IN_TRANSIT' | 'DELIVERED' | 'ISSUE';
  inboxId?: string;
  alertId?: string;
  module?: string;
  severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  actorId?: string | null;
  reason?: string;
}

interface ApiFetchOptions {
  skipAuthRefresh?: boolean;
  hasRetriedAfterRefresh?: boolean;
}

type RefreshFailureReason = 'unauthorized' | 'transient';

interface RefreshSessionResult {
  refreshed: boolean;
  failureReason?: RefreshFailureReason;
  status?: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

function notifySessionExpired(reason: SessionExpiredReason = 'expired') {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(AUTH_SESSION_EXPIRED_EVENT, { detail: { reason } }));
}

export function resolveApiUrl() {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }

  if (typeof window !== 'undefined') {
    // Keep browser traffic on the current origin. Nginx is the normal public
    // proxy and Next rewrites /api for the exposed local Web port, avoiding
    // CORS-dependent calls to a separate API port.
    return `${window.location.origin}/api`;
  }

  return 'http://localhost:3000';
}

// Access token almacenado en memoria runtime (NO en localStorage).
// No sobrevive a recargas de página, mitigando exposición en caso de XSS.
let accessToken: string | null = null;
let refreshInFlight: Promise<RefreshSessionResult> | null = null;
let sessionExpiredNotified = false;
let lastSuccessfulRefreshAt = 0;
const RECENT_REFRESH_REUSE_WINDOW_MS = 1500;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  if (token) {
    sessionExpiredNotified = false;
  }
}

export function clearAccessToken(): void {
  accessToken = null;
}

// Alias de compatibilidad para imports existentes
export const getStoredAccessToken = getAccessToken;
export const setStoredAccessToken = (token: string | null) => {
  setAccessToken(token);
};

export function onSessionExpired(callback: (reason: SessionExpiredReason) => void) {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const listener = (event: Event) => {
    const reason =
      event instanceof CustomEvent && event.detail?.reason === 'cash_closed'
        ? 'cash_closed'
        : 'expired';
    callback(reason);
  };
  window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, listener);
  return () => window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, listener);
}

export function expireCurrentSession(reason: SessionExpiredReason = 'expired') {
  clearAccessToken();
  notifySessionExpiredOnce(reason);
}

function notifySessionExpiredOnce(reason: SessionExpiredReason = 'expired') {
  if (sessionExpiredNotified && reason === 'expired') {
    return;
  }

  sessionExpiredNotified = true;
  notifySessionExpired(reason);
}

function hasRecentSuccessfulRefresh() {
  return Boolean(getAccessToken()) && Date.now() - lastSuccessfulRefreshAt <= RECENT_REFRESH_REUSE_WINDOW_MS;
}

function buildApiError(response: Response) {
  const fallbackMessage =
    response.status === 403
      ? 'No tienes permisos para realizar esta acción.'
      : response.status === 429
        ? 'Demasiados intentos. Espera un momento y vuelve a intentar.'
        : response.status >= 500
          ? 'El servidor no respondió correctamente. Intenta de nuevo en un momento.'
          : 'La solicitud no pudo completarse.';

  return { fallbackMessage };
}

async function handleUnauthorizedResponse(): Promise<RefreshSessionResult> {
  if (hasRecentSuccessfulRefresh()) {
    return { refreshed: true };
  }

  const refreshResult = await refreshSessionSingleFlight();

  if (refreshResult.refreshed) {
    return refreshResult;
  }

  if (refreshResult.failureReason === 'unauthorized') {
    clearAccessToken();
    notifySessionExpiredOnce('expired');
  }

  return refreshResult;
}

async function refreshSessionSingleFlight(): Promise<RefreshSessionResult> {
  if (!refreshInFlight) {
    refreshInFlight = executeRefreshSession().finally(() => {
      refreshInFlight = null;
    });
  }

  return refreshInFlight;
}

async function executeRefreshSession(): Promise<RefreshSessionResult> {
  const apiUrl = resolveApiUrl();

  try {
    const response = await fetch(`${apiUrl}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { refreshed: false, failureReason: 'unauthorized', status: response.status };
      }

      return { refreshed: false, failureReason: 'transient', status: response.status };
    }

    const data = (await response.json()) as { accessToken: string };
    setAccessToken(data.accessToken);
    lastSuccessfulRefreshAt = Date.now();
    return { refreshed: true };
  } catch {
    return { refreshed: false, failureReason: 'transient', status: 0 };
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit, options?: ApiFetchOptions): Promise<T> {
  const apiUrl = resolveApiUrl();
  const token = getStoredAccessToken();
  const headers = new Headers(init?.headers);

  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers,
      credentials: 'include',
    });
  } catch {
    throw new ApiError('No hay conexión con el servidor. Conservamos el borrador para reintentar.', 0);
  }

  if (response.status === 401 && typeof window !== 'undefined' && options?.hasRetriedAfterRefresh) {
    clearAccessToken();
    notifySessionExpiredOnce('expired');
    throw new ApiError('Tu sesión expiró. Inicia sesión nuevamente.', 401);
  }

  if (response.status === 401 && typeof window !== 'undefined' && !options?.skipAuthRefresh) {
    const refreshResult = await handleUnauthorizedResponse();
    if (refreshResult.refreshed) {
      return apiFetch<T>(path, init, { ...options, hasRetriedAfterRefresh: true });
    }

    const message =
      refreshResult.failureReason === 'transient'
        ? 'No pudimos validar la sesión por un problema temporal. Intenta de nuevo en un momento.'
        : 'Tu sesión expiró. Inicia sesión nuevamente.';
    throw new ApiError(message, refreshResult.status ?? 401);
  }

  if (!response.ok) {
    const { fallbackMessage } = buildApiError(response);
    const error = await response.json().catch(() => ({ message: fallbackMessage }));
    throw new ApiError(error.message ?? fallbackMessage, response.status);
  }

  return response.json() as Promise<T>;
}

export async function apiFetchBlob(path: string, init?: RequestInit, options?: ApiFetchOptions): Promise<Blob> {
  const apiUrl = resolveApiUrl();
  const token = getStoredAccessToken();
  const headers = new Headers(init?.headers);

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers,
      credentials: 'include',
    });
  } catch {
    throw new ApiError('No hay conexión con el servidor. Intenta de nuevo cuando la red vuelva.', 0);
  }

  if (response.status === 401 && typeof window !== 'undefined' && options?.hasRetriedAfterRefresh) {
    clearAccessToken();
    notifySessionExpiredOnce('expired');
    throw new ApiError('Tu sesión expiró. Inicia sesión nuevamente.', 401);
  }

  if (response.status === 401 && typeof window !== 'undefined' && !options?.skipAuthRefresh) {
    const refreshResult = await handleUnauthorizedResponse();
    if (refreshResult.refreshed) {
      return apiFetchBlob(path, init, { ...options, hasRetriedAfterRefresh: true });
    }

    const message =
      refreshResult.failureReason === 'transient'
        ? 'No pudimos validar la sesión por un problema temporal. Intenta de nuevo en un momento.'
        : 'Tu sesión expiró. Inicia sesión nuevamente.';
    throw new ApiError(message, refreshResult.status ?? 401);
  }

  if (!response.ok) {
    const { fallbackMessage } = buildApiError(response);
    throw new ApiError(fallbackMessage, response.status);
  }

  return response.blob();
}

export async function loginRequest(email: string, password: string) {
  return apiFetch<{
    accessToken: string;
    user: {
      sub: string;
      email: string;
      fullName: string;
      lastLoginAt?: string | null;
      roles: string[];
      permissions: string[];
    };
  }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  }, {
    skipAuthRefresh: true,
  });
}

export async function waiterLoginRequest(name: string, accessCode: string) {
  return apiFetch<{
    accessToken: string;
    user: {
      sub: string;
      email: string;
      fullName: string;
      lastLoginAt?: string | null;
      roles: string[];
      permissions: string[];
    };
  }>('/auth/waiter-login', {
    method: 'POST',
    body: JSON.stringify({ name, accessCode }),
  }, {
    skipAuthRefresh: true,
  });
}

export async function deliveryLoginRequest(name: string, accessCode: string) {
  return apiFetch<{
    accessToken: string;
    user: {
      sub: string;
      email: string;
      fullName: string;
      lastLoginAt?: string | null;
      roles: string[];
      permissions: string[];
    };
  }>('/auth/delivery-login', {
    method: 'POST',
    body: JSON.stringify({ name, accessCode }),
  }, {
    skipAuthRefresh: true,
  });
}

export async function logoutRequest() {
  await apiFetch('/auth/logout', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function meRequest() {
  return apiFetch<{
    sub: string;
    email: string;
    fullName: string;
    lastLoginAt?: string | null;
    roles: string[];
    permissions: string[];
  }>('/auth/me');
}

export async function tryRefreshToken() {
  const result = await refreshSessionSingleFlight();
  return result.refreshed;
}

function parseSseChunk(chunk: string) {
  const eventMatch = chunk.match(/^event:\s*(.+)$/m);
  const dataMatch = chunk.match(/^data:\s*(.+)$/m);

  return {
    event: eventMatch?.[1]?.trim() ?? 'message',
    data: dataMatch?.[1]?.trim() ?? '',
  };
}

export function subscribeOperationalStream(
  onEvent: (event: OperationalRealtimeEvent) => void,
  onStatusChange?: (status: 'connecting' | 'open' | 'closed') => void,
) {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  let aborted = false;
  let abortController: AbortController | null = null;
  let reconnectTimer: number | null = null;

  const cleanup = () => {
    aborted = true;
    abortController?.abort();
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer);
    }
    onStatusChange?.('closed');
  };

  const connect = async () => {
    const token = getAccessToken();
    if (!token || aborted) {
      onStatusChange?.('closed');
      return;
    }

    onStatusChange?.('connecting');
    abortController = new AbortController();

    try {
      const response = await fetch(`${resolveApiUrl()}/realtime/operational`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${token}`,
        },
        credentials: 'include',
        signal: abortController.signal,
        cache: 'no-store',
      });

      if (response.status === 401) {
        const refreshResult = await handleUnauthorizedResponse();
        if (refreshResult.refreshed && !aborted) {
          await connect();
          return;
        }

        onStatusChange?.('closed');
        return;
      }

      if (!response.ok || !response.body) {
        throw new Error('No pudimos abrir el canal en vivo.');
      }

      onStatusChange?.('open');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!aborted) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';

        for (const rawChunk of chunks) {
          const chunk = rawChunk.trim();
          if (!chunk) {
            continue;
          }

          const parsed = parseSseChunk(chunk);
          if (parsed.event !== 'operational' || !parsed.data) {
            continue;
          }

          try {
            onEvent(JSON.parse(parsed.data) as OperationalRealtimeEvent);
          } catch {
            // Ignore malformed payloads and keep the stream alive.
          }
        }
      }
    } catch (error) {
      if (aborted || (error instanceof DOMException && error.name === 'AbortError')) {
        return;
      }
    }

    if (!aborted) {
      onStatusChange?.('connecting');
      reconnectTimer = window.setTimeout(() => {
        void connect();
      }, 1500);
    }
  };

  void connect();

  return cleanup;
}
