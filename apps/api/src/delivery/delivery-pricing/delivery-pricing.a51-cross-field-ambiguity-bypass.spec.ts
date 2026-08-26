import { DeliveryPricingEngine } from './delivery-pricing.engine';
import { matchLocalZone, isZoneOnlyReferenceStructurallyComplete } from '../providers/local-zone-match';

/**
 * A51 (blind red team, round 5 pass 51) — FINDING (HIGH), FIXED in A52: cross-field ambiguous-prefix
 * bypass in `matchLocalZone` / `isZoneOnlyReferenceStructurallyComplete`, which defeated the
 * "LOCAL_FREE fail-closed on ambiguity" invariant end to end through the real, unmocked
 * `DeliveryPricingEngine`.
 *
 * ROOT CAUSE (A51)
 * ----------------
 * `matchLocalZone()` (apps/api/src/delivery/providers/local-zone-match.ts) detected an ambiguous
 * "near Alborada / near Condados" reference (e.g. "cerca de alborada", "por alborada", "vía
 * alborada" — see delivery-pricing.spec.ts:163 for the still-correct single-field regression) by
 * testing whether ONE candidate STRING literally contained the concatenated phrase
 * `${prefix}${alias}` (e.g. the literal substring "cerca de alborada").
 *
 * `matchLocalZone`/`isZoneOnlyReferenceStructurallyComplete` are always called with THREE
 * independent candidate fields: `addressText`, `neighborhood`, `reference`. Each field was
 * evaluated separately for the ambiguous-phrase substring — there was no cross-field
 * reconstruction of what the customer actually meant. Meanwhile,
 * `isZoneOnlyReferenceStructurallyComplete`'s closed positive vocabulary includes the bare word
 * "cerca" (`CONTENT_VOCAB_TOKENS`) as a legitimate landmark/descriptor token (e.g. "casa cerca del
 * parque azul") — it had no way to distinguish standalone "cerca" (legitimate: "near [some
 * landmark]") from "cerca" as the AMBIGUITY MARKER of "cerca de [zone]" (illegitimate: "I *think*
 * I'm near Alborada, not sure I'm actually in it").
 *
 * Putting the alias in one field (`neighborhood: 'alborada'`) and the ambiguity word in another
 * (`reference: 'cerca'`) — an entirely natural way for a structured WhatsApp/SOFIA conversation
 * capture to store "vivo cerca de alborada" once split into neighborhood vs. free-text reference —
 * made BOTH defenses miss simultaneously, yielding `pricingStatus: 'LOCAL_FREE'`, `finalFee: 0`,
 * `requiresManualQuote: false`, `checkoutAuthorization.canCheckout: true` through the real engine.
 *
 * FIX (A52) — RULE 11 in local-zone-match.ts
 * -------------------------------------------
 * Both functions now additionally reason about the ambiguity marker word ACROSS ALL SUPPLIED
 * FIELDS TOGETHER, independent of which field each half landed in and independent of
 * adjacency/order:
 *
 *   `isBareAmbiguousMarkerField(field)` — true when a normalized field contributes NOTHING beyond
 *   an ambiguity-marker word ("cerca", "por", "via", "al"/"lado") plus pure connector filler
 *   ("de"/"a") — i.e. it names no landmark of its own. This is the precise signal a structured
 *   intake produces when it splits "cerca de X" into a one-word free-text field and a separate
 *   zone field.
 *
 *   `hasCrossFieldAmbiguousMarker(candidates)` — true when some field is a bare marker field AND
 *   some field (the same one or a different one) contains a known zone alias. Both `matchLocalZone`
 *   (returns `ambiguous: true`, `matched: false`) and `isZoneOnlyReferenceStructurallyComplete`
 *   (returns `false`, defense in depth for callers that supply a pre-computed `localZoneMatch` and
 *   reach completeness directly) now check this before granting any zone-only trust.
 *
 * Deliberately NOT flagged: a field that pairs a marker word with genuine landmark content (e.g.
 * "cerca del parque azul", "casa al lado del parque") is NOT a bare-marker field and is left
 * untouched — see the "legitimate non-ambiguous cross-field use" tests below, which assert this
 * explicitly so this suite cannot be "fixed" by over-broadly banning the words themselves.
 *
 * All 7 original bypass cases below are now asserted to fail closed, matching the single-field
 * behavior at delivery-pricing.spec.ts:163. Three additional generalization variants are added
 * (a 3-way field split, the "al lado" marker phrase, and the "por"/"via" cross-field cases already
 * covered by the it.each) to build confidence the RULE 11 fix generalizes beyond the exact reported
 * shape, plus explicit positive-control tests proving legitimate uses of the same words stay
 * unaffected.
 */
describe('A51/A52 — LOCAL_FREE cross-field ambiguous-prefix bypass ("cerca" split across fields) — FIXED, permanent regression', () => {
  it('single-field "cerca de alborada" is correctly detected as ambiguous (baseline, matches existing regression suite)', () => {
    const result = matchLocalZone({ addressText: 'cerca de alborada' });
    expect(result.ambiguous).toBe(true);
    expect(result.matched).toBe(false);
  });

  it('FIXED: identical semantic content split across neighborhood+reference fields is now correctly detected as ambiguous', () => {
    const input = { neighborhood: 'alborada', reference: 'cerca' };

    const zoneMatch = matchLocalZone(input);
    expect(zoneMatch.ambiguous).toBe(true);
    expect(zoneMatch.matched).toBe(false);

    const complete = isZoneOnlyReferenceStructurallyComplete(input);
    // The ambiguity marker word "cerca" is no longer misread as genuine descriptive content once a
    // zone alias is present in another field.
    expect(complete).toBe(false);
  });

  it('FIXED end-to-end through the real, unmocked DeliveryPricingEngine: the cross-field split now fails closed to NEEDS_ADDRESS_CORRECTION, matching the single-field behavior', () => {
    const engine = new DeliveryPricingEngine();

    const result = engine.quote({ neighborhood: 'alborada', reference: 'cerca' });

    expect(result.pricingStatus).toBe('NEEDS_ADDRESS_CORRECTION');
    expect(result.finalFee).toBeNull();
    expect(result.requiresManualQuote).toBe(true);
    expect(result.checkoutAuthorization.canCheckout).toBe(false);
    expect(result.canCheckout).toBe(false);
    expect(result.requiresAddressCorrection).toBe(true);
    expect(result.warnings).toContain('LOCAL_ZONE_AMBIGUOUS');
  });

  it('FIXED: bypass also previously reachable via addressText+reference split (not neighborhood-specific) — now blocked', () => {
    const engine = new DeliveryPricingEngine();
    const result = engine.quote({ addressText: 'alborada', reference: 'cerca' });

    expect(result.pricingStatus).toBe('NEEDS_ADDRESS_CORRECTION');
    expect(result.canCheckout).toBe(false);
    expect(result.requiresManualQuote).toBe(true);
    expect(result.warnings).toContain('LOCAL_ZONE_AMBIGUOUS');
  });

  it.each(['por', 'via', 'vía'])(
    'FIXED: the same cross-field bypass pattern for the other ambiguous-prefix words ("%s") is now blocked',
    (prefixWord) => {
      const zoneMatch = matchLocalZone({ neighborhood: 'condados', reference: prefixWord });
      expect(zoneMatch.ambiguous).toBe(true);
      expect(zoneMatch.matched).toBe(false);
    },
  );

  // --- Additional generalization variants (beyond A51's original 7 cases) -----------------------

  it('GENERALIZATION: a 3-way field split ("cerca" in addressText, connector "de" in neighborhood, alias in reference) is still caught', () => {
    const zoneMatch = matchLocalZone({ addressText: 'cerca', neighborhood: 'de', reference: 'alborada' });
    expect(zoneMatch.ambiguous).toBe(true);
    expect(zoneMatch.matched).toBe(false);

    const complete = isZoneOnlyReferenceStructurallyComplete({
      addressText: 'cerca',
      neighborhood: 'de',
      reference: 'alborada',
    });
    expect(complete).toBe(false);
  });

  it('GENERALIZATION: the "al lado" marker phrase (from "al lado de") split across fields is also caught, for the "condados" alias', () => {
    const zoneMatch = matchLocalZone({ neighborhood: 'condados', reference: 'al lado' });
    expect(zoneMatch.ambiguous).toBe(true);
    expect(zoneMatch.matched).toBe(false);

    const engine = new DeliveryPricingEngine();
    const result = engine.quote({ neighborhood: 'condados', reference: 'al lado' });
    expect(result.pricingStatus).toBe('NEEDS_ADDRESS_CORRECTION');
    expect(result.canCheckout).toBe(false);
  });

  // --- Positive controls: legitimate, non-ambiguous uses of the same words must NOT be flagged ---

  it('POSITIVE CONTROL: "casa cerca del parque" with no zone-alias word anywhere in the input stays non-ambiguous', () => {
    const zoneMatch = matchLocalZone({ addressText: 'casa cerca del parque azul' });
    expect(zoneMatch.ambiguous).toBe(false);
  });

  it('POSITIVE CONTROL: a field pairing the marker with genuine landmark content (not a bare marker) stays non-ambiguous and structurally complete, even with the alias in another field', () => {
    const zoneMatch = matchLocalZone({ addressText: 'Alborada', reference: 'cerca del parque azul' });
    expect(zoneMatch.ambiguous).toBe(false);
    expect(zoneMatch.matched).toBe(true);

    const complete = isZoneOnlyReferenceStructurallyComplete({
      addressText: 'Alborada',
      reference: 'cerca del parque azul',
    });
    expect(complete).toBe(true);
  });

  it('POSITIVE CONTROL: real, unmocked engine still grants LOCAL_FREE + canCheckout for a genuinely complete zone + landmark address', () => {
    const engine = new DeliveryPricingEngine();
    const result = engine.quote({ addressText: 'Alborada', reference: 'casa esquinera porton azul' });

    expect(result.pricingStatus).toBe('LOCAL_FREE');
    expect(result.finalFee).toBe(0);
    expect(result.requiresManualQuote).toBe(false);
    expect(result.checkoutAuthorization.canCheckout).toBe(true);
    expect(result.canCheckout).toBe(true);
  });
});
