/**
 * Tema oscuro "consola" — SOLO para la Torre de Control SOFIA
 * (`ControlTowerFrame` y sus 6 páginas). El CRM y el resto de la
 * aplicación (Inventario, POS, Caja, etc.) NUNCA usan estas clases:
 * se aplican como `className` explícito, nunca vía el variant `dark:`
 * de Tailwind (ese variant reacciona a `prefers-color-scheme` del SO
 * y oscurecería toda la app para cualquier usuario con tema oscuro
 * en su sistema — por eso este archivo existe en vez de usar `dark:`).
 *
 * Paleta: fondo violeta-carbón (`sofia-950/900`, el mismo tono de marca
 * que antes vivía solo en un chip) — la Torre de Control ahora ES el
 * territorio visual de SOFIA, no un dato más dentro del panel blanco
 * genérico del resto del sistema.
 */

export const CONSOLE_SHELL_CLASS =
  'relative isolate overflow-hidden rounded-[1.75rem] bg-[radial-gradient(ellipse_140%_60%_at_50%_-20%,#2E1866_0%,#1A0B3D_42%,#0B0420_100%)] p-4 shadow-[0_40px_80px_-40px_rgba(11,4,32,0.9)] md:p-6';

/** Rejilla de puntos muy tenue sobre el shell — textura de "panel técnico", no decoración ruidosa. */
export const CONSOLE_GRID_OVERLAY_CLASS =
  'pointer-events-none absolute inset-0 -z-10 opacity-[0.07] [background-image:radial-gradient(circle,#fff_1px,transparent_1px)] [background-size:22px_22px]';

export const CONSOLE_CARD_CLASS =
  'rounded-[1.45rem] border border-white/10 bg-white/[0.045] p-4.5 shadow-[0_18px_40px_-24px_rgba(0,0,0,0.65)] backdrop-blur-sm md:p-5';

export const CONSOLE_INSET_CLASS = 'rounded-2xl border border-white/10 bg-black/25';

export const CONSOLE_TEXT = {
  /** Texto principal — números grandes, títulos. Contraste >12:1 sobre el shell. */
  primary: 'text-white',
  /** Texto de cuerpo/legible — mínimo AA garantizado sobre el shell. */
  secondary: 'text-white/78',
  /** Solo para elementos `aria-hidden`/decorativos — NUNCA en texto legible (misma regla que `text-stone-400` en el tema claro). */
  decorative: 'text-white/40',
  eyebrow: 'text-brand-400',
} as const;

export const CONSOLE_BORDER_CLASS = 'border-white/10';
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
