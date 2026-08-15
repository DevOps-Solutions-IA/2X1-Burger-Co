export function customerDisplayName(displayName: string | null) {
  return displayName?.trim() || 'Cliente sin nombre registrado';
}

export function humanizeCrmCode(value: string) {
  const normalized = value.replace(/_/g, ' ').toLocaleLowerCase('es-CO');
  return normalized.charAt(0).toLocaleUpperCase('es-CO') + normalized.slice(1);
}
