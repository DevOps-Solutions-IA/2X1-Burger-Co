/**
 * SOFIA Address Remediation — Round 5 / A9 (Destination State Architecture).
 *
 * WHY THIS MODULE EXISTS
 * -----------------------
 * Four prior rounds fixed individual symptoms of the same root defect class: STALE OR MISMATCHED
 * SPATIAL EVIDENCE SURVIVING DESTINATION EDITS ACROSS TURNS, REQUESTS, PERSISTENCE BOUNDARIES OR
 * CHANNELS. Two concrete instances (found by an independent red team, A8) motivate this module:
 *
 *   - CRITICAL (legacy POS, `orders.service.ts::resolveDeliverySnapshot`): an order has trusted
 *     coordinates proving a destination ~42km away. The customer edits ONLY the non-spatial
 *     portion of the single combined `deliveryReference` text field (e.g. "casa azul" ->
 *     "portón negro"). Today's `referenceChanged` check treats ANY text change as address-
 *     invalidating, discards the trusted coordinates, and the resulting coordinate-less order can
 *     then be re-priced from a bare textual local-zone alias match — silently reopening
 *     LOCAL_FREE for a destination real evidence already proved is far away.
 *   - HIGH (SOFIA, `commercial-checkout.service.ts::process`): `location: command.location ??
 *     previous.location` carries a GPS point forward on every turn that doesn't include a new
 *     GPS share, even after the customer has since typed a different, distant textual address.
 *     The old GPS point (and its cheap quote) can be applied to the NEW address.
 *
 * Both bugs share one architectural cause: coordinates were treated as metadata attached to a
 * conversation / customer / order / message GLOBALLY, instead of evidence bound to ONE specific
 * spatial destination identity. This module makes that identity a first-class, versioned value
 * (`DestinationSnapshot`) and centralizes the only correct state-transition logic
 * (`applyDestinationEdit` in `./destination-revision.ts`) so SOFIA and legacy POS can both reuse
 * it instead of re-inventing (and re-breaking) their own ad hoc "did the address change" checks.
 *
 * CONCEPTUAL MODEL
 * -----------------
 *   DESTINATION -> REVISION -> SPATIAL IDENTITY -> LOCATION EVIDENCE -> COVERAGE -> QUOTE
 *
 * A destination has a sequence of revisions. Each revision has exactly one spatial identity
 * (`spatialFingerprint`, see `./spatial-fingerprint.ts`). Coordinates are evidence ABOUT a
 * revision's spatial identity, never free-floating metadata about the conversation/order/customer
 * as a whole. A revision bump happens only for a SPATIAL field change (street, number,
 * neighborhood-as-geography, city, municipality, postal/locality, latitude/longitude, a new
 * geocode/map-pin/GPS result that disagrees with the current identity). A NON-SPATIAL edit
 * (delivery instructions: "casa azul", "portón negro", "llamar al llegar") never bumps the
 * revision and never invalidates coordinates bound to the unchanged revision.
 *
 * This file defines ONLY the data contract. See:
 *   - `./spatial-fingerprint.ts`      — deterministic canonical spatial identity + the bounded,
 *                                        fail-closed heuristic for single-combined-text-field
 *                                        inputs (legacy POS `deliveryReference`).
 *   - `./destination-revision.ts`     — `applyDestinationEdit()`, the ONE pure state-transition
 *                                        function implementing Rules 1-6, plus
 *                                        `isCoordinateUsableForPricing()` /
 *                                        `isQuoteBoundToCurrentDestination()`.
 *   - `./destination-state.persistence.ts` — pure mapper functions proving this model can be
 *                                        stored onto EXISTING columns/JSON payloads (OrderTicket
 *                                        delivery* columns, DeliveryPricingAudit
 *                                        requestJson/resultJson, a SOFIA conversation-state JSON
 *                                        shape) with NO new Prisma migration.
 */

/** Where a coordinate pair came from. Used for trust-precedence, never for pricing directly. */
export type CoordinateSource =
  | 'GPS_SHARE'
  | 'MAP_PIN'
  | 'GEOCODED_ADDRESS'
  | 'MANUAL_ENTRY'
  | 'CUSTOMER_HISTORY'
  | 'UNKNOWN';

/**
 * Whether a coordinate pair may currently be trusted as authoritative spatial evidence for
 * pricing/coverage.
 *
 *   TRUSTED     — bound to the CURRENT revision, from a high-confidence source. Safe to use.
 *   PROVISIONAL — bound to the CURRENT revision, but from a lower-confidence source (manual entry,
 *                 customer history reuse, low-confidence geocode). Callers may use it but should
 *                 prefer confirming/upgrading it.
 *   STALE       — was proven for a DIFFERENT (older) revision. Preserved for audit/display, but
 *                 `isCoordinateUsableForPricing()` always returns false. Never valid evidence for
 *                 the current spatial identity (RULE 2 / TRUSTED_SPATIAL_DATA precedence
 *                 extension: "TRUSTED_SPATIAL_DATA is valid ONLY for its bound spatial destination
 *                 revision").
 *   UNTRUSTED   — no usable coordinate evidence exists at all (never set / explicitly cleared).
 */
export type CoordinateTrust = 'TRUSTED' | 'PROVISIONAL' | 'STALE' | 'UNTRUSTED';

/** SPATIAL address components — canonicalized/combined to derive `spatialFingerprint`. Purely
 * geographic. Never includes delivery instructions (apartment/gate/access notes). */
export type DestinationAddressComponents = {
  street?: string | null;
  number?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  municipality?: string | null;
  postalCode?: string | null;
  locality?: string | null;
};

/** The canonical, ordered list of spatial component keys used to derive `spatialFingerprint`.
 * Order is part of the canonical contract — changing it changes every fingerprint. */
export const SPATIAL_COMPONENT_ORDER: ReadonlyArray<keyof DestinationAddressComponents> = [
  'street',
  'number',
  'neighborhood',
  'city',
  'municipality',
  'postalCode',
  'locality',
];

/** Canonical fingerprint value for "no spatial content at all" (e.g. TAKEAWAY / no address yet).
 * Distinguishable from any real fingerprint (which is always `sha256:<hex>`), and from each
 * other — two destinations that are BOTH "no address yet" are not asserted to be the "same place",
 * they simply both lack spatial identity. */
export const EMPTY_SPATIAL_FINGERPRINT = 'EMPTY_SPATIAL_IDENTITY';

/** Fingerprint value reserved for inputs the canonical normalizer/classifier could not confidently
 * resolve into spatial components at all (fail-closed sentinel — never equal to any other
 * fingerprint, including another `AMBIGUOUS` one, so two ambiguous inputs are NEVER treated as the
 * same destination). */
export const AMBIGUOUS_SPATIAL_FINGERPRINT_PREFIX = 'AMBIGUOUS_SPATIAL_IDENTITY:';

/**
 * The canonical destination-state contract (maps to the prompt's `DestinationSnapshot`).
 *
 * `revision` and `coordinateBoundRevision` are destination-local monotonic integers (start at 1 on
 * first spatial identity, +1 on every SPATIAL field change). They are NOT the same axis as
 * `OrderTicket.revision` (a general optimistic-concurrency counter that also increments for
 * unrelated technical events — see `orders.service.ts::getDeliveryCommercialVersion` comment) and
 * must never be conflated with it.
 */
export type DestinationSnapshot = {
  /** Monotonic spatial-identity revision. 1 on first assignment, +1 on every SPATIAL change. Never
   * bumped by a NON_SPATIAL-only edit (RULE 3). */
  revision: number;
  /** Deterministic canonical spatial identity — see `spatialFingerprint()`. Two snapshots have the
   * SAME spatial destination iff this value is equal (and neither is an AMBIGUOUS/EMPTY sentinel
   * being compared for equivalence — see `spatial-fingerprint.ts`). */
  spatialFingerprint: string;
  /** Canonicalized (not raw) full address text, for display/audit only — never used as the
   * identity itself (`spatialFingerprint` is). */
  normalizedAddress: string;
  /** Structured spatial components when known (post-geocode, or explicit structured input).
   * `null` when only a raw combined-text input was available (legacy POS fallback path). */
  addressComponents: DestinationAddressComponents | null;
  /** Atomic pair or both-null. See RULE 1 — never partially populated. */
  latitude: number | null;
  longitude: number | null;
  coordinateSource: CoordinateSource | null;
  coordinateTrust: CoordinateTrust;
  /** Which revision the CURRENT `latitude`/`longitude` were actually proven for. When this differs
   * from `revision`, the coordinates are STALE by definition (RULE 2) regardless of
   * `coordinateTrust`'s literal value — `isCoordinateUsableForPricing()` is the single source of
   * truth for that check and always consults both. */
  coordinateBoundRevision: number | null;
  geocodingProvider: string | null;
  /** Correlates to an external audit/evidence record when one exists (e.g.
   * `DeliveryPricingAudit.id`). Optional — many snapshots (e.g. GPS-share-only, no quote yet) have
   * no geocoding evidence row. */
  geocodingEvidenceId: string | null;
  /** NON-SPATIAL delivery instructions ("casa azul", "portón negro", "llamar al llegar"). Editing
   * only this must never bump `revision` or invalidate coordinates (RULE 3). */
  deliveryInstructions: string | null;
  /** Raw, uninterpreted reference text as submitted by the customer/operator, kept for audit even
   * when `addressComponents` is null (legacy single-field path). */
  referenceText: string | null;
  createdAt: string;
  updatedAt: string;
};

/** How a proposed edit changed the destination relative to the previous snapshot. */
export type FieldChangeClassification = 'SPATIAL' | 'NON_SPATIAL' | 'AMBIGUOUS';

/** New coordinate evidence offered as part of an edit. Atomicity (RULE 1) is enforced by
 * `applyDestinationEdit` — passing exactly one of `latitude`/`longitude` throws
 * `DestinationStateError('COORDINATE_PAIR_INCOMPLETE')` rather than silently pairing a new axis
 * with a stale one. */
export type DestinationCoordinateEdit = {
  latitude: number | null;
  longitude: number | null;
  source: CoordinateSource;
  provider?: string | null;
  evidenceId?: string | null;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW' | null;
};

/**
 * One proposed edit to a destination. Exactly one of `addressComponents` / `rawReferenceText`
 * should normally be supplied for the spatial portion (structured is preferred and unambiguous;
 * `rawReferenceText` triggers the bounded fail-closed heuristic classifier in
 * `spatial-fingerprint.ts` for legacy single-combined-field callers). Supplying neither means "no
 * spatial change proposed" (e.g. a pure instructions-only or coordinates-only edit).
 */
export type DestinationEdit = {
  addressComponents?: DestinationAddressComponents | null;
  rawReferenceText?: string | null;
  deliveryInstructions?: string | null;
  coordinates?: DestinationCoordinateEdit | null;
};

export class DestinationStateError extends Error {
  constructor(
    public readonly code: 'COORDINATE_PAIR_INCOMPLETE',
    message: string,
  ) {
    super(message);
    this.name = 'DestinationStateError';
  }
}
