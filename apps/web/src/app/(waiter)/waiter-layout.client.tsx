'use client';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { useAuth } from '@/features/auth/auth-provider';
import { canAccessRoute } from '@/features/auth/access-control';
// PWA interface removed — not used in this layout
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
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <div className="rounded-[1.75rem] border border-stone-200 bg-white px-6 py-5 text-center shadow-soft">
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-brand-600">Meseros</p>
          <p className="mt-2 text-[15px] font-semibold text-ink">Cargando sesión...</p>
        </div>
      </div>
    );
  }
  if (!canAccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-6">
        <div className="w-full max-w-xl rounded-[2rem] border border-stone-200 bg-white p-8 text-center shadow-soft">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-brand-600">Acceso restringido</p>
          <h1 className="mt-3 text-[1.9rem] font-bold text-ink">No tienes permisos para tomar pedidos</h1>
          <p className="mt-3 text-[13px] leading-6 text-stone-600">
            Esta superficie está reservada para usuarios autorizados a crear o actualizar comandas.
          </p>
          <div className="mt-6 flex justify-center">
            <a href="/" className="inline-flex items-center justify-center rounded-xl bg-ink px-4 py-2.5 text-[13px] font-bold text-white hover:bg-stone-800">Volver al inicio</a>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-surface">
      <div
        className="mx-auto flex min-h-screen w-full max-w-[1180px] flex-col px-2.5 py-2.5 sm:px-4 lg:px-5"
        style={{
          paddingTop: 'max(0.65rem, env(safe-area-inset-top))',
          paddingBottom: 'max(0.65rem, env(safe-area-inset-bottom))',
        }}
      >
        <main className="overflow-hidden rounded-[1.45rem] border border-stone-200 bg-white shadow-soft sm:rounded-[1.8rem]">
          {children}
        </main>
      </div>
    </div>
  );
}
