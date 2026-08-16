/** Helpers de presentación puramente derivados — sin llamadas a red ni estado. */

/** Nombre de cliente listo para mostrar, con fallback cuando el CRM no tiene displayName capturado. */
export function customerDisplayName(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'Cliente sin nombre';
}

/** Iniciales de un cliente para el avatar del directorio y de Customer 360 (máx. 2 letras). */
export function customerInitials(name: string | null | undefined): string {
  const trimmed = name?.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '');
  return initials.join('') || '?';
}
