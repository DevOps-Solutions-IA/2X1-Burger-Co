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

// Connector/filler words that may surround a bare zone reference (e.g. "barrio Condados",
// "sector la Alborada") without turning the text into an independently-addressable location
// that needs real geocoding. Deliberately does NOT include street/unit designators (calle,
// carrera, casa, manzana, apto, etc.) \u2014 those indicate a specific address, not a zone label.
const zoneFillerWords = new Set([
  'condados',
  'alborada',
  'de',
  'la',
  'las',
  'los',
  'el',
  'barrio',
  'sector',
  'urbanizacion',
]);

// A local-zone alias must appear as (effectively) the whole candidate text to be trusted as a
// deterministic, no-geocoding-required zone match. This blocks an arbitrary, otherwise
// invalid/unparseable address from becoming checkout-eligible merely because it happens to
// contain the alias token somewhere inside a longer, unrelated string (e.g. street number,
// apartment, distant reference). Anything with digits (street/house/unit numbers) or more than
// a couple of unrelated extra words is treated as a real address and must go through normal
// geocoding + coverage + pricing instead of the free-zone shortcut.
const MAX_EXTRA_ZONE_WORDS = 2;

function isBareZoneReference(candidate: string): boolean {
  if (/\d/.test(candidate)) return false;
  const extraWords = candidate.split(' ').filter((word) => word && !zoneFillerWords.has(word));
  return extraWords.length <= MAX_EXTRA_ZONE_WORDS;
}

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
    if (matchedAlias && isBareZoneReference(candidate)) {
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
