/**
 * SOFIA Address Remediation — canonical delivery checkout-authorization contract.
 *
 * WHY THIS FILE EXISTS
 * ---------------------
 * Two prior remediation rounds tried to fix the same underlying bug (a bare local-free-zone text
 * match, e.g. "Alborada", granting `canCheckout=true` without a real deliverable address) by
 * patching `matchLocalZone()` / the pricing engine in place. Both were broken independently by an
 * automated red team, because `canCheckout` kept being computed ad hoc, in more than one place,
 * from a conflated single status string. `orders.service.ts::assertDeliveryCheckoutAllowed` in
 * particular reimplemented its own `status === 'LOCAL_FREE' || status === 'AUTO_PRICED'` formula,
 * completely independent from whatever the live pricing engine decided.
 *
 * This module is the fix for THAT architectural problem (not the text-matching heuristics — see
 * `apps/api/src/delivery/providers/local-zone-match.ts`, owned by A1/A2 this round). It defines:
 *
 *   1. The 6 canonical, separately-named fields the owner mandated:
 *        ADDRESS_VALID / ADDRESS_COMPLETE / ZONE_MATCHED / COVERAGE_ALLOWED /
 *        DELIVERY_FEE_RESOLVED / CAN_CHECKOUT
 *      (see `DeliveryCheckoutAuthorization` in `./delivery-pricing.types`).
 *   2. `deriveCheckoutAuthorization()` — the ONE pure, deterministic function that turns the first
 *      5 into the 6th. No other file may compute `canCheckout` by any other formula.
 *   3. `deriveCheckoutAuthorizationFromOrderSnapshot()` — the adapter that lets
 *      `orders.service.ts::assertDeliveryCheckoutAllowed` (which only has a *persisted* OrderTicket
 *      row at payment/checkout time, not a live DeliveryPricingResult) reconstruct the same 5
 *      inputs from existing columns and get an IDENTICAL answer to the live quote path, via the
 *      SAME `deriveCheckoutAuthorization()` call.
 *
 * SINGLE SOURCE OF TRUTH
 * -----------------------
 * `deriveCheckoutAuthorization()` is that single source of truth. Every checkout entrypoint must
 * end up calling it (directly, or by trusting a `DeliveryPricingResult.checkoutAuthorization` /
 * `.canCheckout` value that was itself produced by it):
 *
 *   - `DeliveryPricingEngine.quote()` (apps/api/src/delivery/delivery-pricing/delivery-pricing.engine.ts)
 *     calls it directly for every branch (LOCAL_FREE, AUTO_PRICED, and every blocked/needs-correction
 *     branch) to populate `DeliveryPricingResult.checkoutAuthorization` / `.canCheckout`.
 *   - `commercial-checkout.service.ts` (SOFIA) never recomputes anything — it consumes
 *     `DeliveryQuoteDto.canCheckout`, which flows from the engine's result through
 *     `AuthoritativeDeliveryQuoteAdapter` unchanged. It is structurally impossible for it to diverge
 *     as long as it keeps trusting that field instead of re-deriving its own notion of "can checkout".
 *   - `orders.service.ts::assertDeliveryCheckoutAllowed` (legacy POS checkout, and the safety net for
 *     ANY order regardless of origin) calls `deriveCheckoutAuthorizationFromOrderSnapshot()` on the
 *     persisted order row, which internally calls `deriveCheckoutAuthorization()`. This is the exact
 *     function/service both paths must call — see A0 report `SINGLE_AUTHORITY_FUNCTION`.
 *
 * Deliberately NOT a NestJS `@Injectable`/service: this is pure, dependency-free logic so it can be
 * imported directly from a plain class (`DeliveryPricingEngine`) and from `OrdersService` without
 * requiring either caller to share a DI graph or without touching any central Nest module (which is
 * out of scope / prohibited for this remediation round).
 *
 * FAIL-CLOSED BY CONSTRUCTION
 * -----------------------------
 * Every derivation in this file defaults unknown/unproven state to `false`. `canCheckout` is a pure
 * logical AND of the four gating flags (`zoneMatched` is informational only, see below) — there is
 * no code path that can produce `canCheckout=true` without every gating flag being explicitly and
 * affirmatively set `true` by a caller. Absence of evidence must never become success (CLAUDE.md
 * section 5 / section 30).
 */

import type { DeliveryCheckoutAuthorization } from './delivery-pricing.types';
import {
  hasUnicodeDigit,
  isZoneOnlyReferenceStructurallyComplete,
  normalizeStructuralAddressText,
  type ZoneAddressCompletenessInput,
} from '../providers/local-zone-match';

// Re-exported so existing callers (delivery-pricing.engine.ts) keep importing these from this
// file unchanged. The REAL implementations live in local-zone-match.ts (A1/A2 ownership this
// round — see that file for the full RULE 7/8/9/10 design) to keep this file's normalization and
// completeness logic as ONE canonical implementation, never two that could silently drift apart.
export { hasUnicodeDigit, isZoneOnlyReferenceStructurallyComplete, normalizeStructuralAddressText };
export type { ZoneAddressCompletenessInput };

export type DeliveryCheckoutAuthorizationInput = {
  /** The submitted address/zone reference is structurally valid: not ambiguous, not missing, not
   * an unparseable/not-found geocoding result. `false` blocks `canCheckout` unconditionally,
   * regardless of the other four flags. */
  addressValid: boolean;
  /**
   * There is enough concrete, courier-actionable detail to actually reach the destination: a real
   * geocoded point, or a proven genuine complement beyond a bare zone label. A `zoneMatched` alias
   * alone (e.g. "Alborada" with nothing else) is NEVER sufficient by itself — MANDATORY RULE 1/2.
   */
  addressComplete: boolean;
  /**
   * The address matched a known named local free-delivery zone alias (Condados / Alborada).
   * Purely informational / pricing-relevant (drives fee=0). Intentionally NOT part of the
   * `canCheckout` AND-gate below — MANDATORY RULE 1: "LOCAL_FREE (ZONE_MATCHED) never by itself
   * implies ADDRESS_COMPLETE", and by extension never by itself implies CAN_CHECKOUT.
   */
  zoneMatched: boolean;
  /**
   * The resolved destination (whether via zone match or a real route) falls within configured
   * automated delivery coverage (i.e. status is not OUT_OF_COVERAGE / DIFFICULT_ACCESS). Fail
   * closed: `false` unless affirmatively proven in coverage.
   */
  coverageAllowed: boolean;
  /**
   * A concrete, finite delivery fee — including a legitimate `0` for a confirmed free zone — has
   * been resolved and is available to charge/display.
   */
  deliveryFeeResolved: boolean;
};

/**
 * THE single, pure, deterministic derivation of CAN_CHECKOUT from the other 5 canonical fields.
 * See file header for why every checkout entrypoint must route through this function (directly or
 * transitively) and never reimplement this boolean expression independently.
 */
export function deriveCheckoutAuthorization(input: DeliveryCheckoutAuthorizationInput): DeliveryCheckoutAuthorization {
  const canCheckout = input.addressValid && input.addressComplete && input.coverageAllowed && input.deliveryFeeResolved;
  return {
    addressValid: input.addressValid,
    addressComplete: input.addressComplete,
    zoneMatched: input.zoneMatched,
    coverageAllowed: input.coverageAllowed,
    deliveryFeeResolved: input.deliveryFeeResolved,
    canCheckout,
  };
}

// ---------------------------------------------------------------------------------------------
// Persisted-order-snapshot adapter — lets orders.service.ts::assertDeliveryCheckoutAllowed
// reconstruct the same 5 canonical inputs from the OrderTicket row it already has at
// payment/checkout time (no new Prisma columns; see A0 report DESIGN_NOTES for why this is
// migration-free) and get an answer identical to the live quote path.
// ---------------------------------------------------------------------------------------------

export type OrderDeliveryCheckoutSnapshot = {
  /** Raw `order.deliveryPricingStatus` column value (DeliveryPricingStatus, persisted as a plain
   * string — see delivery-pricing.types.ts). */
  deliveryPricingStatus?: string | null;
  /** Raw `order.deliveryRequiresManualQuote` column value. The pricing engine sets this `true` for
   * every branch that still needs human/manual attention before a courier can be dispatched,
   * INCLUDING a bare zone-only match with no proven address complement (see engine wiring) — so a
   * resolved status (LOCAL_FREE/AUTO_PRICED) with this left `false` is, by construction,
   * address-complete. */
  deliveryRequiresManualQuote?: boolean | null;
  /** Raw `order.deliveryFee` column value, numeric. */
  deliveryFee?: number | null;
  /** Whether a calculation snapshot was actually persisted (existing
   * `deliveryCalculationVersion` + `deliveryPricingBreakdown` presence check, unchanged from the
   * pre-remediation `assertDeliveryCheckoutAllowed` logic). */
  hasCalculationSnapshot: boolean;
};

const RESOLVED_PRICED_STATUSES = new Set(['LOCAL_FREE', 'AUTO_PRICED']);
const OUT_OF_COVERAGE_STATUS = 'OUT_OF_COVERAGE';

export function deriveCheckoutAuthorizationFromOrderSnapshot(
  snapshot: OrderDeliveryCheckoutSnapshot,
): DeliveryCheckoutAuthorization {
  const status = snapshot.deliveryPricingStatus ?? null;

  const addressValid = status != null && RESOLVED_PRICED_STATUSES.has(status);
  const zoneMatched = status === 'LOCAL_FREE';
  // Fail-closed: coverage is only affirmatively known-allowed once we know we reached a resolved
  // priced status. Every other status (including OUT_OF_COVERAGE itself, and any unknown/blocked
  // status) is treated as NOT proven-in-coverage.
  const coverageAllowed = addressValid && status !== OUT_OF_COVERAGE_STATUS;
  const fee = snapshot.deliveryFee;
  const deliveryFeeResolved = fee != null && Number.isFinite(fee) && snapshot.hasCalculationSnapshot;
  const addressComplete = addressValid && snapshot.deliveryRequiresManualQuote !== true;

  return deriveCheckoutAuthorization({
    addressValid,
    addressComplete,
    zoneMatched,
    coverageAllowed,
    deliveryFeeResolved,
  });
}
