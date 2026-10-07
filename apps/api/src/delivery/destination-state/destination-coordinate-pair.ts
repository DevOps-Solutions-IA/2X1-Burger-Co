/**
 * Delivery destination TOCTOU reintegration — RULE 1 / RULE 2 fix
 * (fix/delivery-destination-rule1-rule2-reintegration-20261007).
 *
 * CONTEXT: this is Commit B of the same program that closed RULE 3/RULE 5
 * (`fix/delivery-destination-toctou-reintegration-20261006`,
 * `apps/api/src/delivery/destination-state/spatial-change-classifier.ts`). RULE 3/5 fixed WHEN a
 * previously-trusted coordinate pair may survive a text edit. RULE 1/2 fix a separate, orthogonal
 * defect in HOW that pair is assembled once "survive" has been decided:
 *
 *   RULE 1 — COORDINATE ATOMICITY: `orders.service.ts::resolveDeliverySnapshot` used to resolve
 *   `latitude`/`longitude` INDEPENDENTLY, per axis:
 *     const latitude = explicitLatitude ?? existingLatitude;
 *     const longitude = explicitLongitude ?? existingLongitude;
 *   `deliveryLatitude`/`deliveryLongitude` are both `@IsOptional()` with no cross-field validator
 *   (see `apps/api/src/modules/orders/dto/update-order-ticket.dto.ts`), so a turn that supplies ONLY
 *   a new latitude (no longitude) silently combines a BRAND NEW latitude with a STALE longitude from
 *   a completely different capture event — a synthetic point that was never geocoded or GPS-proven
 *   as a pair, then trusted as real evidence for delivery pricing/coverage. Confirmed with a PoC
 *   (see `apps/api/src/modules/orders/orders.rule1-rule2-coordinate-atomicity.spec.ts`).
 *
 *   RULE 2 — ANCHOR BINDING: the ONLY structural anchor already on `OrderTicket` that answers
 *   "when/whether this specific coordinate pair is actually usable" is
 *   `deliveryLocationReceivedAt` — the historical `destination-state.persistence.ts` Tier-1 mapping
 *   (see `inventario-round5-a63`) independently reaches the same conclusion: `OrderTicket.revision`
 *   is a GENERAL optimistic-concurrency counter that also bumps for unrelated technical events, so it
 *   cannot be reused as a spatial-revision axis, and no spare column exists for a true
 *   `coordinateBoundRevision` counter without a migration. `resolveDeliverySnapshot` used to write:
 *     deliveryLocationReceivedAt: latitude != null && longitude != null
 *       ? new Date()
 *       : input.existing?.deliveryLocationReceivedAt ? new Date(input.existing.deliveryLocationReceivedAt) : null,
 *   which has two bugs relative to "coordinates and their anchor must be invalidated/preserved
 *   TOGETHER, never independently":
 *     (a) when coordinates are null (no usable pair this turn, e.g. a SPATIAL edit discarded them
 *         per RULE 3/5, or there never was a pair) the OLD timestamp was still carried forward —
 *         a dangling anchor claiming "a GPS fix was captured at time T" while no coordinates exist;
 *     (b) when coordinates are CARRIED FORWARD unchanged (a NON_SPATIAL edit, RULE 3/5), the
 *         timestamp was unconditionally re-stamped to `now()` — misrepresenting WHEN the surviving
 *         evidence was actually captured, even though nothing about the coordinates changed.
 *
 * SCOPE: this module provides the ONE pure, reusable resolution function both real call sites
 * (`orders.service.ts::resolveDeliverySnapshot` and, for defense in depth,
 * `commercial-checkout.service.ts::process`) must use instead of re-deriving their own per-axis
 * merge — exactly the kind of independent re-derivation that produced the RULE 1 bug. It does NOT
 * port the full historical `DestinationSnapshot` / `applyDestinationEdit` / `coordinateBoundRevision`
 * architecture from `inventario-round5-a63` (revision numbers, coordinate trust levels, quote
 * binding, spatial fingerprints) — that depends on persisting a true multi-revision history, which
 * the investigation documented in the delivery report (and in `destination-state.persistence.ts`'s
 * own header there) concludes is NOT representable on current `OrderTicket` columns without a new
 * Prisma migration. What IS safely representable without a migration, and is all RULE 1/2 require at
 * these two call sites, is exactly what this module does: (1) never assemble a coordinate pair from
 * two different capture events, and (2) never let `deliveryLocationReceivedAt` describe a capture
 * event the current `deliveryLatitude`/`deliveryLongitude` don't actually correspond to.
 */

export type CoordinatePairSource = 'EXPLICIT_PAIR' | 'EXISTING_PAIR' | 'NONE';

export type CoordinatePairResolutionInput = {
  /** A fresh value submitted THIS turn/edit, or `null`/`undefined` if none was submitted. */
  explicitLatitude: number | null | undefined;
  explicitLongitude: number | null | undefined;
  /**
   * The previously-persisted pair, ALREADY gated by the caller's own RULE 3/5 "is this still
   * trusted" decision (e.g. `orders.service.ts` passes `null` here when a SPATIAL text change
   * already proved the existing pair unusable). This function never re-derives that decision — it
   * only enforces that whatever pair comes out the other side is atomic.
   */
  existingLatitude: number | null | undefined;
  existingLongitude: number | null | undefined;
};

export type CoordinatePairResolution = {
  /** Always a real pair or both `null` — never one axis set and the other not. */
  latitude: number | null;
  longitude: number | null;
  /**
   * `EXPLICIT_PAIR` — both axes were freshly supplied this turn, used as-is (a genuinely new
   *   capture event; the anchor timestamp must be re-stamped to now by the caller).
   * `EXISTING_PAIR` — neither axis (or only a partial, discarded, axis — see
   *   `partialCoordinateDiscarded`) was freshly supplied; the full previous pair was carried forward
   *   unchanged (the anchor timestamp must be PRESERVED, not re-stamped, by the caller).
   * `NONE` — no usable pair exists on either side (no anchor may survive; the caller must persist
   *   `null` for any anchor/received-at field).
   */
  source: CoordinatePairSource;
  /**
   * `true` iff the caller supplied EXACTLY ONE of `explicitLatitude`/`explicitLongitude` (the
   * RULE 1 violation this function exists to neutralize). The partial axis is always discarded in
   * favor of falling back to the existing pair (or to `NONE` if no existing pair is trusted either)
   * — it is NEVER combined with the other axis from a different source. Callers should audit-log
   * this case: it is evidence of either a buggy client or a user who genuinely meant to move the
   * pin and whose update was silently (but safely) dropped rather than silently corrupting the
   * stored location.
   */
  partialCoordinateDiscarded: boolean;
  discardedAxis: 'latitude' | 'longitude' | null;
};

/**
 * RULE 1 — the single place either real call site may turn a (possibly partial) explicit
 * lat/lng submission plus a (possibly present) existing trusted pair into the coordinate pair that
 * is actually persisted/used for pricing. Pure, synchronous, no I/O.
 */
export function resolveAtomicCoordinatePair(input: CoordinatePairResolutionInput): CoordinatePairResolution {
  const hasExplicitLatitude = input.explicitLatitude != null;
  const hasExplicitLongitude = input.explicitLongitude != null;

  if (hasExplicitLatitude && hasExplicitLongitude) {
    return {
      latitude: input.explicitLatitude as number,
      longitude: input.explicitLongitude as number,
      source: 'EXPLICIT_PAIR',
      partialCoordinateDiscarded: false,
      discardedAxis: null,
    };
  }

  // Exactly one of the two was supplied -> RULE 1 violation attempt. Never combine it with the
  // other axis's existing value: discard the partial axis entirely and fall through to the
  // existing-pair/none resolution below, exactly as if nothing new had been submitted this turn.
  const partialCoordinateDiscarded = hasExplicitLatitude !== hasExplicitLongitude;
  const discardedAxis: 'latitude' | 'longitude' | null = !partialCoordinateDiscarded
    ? null
    : hasExplicitLatitude
      ? 'latitude'
      : 'longitude';

  const hasExistingLatitude = input.existingLatitude != null;
  const hasExistingLongitude = input.existingLongitude != null;

  if (hasExistingLatitude && hasExistingLongitude) {
    return {
      latitude: input.existingLatitude as number,
      longitude: input.existingLongitude as number,
      source: 'EXISTING_PAIR',
      partialCoordinateDiscarded,
      discardedAxis,
    };
  }

  // No trusted existing pair either (e.g. a brand-new order, or RULE 3/5 already invalidated it) —
  // fail closed to NO coordinates at all rather than ever surfacing a lone existing axis.
  return {
    latitude: null,
    longitude: null,
    source: 'NONE',
    partialCoordinateDiscarded,
    discardedAxis,
  };
}
