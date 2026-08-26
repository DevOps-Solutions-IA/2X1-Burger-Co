import { DeliveryPricingEngine } from './delivery-pricing.engine';
import { matchLocalZone, isZoneOnlyReferenceStructurallyComplete } from '../providers/local-zone-match';

/**
 * A61 (blind red team, round 5 pass 61) — FINDING (HIGH, process/regression): the A51 LOCAL_FREE
 * cross-field ambiguous-prefix bypass ("cerca de alborada" split across `neighborhood`/`reference`)
 * is STILL LIVE on this branch's HEAD, despite already having been found AND fixed nine rounds ago.
 *
 * GIT ARCHAEOLOGY (verified with `git merge-base --is-ancestor` against this worktree's HEAD)
 * -------------------------------------------------------------------------------------------
 * The A51 test commit (6c89a2f, "test(sofia): A51 blind red team round 5 pass 51 — 2 real
 * findings") documented TWO independent findings in one pass. Two SIBLING fix commits were built
 * directly on top of it:
 *   - 4f03d79 "fix(delivery): close LOCAL_FREE cross-field ambiguous-marker bypass (A52)"
 *     (branch feat/sofia-remediation-address-round5-52-local-free-crossfield-fix) — fixes THIS
 *     bypass.
 *   - 4aa5c70 "fix(sofia): enforce rider ownership on delivery-receipt read endpoints (A53/A51
 *     IDOR)" (branch feat/sofia-remediation-address-round5-53-delivery-receipt-idor-fix) — fixes
 *     the OTHER A51 finding (delivery-receipt IDOR).
 *
 * These are SIBLINGS, not a sequential chain: `git merge-base --is-ancestor 4f03d79 4aa5c70`
 * fails, and `git merge-base --is-ancestor 4f03d79 <round5-60 HEAD>` ALSO fails. The round5-53+
 * lineage that this worktree was built from (…round5-60-cash-current-pii-fix) descends only from
 * 4aa5c70 (the IDOR fix) — it never merged 4f03d79 (the LOCAL_FREE fix). The cross-field bypass fix
 * was silently dropped by the remediation pipeline's own branch topology, not by any code change
 * that reintroduced it.
 *
 * This test re-proves, on THIS worktree's real HEAD, that `delivery-pricing.a51-cross-field-
 * ambiguity-bypass.spec.ts` (already present in this repo, unmodified) still passes its "BYPASS:"
 * assertions against the real, unmocked `DeliveryPricingEngine` — i.e. the finding is not a
 * residual false-positive, it is a live business-safety gap: a customer whose address capture
 * splits "cerca de alborada" ("near Alborada, not sure I'm in it") across `neighborhood: 'alborada'`
 * + `reference: 'cerca'` (a completely natural WhatsApp/SOFIA structured-capture outcome) gets
 * `pricingStatus: 'LOCAL_FREE'`, `finalFee: 0`, `requiresManualQuote: false`,
 * `checkoutAuthorization.canCheckout: true` — bypassing the fail-closed "ambiguous near-zone
 * reference must not auto-qualify for free delivery" invariant that the single-field form of the
 * identical semantic content ("cerca de alborada" in one field) correctly still enforces.
 *
 * REMEDIATION IS NOT "write new code" — it already exists at commit 4f03d79. The actionable fix
 * for the orchestrator is a git operation: merge/cherry-pick 4f03d79's cross-field ambiguity
 * detection onto this lineage (apps/api/src/delivery/providers/local-zone-match.ts,
 * `matchLocalZone` / `isZoneOnlyReferenceStructurallyComplete`), NOT a fresh redesign.
 */
describe('A61 — orphaned fix regression: A51/A52 LOCAL_FREE cross-field bypass is live again on round5-60 HEAD', () => {
  it('CONTROL: single-field "cerca de alborada" is still correctly detected as ambiguous', () => {
    const result = matchLocalZone({ addressText: 'cerca de alborada' });
    expect(result.ambiguous).toBe(true);
    expect(result.matched).toBe(false);
  });

  it('REGRESSION LIVE: identical semantic content split across neighborhood+reference fields still evades ambiguous detection', () => {
    const input = { neighborhood: 'alborada', reference: 'cerca' };

    const zoneMatch = matchLocalZone(input);
    // If this fails (ambiguous === true), the round5-52 fix (or an equivalent one) HAS been merged
    // onto this lineage since this test was written — treat that as GOOD NEWS and retire this
    // regression test, it will have served its purpose.
    expect(zoneMatch.ambiguous).toBe(false);
    expect(zoneMatch.matched).toBe(true);
    expect(zoneMatch.confidence).toBe('HIGH');

    const complete = isZoneOnlyReferenceStructurallyComplete(input);
    expect(complete).toBe(true);
  });

  it('REGRESSION LIVE end-to-end through the real, unmocked DeliveryPricingEngine: LOCAL_FREE + fee=0 + canCheckout=true for an ambiguous "near the zone" submission', () => {
    const engine = new DeliveryPricingEngine();

    const result = engine.quote({ neighborhood: 'alborada', reference: 'cerca' });

    // What SHOULD happen (per the single-field regression at delivery-pricing.spec.ts:163):
    //   pricingStatus === 'NEEDS_ADDRESS_CORRECTION', canCheckout === false, finalFee === null.
    // What ACTUALLY happens today via the cross-field split, on this exact HEAD:
    expect(result.pricingStatus).toBe('LOCAL_FREE');
    expect(result.finalFee).toBe(0);
    expect(result.requiresManualQuote).toBe(false);
    expect(result.checkoutAuthorization.canCheckout).toBe(true);
    expect(result.canCheckout).toBe(true);
    expect(result.warnings).not.toContain('LOCAL_ZONE_AMBIGUOUS');
  });
});
