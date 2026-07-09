'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { canAccessRoute, resolveDefaultRoute } from '@/features/auth/access-control';
import { useAuth } from '@/features/auth/auth-provider';
import { ClipboardList, LogOut, Menu, Smartphone, Truck, X } from 'lucide-react';

export default function DeliveryLayoutClient({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const safePathname = pathname ?? '/delivery';
  const canAccess = canAccessRoute(safePathname, user?.permissions);
  const shiftStartedLabel = user?.lastLoginAt
    ? new Date(user.lastLoginAt).toLocaleTimeString('es-CO', {
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/delivery/login');
    }
  }, [loading, router, user]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [menuOpen]);

  useEffect(() => {
    setMenuOpen(false);
  }, [safePathname]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <div className="rounded-[1.75rem] border border-stone-200 bg-white px-6 py-5 text-center shadow-soft">
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-brand-600">Domicilios</p>
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
          <h1 className="mt-3 text-[1.9rem] font-bold text-ink">No tienes permisos para reparto</h1>
          <p className="mt-3 text-[13px] leading-6 text-stone-600">
            Esta superficie está reservada para domiciliarios o supervisores con permisos de delivery.
          </p>
          <div className="mt-6 flex justify-center">
            <Button asChild>
              <Link href={resolveDefaultRoute(user)}>Volver</Link>
            </Button>
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
        <header className="sticky top-0 z-40 pb-2.5">
          <div className="absolute inset-x-0 inset-y-0 rounded-[1.7rem] bg-gradient-to-b from-surface via-surface/95 to-surface/60 backdrop-blur-sm" />
          <div className="relative rounded-[1.45rem] border border-stone-200 bg-white/95 px-3.5 py-2.5 shadow-soft supports-[backdrop-filter]:bg-white/88 sm:px-4 sm:py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.95rem] bg-brand-50 text-brand-700">
                  <Truck className="h-4.5 w-4.5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-[0.88rem] font-bold tracking-[0.16em] text-ink sm:text-[0.95rem]">
                    2X1 BURGER CO
                  </p>
                  <p className="mt-0.5 text-[11px] text-stone-500">Reparto y entregas</p>
                </div>
              </div>

              <div className="hidden items-center gap-2 lg:flex">
                <Badge tone="neutral" className="gap-1.5">
                  <Smartphone className="h-3.5 w-3.5" />
                  Panel móvil
                </Badge>
                <div className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-1.5 text-right">
                  <p className="truncate text-[12px] font-semibold text-ink">{user.fullName}</p>
                  <p className="truncate text-[11px] text-stone-500">
                    {shiftStartedLabel ? `Turno desde ${shiftStartedLabel}` : 'Turno activo'}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  className="rounded-2xl"
                  onClick={async () => {
                    await logout();
                    router.push('/delivery/login');
                  }}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Salir
                </Button>
              </div>

              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-[0.95rem] border border-stone-200 bg-white text-ink shadow-[0_8px_18px_rgba(15,23,42,0.06)] transition hover:border-brand-300 hover:bg-brand-50 lg:hidden"
                onClick={() => setMenuOpen((current) => !current)}
                aria-label={menuOpen ? 'Cerrar menú de domiciliarios' : 'Abrir menú de domiciliarios'}
              >
                {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </header>

        {menuOpen ? (
          <div className="fixed inset-0 z-50 bg-stone-950/28 backdrop-blur-[1px] lg:hidden" onClick={() => setMenuOpen(false)}>
            <div
              className="absolute inset-x-3 top-20 rounded-[1.7rem] border border-stone-200 bg-white p-4 shadow-[0_24px_70px_rgba(15,23,42,0.18)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500">Sesión activa</p>
                  <p className="mt-1 text-[15px] font-semibold text-ink">{user.fullName}</p>
                  <p className="mt-0.5 text-[12px] text-stone-500">
                    {shiftStartedLabel ? `Turno desde ${shiftStartedLabel}` : 'Panel operativo listo'}
                  </p>
                </div>
                <Badge tone="neutral" className="gap-1.5">
                  <ClipboardList className="h-3.5 w-3.5" />
                  Entregas
                </Badge>
              </div>
              <div className="mt-4 grid gap-2">
                <Button
                  variant="secondary"
                  className="justify-center rounded-2xl"
                  onClick={async () => {
                    setMenuOpen(false);
                    await logout();
                    router.push('/delivery/login');
                  }}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Cerrar sesión
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        <main className="overflow-hidden rounded-[1.45rem] border border-stone-200 bg-white shadow-soft sm:rounded-[1.8rem]">
          {children}
        </main>
      </div>
    </div>
  );
}
