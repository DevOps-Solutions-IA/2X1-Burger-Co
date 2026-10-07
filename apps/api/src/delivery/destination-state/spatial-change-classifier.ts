/**
 * Delivery destination TOCTOU reintegration — RULE 3 fix (fix/delivery-destination-toctou-
 * reintegration-20261006).
 *
 * CONTEXT: `apps/api/src/modules/orders/orders.service.ts` (`resolveDeliverySnapshot`) decides
 * whether a previously-trusted GPS fix (`existingLatitude`/`existingLongitude`) may still be
 * trusted on this turn, or must be discarded and re-proven, purely by checking whether the
 * normalized delivery-reference TEXT differs from the stored one — ANY text difference, however
 * trivial and non-spatial (e.g. "casa azul" -> "porton negro" with the exact same real address),
 * discarded real coordinates. That is both wrong (throws away good evidence) and, per the
 * confirmed PoC, re-opens a window for a textual zone-alias match at a different tariff once the
 * coordinates are gone.
 *
 * FIX: classify the TEXT CHANGE itself as SPATIAL, NON_SPATIAL or AMBIGUOUS before deciding to
 * discard. Only SPATIAL (or AMBIGUOUS — fail-closed, never assert "proven non-spatial" without
 * positive proof) changes may discard coordinates. A purely NON_SPATIAL change (same spatial
 * segments, different instruction/note segments) must not.
 *
 * SCOPE NOTE: this is intentionally the minimal, self-contained slice of the historical
 * `destination-state` red-team architecture (`inventario-round5-a63`,
 * `apps/api/src/delivery/destination-state/spatial-fingerprint.ts`) needed to close RULE 3 at its
 * one real call site today. It does not port `DestinationSnapshot`, `applyDestinationEdit()`, or
 * the structured-components fingerprint path (those depend on Prisma schema / revision-binding
 * machinery that does not exist on current `main` — see the delivery report for why that is
 * deferred to a possible Commit B rather than built blind here). This module operates purely on
 * strings already passed through the SAME normalizer the call site already uses
 * (`normalizeAddressText` from `../../common/normalization/customer-normalization`) — no new
 * normalizer is introduced, to avoid exactly the "two independently-evolving text normalizers"
 * drift the historical module's header warns about.
 */

export type ReferenceChangeClassification = 'SPATIAL' | 'NON_SPATIAL' | 'AMBIGUOUS';

export type ReferenceChangeClassificationResult = {
  classification: ReferenceChangeClassification;
  reason: string;
};

// Spanish street/structural keywords — presence strongly indicates a segment carries spatial
// (address) meaning rather than a delivery instruction/note. Ported from the historical
// `spatial-fingerprint.ts` (Round 5 / A9) vocabulary; text is assumed already lowercased and
// diacritic-stripped by the caller's normalizer (matches that assumption, e.g. "porton" not
// "portón").
const STREET_KEYWORDS =
  /\b(calle|cll|cl|carrera|cra|kra|kr|avenida|av|diagonal|diag|transversal|tv|autopista|via|manzana|mz|circular)\b/;

// Instruction/note vocabulary — presence (without a street keyword) indicates the segment is a
// delivery note, not a spatial identifier.
const INSTRUCTION_VOCABULARY =
  /\b(casa|apto|apartamento|apartaestudio|interior|int|torre|bloque|piso|porton|reja|timbre|conserje|recepcion|porteria|llamar|avisar|referencia|nota|color|azul|verde|rojo|blanco|negro|amarillo|gris|cafe|marron|naranja|rosado|frente|esquina|lado|cerca|detras|entrada|garaje|local|oficina|edificio|conjunto|cuidado|perro|mascota|dejar|encargar|encargado|vigilante|portero)\b/;

type SegmentClass = 'SPATIAL' | 'INSTRUCTION' | 'AMBIGUOUS';

function classifySegment(segment: string): SegmentClass {
  const trimmed = segment.trim();
  if (!trimmed) return 'INSTRUCTION'; // empty segment carries no spatial signal either way
  const hasDigit = /\d/.test(trimmed);
  if (STREET_KEYWORDS.test(trimmed) || (hasDigit && trimmed.length <= 40)) return 'SPATIAL';
  if (INSTRUCTION_VOCABULARY.test(trimmed)) return 'INSTRUCTION';
  return 'AMBIGUOUS';
}

function splitSegments(normalizedText: string): string[] {
  return normalizedText
    .split(/[,;\n]|(?:\s-\s)/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

type SplitResult = {
  spatialSegments: string[];
  ambiguousSegments: string[];
};

function splitReference(normalizedText: string): SplitResult {
  const spatialSegments: string[] = [];
  const ambiguousSegments: string[] = [];
  for (const segment of splitSegments(normalizedText)) {
    const kind = classifySegment(segment);
    if (kind === 'SPATIAL') spatialSegments.push(segment);
    else if (kind === 'AMBIGUOUS') ambiguousSegments.push(segment);
    // INSTRUCTION segments are intentionally not tracked further — they are not spatial
    // evidence and never block a NON_SPATIAL classification on their own.
  }
  return { spatialSegments, ambiguousSegments };
}

/**
 * Classifies a delivery-reference text EDIT as SPATIAL, NON_SPATIAL or AMBIGUOUS.
 *
 * Both arguments MUST already be normalized with the call site's canonical normalizer
 * (same casing/diacritic/whitespace folding on both sides) — this function does not
 * re-normalize, to avoid silently diverging from whatever normalizer the caller is using.
 *
 * FAIL-CLOSED RULES (checked in order):
 *   0. Identical normalized text -> NON_SPATIAL. (Caller should generally short-circuit this
 *      case itself, but it is handled here too so this function is safe to call unconditionally.)
 *   1. Either side has zero recognizable SPATIAL segments -> AMBIGUOUS. We cannot prove the
 *      spatial portion is unchanged without at least one recognizable spatial segment on both
 *      sides (never assert NON_SPATIAL without positive proof).
 *   2. The two sides' AMBIGUOUS (unrecognized) segment sets differ -> AMBIGUOUS. We cannot prove
 *      that difference is spatially inert.
 *   3. Otherwise: NON_SPATIAL iff the joined SPATIAL segments are textually identical; SPATIAL
 *      otherwise.
 *
 * Callers must treat AMBIGUOUS the same as SPATIAL for any decision that discards previously
 * trusted coordinates or pricing evidence (fail-closed).
 */
export function classifyReferenceTextChange(
  previousNormalized: string,
  nextNormalized: string,
): ReferenceChangeClassificationResult {
  if (previousNormalized === nextNormalized) {
    return { classification: 'NON_SPATIAL', reason: 'TEXT_UNCHANGED' };
  }

  const previous = splitReference(previousNormalized);
  const next = splitReference(nextNormalized);

  if (previous.spatialSegments.length === 0 || next.spatialSegments.length === 0) {
    return { classification: 'AMBIGUOUS', reason: 'NO_PROVEN_SPATIAL_BASELINE' };
  }

  const previousAmbiguous = new Set(previous.ambiguousSegments);
  const nextAmbiguous = new Set(next.ambiguousSegments);
  const ambiguousDiffers =
    previousAmbiguous.size !== nextAmbiguous.size ||
    [...previousAmbiguous].some((value) => !nextAmbiguous.has(value));
  if (ambiguousDiffers) {
    return { classification: 'AMBIGUOUS', reason: 'UNRECOGNIZED_SEGMENT_CHANGED' };
  }

  const previousSpatialJoined = previous.spatialSegments.join(' ');
  const nextSpatialJoined = next.spatialSegments.join(' ');
  if (previousSpatialJoined === nextSpatialJoined) {
    return { classification: 'NON_SPATIAL', reason: 'SPATIAL_SEGMENTS_UNCHANGED' };
  }
  return { classification: 'SPATIAL', reason: 'SPATIAL_SEGMENTS_CHANGED' };
}
