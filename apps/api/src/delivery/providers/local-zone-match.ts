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

// Closed vocabulary for a bare local-zone reference: the alias words themselves plus purely
// structural/connector words that only ever compose a zone label (e.g. "barrio Condados",
// "sector la Alborada"), never an independently-addressable location. Deliberately does NOT
// include street/unit designators (calle, carrera, casa, manzana, apto, etc.), nor any other
// semantic word \u2014 those indicate a specific address or unrelated prose, not a zone label.
const zoneVocabulary = new Set([
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

// A local-zone alias must be trusted as a deterministic, no-geocoding-required zone match only
// when EVERY token of the candidate text belongs to the closed zone vocabulary above \u2014 not
// merely when "few enough" extra words are present. This blocks an arbitrary, otherwise
// invalid/unparseable address from becoming checkout-eligible merely because it happens to
// contain the alias token somewhere inside a longer, unrelated string (e.g. street number,
// apartment, distant reference, or any surrounding prose at all \u2014 "vivo en alborada", "casa
// alborada", "calle alborada" all fail because "vivo"/"en"/"casa"/"calle" are not zone
// vocabulary). Anything containing digits, or any single token outside this whitelist, is
// treated as a real/unrelated address and must go through normal geocoding + coverage +
// pricing instead of the free-zone shortcut.
function isPureZoneReference(candidate: string): boolean {
  if (/\d/.test(candidate)) return false;
  const tokens = candidate.split(' ').filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => zoneVocabulary.has(token));
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
    if (matchedAlias && isPureZoneReference(candidate)) {
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
