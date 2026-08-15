'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { useAuth } from '@/features/auth/auth-provider';
import { canAccessRoute, resolveDefaultRoute } from '@/features/auth/access-control';
export default function WaiterLayoutClient({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading } = useAuth();
  const safePathname = pathname ?? '/waiter';
  const canAccess = canAccessRoute(safePathname, user?.permissions);
  useEffect(() => {
    if (!loading && !user) {
      router.replace('/waiter/login');
    }
  }, [loading, router, user]);

  if (loading || !user) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface">
        <div className="rounded-[1.75rem] border border-stone-200 bg-white px-6 py-5 text-center shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-brand-900">Meseros</p>
          <p className="mt-2 text-[15px] font-semibold text-ink">Cargando sesión...</p>
        </div>
      </div>
    );
  }
  if (!canAccess) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface px-4 py-6">
        <div className="w-full max-w-xl rounded-[2rem] border border-stone-200 bg-white p-8 text-center shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-brand-900">Acceso restringido</p>
          <h1 className="mt-3 text-[1.9rem] font-bold text-ink">No tienes permisos para tomar pedidos</h1>
          <p className="mt-3 text-[13px] leading-6 text-stone-600">
            Esta superficie está reservada para usuarios autorizados a crear o actualizar comandas.
          </p>
          <div className="mt-6 flex justify-center">
            <Link href={resolveDefaultRoute(user)} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-ink px-4 py-2.5 text-[13px] font-bold text-white hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100">Volver</Link>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-dvh bg-surface">
      <a
        href="#waiter-main"
        className="sr-only z-[60] rounded-xl bg-ink px-4 py-3 text-sm font-bold text-white focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Ir a las mesas
      </a>
      <div
        className="mx-auto flex min-h-dvh w-full max-w-[1180px] flex-col px-2.5 py-2.5 sm:px-4 lg:px-5"
        style={{
          paddingTop: 'max(0.65rem, env(safe-area-inset-top))',
          paddingBottom: 'max(0.65rem, env(safe-area-inset-bottom))',
        }}
      >
        <main id="waiter-main" tabIndex={-1} className="overflow-hidden rounded-[1.45rem] border border-stone-200 bg-white shadow-soft outline-none sm:rounded-[1.8rem]">
          {children}
        </main>
      </div>
    </div>
  );
}
