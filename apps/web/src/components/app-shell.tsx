'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Package2,
  Boxes,
  ShoppingCart,
  Wallet,
  ReceiptText,
  LogOut,
  Store,
  ChefHat,
  Truck,
  PiggyBank,
  Tags,
  Users,
  ContactRound,
  Settings,
  Armchair,
  Bot,
  Menu,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/features/auth/auth-provider';
import { hasPermission } from '@/features/auth/access-control';

const navSections = [
  {
    title: 'Operación',
    items: [
      { href: '/dashboard', label: 'Inicio', icon: LayoutDashboard },
      { href: '/pos', label: 'Punto de venta', icon: ShoppingCart, permission: 'sales.read' },
      { href: '/tables', label: 'Mesas', icon: Armchair, permission: 'tables.read' },
      { href: '/deliveries', label: 'Domicilios', icon: Truck, permission: 'delivery.read' },
      { href: '/sofia', label: 'Sofía', icon: Bot, permission: 'orders.read' },
      { href: '/sofia/crm', label: 'Clientes Sofía', icon: ContactRound, permission: 'orders.read' },
      { href: '/cash', label: 'Caja', icon: Wallet, permission: 'cash.read' },
      { href: '/reports', label: 'Reportes e histórico', icon: ReceiptText, permission: 'reports.read' },
    ],
  },
  {
    title: 'Abastecimiento',
    items: [
      { href: '/inventory', label: 'Inventario', icon: Boxes, permission: 'inventory.read' },
      { href: '/purchases', label: 'Compras', icon: Store, permission: 'purchases.read' },
      { href: '/expenses', label: 'Gastos', icon: PiggyBank, permission: 'expenses.read' },
      { href: '/suppliers', label: 'Proveedores', icon: Truck, permission: 'suppliers.read' },
    ],
  },
  {
    title: 'Catálogo',
    items: [
      { href: '/products', label: 'Productos', icon: Package2, permission: 'products.read' },
      { href: '/ingredients', label: 'Insumos', icon: ChefHat, permission: 'ingredients.read' },
      { href: '/categories', label: 'Categorías', icon: Tags, permission: 'categories.read' },
      { href: '/recipes', label: 'Recetas', icon: ChefHat, permission: 'recipes.read' },
    ],
  },
  {
    title: 'Administración',
    items: [
      { href: '/users', label: 'Usuarios', icon: Users, permission: 'users.read' },
      { href: '/settings', label: 'Configuración', icon: Settings, permission: 'settings.read' },
    ],
  },
];

const saleCountersSchema = z.object({
  sales: z.object({
    bestSellers: z.array(z.object({
      productName: z.string(),
      quantity: z.union([z.number(), z.string()]),
    }).passthrough()),
    itemsSold: z.union([z.number(), z.string()]),
  }).passthrough(),
}).passthrough();

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Cerrar navegación móvil al navegar
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // Cerrar navegación móvil con ESC
  useEffect(() => {
    if (!mobileNavOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [mobileNavOpen]);

  // Bloquear scroll del body cuando el drawer móvil está abierto
  useEffect(() => {
    if (mobileNavOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileNavOpen]);

  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
  const visibleNavSections = navSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => hasPermission(user?.permissions, item.permission)),
    }))
    .filter((section) => section.items.length > 0);
  const today = new Date().toLocaleDateString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const primaryRole = user?.roles[0]
    ? user.roles[0]
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase())
    : 'Sesión activa';

  return (
    <div className="min-h-screen bg-surface text-ink">
      {/* Botón hamburger para móvil */}
      <button
        type="button"
        className="fixed left-3 top-3 z-[60] flex h-11 w-11 items-center justify-center rounded-2xl border border-stone-200 bg-white text-ink shadow-soft transition active:scale-95 lg:hidden"
        onClick={() => setMobileNavOpen((v) => !v)}
        aria-label={mobileNavOpen ? 'Cerrar menú de navegación' : 'Abrir menú de navegación'}
        aria-expanded={mobileNavOpen}
      >
        {mobileNavOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Backdrop overlay para móvil */}
      {mobileNavOpen ? (
        <div
          className="fixed inset-0 z-[55] bg-black/30 backdrop-blur-sm lg:hidden"
          onClick={closeMobileNav}
          aria-hidden="true"
        />
      ) : null}

      <div className="mx-auto min-h-screen w-full max-w-[1600px] px-4 py-4 lg:h-screen lg:overflow-hidden lg:px-6">
        {/* Sidebar: overlay en móvil, fijo en desktop */}
        <aside
          role="navigation"
          aria-label="Navegación principal"
          className={cn(
            'rounded-[2rem] border border-white/[0.06] bg-black px-5 py-5 text-stone-100 shadow-2xl transition-transform duration-200',
            'lg:fixed lg:bottom-4 lg:top-4 lg:flex lg:w-[280px] lg:flex-col lg:[left:max(1.5rem,calc((100vw-1600px)/2+1.5rem))]',
            'fixed inset-4 z-[55] overflow-y-auto',
            mobileNavOpen ? 'translate-x-0' : '-translate-x-[calc(100%+2rem)] lg:translate-x-0',
          )}
        >
          <div className="flex flex-1 flex-col">
            {/* Logo */}
            <div className="flex justify-center py-4 shrink-0">
              <div className="relative w-full max-w-[200px]">
                <Image
                  src="/brand/sidebar-logo.png"
                  alt="2X1 Burger Co."
                  width={160}
                  height={56}
                  priority
                  className="h-auto w-full object-contain object-center"
                />
              </div>
            </div>

            {/* Navegación */}
            <nav className="flex flex-1 flex-col justify-between px-1 overflow-hidden">
              {visibleNavSections.map((section) => (
                <div key={section.title}>
                  <h2 className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-stone-400">
                    {section.title}
                  </h2>
                  <div className="space-y-0.5">
                    {section.items.map((item) => {
                      const Icon = item.icon;
                      const active =
                        pathname === item.href ||
                        (item.href !== '/sofia' && pathname?.startsWith(`${item.href}/`) === true);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          data-testid={`nav-${item.href.replace('/', '') || 'home'}`}
                          className={cn(
                            'group flex items-center gap-2.5 rounded-xl px-3 py-2 text-[12.5px] font-medium transition-all duration-200',
                            active
                              ? 'bg-brand-500 text-ink shadow-[0_6px_16px_rgba(255,159,28,0.25)]'
                              : 'text-stone-300 hover:bg-white/[0.06] hover:text-white',
                          )}
                        >
                          <Icon className={cn('h-4 w-4 shrink-0 transition-colors', active ? 'text-ink' : 'text-stone-400 group-hover:text-stone-200')} />
                          <span className="flex-1 truncate">{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>

            {/* Sesión */}
            <div className="mt-auto border-t border-white/[0.08] px-1 pt-3">
              <div className="flex items-center gap-2.5 rounded-xl bg-white/[0.04] px-3 py-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-500 text-[11px] font-bold text-ink">
                  {user?.fullName?.charAt(0)?.toUpperCase() ?? 'U'}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold text-white">
                    {user?.fullName ?? 'Usuario activo'}
                  </p>
                  <p className="truncate text-[10px] text-stone-400">{primaryRole}</p>
                </div>
                <button
                  type="button"
                  aria-label="Cerrar sesión"
                  onClick={async () => {
                    await logout();
                    router.push('/login');
                  }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-400 transition hover:bg-white/[0.08] hover:text-white"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </aside>

        <div className="min-h-0 lg:ml-[296px] lg:h-[calc(100vh-2rem)]">
          <div className="min-h-0 lg:h-full lg:overflow-y-auto lg:pr-1">
            <div className="sticky top-0 z-30 pb-4 pt-0">
              <div className="absolute inset-x-0 inset-y-0 rounded-[2rem] bg-gradient-to-b from-surface via-surface/95 to-surface/70 backdrop-blur-sm" />
              <div className="relative rounded-[2rem] border border-white/[0.08] bg-black px-6 py-3 shadow-2xl">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <p className="text-[12px] font-semibold capitalize text-white whitespace-nowrap">{today}</p>
                    <span className="hidden sm:inline-flex h-4 w-px bg-white/15" />
                    <p className="hidden sm:block text-[11px] font-medium text-stone-400 truncate">Jornada actual</p>
                  </div>
                  <div
                    className="flex items-center gap-1.5 overflow-x-auto hide-scrollbar"
                    role="region"
                    aria-label="Resumen de ventas de la jornada"
                    tabIndex={0}
                  >
                    <SaleCounters />
                  </div>
                </div>
              </div>
            </div>

            <main
              id="main-content"
              data-testid="app-main"
              className="overflow-hidden rounded-[2rem] border border-stone-200 bg-white shadow-soft"
              tabIndex={-1}
            >
              {children}
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}

function SaleCounters() {
  const { data } = useQuery({
    queryKey: ['sale-counters'],
    queryFn: async () => saleCountersSchema.parse(await apiFetch<unknown>('/reports/operational')),
    refetchInterval: 3000,
  });

  const sellers = data?.sales.bestSellers ?? [];
  const itemsSold = Number(data?.sales.itemsSold ?? 0);

  const targetProducts = [
    { key: '2x1', label: '2X1', match: '2x1' },
    { key: 'doble', label: 'Doble Carne', match: 'doble' },
    { key: 'sencilla', label: 'Sencilla', match: 'sencilla' },
    { key: 'maxi', label: 'Maxy Family', match: 'maxi' },
  ];

  const counters = targetProducts.map((tp) => {
    const found = sellers.find((s) =>
      (s.productName ?? '').toLowerCase().includes(tp.match),
    );
    return { label: tp.label, qty: found ? Number(found.quantity ?? 0) : 0 };
  });

  return (
    <>
      <span
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-[12px] font-bold text-white shadow-sm"
        data-testid="topbar-items-sold"
      >
        <span className="text-brand-400">{itemsSold}</span> unidades vendidas hoy
      </span>
      {counters.map((c) => (
        <span
          key={c.label}
          className="inline-flex shrink-0 items-center gap-2 rounded-full border border-brand-500/40 bg-brand-500/15 px-4 py-2 text-[12px] font-bold shadow-sm backdrop-blur-sm transition hover:border-brand-400 hover:bg-brand-500/25"
        >
          <span className="text-brand-300">{c.label}</span>
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-500 px-1.5 text-[11px] font-extrabold text-black">{c.qty}</span>
        </span>
      ))}
    </>
  );
}
