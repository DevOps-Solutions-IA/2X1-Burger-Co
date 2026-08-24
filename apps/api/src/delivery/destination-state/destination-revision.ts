/**
 * SOFIA Address Remediation — Round 5 / A9. The ONE pure state-transition function for
 * destination revisions (`applyDestinationEdit`) plus the usability/quote-binding predicates every
 * consumer must use instead of re-deriving their own notion of "is this coordinate/quote still
 * good". See `destination-snapshot.types.ts` for the conceptual model and the two concrete bugs
 * (CRITICAL legacy POS / HIGH SOFIA) this closes.
 *
 * RULES IMPLEMENTED (exact prompt numbering):
 *   RULE 1 — coordinate atomicity: `applyDestinationEdit` throws `COORDINATE_PAIR_INCOMPLETE`
 *            rather than accept exactly one of latitude/longitude.
 *   RULE 2 — coordinates bound to ONE revision: `isCoordinateUsableForPricing` requires
 *            `coordinateBoundRevision === revision`; a SPATIAL edit without new coordinate
 *            evidence bumps `revision` and, by construction, leaves the old pair's
 *            `coordinateBoundRevision` behind (STALE), never valid for the new revision.
 *   RULE 3 — non-spatial edit does not bump revision: NON_SPATIAL classification -> `revision`
 *            unchanged, existing coordinates carried forward unchanged (same trust).
 *   RULE 4 — new trusted evidence replaces old FOR THE ACTIVE REVISION: any edit carrying a real
 *            coordinate pair always (re)binds it to the resulting revision, superseding whatever
 *            was there before — never two simultaneously-authoritative pairs.
 *   RULE 5 — no global carry-forward after a textual destination change: enforced by callers using
 *            `applyDestinationEdit` as the ONLY way to advance a conversation's destination state
 *            (see file header of `destination-snapshot.types.ts` for the SOFIA
 *            `location: command.location ?? previous.location` bug this replaces) — once a SPATIAL
 *            edit occurs without new coordinates, `latitude`/`longitude` become STALE, and
 *            `isCoordinateUsableForPricing` fails until fresh evidence for the NEW revision
 *            arrives.
 *   RULE 6 — a previous order's coordinates must never silently flow into a new order:
 *            `createInitialDestinationSnapshot` never takes a "previous" argument — a new
 *            destination/order always starts at revision 1 with NO inherited coordinate state;
 *            only `applyDestinationEdit` (explicit, same-destination continuation) carries
 *            anything forward.
 *   RULE 7 — persisted destination reconstructed after restart preserves everything: this module
 *            is pure/stateless (no module-level mutable state, no cache) — see
 *            `destination-state.persistence.ts` for the round-trip mapping onto EXISTING columns.
 *
 * SOFIA Round 5 / A14 REMEDIATION (HIGH, A13 blind red team finding): RULE 3/4 correctly let a
 * coordinate-only refinement of the SAME address update `latitude`/`longitude` WITHOUT bumping
 * `revision` — that is by design (see RULE 3 above). But that also means a `DestinationQuoteBinding`
 * keyed ONLY on `revision`/`spatialFingerprint` (the pre-A14 shape) stays "still bound" across a
 * coordinate-only turn even when the NEW coordinate evidence is a completely different point than
 * the one the quote/draft was actually priced against (A13: a NEAR in-coverage GPS pair superseded,
 * same revision, by a FAR out-of-coverage live-location share for the identical address text — the
 * stale NEAR quote was then confirmable as-is). `DestinationQuoteBinding` now ALSO captures the
 * ACTUAL coordinate pair the quote was computed against (`boundCoordinateLatitude/Longitude`), and
 * `isQuoteBoundToCurrentDestination` additionally requires that pair to be within
 * `COORDINATE_EVIDENCE_MATERIAL_THRESHOLD_KM` of whatever is CURRENTLY the active, usable coordinate
 * evidence for the destination — independent of whether `revision` itself changed. See
 * `isCoordinateEvidenceMateriallyDifferent` below for the exact rule and why a small jitter tolerance
 * is intentional (never force a pointless requote for GPS noise around the same point).
 */

import {
  classifyComponentsChange,
  classifyRawReferenceChange,
  spatialFingerprint,
} from './spatial-fingerprint';
import { normalizeStructuralAddressText } from '../providers/local-zone-match';
import {
  DestinationStateError,
  EMPTY_SPATIAL_FINGERPRINT,
  type CoordinateSource,
  type CoordinateTrust,
  type DestinationEdit,
  type DestinationSnapshot,
  type FieldChangeClassification,
} from './destination-snapshot.types';

/** Coordinate sources trusted at HIGH confidence without further corroboration. A live GPS share
 * or a customer-dropped map pin is direct first-party evidence; a real geocode result is
 * provider-verified. Manual entry / reused customer history is never more than PROVISIONAL on its
 * own (extends Round 4's TRUSTED_SPATIAL_DATA > TEXTUAL_ZONE_ALIAS precedence with a source axis,
 * not just a "did we get a point at all" axis). */
const HIGH_TRUST_SOURCES: ReadonlySet<CoordinateSource> = new Set(['GPS_SHARE', 'MAP_PIN', 'GEOCODED_ADDRESS']);

function deriveCoordinateTrust(source: CoordinateSource, confidence: 'HIGH' | 'MEDIUM' | 'LOW' | null | undefined): CoordinateTrust {
  if (!HIGH_TRUST_SOURCES.has(source)) return 'PROVISIONAL';
  if (confidence === 'LOW') return 'PROVISIONAL';
  return 'TRUSTED';
}

function validateCoordinatePair(edit: DestinationEdit): void {
  if (!edit.coordinates) return;
  const { latitude, longitude } = edit.coordinates;
  const hasLat = latitude != null;
  const hasLng = longitude != null;
  if (hasLat !== hasLng) {
    throw new DestinationStateError(
      'COORDINATE_PAIR_INCOMPLETE',
      `Coordinate edit supplied only ${hasLat ? 'latitude' : 'longitude'} without its pair. ` +
        'Coordinates must be atomic (RULE 1) — never combine a new axis with a previous/old one.',
    );
  }
}

function resolveNextSpatialIdentity(
  previous: DestinationSnapshot | null,
  edit: DestinationEdit,
): {
  classification: FieldChangeClassification;
  spatialFingerprintValue: string;
  normalizedAddress: string;
  addressComponents: DestinationSnapshot['addressComponents'];
  referenceText: string | null;
} {
  if (edit.addressComponents !== undefined && edit.addressComponents !== null) {
    const result = classifyComponentsChange(previous?.addressComponents ?? null, edit.addressComponents);
    return {
      classification: result.classification,
      spatialFingerprintValue: spatialFingerprint(edit.addressComponents),
      normalizedAddress: [edit.addressComponents.street, edit.addressComponents.number, edit.addressComponents.neighborhood, edit.addressComponents.city]
        .filter((part): part is string => Boolean(part && part.trim()))
        .join(', '),
      addressComponents: edit.addressComponents,
      referenceText: previous?.referenceText ?? null,
    };
  }

  if (edit.rawReferenceText !== undefined && edit.rawReferenceText !== null) {
    const previousRawText = previous?.referenceText ?? null;
    const result = classifyRawReferenceChange(previousRawText, edit.rawReferenceText);
    // The AMBIGUOUS/SPATIAL distinction is preserved and reported to callers (useful for
    // audit/observability), but both are handled IDENTICALLY below for revision-bump/coordinate-
    // staleness purposes ("fail closed when ambiguity affects pricing authority": we cannot prove
    // the spatial portion is unchanged, so we must never assert NON_SPATIAL) — see
    // `revisionBumped` in `applyDestinationEdit`, which treats anything other than NON_SPATIAL the
    // same way.
    return {
      classification: previous ? result.classification : 'SPATIAL',
      spatialFingerprintValue: spatialFingerprint({ street: edit.rawReferenceText }),
      normalizedAddress: normalizeStructuralAddressText(edit.rawReferenceText),
      addressComponents: null,
      referenceText: edit.rawReferenceText,
    };
  }

  // Neither addressComponents nor rawReferenceText supplied — no spatial change proposed at all
  // (e.g. an instructions-only or coordinates-only edit against an existing destination).
  if (previous) {
    return {
      classification: 'NON_SPATIAL',
      spatialFingerprintValue: previous.spatialFingerprint,
      normalizedAddress: previous.normalizedAddress,
      addressComponents: previous.addressComponents,
      referenceText: previous.referenceText,
    };
  }
  return {
    classification: 'SPATIAL',
    spatialFingerprintValue: EMPTY_SPATIAL_FINGERPRINT,
    normalizedAddress: '',
    addressComponents: null,
    referenceText: null,
  };
}

/**
 * THE single, pure state-transition function. Every caller (SOFIA `commercial-checkout.service.ts`,
 * legacy POS `orders.service.ts::resolveDeliverySnapshot`) must route destination edits through
 * this function instead of independently deciding whether to keep or discard coordinates — that
 * exact kind of independent re-derivation is what produced both the CRITICAL and HIGH findings
 * this round closes.
 *
 * `previous === null` always starts a BRAND NEW destination at revision 1 with no inherited
 * coordinate state (RULE 6 — a previous order's coordinates never silently flow into a new one).
 */
export function applyDestinationEdit(previous: DestinationSnapshot | null, edit: DestinationEdit, now: Date = new Date()): {
  snapshot: DestinationSnapshot;
  classification: FieldChangeClassification;
  revisionBumped: boolean;
} {
  validateCoordinatePair(edit);

  const identity = resolveNextSpatialIdentity(previous, edit);
  const revisionBumped = identity.classification !== 'NON_SPATIAL' || !previous;
  const revision = previous ? (revisionBumped ? previous.revision + 1 : previous.revision) : 1;

  const nowIso = now.toISOString();
  const nextInstructions = edit.deliveryInstructions !== undefined ? edit.deliveryInstructions : previous?.deliveryInstructions ?? null;

  const newCoordinates = edit.coordinates && edit.coordinates.latitude != null && edit.coordinates.longitude != null ? edit.coordinates : null;

  let latitude: number | null;
  let longitude: number | null;
  let coordinateSource: CoordinateSource | null;
  let coordinateTrust: CoordinateSnapshotTrust;
  let coordinateBoundRevision: number | null;
  let geocodingProvider: string | null;
  let geocodingEvidenceId: string | null;

  if (newCoordinates) {
    // RULE 4: new trusted evidence replaces previous spatial evidence for the ACTIVE (resulting)
    // revision — never left bound to the old one, always the CURRENT one.
    latitude = newCoordinates.latitude;
    longitude = newCoordinates.longitude;
    coordinateSource = newCoordinates.source;
    coordinateTrust = deriveCoordinateTrust(newCoordinates.source, newCoordinates.confidence);
    coordinateBoundRevision = revision;
    geocodingProvider = newCoordinates.provider ?? previous?.geocodingProvider ?? null;
    geocodingEvidenceId = newCoordinates.evidenceId ?? null;
  } else if (!revisionBumped && previous) {
    // RULE 3: non-spatial-only edit — carry forward unchanged, still bound to the SAME revision.
    latitude = previous.latitude;
    longitude = previous.longitude;
    coordinateSource = previous.coordinateSource;
    coordinateTrust = previous.coordinateTrust;
    coordinateBoundRevision = previous.coordinateBoundRevision;
    geocodingProvider = previous.geocodingProvider;
    geocodingEvidenceId = previous.geocodingEvidenceId;
  } else if (previous && previous.latitude != null && previous.longitude != null) {
    // RULE 2: spatial identity changed (or ambiguous, fail-closed as spatial) without new
    // coordinate evidence — the OLD pair is preserved for audit/display (never silently deleted:
    // "old coordinates become STALE for pricing/coverage purposes", not "old coordinates vanish"),
    // but is marked STALE and left bound to the OLD revision, so it can never again be treated as
    // valid evidence for the new one.
    latitude = previous.latitude;
    longitude = previous.longitude;
    coordinateSource = previous.coordinateSource;
    coordinateTrust = 'STALE';
    coordinateBoundRevision = previous.coordinateBoundRevision;
    geocodingProvider = previous.geocodingProvider;
    geocodingEvidenceId = null; // the old evidence record proved the OLD identity, not this one
  } else {
    latitude = null;
    longitude = null;
    coordinateSource = null;
    coordinateTrust = 'UNTRUSTED';
    coordinateBoundRevision = null;
    geocodingProvider = previous?.geocodingProvider ?? null;
    geocodingEvidenceId = null;
  }

  const snapshot: DestinationSnapshot = {
    revision,
    spatialFingerprint: identity.spatialFingerprintValue,
    normalizedAddress: identity.normalizedAddress,
    addressComponents: identity.addressComponents,
    latitude,
    longitude,
    coordinateSource,
    coordinateTrust,
    coordinateBoundRevision,
    geocodingProvider,
    geocodingEvidenceId,
    deliveryInstructions: nextInstructions,
    referenceText: identity.referenceText,
    createdAt: previous?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };

  return { snapshot, classification: identity.classification, revisionBumped };
}

type CoordinateSnapshotTrust = CoordinateTrust;

/** Creates the FIRST revision of a brand new destination (RULE 6 entry point — never derives from
 * another destination/order's state). Equivalent to `applyDestinationEdit(null, edit)` but named
 * explicitly so call sites document intent (new order / new conversation / new customer) instead
 * of relying on `previous` happening to be `null`. */
export function createInitialDestinationSnapshot(edit: DestinationEdit, now: Date = new Date()): DestinationSnapshot {
  return applyDestinationEdit(null, edit, now).snapshot;
}

/**
 * Single source of truth for "may pricing/coverage logic use this snapshot's coordinates right
 * now". Both conditions are required — a coordinate can be nominally `TRUSTED` in the enum sense
 * yet still be bound to a PAST revision (state reconstructed from persistence, or a bug elsewhere
 * that failed to update `coordinateTrust`); checking `coordinateBoundRevision === revision` here
 * as well as `coordinateTrust === 'TRUSTED'` is defense in depth, not redundant — it is the actual
 * enforcement of RULE 2 ("GPS_A is never valid evidence for rev N+1's different address"),
 * independent of whether every writer correctly downgraded `coordinateTrust` to `STALE`.
 */
export function isCoordinateUsableForPricing(snapshot: DestinationSnapshot): boolean {
  return (
    snapshot.latitude != null &&
    snapshot.longitude != null &&
    snapshot.coordinateTrust === 'TRUSTED' &&
    snapshot.coordinateBoundRevision === snapshot.revision
  );
}

export function isCoordinateProvisionallyUsable(snapshot: DestinationSnapshot): boolean {
  return (
    snapshot.latitude != null &&
    snapshot.longitude != null &&
    (snapshot.coordinateTrust === 'TRUSTED' || snapshot.coordinateTrust === 'PROVISIONAL') &&
    snapshot.coordinateBoundRevision === snapshot.revision
  );
}

/** A minimal, storable reference to the destination state a quote was computed against — what a
 * `DeliveryQuoteDto`/`DeliveryPricingAudit` row must retain so a LATER checkout attempt can be
 * proven bound (or stale) against the CURRENT destination. Deliberately smaller than a full
 * `DestinationSnapshot` — a quote references a destination identity, it does not own one.
 *
 * SOFIA Round 5 / A14: `boundCoordinateLatitude`/`boundCoordinateLongitude` record the ACTUAL
 * coordinate pair (or `null`/`null` when none was usable) that was active for the destination at
 * the moment the quote/pricing snapshot was computed — the RULE 4 evidence identity. This is
 * intentionally a SEPARATE axis from `destinationRevision`/`destinationSpatialFingerprint`: RULE 3
 * never bumps `revision` for a coordinate-only refinement, so relying on revision alone lets NEW,
 * materially-different, TRUSTED coordinate evidence silently outlive the quote it invalidates (the
 * A13 finding). See `isQuoteBoundToCurrentDestination` for how this pair is compared. */
export type DestinationQuoteBinding = {
  destinationRevision: number;
  destinationSpatialFingerprint: string;
  boundCoordinateLatitude: number | null;
  boundCoordinateLongitude: number | null;
};

export function quoteBindingFor(snapshot: DestinationSnapshot): DestinationQuoteBinding {
  // Only the coordinate pair that was ACTUALLY usable for pricing at quote time is captured — a
  // STALE or UNTRUSTED pair (never fed to the pricing engine, see `isCoordinateProvisionallyUsable`)
  // must never be recorded as "what the quote was computed against". This mirrors exactly what
  // `commercial-checkout.service.ts::process()` derives as `state.location` and what legacy POS's
  // `resolveDeliverySnapshot` passes to `deliveryPricingService.estimate()`.
  const usable = isCoordinateProvisionallyUsable(snapshot);
  return {
    destinationRevision: snapshot.revision,
    destinationSpatialFingerprint: snapshot.spatialFingerprint,
    boundCoordinateLatitude: usable ? snapshot.latitude : null,
    boundCoordinateLongitude: usable ? snapshot.longitude : null,
  };
}

/** Distance (km) between two lat/lng pairs, via the standard haversine great-circle formula.
 * Deliberately duplicated here (rather than imported from
 * `../providers/delivery-external-data.service`) — this module is intentionally pure/dependency-free
 * of the injectable-service layer (see file/module headers: "no in-memory state, no cache", reused
 * directly by a plain class AND by `orders.service.ts` without a DI graph). The formula itself is
 * standard and stable; keeping this module self-contained avoids coupling destination-state's core
 * safety invariant to an unrelated NestJS service's internals. */
function coordinateDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadiusKm = 6371;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

/**
 * SOFIA Round 5 / A14: the jitter-tolerance threshold for "is this coordinate evidence actually
 * DIFFERENT, or just GPS noise around the same point". Chosen deliberately:
 *   - LARGER than typical smartphone GPS accuracy jitter outdoors (commonly single-digit to a few
 *     tens of meters; degraded/urban-canyon conditions can reach ~50-100m) — a benign re-share of
 *     "the same spot" must never force an unnecessary requote/UX disruption.
 *   - MUCH SMALLER than the smallest delivery-pricing zone granularity this system prices on
 *     (`resolveZoneType` in `delivery-pricing.engine.ts`: NEAR <= 3km, MEDIUM <= 6km, and coverage
 *     itself is bounded in the tens-of-km range) — so this threshold can never mask a coordinate
 *     change that could plausibly move the destination into a different pricing zone or in/out of
 *     coverage. The A13 exploit pair (NEAR ~2km vs FAR ~42km from origin) differs by tens of
 *     kilometers, orders of magnitude above this threshold.
 * 150m sits comfortably in the gap between those two bounds.
 */
export const COORDINATE_EVIDENCE_MATERIAL_THRESHOLD_KM = 0.15;

/**
 * Whether coordinate evidence changed enough to require re-validating any quote/draft bound to the
 * PREVIOUS pair. Both "one side has usable evidence and the other doesn't" (evidence appeared or
 * disappeared) and "both sides have evidence but it's further apart than the jitter tolerance" are
 * material. Two `null` pairs (no evidence either time — e.g. a takeaway order, or an address-text-only
 * destination never given coordinates) are NOT material — nothing about the evidence changed.
 */
export function isCoordinateEvidenceMateriallyDifferent(
  previousLatitude: number | null,
  previousLongitude: number | null,
  nextLatitude: number | null,
  nextLongitude: number | null,
): boolean {
  const previousUsable = previousLatitude != null && previousLongitude != null;
  const nextUsable = nextLatitude != null && nextLongitude != null;
  if (!previousUsable && !nextUsable) return false;
  // Fail closed: evidence appearing (a quote priced with NO coordinates, e.g. a bare zone-text
  // match, now has a real GPS point to check) or disappearing is always treated as material — we
  // cannot prove the destination didn't move, so we must not assert it stayed the same.
  if (previousUsable !== nextUsable) return true;
  const distanceKm = coordinateDistanceKm(previousLatitude!, previousLongitude!, nextLatitude!, nextLongitude!);
  return distanceKm > COORDINATE_EVIDENCE_MATERIAL_THRESHOLD_KM;
}

/**
 * QUOTE BINDING invariant: `quote.destinationRevision == currentDestination.revision` PLUS a
 * stronger fingerprint check (defense in depth — two different destination lifecycles, e.g. two
 * different orders, could otherwise coincidentally both be "at revision 1"; comparing the
 * fingerprint too makes the check identity-based, not merely counter-based) PLUS (SOFIA Round 5 /
 * A14) a coordinate-evidence check: the pair the quote was actually computed against
 * (`quote.boundCoordinateLatitude/Longitude`) must still be within
 * `COORDINATE_EVIDENCE_MATERIAL_THRESHOLD_KM` of whichever pair is CURRENTLY active/usable for the
 * destination. This third check is what closes the A13 finding — RULE 3/4 deliberately never bump
 * `revision` for a coordinate-only refinement, so the first two checks alone stay "bound" across
 * exactly the turn where new, materially-different coordinate evidence replaced the old pair. A
 * checkout entrypoint must call this before trusting any previously-computed quote/fee; `false`
 * means REQUOTE REQUIRED, never "checkout with the stale quote anyway".
 */
export function isQuoteBoundToCurrentDestination(quote: DestinationQuoteBinding, current: DestinationSnapshot): boolean {
  if (quote.destinationRevision !== current.revision) return false;
  if (quote.destinationSpatialFingerprint !== current.spatialFingerprint) return false;
  const currentUsable = isCoordinateProvisionallyUsable(current);
  const currentLatitude = currentUsable ? current.latitude : null;
  const currentLongitude = currentUsable ? current.longitude : null;
  return !isCoordinateEvidenceMateriallyDifferent(
    quote.boundCoordinateLatitude,
    quote.boundCoordinateLongitude,
    currentLatitude,
    currentLongitude,
  );
}
