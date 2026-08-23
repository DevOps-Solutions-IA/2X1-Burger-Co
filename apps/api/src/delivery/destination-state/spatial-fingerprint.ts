/**
 * SOFIA Address Remediation — Round 5 / A9. Canonical spatial-identity fingerprint.
 *
 * REUSE, NOT REBUILD: normalization reuses `normalizeStructuralAddressText` /
 * `hasUnicodeDigit` from `../providers/local-zone-match.ts` (A1/A2, round 5 predecessor) — the
 * SAME canonical Unicode-safe normalizer already used for zone-alias matching and address-
 * completeness checks. Two independently-evolving text normalizers is exactly the class of drift
 * that broke rounds 1-3 (see that file's header). This module never re-implements normalization;
 * it only adds a deterministic COMBINATION of already-normalized components into one spatial
 * identity value.
 *
 * FAIL-CLOSED ON HOMOGLYPHS: `normalizeStructuralAddressText` deliberately does NOT fold
 * visually-similar characters across scripts (e.g. Cyrillic "а" U+0430 vs Latin "a" U+0061 stay
 * distinct). That property is exactly what this module needs: fingerprint EQUALITY must mean SAME
 * spatial destination, never merely similar-looking text. A homoglyph-substituted address
 * therefore normalizes to different text and produces a DIFFERENT fingerprint — it can never be
 * mistaken for the real one it is impersonating (a false "same destination" match), and it also
 * never matches any known real destination, so it correctly falls through to being treated as an
 * unrecognized (fail-closed) new/ambiguous identity rather than silently reusing someone else's
 * evidence.
 */

import { createHash } from 'node:crypto';
import { normalizeStructuralAddressText } from '../providers/local-zone-match';
import {
  AMBIGUOUS_SPATIAL_FINGERPRINT_PREFIX,
  EMPTY_SPATIAL_FINGERPRINT,
  SPATIAL_COMPONENT_ORDER,
  type DestinationAddressComponents,
} from './destination-snapshot.types';

/**
 * Canonical spatial fingerprint from STRUCTURED components (preferred path — unambiguous,
 * geocoder/parser-sourced). `spatialFingerprint(a)` and `spatialFingerprint(b)` produce a value
 * that means "same spatial destination" — never merely "the two raw texts happened to look
 * alike" — because every component is passed through the shared canonical normalizer first
 * (Unicode NFKC, zero-width strip, NFD diacritic strip, case-fold, canonical whitespace) before
 * being combined.
 */
export function spatialFingerprint(components: DestinationAddressComponents): string {
  const canonicalParts = SPATIAL_COMPONENT_ORDER.map((key) => normalizeStructuralAddressText(components[key] ?? null));
  const nonEmpty = canonicalParts.some((part) => part.length > 0);
  if (!nonEmpty) return EMPTY_SPATIAL_FINGERPRINT;
  // Joined with U+001F (Unit Separator) rather than a plain concatenation or a printable
  // delimiter such as '|': `normalizeStructuralAddressText` collapses any character outside
  // `\p{L}\p{N}\s` to a plain space, so a printable delimiter typed by a customer inside a raw
  // field (or even reintroduced by future normalization changes) could theoretically end up
  // indistinguishable from the join separator. U+001F is a C0 control character with no printable
  // form; it cannot appear in normalized output and is stripped only via the same NFKC pipeline
  // (never re-introduced), keeping the per-field combination injective: street="a", number="b1"
  // can never collide with street="ab", number="1".
  const canonical = canonicalParts.join('');
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}

/** Two fingerprints denote the SAME spatial destination iff strictly equal AND neither is the
 * "no spatial content" or an "ambiguous, could not classify" sentinel — those never assert
 * equivalence with themselves or each other, by design (fail-closed: "no evidence" is never
 * treated as "proven same place"). */
export function isSameSpatialDestination(a: string, b: string): boolean {
  if (a !== b) return false;
  if (a === EMPTY_SPATIAL_FINGERPRINT) return false;
  if (a.startsWith(AMBIGUOUS_SPATIAL_FINGERPRINT_PREFIX)) return false;
  return true;
}

// -------------------------------------------------------------------------------------------
// Legacy single-combined-text-field fallback (`orders.service.ts` `deliveryReference` today has
// no structural split between the address and delivery instructions — see that file's
// `resolveDeliverySnapshot`). This is a BOUNDED, fail-closed heuristic, not a geocoder: it only
// has to answer one narrow question well — "did the SPATIAL-bearing portion of this raw text
// change, or only the non-spatial instructions portion?" — and default to SPATIAL (safe/
// conservative: forces re-proof) whenever it cannot confidently tell. Production callers should
// prefer the structured `spatialFingerprint(components)` path once real geocoder/parser
// components are available; this fallback exists only so the raw-text-only legacy path can be
// upgraded from "any change invalidates coordinates" (today's bug: a non-spatial-only edit
// silently loses real proof of a far destination) to something field-classification-aware without
// inventing new persisted columns.
// -------------------------------------------------------------------------------------------

const STREET_KEYWORDS =
  /\b(calle|cll|cl|carrera|cra|kra|kr|avenida|av|diagonal|diag|transversal|tv|autopista|via|manzana|mz|circular)\b/;

const INSTRUCTION_VOCABULARY =
  /\b(casa|apto|apartamento|apartaestudio|interior|int|torre|bloque|piso|porton|reja|timbre|conserje|recepcion|porteria|llamar|avisar|referencia|nota|color|azul|verde|rojo|blanco|negro|amarillo|gris|cafe|marron|naranja|rosado|frente|esquina|lado|cerca|detras|entrada|garaje|local|oficina|edificio|conjunto|cuidado|perro|mascota|dejar|encargar|encargado|vigilante|portero)\b/;

/** A single comma/semicolon-delimited segment of a raw combined reference text, classified as
 * spatial-bearing, an instruction/note, or unrecognized (ambiguous). */
export type ReferenceSegmentClass = 'SPATIAL' | 'INSTRUCTION' | 'AMBIGUOUS';

export function classifyReferenceSegment(rawSegment: string): ReferenceSegmentClass {
  const normalized = normalizeStructuralAddressText(rawSegment);
  if (!normalized) return 'INSTRUCTION'; // empty segment carries no spatial signal either way
  const hasDigit = /\p{Nd}/u.test(rawSegment);
  const hasStreetKeyword = STREET_KEYWORDS.test(normalized);
  if (hasStreetKeyword || (hasDigit && normalized.length <= 40)) return 'SPATIAL';
  if (INSTRUCTION_VOCABULARY.test(normalized)) return 'INSTRUCTION';
  return 'AMBIGUOUS';
}

function splitIntoSegments(rawText: string): string[] {
  return rawText
    .split(/[,;\n]|(?:\s-\s)/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

export type ReferenceTextSplit = {
  spatialSegments: string[];
  instructionSegments: string[];
  ambiguousSegments: string[];
  /** Fingerprint of the joined SPATIAL segments only (never includes instruction/ambiguous text).
   * `EMPTY_SPATIAL_FINGERPRINT` when no segment classified as SPATIAL. */
  fingerprint: string;
};

/** Splits a raw combined reference text into spatial vs. non-spatial (instruction) segments using
 * the bounded heuristic above. Never throws; unrecognized segments are reported separately
 * (`ambiguousSegments`) so callers can fail closed when they matter. */
export function splitReferenceText(rawText: string | null | undefined): ReferenceTextSplit {
  const segments = splitIntoSegments(rawText ?? '');
  const spatialSegments: string[] = [];
  const instructionSegments: string[] = [];
  const ambiguousSegments: string[] = [];
  for (const segment of segments) {
    const kind = classifyReferenceSegment(segment);
    if (kind === 'SPATIAL') spatialSegments.push(segment);
    else if (kind === 'INSTRUCTION') instructionSegments.push(segment);
    else ambiguousSegments.push(segment);
  }
  const fingerprint = spatialSegments.length
    ? spatialFingerprint({ street: spatialSegments.join(' ') })
    : EMPTY_SPATIAL_FINGERPRINT;
  return { spatialSegments, instructionSegments, ambiguousSegments, fingerprint };
}

/**
 * Classifies a raw-combined-text reference-field EDIT (legacy POS `deliveryReference` shape) as
 * SPATIAL, NON_SPATIAL, or AMBIGUOUS, comparing the previous and next raw text.
 *
 * FAIL-CLOSED RULES (in order):
 *   0. If the two raw texts are IDENTICAL after canonical normalization (whitespace/case/accents/
 *      punctuation-insensitive), the edit is NON_SPATIAL regardless of whether either side has a
 *      recognizable spatial segment at all. This is not an exception to "never assert NON_SPATIAL
 *      without positive proof" — it IS the proof: nothing about the text changed, so whatever
 *      spatial identity it encodes (even one this bounded heuristic cannot itself recognize, e.g.
 *      an informal reference like "cerca del parque" with no street keyword or house number)
 *      cannot have changed either. Found via A11 (Round 5, legacy POS closure): without this,
 *      EVERY unrelated order edit (changing `notes`, `customerName`, items, etc.) that happens to
 *      re-submit the SAME already-persisted `deliveryReference` text would spuriously fail closed
 *      to AMBIGUOUS whenever that reference lacks a recognizable street keyword or digit —
 *      bumping the destination revision and marking previously-trusted coordinates STALE on a
 *      turn that changed nothing about the address at all. Common for informal Colombian
 *      addresses ("frente al parque", "al lado de la tienda azul"), not just a contrived case.
 *   1. Otherwise, if either side has zero recognizable SPATIAL segments, we cannot prove the
 *      spatial portion is unchanged -> AMBIGUOUS (never assert NON_SPATIAL without positive proof).
 *   2. If the two texts' AMBIGUOUS (unrecognized) segments differ, we cannot prove that
 *      difference is spatially inert -> AMBIGUOUS.
 *   3. Otherwise: NON_SPATIAL iff the SPATIAL-segment fingerprints match; SPATIAL otherwise.
 *
 * Callers (`applyDestinationEdit`) treat AMBIGUOUS the same as SPATIAL for revision/staleness
 * purposes — see `destination-revision.ts` — so this function's only real decision is "can I
 * PROVE this was non-spatial-only", never the reverse.
 */
export function classifyRawReferenceChange(
  previousRawText: string | null | undefined,
  nextRawText: string | null | undefined,
): FieldChangeClassificationResult {
  if (normalizeStructuralAddressText(previousRawText ?? null) === normalizeStructuralAddressText(nextRawText ?? null)) {
    return { classification: 'NON_SPATIAL', reason: 'TEXT_UNCHANGED' };
  }

  const previous = splitReferenceText(previousRawText);
  const next = splitReferenceText(nextRawText);

  if (previous.spatialSegments.length === 0 || next.spatialSegments.length === 0) {
    return { classification: 'AMBIGUOUS', reason: 'NO_PROVEN_SPATIAL_BASELINE' };
  }
  const previousAmbiguous = new Set(previous.ambiguousSegments.map((segment) => normalizeStructuralAddressText(segment)));
  const nextAmbiguous = new Set(next.ambiguousSegments.map((segment) => normalizeStructuralAddressText(segment)));
  const ambiguousDiffers =
    previousAmbiguous.size !== nextAmbiguous.size || [...previousAmbiguous].some((value) => !nextAmbiguous.has(value));
  if (ambiguousDiffers) {
    return { classification: 'AMBIGUOUS', reason: 'UNRECOGNIZED_SEGMENT_CHANGED' };
  }
  if (isSameSpatialDestination(previous.fingerprint, next.fingerprint)) {
    return { classification: 'NON_SPATIAL', reason: 'SPATIAL_SEGMENTS_UNCHANGED' };
  }
  return { classification: 'SPATIAL', reason: 'SPATIAL_SEGMENTS_CHANGED' };
}

export type FieldChangeClassificationResult = {
  classification: 'SPATIAL' | 'NON_SPATIAL' | 'AMBIGUOUS';
  reason: string;
};

/**
 * Classifies a STRUCTURED components edit (preferred path). Pure deep-equality of the canonical
 * (normalized) per-field values — unambiguous by construction, so this never returns AMBIGUOUS.
 */
export function classifyComponentsChange(
  previous: DestinationAddressComponents | null,
  next: DestinationAddressComponents,
): FieldChangeClassificationResult {
  if (!previous) return { classification: 'SPATIAL', reason: 'NEW_DESTINATION' };
  const changed = SPATIAL_COMPONENT_ORDER.some(
    (key) => normalizeStructuralAddressText(previous[key] ?? null) !== normalizeStructuralAddressText(next[key] ?? null),
  );
  return changed
    ? { classification: 'SPATIAL', reason: 'COMPONENT_CHANGED' }
    : { classification: 'NON_SPATIAL', reason: 'COMPONENTS_UNCHANGED' };
}
