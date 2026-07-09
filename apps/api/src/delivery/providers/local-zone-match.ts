import type { LocalZoneMatchResult } from './provider-types';

const strongAliases = [
  'condados',
  'alborada',
  'condados de la alborada',
  'la alborada',
  'barrio alborada',
  'condados alborada',
];

const ambiguousPrefixes = ['cerca de ', 'por ', 'cerca a ', 'al lado de ', 'via '];

export function normalizeLocalZoneText(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchLocalZone(input: {
  addressText?: string | null;
  neighborhood?: string | null;
  reference?: string | null;
}): LocalZoneMatchResult {
  const candidates = [input.neighborhood, input.addressText, input.reference]
    .map(normalizeLocalZoneText)
    .filter(Boolean);

  for (const candidate of candidates) {
    if (ambiguousPrefixes.some((prefix) => candidate.includes(`${prefix}alborada`) || candidate.includes(`${prefix}condados`))) {
      return {
        matched: false,
        zoneLabel: null,
        confidence: 'LOW',
        ambiguous: true,
        reason: 'Referencia local ambigua, requiere confirmación manual.',
      };
    }
  }

  for (const candidate of candidates) {
    if (strongAliases.includes(candidate)) {
      return {
        matched: true,
        zoneLabel: candidate.includes('condados') ? 'Condados de la Alborada' : 'Alborada',
        confidence: 'HIGH',
        ambiguous: false,
        reason: 'Alias local exacto.',
      };
    }
  }

  for (const candidate of candidates) {
    const matchedAlias = strongAliases.find((alias) => candidate.includes(alias));
    if (matchedAlias) {
      return {
        matched: true,
        zoneLabel: matchedAlias.includes('condados') ? 'Condados de la Alborada' : 'Alborada',
        confidence: 'MEDIUM',
        ambiguous: false,
        reason: 'Alias local fuerte dentro del texto.',
      };
    }
  }

  return {
    matched: false,
    zoneLabel: null,
    confidence: 'LOW',
    ambiguous: false,
    reason: 'Sin coincidencia local preparatoria.',
  };
}
