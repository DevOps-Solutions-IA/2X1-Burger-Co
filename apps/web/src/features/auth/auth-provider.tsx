'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import {
  ApiError,
  clearAccessToken,
  deliveryLoginRequest,
  expireCurrentSession,
  loginRequest,
  logoutRequest,
  meRequest,
  onSessionExpired,
  setAccessToken,
  tryRefreshToken,
  waiterLoginRequest,
} from '@/lib/api';

interface AuthUser {
  sub: string;
  email: string;
  fullName: string;
  lastLoginAt?: string | null;
  roles: string[];
  permissions: string[];
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  loginWaiter: (name: string, accessCode: string) => Promise<AuthUser>;
  loginDelivery: (name: string, accessCode: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const lastSessionToastAt = useRef(0);

  useEffect(() => {
    void (async () => {
      try {
        // Reintentar refresh hasta 2 veces con delay para asegurar que la cookie httpOnly esté disponible
        let refreshed = false;
        for (let attempt = 0; attempt < 2; attempt++) {
          refreshed = await tryRefreshToken();
          if (refreshed) break;
          if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
        }

        if (!refreshed) {
          setLoading(false);
          return;
        }

        const profile = await meRequest();
        setUser(profile);
      } catch {
        clearAccessToken();
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(
    () =>
      onSessionExpired((reason) => {
        clearAccessToken();
        setUser(null);
        const now = Date.now();
        if (now - lastSessionToastAt.current > 3000) {
          toast.error(
            reason === 'cash_closed'
              ? 'El turno de meseros se cerró porque la caja fue cerrada.'
              : 'Tu sesión expiró. Inicia sesión nuevamente.',
          );
          lastSessionToastAt.current = now;
        }
      }),
    [],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      login: async (email: string, password: string) => {
        const result = await loginRequest(email, password);
        setAccessToken(result.accessToken);
        setUser(result.user);
        return result.user;
      },
      loginWaiter: async (name: string, accessCode: string) => {
        const result = await waiterLoginRequest(name, accessCode);
        setAccessToken(result.accessToken);
        setUser(result.user);
        return result.user;
      },
      loginDelivery: async (name: string, accessCode: string) => {
        const result = await deliveryLoginRequest(name, accessCode);
        setAccessToken(result.accessToken);
        setUser(result.user);
        return result.user;
      },
      logout: async () => {
        try {
          await logoutRequest();
        } catch (error) {
          // Degradacion controlada: si el servidor no responde, limpiamos estado local igualmente
          console.error('Error al cerrar sesion en el servidor:', error);
        } finally {
          clearAccessToken();
          setUser(null);
        }
      },
      refreshProfile: async () => {
        try {
          const profile = await meRequest();
          setUser(profile);
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            clearAccessToken();
            setUser(null);
            return;
          }

          throw error;
        }
      },
    }),
    [loading, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
}

export { expireCurrentSession };
