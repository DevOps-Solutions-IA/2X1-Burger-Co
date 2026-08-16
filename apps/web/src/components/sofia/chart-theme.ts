/**
 * Paleta y estilos compartidos para todos los gráficos `recharts` de la
 * Torre de Control. Los colores coinciden exactamente con los tonos
 * semánticos de `StatusBadge`/`status-tone.ts` para que un gráfico y un
 * badge que representen el mismo estado se vean consistentes.
 */
export const SOFIA_CHART_COLORS = {
  success: '#10b981',
  warning: '#f59e0b',
  blocked: '#ef4444',
  pending: '#0ea5e9',
  unknown: '#f97316',
  neutral: '#a8a29e',
  brand: '#f58a07',
} as const;

export const SOFIA_CHART_GRID_COLOR = '#e7e5e4';
export const SOFIA_CHART_AXIS_COLOR = '#78716c';

export const SOFIA_CHART_TOOLTIP_STYLE = {
  contentStyle: {
    borderRadius: '0.85rem',
    border: '1px solid #e7e5e4',
    boxShadow: '0 8px 24px -12px rgba(26,26,26,0.18)',
    fontSize: '12px',
    fontFamily: 'var(--font-body), sans-serif',
    padding: '8px 12px',
  },
  labelStyle: { fontWeight: 700, color: '#1a1a1a', marginBottom: 2 },
  itemStyle: { fontSize: '12px' },
} as const;

export const SOFIA_CHART_AXIS_TICK_STYLE = { fontSize: 11, fill: SOFIA_CHART_AXIS_COLOR };

/**
 * Variante oscura — misma paleta de estado (los colores de segmento no
 * cambian, para que un gráfico siga leyéndose igual que su `StatusBadge`
 * correspondiente), pero grilla/ejes/tooltip legibles sobre el shell
 * violeta-carbón de la Torre de Control.
 */
export const SOFIA_CHART_GRID_COLOR_CONSOLE = 'rgba(255,255,255,0.08)';
export const SOFIA_CHART_AXIS_COLOR_CONSOLE = 'rgba(255,255,255,0.55)';

export const SOFIA_CHART_TOOLTIP_STYLE_CONSOLE = {
  contentStyle: {
    borderRadius: '0.85rem',
    border: '1px solid rgba(255,255,255,0.12)',
    background: '#1A0B3D',
    boxShadow: '0 16px 32px -16px rgba(0,0,0,0.6)',
    fontSize: '12px',
    fontFamily: 'var(--font-body), sans-serif',
    padding: '8px 12px',
  },
  labelStyle: { fontWeight: 700, color: '#ffffff', marginBottom: 2 },
  itemStyle: { fontSize: '12px', color: 'rgba(255,255,255,0.85)' },
} as const;

export const SOFIA_CHART_AXIS_TICK_STYLE_CONSOLE = { fontSize: 11, fill: SOFIA_CHART_AXIS_COLOR_CONSOLE };
