/**
 * Normalización de clientes 2X1 Burger Co.
 * Funciones puras, sin efectos secundarios, testeables.
 */

/** Normaliza texto para búsqueda: lowercase, sin tildes, trim, colapsa espacios */
export function normalizeSearchText(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normaliza teléfono colombiano a 10 dígitos.
 * Maneja: 3237963047, 573237963047, +57 323 796 3047, 57-323-796-3047
 * Retorna string de 10 dígitos o null si es inválido.
 */
export function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;

  // Quitar todo excepto dígitos
  const digits = value.replace(/\D/g, '');

  // Colombiano sin prefijo: 10 dígitos, empieza con 3
  if (digits.length === 10 && digits.startsWith('3')) {
    return digits;
  }

  // Colombiano con prefijo 57: 12 dígitos, empieza con 573
  if (digits.length === 12 && digits.startsWith('573')) {
    return digits.slice(2);
  }

  // Menos de 7 dígitos: inválido
  if (digits.length < 7) {
    return null;
  }

  // Caso límite: retornar últimos 10 si son válidos
  const last10 = digits.slice(-10);
  if (last10.length === 10 && last10.startsWith('3')) {
    return last10;
  }

  return null;
}

/** Normaliza dirección: lowercase, sin tildes, trim, colapsa espacios */
export function normalizeAddressText(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[#]/g, '')
    .trim();
}

/** Extrae nombre de barrio de una dirección si coincide con zonas conocidas */
export function extractNeighborhood(
  address: string | null | undefined,
  knownNeighborhoods: string[] = [],
): string | null {
  if (!address) return null;
  const normalized = normalizeAddressText(address);
  for (const hood of knownNeighborhoods) {
    if (normalized.includes(normalizeAddressText(hood))) {
      return normalizeAddressText(hood);
    }
  }
  return null;
}
