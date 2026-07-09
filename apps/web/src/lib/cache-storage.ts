// Cache operacional con expiracion y version de schema.
// Previene errores por datos obsoletos en localStorage tras actualizaciones.
//
// Datos que persisten:
//   - Drafts de pedidos (meseros): se mantienen en localStorage con expiracion de 24h
//     para que el mesero pueda retomar un pedido aunque recargue la pagina.
//   - Cache de datos operativos (pedidos activos, alertas): expiracion 5 min,
//     sirven como fallback visual mientras se refrescan del servidor.
//   - Cache de entregas/admin: expiracion 10 min, evita pantallas en blanco
//     mientras react-query revalida.
//   - Preferencias de vista: persisten sin expiracion (son configuracion local).

const STORAGE_VERSION = 1;
const CACHE_PREFIX = 'invf:';

interface CacheEntry<T> {
  v: number;
  data: T;
  exp: number | null;
}

function isExpired(entry: CacheEntry<unknown>): boolean {
  if (entry.exp === null) return false;
  return Date.now() > entry.exp;
}

function readCache<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (entry.v !== STORAGE_VERSION || isExpired(entry)) {
      window.localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return entry.data;
  } catch {
    window.localStorage.removeItem(CACHE_PREFIX + key);
    return null;
  }
}

function writeCache<T>(key: string, data: T, ttlMs: number | null): void {
  if (typeof window === 'undefined') return;
  try {
    const entry: CacheEntry<T> = {
      v: STORAGE_VERSION,
      data,
      exp: ttlMs !== null ? Date.now() + ttlMs : null,
    };
    window.localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // localStorage lleno o deshabilitado — ignorar silenciosamente
  }
}

function removeCache(key: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(CACHE_PREFIX + key);
}

// SessionStorage wrapper para drafts (se borran al cerrar pestana)
function readSession<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (entry.v !== STORAGE_VERSION) {
      window.sessionStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return entry.data;
  } catch {
    window.sessionStorage.removeItem(CACHE_PREFIX + key);
    return null;
  }
}

function writeSession<T>(key: string, data: T): void {
  if (typeof window === 'undefined') return;
  try {
    const entry: CacheEntry<T> = {
      v: STORAGE_VERSION,
      data,
      exp: null,
    };
    window.sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // ignorar silenciosamente
  }
}

function removeSession(key: string): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(CACHE_PREFIX + key);
}

// TTLs predefinidos
export const TTL = {
  DRAFT: 24 * 60 * 60 * 1000, // 24h para borradores
  ACTIVE_ORDERS: 5 * 60 * 1000, // 5 min para pedidos activos
  ALERTS: 5 * 60 * 1000, // 5 min para alertas
  DELIVERY_DATA: 10 * 60 * 1000, // 10 min para datos de entregas
  SETTINGS: 60 * 60 * 1000, // 1h para configuracion
  PRODUCTS: 30 * 60 * 1000, // 30 min para productos
} as const;

export const CacheStorage = {
  read: readCache,
  write: writeCache,
  remove: removeCache,
  readSession,
  writeSession,
  removeSession,
};
