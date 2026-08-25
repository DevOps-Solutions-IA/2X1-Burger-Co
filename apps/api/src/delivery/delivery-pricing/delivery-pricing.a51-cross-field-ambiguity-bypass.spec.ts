import { DeliveryPricingEngine } from './delivery-pricing.engine';
import { matchLocalZone, isZoneOnlyReferenceStructurallyComplete } from '../providers/local-zone-match';

/**
 * A51 (blind red team, round 5 pass 51) — FINDING: cross-field ambiguous-prefix bypass in
 * `matchLocalZone` / `isZoneOnlyReferenceStructurallyComplete`, defeating the
 * "LOCAL_FREE fail-closed on ambiguity" invariant end to end through the real, unmocked
 * `DeliveryPricingEngine`.
 *
 * ROOT CAUSE
 * ----------
 * `matchLocalZone()` (apps/api/src/delivery/providers/local-zone-match.ts) detects an ambiguous
 * "near Alborada / near Condados" reference (e.g. "cerca de alborada", "por alborada", "vía
 * alborada" — see delivery-pricing.spec.ts:163 for the existing, correctly-blocked single-field
 * regression) by testing whether ONE candidate STRING literally contains the concatenated phrase
 * `${prefix}${alias}` (e.g. the literal substring "cerca de alborada").
 *
 * `matchLocalZone`/`isZoneOnlyReferenceStructurallyComplete` are always called with THREE
 * independent candidate fields: `addressText`, `neighborhood`, `reference`. Each field is
 * evaluated separately for the ambiguous-phrase substring — there is no cross-field
 * reconstruction of what the customer actually meant. Meanwhile,
 * `isZoneOnlyReferenceStructurallyComplete`'s closed positive vocabulary includes the bare word
 * "cerca" (`CONTENT_VOCAB_TOKENS`, local-zone-match.ts:200) as a legitimate landmark/descriptor
 * token (e.g. "casa cerca del parque azul") — it has no way to distinguish standalone "cerca"
 * (legitimate: "near [some landmark]") from "cerca" as the AMBIGUITY MARKER of "cerca de
 * [zone]" (illegitimate: "I *think* I'm near Alborada, not sure I'm actually in it").
 *
 * Putting the alias in one field (`neighborhood: 'alborada'`) and the ambiguity word in another
 * (`reference: 'cerca'`) — an entirely natural way for a structured WhatsApp/SOFIA conversation
 * capture to store "vivo cerca de alborada" once split into neighborhood vs. free-text reference
 * — makes BOTH defenses miss simultaneously:
 *   1. `matchLocalZone` never sees the literal substring "cerca de alborada" in any single field,
 *      so `ambiguous` stays `false` and it returns a HIGH-confidence exact match instead of
 *      requiring manual confirmation.
 *   2. `isZoneOnlyReferenceStructurallyComplete` sees token "alborada" (zone anchor, ignored) and
 *      token "cerca" (recognized CONTENT_VOCAB_TOKENS, `hasGenuineContent = true`) and returns
 *      `true` — treating the very word that should have triggered ambiguity as proof of a
 *      complete, courier-actionable address.
 *
 * The result flows, unmocked, through the real `DeliveryPricingEngine.quote()`:
 * `pricingStatus: 'LOCAL_FREE'`, `finalFee: 0`, `requiresManualQuote: false`,
 * `checkoutAuthorization.canCheckout: true` — for an address whose OWN submitted text is exactly
 * the "I think I'm near Alborada, not sure" case the ambiguous-prefix list exists to fail closed
 * on. A single-field submission of the identical semantic content ("cerca de alborada") is
 * correctly blocked (`NEEDS_ADDRESS_CORRECTION`, `canCheckout: false`) by the existing regression
 * suite at delivery-pricing.spec.ts:163 — this is a genuine gap in that same defense, not a
 * request for different business behavior.
 *
 * BUSINESS IMPACT
 * ----------------
 * A courier can be auto-dispatched, with a HIGH-confidence "Condados / Alborada" free-delivery
 * quote (fee = 0, no manual review flagged, `canCheckout = true`), to an address the customer
 * only claimed to be NEAR the free zone — potentially outside actual delivery coverage / a real
 * distance away, with no geocoded point ever validated (this is the LOCAL_FREE branch precisely
 * because `hasRealPoint` is false). This is the same class of business-facing false-positive the
 * two prior (pre-remediation) LOCAL_FREE rounds were broken for, now reachable through a field
 * decomposition angle neither the strong-alias substring check nor the closed-vocabulary
 * completeness check individually account for.
 */
describe('A51 — LOCAL_FREE cross-field ambiguous-prefix bypass ("cerca" split across fields)', () => {
  it('single-field "cerca de alborada" is correctly detected as ambiguous (baseline, matches existing regression suite)', () => {
    const result = matchLocalZone({ addressText: 'cerca de alborada' });
    expect(result.ambiguous).toBe(true);
    expect(result.matched).toBe(false);
  });

  it('BYPASS: identical semantic content split across neighborhood+reference fields evades ambiguous detection', () => {
    const input = { neighborhood: 'alborada', reference: 'cerca' };

    const zoneMatch = matchLocalZone(input);
    // VIOLATION: should be ambiguous (same meaning as "cerca de alborada"), but is not.
    expect(zoneMatch.ambiguous).toBe(false);
    expect(zoneMatch.matched).toBe(true);
    expect(zoneMatch.confidence).toBe('HIGH');

    const complete = isZoneOnlyReferenceStructurallyComplete(input);
    // VIOLATION: the ambiguity marker word "cerca" is misread as genuine descriptive content.
    expect(complete).toBe(true);
  });

  it('BYPASS end-to-end through the real, unmocked DeliveryPricingEngine: LOCAL_FREE + fee=0 + canCheckout=true for an ambiguous "near the zone" submission', () => {
    const engine = new DeliveryPricingEngine();

    const result = engine.quote({ neighborhood: 'alborada', reference: 'cerca' });

    // What SHOULD happen (per the single-field regression at delivery-pricing.spec.ts:163):
    //   pricingStatus === 'NEEDS_ADDRESS_CORRECTION', canCheckout === false, finalFee === null.
    // What ACTUALLY happens via the cross-field split:
    expect(result.pricingStatus).toBe('LOCAL_FREE');
    expect(result.finalFee).toBe(0);
    expect(result.requiresManualQuote).toBe(false);
    expect(result.checkoutAuthorization.zoneMatched).toBe(true);
    expect(result.checkoutAuthorization.addressComplete).toBe(true);
    expect(result.checkoutAuthorization.canCheckout).toBe(true);
    expect(result.canCheckout).toBe(true);
    expect(result.warnings).not.toContain('LOCAL_ZONE_AMBIGUOUS');
    expect(result.warnings).not.toContain('LOCAL_ZONE_ADDRESS_INCOMPLETE');
  });

  it('BYPASS also reachable via addressText+reference split (not neighborhood-specific)', () => {
    const engine = new DeliveryPricingEngine();
    const result = engine.quote({ addressText: 'alborada', reference: 'cerca' });

    expect(result.pricingStatus).toBe('LOCAL_FREE');
    expect(result.canCheckout).toBe(true);
    expect(result.requiresManualQuote).toBe(false);
  });

  it.each(['por', 'via', 'vía'])(
    'the same cross-field bypass pattern applies to the other ambiguous-prefix words: "%s"',
    (prefixWord) => {
      const zoneMatch = matchLocalZone({ neighborhood: 'condados', reference: prefixWord });
      // Single-field equivalents ("por condados", "vía condados") are correctly flagged ambiguous
      // by the existing suite; split across fields, ambiguity detection is bypassed.
      // (`prefixWord` alone is not itself in CONTENT_VOCAB_TOKENS, so completeness is not
      // necessarily granted for every one of these — the ambiguity-detection bypass on
      // `matchLocalZone` itself is the invariant violation asserted here regardless.)
      expect(zoneMatch.ambiguous).toBe(false);
      expect(zoneMatch.matched).toBe(true);
    },
  );
});
