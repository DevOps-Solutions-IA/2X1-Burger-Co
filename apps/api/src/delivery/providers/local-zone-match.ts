import type { LocalZoneMatchResult } from './provider-types';

// ---------------------------------------------------------------------------------------------
// SOFIA Address Remediation (A1 — normalization/completeness). See
// `../delivery-pricing/delivery-checkout-authorization.ts` file header for the full architecture
// story: two prior remediation rounds patched a "conflicting signal" DENYLIST (reject a match only
// when a field contains one of ~25 known-bad words) that an automated red team broke twice — any
// place name, city, or prose NOT on the list (e.g. "Bogota Chapinero", "Medellin", "Cerca de la
// playa en Cartagena") sailed through as a "safe complement" for an unrelated location. This file
// replaces that inverted denylist approach entirely with:
//   1. Unicode-safe normalization (NFKC + zero-width strip + NFD diacritic-strip) — RULE 7.
//   2. A Unicode-aware digit check (`\p{Nd}`, not bare `/\d/`) — RULE 8.
//   3. A POSITIVE, closed-vocabulary, token-by-token structural completeness check — RULE 9/10.
// ---------------------------------------------------------------------------------------------

const strongAliases = [
  'condados',
  'alborada',
  'condados de la alborada',
  'la alborada',
  'barrio alborada',
  'condados alborada',
];

const ambiguousPrefixes = ['cerca de ', 'por ', 'cerca a ', 'al lado de ', 'via '];

/**
 * Zero-width / invisible-format Unicode characters that must be STRIPPED OUTRIGHT (not replaced
 * with a space, which would fragment an otherwise-legitimate word into two tokens). This is a
 * small, well-known, fixed set of format characters (zero-width space/non-joiner/joiner, BOM,
 * word joiner, soft hyphen) — it is NOT a confusables map and does NOT do any cross-script
 * folding. We deliberately never fold visually-similar characters from one script into another
 * (e.g. Cyrillic "а" U+0430 must NEVER be silently treated as Latin "a" U+0061) — doing so would
 * be its own new vulnerability. A homoglyph-substituted alias is expected — and verified by
 * regression test — to simply fail to match any known alias/vocabulary token and fall through to
 * normal geocoding, exactly like any other unrecognized string.
 */
const INVISIBLE_FORMAT_CHARS = /[\u200B-\u200D\uFEFF\u2060\u00AD]/g;

/**
 * RULE 7: Unicode-safe normalization for structural address/zone-reference comparison.
 *
 * Order matters:
 *   1. NFKC — canonicalizes *compatibility* variants (fullwidth Latin letters/digits, ligatures,
 *      etc.) that plain NFD+diacritic-strip does NOT touch. This is what turns "Casa４５" into
 *      "Casa45" before any digit/vocabulary check runs.
 *   2. Strip invisible/zero-width format characters — BEFORE punctuation collapsing, so an
 *      adversarial zero-width character inserted mid-word cannot fragment it into two unrelated
 *      tokens (which would otherwise both break legitimate matches and, in principle, be used to
 *      dodge a token-based check).
 *   3. NFD + strip combining diacritical marks — "CÓNDADOS" -> "condados".
 *   4. Lowercase, then collapse any remaining run of non-letter/non-digit characters to a single
 *      space and trim.
 *
 * This is the SINGLE canonical normalizer for all zone-matching and zone-completeness text
 * comparison in this remediation. `delivery-pricing/delivery-checkout-authorization.ts`
 * re-exports it rather than maintaining a second copy that could silently drift — that exact kind
 * of drift (two independently-evolving notions of "the same text") is the class of bug this round
 * closes.
 */
export function normalizeStructuralAddressText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKC')
    .replace(INVISIBLE_FORMAT_CHARS, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** @deprecated Alias kept for call-site continuity; use `normalizeStructuralAddressText` in new
 * code. Both names point at the exact same function — never two divergent implementations. */
export const normalizeLocalZoneText = normalizeStructuralAddressText;

/**
 * RULE 8: Unicode-digit-aware check. Round 2's fix used a bare `/\d/` (ASCII `0-9` only) and was
 * broken by fullwidth digits (U+FF10-FF19, e.g. "Casa ４５") and other Unicode decimal-digit
 * blocks (e.g. Arabic-Indic U+0660-0669). `\p{Nd}` matches the full Unicode "Decimal_Number"
 * category, covering all of those. Tested against the RAW (pre-normalization) value so the result
 * does not depend on normalization ordering. Use this — never a bare `/\d/` — anywhere a "does
 * this text contain a house/street number" signal is needed.
 */
export function hasUnicodeDigit(text: string | null | undefined): boolean {
  return /\p{Nd}/u.test(text ?? '');
}

export type ZoneReferenceCandidateInput = {
  addressText?: string | null;
  neighborhood?: string | null;
  reference?: string | null;
};

export function matchLocalZone(input: ZoneReferenceCandidateInput): LocalZoneMatchResult {
  const candidates = [input.neighborhood, input.addressText, input.reference]
    .map(normalizeStructuralAddressText)
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

// ---------------------------------------------------------------------------------------------
// POSITIVE / STRUCTURAL zone-only-reference completeness check — RULE 9/10, the core fix.
//
// This determines `ADDRESS_COMPLETE` for a LOCAL_FREE zone-only text match (no real geocoded
// point yet — see TRUSTED_POST_GEOCODING_ZONE_HANDLING in delivery-external-data.service.ts /
// delivery-pricing.engine.ts, which always outranks this text-only shortcut when a real point is
// already known).
//
// MANDATORY RULE 1/2: a bare zone alias ("Alborada") NEVER by itself implies ADDRESS_COMPLETE.
// MANDATORY RULE 9: no growing denylist of forbidden words as the primary authority.
// MANDATORY RULE 10: define what a valid, COMPLETE zone-only reference IS via a closed, positive
//   vocabulary, checked token-by-token, across EVERY supplied candidate field — not just the field
//   the alias happened to be found in (that per-field blind spot is exactly how both prior rounds
//   were broken: "Bogota Chapinero" in `addressText` sailed through because only `reference`,
//   which held "alborada", was checked).
//
// Any token, in ANY field, that is not affirmatively recognized as either (a) part of the zone
// alias itself, (b) a closed set of Spanish grammatical connector/function words, or (c) a closed,
// positive vocabulary of genuine courier-actionable landmark/descriptor words, fails the check
// outright and falls through to normal geocoding. A real Unicode digit anywhere is treated as
// proof of a genuine, independently-addressable location (a real house/street number) that must
// be verified by real geocoding, not trusted via this text shortcut.
// ---------------------------------------------------------------------------------------------

/** Tokens that make up the known local-free-zone aliases themselves. Present so a field composed
 * purely of the alias (optionally with grammatical filler) does not fail the vocabulary check —
 * but see `hasGenuineContent` below: these tokens alone never satisfy completeness. */
const ZONE_ANCHOR_TOKENS = new Set(['condados', 'alborada', 'barrio']);

/** Closed, fixed set of Spanish grammatical connector/function words. These make an otherwise
 * valid descriptive phrase read naturally but never by themselves count as "genuine complement
 * content" — see `hasGenuineContent` below. */
const FUNCTION_VOCAB_TOKENS = new Set([
  'de', 'la', 'el', 'los', 'las', 'al', 'del', 'en', 'a', 'un', 'una', 'y', 'con', 'sin', 'mas', 'que', 'es', 'esta', 'este', 'muy',
]);

/**
 * Closed, fixed, POSITIVE vocabulary of genuine courier-actionable landmark/descriptor words for
 * an informal (no formal street addressing) local reference. This is an allowlist — MANDATORY
 * RULE 9/10: anything NOT in this list (plus the anchor/function sets above) is treated as
 * unproven and fails the check, rather than the inverted "anything not explicitly bad is safe"
 * logic that broke both prior remediation rounds.
 *
 * Deliberately EXCLUDES: place/city names and generic geographic nouns (those can never be
 * enumerated closed-world — "Bogota", "Medellin", "Cartagena", "playa" are intentionally absent),
 * and street/route designators (calle, carrera, avenida, kra, cra, diagonal, transversal,
 * autopista, kilometro, ...) which signal a genuine, formally-addressed location that must go
 * through real geocoding, not this text shortcut. Digits are handled separately via
 * `hasUnicodeDigit`, for the same reason.
 */
const CONTENT_VOCAB_TOKENS = new Set([
  'casa', 'esquina', 'esquinera', 'esquinero',
  'porton', 'reja', 'puerta', 'entrada', 'salida',
  'local', 'negocio', 'tienda', 'cancha', 'iglesia', 'parque', 'lote', 'apto', 'apartamento', 'piso',
  'frente', 'atras', 'detras', 'lado', 'junto', 'cerca',
  'arriba', 'abajo', 'derecha', 'izquierda', 'mano',
  'primera', 'primero', 'segunda', 'segundo', 'tercera', 'tercero', 'ultima', 'ultimo',
  'azul', 'roja', 'rojo', 'verde', 'blanca', 'blanco', 'amarilla', 'amarillo', 'negra', 'negro', 'gris',
  'grande', 'pequena', 'pequeno',
]);

export type ZoneAddressCompletenessInput = ZoneReferenceCandidateInput;

export function isZoneOnlyReferenceStructurallyComplete(input: ZoneAddressCompletenessInput): boolean {
  const rawFields = [input.addressText, input.neighborhood, input.reference];

  // RULE 8: a real Unicode digit anywhere in ANY supplied field is treated as proof of a genuine,
  // independently-addressable location (a real house/street number), which must be verified by
  // real geocoding — never trusted via this text-only shortcut. Tested on the RAW value so the
  // result never depends on normalization having run first.
  if (rawFields.some((field) => hasUnicodeDigit(field))) {
    return false;
  }

  const normalizedFields = rawFields.map((field) => normalizeStructuralAddressText(field)).filter((field) => field.length > 0);

  if (normalizedFields.length === 0) {
    return false;
  }

  let hasGenuineContent = false;

  for (const field of normalizedFields) {
    for (const token of field.split(' ')) {
      if (!token) continue;
      if (CONTENT_VOCAB_TOKENS.has(token)) {
        hasGenuineContent = true;
        continue;
      }
      if (ZONE_ANCHOR_TOKENS.has(token) || FUNCTION_VOCAB_TOKENS.has(token)) {
        continue;
      }
      // RULE 10: any token, in ANY field, outside the closed positive vocabulary fails the check
      // outright — it must never be treated as a "safe complement" merely for not matching a bad
      // word list. This is the exact inversion the red team exploited in both prior rounds.
      return false;
    }
  }

  // A bare zone alias (or alias + pure grammatical filler) with no genuine descriptive content is,
  // by definition, not a courier-actionable complete reference — MANDATORY RULE 1/2.
  return hasGenuineContent;
}
