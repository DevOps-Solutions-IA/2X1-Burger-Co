'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { useAuth } from '@/features/auth/auth-provider';
import { canAccessRoute, resolveDefaultRoute } from '@/features/auth/access-control';
import { Button } from '@/components/ui/button';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const safePathname = pathname ?? '/dashboard';
  const canAccess = canAccessRoute(safePathname, user?.permissions, user?.roles);
  const defaultRoute = resolveDefaultRoute(user);

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [loading, router, user]);

  useEffect(() => {
    if (
      !loading
      && user?.roles.some((role) => role === 'waiter' || role === 'delivery' || role === 'rider')
    ) {
      router.replace(defaultRoute);
    }
  }, [defaultRoute, loading, router, user]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface" data-testid="protected-route-loading">
        <div className="rounded-[1.75rem] border border-stone-200 bg-white px-6 py-5 text-center shadow-soft">
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-brand-900">Acceso</p>
          <p className="mt-2 text-[15px] font-semibold text-ink">Cargando sesión...</p>
        </div>
      </div>
    );
  }

  if (!canAccess) {
    return (
      <AppShell>
        <div className="flex min-h-[70vh] items-center justify-center p-6">
          <div className="w-full max-w-xl rounded-[2rem] border border-stone-200 bg-white p-8 text-center shadow-soft">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-brand-900">Acceso restringido</p>
            <h1 className="mt-3 text-[1.9rem] font-bold text-ink">No tienes permisos para este módulo</h1>
            <p className="mt-3 text-[13px] leading-6 text-stone-600">
              Tu sesión está activa, pero el rol asignado no permite entrar a esta sección.
            </p>
            <div className="mt-6 flex justify-center">
              <Button asChild>
                <Link href={defaultRoute}>Volver a mi inicio</Link>
              </Button>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  return <AppShell>{children}</AppShell>;
}
