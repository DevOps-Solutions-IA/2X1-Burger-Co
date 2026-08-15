/**
 * Formateo de solo presentación para el dashboard de Pagos. No transforma
 * ni deriva estado financiero — únicamente formatea valores que ya vienen
 * del backend.
 */
export function formatPaymentAmount(amount: number | string | null | undefined, currency?: string | null): string {
  if (amount === null || amount === undefined) return '—';
  const numeric = typeof amount === 'string' ? Number(amount) : amount;
  if (Number.isNaN(numeric)) return String(amount);
  const formatted = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(numeric);
  return currency ? `${formatted} ${currency}` : formatted;
}

export function formatPaymentDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function truncateId(id: string | null | undefined, length = 10): string {
  if (!id) return '—';
  return id.length > length ? `${id.slice(0, length)}…` : id;
}
