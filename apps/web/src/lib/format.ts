export function formatCurrency(value: number | string | null | undefined) {
  return `COP\u00A0${Math.round(Number(value ?? 0)).toLocaleString('es-CO')}`;
}

export function formatNumber(value: number | string | null | undefined) {
  return Number(value ?? 0).toLocaleString('es-CO');
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) {
    return 'Sin fecha';
  }

  return new Date(value).toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) {
    return 'Sin fecha';
  }

  return new Date(value).toLocaleString('es-CO', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function matchesSearch(parts: Array<string | number | null | undefined>, term: string) {
  const normalized = term.toLowerCase().trim();
  if (!normalized) {
    return true;
  }

  return parts
    .filter((part): part is string | number => part != null)
    .some((part) => String(part).toLowerCase().includes(normalized));
}
