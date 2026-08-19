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
// semantic word — those indicate a specific address or unrelated prose, not a zone label.
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
// when EVERY token of the candidate text belongs to the closed zone vocabulary above — not
// merely when "few enough" extra words are present. This blocks an arbitrary, otherwise
// invalid/unparseable address from becoming checkout-eligible merely because it happens to
// contain the alias token somewhere inside a longer, unrelated string (e.g. street number,
// apartment, distant reference, or any surrounding prose at all — "vivo en alborada", "casa
// alborada", "calle alborada" all fail because "vivo"/"en"/"casa"/"calle" are not zone
// vocabulary). Anything containing digits, or any single token outside this whitelist, is
// treated as a real/unrelated address and must go through normal geocoding + coverage +
// pricing instead of the free-zone shortcut.
function isPureZoneReference(candidate: string): boolean {
  if (/\d/.test(candidate)) return false;
  const tokens = candidate.split(' ').filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => zoneVocabulary.has(token));
}

// CROSS_FIELD_BYPASS guard. addressText/neighborhood/reference must never be evaluated as three
// independent, unrelated candidates: a LOCAL_FREE match has to depend on the supplied address AS
// A WHOLE. Digits are the unambiguous signature of an independently-addressable location (a
// street/unit/apartment number — "Calle 45 #12-34", "Manzana 5 casa 12"), and a small closed set
// of Colombian street/route designators carries the same signal even without a digit present
// ("Carrera Real", "Avenida Distante"). If ANY supplied field carries this signal, the alias
// appearing in a DIFFERENT field can no longer be trusted alone: the whole submission must fall
// through to real geocoding + coverage + pricing instead of the free-zone text shortcut, because
// another field is describing a real, potentially different/distant address, not just more zone
// label. This is intentionally narrower than "any non-zone-vocabulary token" — plain descriptive
// prose without digits or a street designator (e.g. "casa esquinera, porton azul") is not by
// itself proof of a different address, and is treated as a legitimate complement to the zone
// label instead (see hasZoneAddressComplement / ZONE_ONLY_ADDRESS_COMPLETION handling in
// delivery-pricing.engine.ts) rather than a bypass vector.
const streetDesignators = new Set([
  'calle',
  'cl',
  'cll',
  'carrera',
  'cra',
  'cr',
  'kra',
  'avenida',
  'av',
  'diagonal',
  'dg',
  'transversal',
  'tv',
  'manzana',
  'mz',
  'apto',
  'apartamento',
  'torre',
  'bloque',
  'autopista',
  'vereda',
  'kilometro',
  'km',
]);

function hasConflictingAddressSignal(candidate: string): boolean {
  if (/\d/.test(candidate)) return true;
  const tokens = candidate.split(' ').filter(Boolean);
  return tokens.some((token) => streetDesignators.has(token));
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

function candidatesOf(input: { addressText?: string | null; neighborhood?: string | null; reference?: string | null }) {
  return [input.neighborhood, input.addressText, input.reference].map(normalizeLocalZoneText).filter(Boolean);
}

// ZONE_ONLY_ADDRESS_COMPLETION support. Whether the supplied fields contain any genuine content
// beyond the bare zone label itself — e.g. a descriptive reference ("casa esquinera, porton
// azul") in addition to the zone alias. A bare zone label alone ("Alborada", "barrio Condados")
// identifies the FREE ZONE for pricing purposes but is not, by itself, a complete/deliverable
// address for a courier. Intended to be called once matchLocalZone has already confirmed there is
// no conflicting-address signal in any field, so any "impure" candidate found here is genuine
// descriptive complement, not a different/unrelated address.
export function hasZoneAddressComplement(input: {
  addressText?: string | null;
  neighborhood?: string | null;
  reference?: string | null;
}): boolean {
  return candidatesOf(input).some((candidate) => !isPureZoneReference(candidate));
}

export function matchLocalZone(input: {
  addressText?: string | null;
  neighborhood?: string | null;
  reference?: string | null;
}): LocalZoneMatchResult {
  const candidates = candidatesOf(input);

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

  // CROSS_FIELD_BYPASS: a LOCAL_FREE match must depend on the address as a whole. If any supplied
  // field (addressText, neighborhood or reference) independently carries a conflicting-address
  // signal, an alias appearing in a *different* field can no longer be trusted alone — fall
  // through to normal geocoding + coverage + pricing instead of the free-zone text shortcut.
  if (candidates.some(hasConflictingAddressSignal)) {
    return {
      matched: false,
      zoneLabel: null,
      confidence: 'LOW',
      ambiguous: false,
      reason: 'Otro campo de la dirección contiene contenido de dirección real/distinta; requiere geocodificación normal.',
    };
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
