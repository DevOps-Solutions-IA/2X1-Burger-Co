/**
 * Tema oscuro "consola" — SOLO para la Torre de Control SOFIA
 * (`ControlTowerFrame` y sus 6 páginas). El CRM y el resto de la
 * aplicación (Inventario, POS, Caja, etc.) NUNCA usan estas clases:
 * se aplican como `className` explícito, nunca vía el variant `dark:`
 * de Tailwind (ese variant reacciona a `prefers-color-scheme` del SO
 * y oscurecería toda la app para cualquier usuario con tema oscuro
 * en su sistema — por eso este archivo existe en vez de usar `dark:`).
 *
 * Paleta: EXACTAMENTE el negro ya establecido en `app-shell.tsx`
 * (sidebar y barra superior) — `bg-black` plano, `border-white/[0.06]`,
 * `shadow-2xl`, sin degradado ni resplandor de color. Nada de morado,
 * nada de gradientes ni "glow" decorativo: eso lee como plantilla
 * genérica de dashboard de IA, no como la identidad negra ya
 * establecida de la marca. El único acento de color es `brand-*`
 * (ámbar/naranja del logo), usado con la misma moderación puntual que
 * ya usa el nav activo del sidebar (`shadow-[0_6px_16px_rgba(255,159,28,0.25)]`
 * sobre un elemento pequeño, nunca como fondo de página).
 */

export const CONSOLE_SHELL_CLASS =
  'relative isolate overflow-hidden rounded-[2rem] border border-white/[0.06] bg-black p-4 shadow-2xl md:p-6';

export const CONSOLE_CARD_CLASS =
  'rounded-[1.45rem] border border-white/[0.06] bg-white/[0.04] p-4.5 shadow-2xl md:p-5';

export const CONSOLE_INSET_CLASS = 'rounded-2xl border border-white/[0.08] bg-white/[0.04]';

export const CONSOLE_TEXT = {
  /** Texto principal — números grandes, títulos. Contraste >12:1 sobre el shell. */
  primary: 'text-white',
  /** Texto de cuerpo/legible — mínimo AA garantizado sobre el shell. */
  secondary: 'text-white/78',
  /** Solo para elementos `aria-hidden`/decorativos — NUNCA en texto legible (misma regla que `text-stone-400` en el tema claro). */
  decorative: 'text-white/40',
  eyebrow: 'text-brand-400',
} as const;

export const CONSOLE_BORDER_CLASS = 'border-white/[0.06]';
export const CONSOLE_DIVIDER_CLASS = 'border-white/[0.08]';

/**
 * Indicador "en vivo": punto sólido + halo `animate-ping` detrás. Se usa
 * para estados que representan el pulso operativo real de SOFIA en este
 * instante (canal conectado, bloqueo activo) — nunca para datos estáticos.
 */
export function consoleLiveDotClass(color: string) {
  return { dot: `relative inline-flex h-2 w-2 rounded-full ${color}`, ping: `absolute inline-flex h-2 w-2 animate-ping rounded-full ${color} opacity-60` };
}

export const CONSOLE_ACCENT_ICON_CLASS = {
  brand: 'border-brand-400/30 bg-brand-400/10 text-brand-300 shadow-[0_0_0_1px_rgba(255,159,28,0.08),0_0_24px_-8px_rgba(255,159,28,0.55)]',
  success: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300 shadow-[0_0_0_1px_rgba(16,185,129,0.08),0_0_24px_-8px_rgba(16,185,129,0.5)]',
  warning: 'border-amber-400/30 bg-amber-400/10 text-amber-300 shadow-[0_0_0_1px_rgba(245,158,11,0.08),0_0_24px_-8px_rgba(245,158,11,0.5)]',
  danger: 'border-red-400/30 bg-red-400/10 text-red-300 shadow-[0_0_0_1px_rgba(239,68,68,0.08),0_0_24px_-8px_rgba(239,68,68,0.5)]',
  ink: 'border-white/15 bg-white/[0.06] text-white/70',
} as const;
