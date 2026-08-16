/** Helpers de presentación puramente derivados — sin llamadas a red ni estado. */

/** Nombre de cliente listo para mostrar, con fallback cuando el CRM no tiene displayName capturado. */
export function customerDisplayName(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'Cliente sin nombre';
}
