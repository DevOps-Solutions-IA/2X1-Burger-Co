/**
 * SOFIA Address Remediation — Round 5 / A9. Persistence mapping — proves `DestinationSnapshot`
 * (see `./destination-snapshot.types.ts`) can be stored and reloaded onto EXISTING
 * columns/tables/JSON payloads with NO new Prisma migration (owner mandate — "FIRST RULE: REUSE
 * BEFORE BUILD" / "NO new Prisma migration file created").
 *
 * INVESTIGATED FIRST (per the round's instructions), in order:
 *   - `OrderCheckout.version` / `.sofiaDraftVersion` — general checkout-attempt versioning, not
 *     spatial-specific; not reused here (out of this module's concern — see file header of
 *     `order-checkout.service.ts` for what it actually versions).
 *   - `SofiaOrderDraft.version` / `CommercialConversationState.draftVersion` — the SOFIA DRAFT's
 *     own optimistic-concurrency version (items/payment/etc, not spatial-identity-specific). Not
 *     reused as the destination revision axis for the same reason `OrderTicket.revision` isn't
 *     (see below) — but `sofiaConversationMemory.currentOrderIntentJson` (the JSON blob backing
 *     `CommercialConversationState`) IS reused below as the RICH, full-fidelity persistence target
 *     for SOFIA, since it is schemaless already.
 *   - `OrderTicket.revision` — a GENERAL optimistic-concurrency counter that also increments for
 *     unrelated technical events (see `orders.service.ts::getDeliveryCommercialVersion`'s own
 *     comment: "La columna `revision` NO sirve como versión: también se incrementa por eventos
 *     técnicos como la ubicación logistics-only"). Reusing it as the SPATIAL revision axis would
 *     violate RULE 3 (non-spatial edits must not bump the spatial revision) on day one, since it
 *     already bumps for things that have nothing to do with spatial identity. NOT reused as the
 *     revision number; see `toOrderTicketDeliveryColumns` below for the actual (collapsed,
 *     content-addressed) mapping that IS safe without a migration.
 *   - `deliveryCalculationVersion` / `deliveryQuoteVersion` / `deliveryQuoteAuditId` — these
 *     version the PRICING CALCULATION, not the destination. Reused below only as correlation keys
 *     (a quote binding references a `DeliveryPricingAudit` row; the destination binding is stored
 *     INSIDE that row's already-freeform `resultJson`, see `toDeliveryQuoteAuditEnvelope` below).
 *
 * TWO PERSISTENCE TIERS (both migration-free, deliberately different fidelity):
 *
 *   1. `OrderTicket` delivery* columns — "COLLAPSED / current-state-only" mapping. There is no
 *      spare column to hold a true multi-revision history, a `coordinateBoundRevision` integer, or
 *      a `coordinateTrust` enum on this row. The mapping below is still SAFE (never lets stale
 *      coordinates be read back as usable) because it only ever persists `deliveryLatitude`/
 *      `deliveryLongitude` when the snapshot's coordinates are `TRUSTED`/`PROVISIONAL` *and* bound
 *      to the CURRENT revision (`isCoordinateProvisionallyUsable`) — a STALE pair (RULE 2) is
 *      persisted as NULL, exactly like "no coordinates known", never as a value that could later be
 *      misread as current. What is genuinely NOT representable without a migration: retaining the
 *      OLD (stale) pair on the row itself for later display/audit, and a true incrementing
 *      multi-edit revision counter distinct from `OrderTicket.revision`. Neither is required for
 *      the SAFETY invariants this round mandates (see MIGRATION_REQUIRED note in the module this
 *      is reported from) — audit history of what was discarded and why belongs in the existing
 *      `AuditLog` mechanism `orders.service.ts` already writes to on every mutation, not on the
 *      OrderTicket row itself.
 *
 *   2. `DeliveryPricingAudit.resultJson` (and SOFIA's `SofiaConversationMemory
 *      .currentOrderIntentJson`) — "FULL FIDELITY" mapping. Both columns are already untyped
 *      `Json?` with, respectively, zero and one (JSON-shape-checked, not DB-schema-checked)
 *      consumer(s) — see investigation below — so every `DestinationSnapshot` field, including
 *      `revision`, `coordinateBoundRevision`, and `coordinateTrust`, round-trips losslessly with
 *      NO migration. This is the tier the QUOTE BINDING invariant
 *      (`quote.destinationRevision == currentDestination.revision`) actually needs, and the tier
 *      SOFIA should adopt for its conversation state to close the HIGH finding (see
 *      `destination-snapshot.types.ts` file header).
 */

import type { Prisma } from '@prisma/client';
import { EMPTY_SPATIAL_FINGERPRINT, type CoordinateSource, type CoordinateTrust, type DestinationSnapshot } from './destination-snapshot.types';
import { isCoordinateProvisionallyUsable } from './destination-revision';
import { spatialFingerprint } from './spatial-fingerprint';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toFiniteNumberOrNull(value: unknown): number | null {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(num) ? num : null;
}

// ---------------------------------------------------------------------------------------------
// Tier 1 — OrderTicket delivery* columns (collapsed / current-state-only, safe without migration)
// ---------------------------------------------------------------------------------------------

/** The subset of `OrderTicket` delivery* columns this mapping reads/writes. Matches
 * `prisma/schema.prisma`'s `OrderTicket` model field names exactly (see that file) so this type
 * can be used directly against `prisma.orderTicket.update({ data: ... })` /
 * a `select` result, without any adapter layer drifting from the real columns. */
export type OrderTicketDeliveryColumns = {
  deliveryReference: string | null;
  deliveryAddressNormalized: string | null;
  deliveryLatitude: Prisma.Decimal | number | null;
  deliveryLongitude: Prisma.Decimal | number | null;
  deliveryLocationSource: string | null;
  deliveryLocationReceivedAt: Date | null;
  deliveryGeocodingProvider: string | null;
};

const COORDINATE_SOURCE_TO_LOCATION_SOURCE: Record<CoordinateSource, string> = {
  GPS_SHARE: 'whatsapp_live_location',
  MAP_PIN: 'map_pin',
  GEOCODED_ADDRESS: 'geocoded_address',
  MANUAL_ENTRY: 'manual_entry',
  CUSTOMER_HISTORY: 'customer_history',
  UNKNOWN: 'address_zone_estimate',
};

const LOCATION_SOURCE_TO_COORDINATE_SOURCE: Record<string, CoordinateSource> = Object.fromEntries(
  Object.entries(COORDINATE_SOURCE_TO_LOCATION_SOURCE).map(([source, locationSource]) => [locationSource, source as CoordinateSource]),
);

/** Snapshot -> OrderTicket columns. Pass a `now` consistent with whatever transaction timestamp
 * the caller is using, so `deliveryLocationReceivedAt` reflects the actual write time rather than
 * the snapshot's own (possibly earlier, e.g. re-derived) `updatedAt`. */
export function toOrderTicketDeliveryColumns(snapshot: DestinationSnapshot, now: Date = new Date()): OrderTicketDeliveryColumns {
  const usable = isCoordinateProvisionallyUsable(snapshot);
  return {
    deliveryReference: snapshot.referenceText,
    deliveryAddressNormalized: snapshot.normalizedAddress || null,
    // SAFETY: a STALE pair (bound to an old revision) is deliberately written as NULL, never as
    // the stale numeric value — this column has no way to also record "but don't trust this",
    // so the only safe representation of "not currently usable" is absence, exactly like "never
    // had coordinates at all". Preserving the discarded value for human review is the AuditLog's
    // job (`orders.service.ts` already writes one on every delivery-field mutation), not this row.
    deliveryLatitude: usable ? snapshot.latitude : null,
    deliveryLongitude: usable ? snapshot.longitude : null,
    deliveryLocationSource: usable && snapshot.coordinateSource ? COORDINATE_SOURCE_TO_LOCATION_SOURCE[snapshot.coordinateSource] : null,
    deliveryLocationReceivedAt: usable ? now : null,
    deliveryGeocodingProvider: snapshot.geocodingProvider,
  };
}

/** OrderTicket row -> reconstructed snapshot (RULE 7 — round-trip after restart, no in-memory
 * state involved). Content-addressed: `spatialFingerprint` is recomputed fresh from the persisted
 * `deliveryAddressNormalized` text (never trusted from a stored value), so a row can never claim a
 * spatial identity it doesn't currently contain. `revision`/`coordinateBoundRevision` collapse to
 * `1` — this mapping only ever represents "the current state", never a multi-edit history (see
 * module header) — which is exactly why coordinates are ONLY ever persisted (tier 1) when already
 * proven current: reconstruction can therefore always safely treat a present pair as bound to the
 * (only) revision `1`, and an absent pair as `UNTRUSTED`, without ever having to guess. */
export function fromOrderTicketDeliveryColumns(row: OrderTicketDeliveryColumns): DestinationSnapshot {
  const latitude = row.deliveryLatitude != null ? Number(row.deliveryLatitude) : null;
  const longitude = row.deliveryLongitude != null ? Number(row.deliveryLongitude) : null;
  const hasCoordinates = latitude != null && longitude != null;
  const normalizedAddress = row.deliveryAddressNormalized ?? '';
  const coordinateSource: CoordinateSource | null =
    hasCoordinates && row.deliveryLocationSource ? LOCATION_SOURCE_TO_COORDINATE_SOURCE[row.deliveryLocationSource] ?? 'UNKNOWN' : null;
  const coordinateTrust: CoordinateTrust = !hasCoordinates
    ? 'UNTRUSTED'
    : coordinateSource === 'GPS_SHARE' || coordinateSource === 'MAP_PIN' || coordinateSource === 'GEOCODED_ADDRESS'
      ? 'TRUSTED'
      : 'PROVISIONAL';

  return {
    revision: 1,
    // Deliberately re-derived, never read from a stored fingerprint column (there is none) — see
    // `spatialFingerprint()` in `./spatial-fingerprint.ts`. Uses the raw reference text as the
    // single spatial-bearing field (legacy POS has no structured components persisted).
    spatialFingerprint: spatialFingerprintOf(normalizedAddress),
    normalizedAddress,
    addressComponents: null,
    latitude,
    longitude,
    coordinateSource,
    coordinateTrust,
    coordinateBoundRevision: hasCoordinates ? 1 : null,
    geocodingProvider: row.deliveryGeocodingProvider,
    geocodingEvidenceId: null,
    deliveryInstructions: null,
    referenceText: row.deliveryReference,
    createdAt: row.deliveryLocationReceivedAt?.toISOString() ?? new Date(0).toISOString(),
    updatedAt: row.deliveryLocationReceivedAt?.toISOString() ?? new Date(0).toISOString(),
  };
}

/** Raw-text fallback fingerprint (legacy POS has no structured components persisted — only the
 * combined `deliveryAddressNormalized` text). Kept as a named local helper so every call site in
 * this file makes the "no structured components" fallback explicit rather than inlining it. */
function spatialFingerprintOf(normalizedAddressText: string): string {
  if (!normalizedAddressText) return EMPTY_SPATIAL_FINGERPRINT;
  return spatialFingerprint({ street: normalizedAddressText });
}

// ---------------------------------------------------------------------------------------------
// Tier 2 — DeliveryPricingAudit.resultJson envelope (full fidelity, quote binding)
// ---------------------------------------------------------------------------------------------

/** JSON-serializable, full-fidelity envelope. Every `DestinationSnapshot` field round-trips
 * exactly (unlike tier 1). Intended to be spread into whatever object
 * `DeliveryPricingService::auditEstimate` passes as `resultJson` (that call already
 * `JSON.stringify`s whatever object it is given — see `delivery-pricing.service.ts`
 * `sanitizeJson` — so adding this key is additive and requires no change to the audit sink
 * itself, only to what the CALLER includes in the `result` object it hands the pricing engine's
 * wrapper; that wiring is A10/A11's integration work, not this module's).
 */
export type DestinationSnapshotAuditEnvelope = {
  destinationSnapshot: DestinationSnapshot;
};

export function toDeliveryQuoteAuditEnvelope(snapshot: DestinationSnapshot): DestinationSnapshotAuditEnvelope {
  return { destinationSnapshot: snapshot };
}

export function fromDeliveryQuoteAuditEnvelope(value: unknown): DestinationSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>).destinationSnapshot;
  if (!candidate || typeof candidate !== 'object') return null;
  return candidate as DestinationSnapshot;
}

// ---------------------------------------------------------------------------------------------
// Tier 2b — DeliveryPricingAudit request/result reconstruction (SOFIA Round 5 / A20 CLOSURE).
// ---------------------------------------------------------------------------------------------

/** The subset of a `DeliveryPricingAudit` row this reads. `requestJson`/`resultJson` match
 * `DeliveryPricingRequest`/`DeliveryPricingResult` (`delivery-pricing.types.ts`) exactly —
 * `DeliveryPricingService.auditEstimate()` writes `sanitizeJson(request)`/`sanitizeJson(result)`
 * verbatim (see `delivery-pricing.service.ts`), with no `DestinationSnapshotAuditEnvelope` wrapper:
 * as of A20, `toDeliveryQuoteAuditEnvelope` still has zero real write-side callers anywhere in the
 * codebase (grep-confirmed). `fromDeliveryPricingAudit` below is written to prefer that envelope
 * the moment any caller ever adopts it, but must work correctly against the RAW shape every real
 * audit row actually carries today. */
export type DeliveryPricingAuditEvidenceRow = {
  id: string;
  requestJson: Prisma.JsonValue;
  resultJson: Prisma.JsonValue;
};

/**
 * `DeliveryPricingAudit` row -> reconstructed `DestinationSnapshot` (A20 CLOSURE — SOFIA order
 * materialization, `OrdersService.createFromCanonicalCheckout()`, read the address TEXT sitting
 * next to `deliveryQuoteAuditId` but never followed the pointer to recover the trusted GPS pair the
 * audit actually carries; see that function's own comment for the full A19 finding).
 *
 * Prefers the full-fidelity Tier 2 envelope (`fromDeliveryQuoteAuditEnvelope`) when present, so this
 * reader is correct-by-construction the moment any write-side caller adopts it. Falls back to
 * reconstructing directly from the RAW `DeliveryPricingRequest`/`-Result` shape every real audit row
 * carries today: `requestJson.location.{latitude,longitude,provider,confidence}` (falling back to
 * `requestJson.{latitude,longitude}` top-level, matching `DeliveryPricingService.estimate()`'s own
 * `request.location?.latitude ?? request.latitude` precedence) and `requestJson.{addressText,
 * reference}` for the reference text.
 *
 * Returns `null` only when the row carries genuinely no usable spatial evidence at all (no
 * coordinates AND no reference text) — content-addressed, like every other reconstruction in this
 * file: it never fabricates identity the row does not actually contain (RULE 7). A row with a
 * reference text but no coordinates (e.g. a LOCAL_FREE zone-alias quote with no GPS ever submitted)
 * still reconstructs a valid, coordinate-less snapshot — a legitimate case, not an error; see
 * `toOrderTicketDeliveryColumns` for how that safely persists as NULL coordinates, never as a
 * fabricated pair. */
export function fromDeliveryPricingAudit(audit: DeliveryPricingAuditEvidenceRow): DestinationSnapshot | null {
  const envelope = fromDeliveryQuoteAuditEnvelope(audit.resultJson);
  if (envelope) return envelope;

  const request = isPlainRecord(audit.requestJson) ? audit.requestJson : null;
  if (!request) return null;
  const location = isPlainRecord(request.location) ? request.location : null;
  const latitude = toFiniteNumberOrNull(location?.latitude ?? request.latitude);
  const longitude = toFiniteNumberOrNull(location?.longitude ?? request.longitude);
  const hasCoordinates = latitude != null && longitude != null;

  const referenceText =
    typeof request.addressText === 'string' && request.addressText.trim()
      ? request.addressText
      : typeof request.reference === 'string' && request.reference.trim()
        ? request.reference
        : null;
  if (!hasCoordinates && !referenceText) return null;

  const normalizedAddress = referenceText ?? '';
  const providerLabel = typeof location?.provider === 'string' ? location.provider : null;
  const confidence = typeof location?.confidence === 'string' ? location.confidence : null;
  const coordinateSource: CoordinateSource | null = !hasCoordinates
    ? null
    : (providerLabel && LOCATION_SOURCE_TO_COORDINATE_SOURCE[providerLabel]) || 'UNKNOWN';
  // Same trust precedence `resolveDeliverySnapshot`'s `pricingLocationConfidence` fallback uses:
  // a recognized high-trust provider (GPS share / map pin / geocode) is TRUSTED outright; anything
  // else defers to the request's own recorded confidence, defaulting to PROVISIONAL rather than
  // ever silently upgrading unknown provenance to TRUSTED (fail closed).
  const coordinateTrust: CoordinateTrust = !hasCoordinates
    ? 'UNTRUSTED'
    : coordinateSource === 'GPS_SHARE' || coordinateSource === 'MAP_PIN' || coordinateSource === 'GEOCODED_ADDRESS'
      ? 'TRUSTED'
      : confidence === 'HIGH'
        ? 'TRUSTED'
        : 'PROVISIONAL';

  const now = new Date().toISOString();
  return {
    revision: 1,
    spatialFingerprint: spatialFingerprintOf(normalizedAddress),
    normalizedAddress,
    addressComponents: null,
    // RULE 1 (coordinate atomicity): a lone axis (e.g. `requestJson.latitude` present but
    // `.longitude` missing/non-finite) must never survive as a partial pair — `hasCoordinates`
    // already requires BOTH to be finite, so null out both here rather than leaking a single
    // numeric axis into a snapshot that every other consumer assumes is atomic-or-both-null.
    latitude: hasCoordinates ? latitude : null,
    longitude: hasCoordinates ? longitude : null,
    coordinateSource,
    coordinateTrust,
    coordinateBoundRevision: hasCoordinates ? 1 : null,
    geocodingProvider: providerLabel,
    geocodingEvidenceId: audit.id,
    deliveryInstructions: null,
    referenceText,
    createdAt: now,
    updatedAt: now,
  };
}
