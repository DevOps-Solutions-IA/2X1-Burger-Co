import {
  applyDestinationEdit,
  createInitialDestinationSnapshot,
  COORDINATE_EVIDENCE_MATERIAL_THRESHOLD_KM,
  isCoordinateEvidenceMateriallyDifferent,
  isCoordinateUsableForPricing,
  isQuoteBoundToCurrentDestination,
  quoteBindingFor,
} from './destination-revision';
import { DestinationStateError, type DestinationSnapshot } from './destination-snapshot.types';

const NOW = new Date('2026-08-23T12:00:00.000Z');

describe('RULE 1 — coordinate atomicity', () => {
  it('throws COORDINATE_PAIR_INCOMPLETE when only latitude is supplied', () => {
    expect(() =>
      applyDestinationEdit(null, { rawReferenceText: 'Calle 5 #10-20', coordinates: { latitude: 3.42, longitude: null, source: 'GPS_SHARE' } }, NOW),
    ).toThrow(DestinationStateError);
  });

  it('throws COORDINATE_PAIR_INCOMPLETE when only longitude is supplied', () => {
    expect(() =>
      applyDestinationEdit(null, { rawReferenceText: 'Calle 5 #10-20', coordinates: { latitude: null, longitude: -76.5, source: 'GPS_SHARE' } }, NOW),
    ).toThrow(DestinationStateError);
  });

  it('never pairs a NEW latitude with an OLD longitude across two edits', () => {
    const { snapshot: first } = applyDestinationEdit(
      null,
      { rawReferenceText: 'Calle 5 #10-20', coordinates: { latitude: 3.62, longitude: -76.15, source: 'GPS_SHARE' } },
      NOW,
    );
    expect(() =>
      applyDestinationEdit(first, { coordinates: { latitude: 3.25, longitude: null, source: 'GPS_SHARE' } }, NOW),
    ).toThrow(DestinationStateError);
  });

  it('accepts a real atomic pair', () => {
    const { snapshot } = applyDestinationEdit(
      null,
      { rawReferenceText: 'Calle 5 #10-20', coordinates: { latitude: 3.62, longitude: -76.15, source: 'GPS_SHARE' } },
      NOW,
    );
    expect(snapshot.latitude).toBe(3.62);
    expect(snapshot.longitude).toBe(-76.15);
  });
});

describe('RULE 2 — coordinates bound to ONE spatial destination revision', () => {
  it('a SPATIAL edit without new coordinates leaves the OLD pair STALE, unusable for the new revision', () => {
    const { snapshot: rev1 } = applyDestinationEdit(
      null,
      { rawReferenceText: 'Calle 5 #10-20', coordinates: { latitude: 3.62, longitude: -76.15, source: 'GPS_SHARE', confidence: 'HIGH' } },
      NOW,
    );
    expect(isCoordinateUsableForPricing(rev1)).toBe(true);

    const { snapshot: rev2, classification, revisionBumped } = applyDestinationEdit(rev1, { rawReferenceText: 'Carrera 8 #40-12' }, NOW);
    expect(classification).toBe('SPATIAL');
    expect(revisionBumped).toBe(true);
    expect(rev2.revision).toBe(rev1.revision + 1);
    // Preserved (not deleted) for audit, but structurally unusable for pricing at the new revision.
    expect(rev2.latitude).toBe(3.62);
    expect(rev2.longitude).toBe(-76.15);
    expect(rev2.coordinateTrust).toBe('STALE');
    expect(rev2.coordinateBoundRevision).toBe(rev1.revision);
    expect(rev2.coordinateBoundRevision).not.toBe(rev2.revision);
    expect(isCoordinateUsableForPricing(rev2)).toBe(false);
  });

  it('GPS_A proven for destination A is never valid evidence for destination B\'s different revision', () => {
    const { snapshot: destinationA } = applyDestinationEdit(
      null,
      { rawReferenceText: 'Calle 5 #10-20', coordinates: { latitude: 3.62, longitude: -76.15, source: 'GPS_SHARE', confidence: 'HIGH' } },
      NOW,
    );
    const { snapshot: destinationB } = applyDestinationEdit(destinationA, { rawReferenceText: 'Avenida 9 #50-30' }, NOW);
    expect(isCoordinateUsableForPricing(destinationB)).toBe(false);
    expect(destinationB.spatialFingerprint).not.toBe(destinationA.spatialFingerprint);
  });
});

describe('RULE 3 — a non-spatial edit does NOT create a new spatial revision', () => {
  it('CRITICAL finding fix: "casa azul" -> "portón negro" on the SAME address preserves revision AND coordinates', () => {
    const { snapshot: rev1 } = applyDestinationEdit(
      null,
      { rawReferenceText: 'Calle 5 #10-20, casa azul', coordinates: { latitude: 3.62, longitude: -76.15, source: 'GPS_SHARE', confidence: 'HIGH' } },
      NOW,
    );
    const { snapshot: rev1Again, classification, revisionBumped } = applyDestinationEdit(
      rev1,
      { rawReferenceText: 'Calle 5 #10-20, portón negro' },
      NOW,
    );
    expect(classification).toBe('NON_SPATIAL');
    expect(revisionBumped).toBe(false);
    expect(rev1Again.revision).toBe(rev1.revision);
    expect(rev1Again.latitude).toBe(3.62);
    expect(rev1Again.longitude).toBe(-76.15);
    expect(rev1Again.coordinateTrust).toBe('TRUSTED');
    expect(isCoordinateUsableForPricing(rev1Again)).toBe(true);
  });

  it('an instructions-only edit (structured components path) does not bump revision', () => {
    const { snapshot: rev1 } = applyDestinationEdit(
      null,
      { addressComponents: { street: 'Calle 5', number: '10-20' }, deliveryInstructions: 'casa azul' },
      NOW,
    );
    const { snapshot: rev1Again, revisionBumped } = applyDestinationEdit(rev1, { deliveryInstructions: 'portón negro' }, NOW);
    expect(revisionBumped).toBe(false);
    expect(rev1Again.revision).toBe(rev1.revision);
    expect(rev1Again.deliveryInstructions).toBe('portón negro');
  });
});

describe('RULE 4 — new trusted evidence replaces old evidence for the ACTIVE revision only', () => {
  it('a fresh GPS share on the same address supersedes the previous pair, same revision', () => {
    const { snapshot: rev1 } = applyDestinationEdit(
      null,
      { rawReferenceText: 'Calle 5 #10-20', coordinates: { latitude: 3.2, longitude: -76.5, source: 'MANUAL_ENTRY' } },
      NOW,
    );
    expect(rev1.coordinateTrust).toBe('PROVISIONAL');

    const { snapshot: rev1Refined, revisionBumped } = applyDestinationEdit(
      rev1,
      { coordinates: { latitude: 3.201, longitude: -76.501, source: 'GPS_SHARE', confidence: 'HIGH' } },
      NOW,
    );
    expect(revisionBumped).toBe(false);
    expect(rev1Refined.revision).toBe(rev1.revision);
    expect(rev1Refined.latitude).toBe(3.201);
    expect(rev1Refined.longitude).toBe(-76.501);
    expect(rev1Refined.coordinateTrust).toBe('TRUSTED');
    expect(rev1Refined.coordinateBoundRevision).toBe(rev1Refined.revision);
    expect(isCoordinateUsableForPricing(rev1Refined)).toBe(true);
  });

  it('never leaves two simultaneously-authoritative pairs — the new one always wins', () => {
    const { snapshot: rev1 } = applyDestinationEdit(
      null,
      { rawReferenceText: 'Calle 5 #10-20', coordinates: { latitude: 3.2, longitude: -76.5, source: 'GPS_SHARE', confidence: 'HIGH' } },
      NOW,
    );
    const { snapshot: rev2 } = applyDestinationEdit(
      rev1,
      { rawReferenceText: 'Carrera 8 #40-12', coordinates: { latitude: 3.9, longitude: -76.1, source: 'GPS_SHARE', confidence: 'HIGH' } },
      NOW,
    );
    expect(rev2.revision).toBe(rev1.revision + 1);
    expect(rev2.latitude).toBe(3.9);
    expect(rev2.longitude).toBe(-76.1);
    expect(rev2.coordinateBoundRevision).toBe(rev2.revision);
    expect(isCoordinateUsableForPricing(rev2)).toBe(true);
  });
});

describe('RULE 5/HIGH finding — SOFIA: a distant textual destination after a nearby GPS share never inherits the old GPS', () => {
  it('customer shares nearby GPS then later types a different distant address in the same conversation', () => {
    const { snapshot: withGps } = applyDestinationEdit(
      null,
      { rawReferenceText: 'Calle 5 #10-20', coordinates: { latitude: 3.26, longitude: -76.54, source: 'GPS_SHARE', confidence: 'HIGH' } },
      NOW,
    );
    expect(isCoordinateUsableForPricing(withGps)).toBe(true);

    // Later turn: customer types a DIFFERENT, distant textual address, no new GPS attached.
    const { snapshot: afterTextChange, classification } = applyDestinationEdit(
      withGps,
      { rawReferenceText: 'Carrera 100 #5-20' },
      NOW,
    );
    expect(classification).toBe('SPATIAL');
    // The old GPS is never usable evidence for the new textual destination.
    expect(isCoordinateUsableForPricing(afterTextChange)).toBe(false);
    expect(afterTextChange.coordinateTrust).toBe('STALE');
  });
});

describe('RULE 6 — a previous order/destination never silently flows into a new one', () => {
  it('createInitialDestinationSnapshot never inherits coordinates, even implicitly', () => {
    const fresh = createInitialDestinationSnapshot({ rawReferenceText: 'Calle 5 #10-20' }, NOW);
    expect(fresh.latitude).toBeNull();
    expect(fresh.longitude).toBeNull();
    expect(fresh.coordinateTrust).toBe('UNTRUSTED');
    expect(fresh.revision).toBe(1);
  });
});

describe('AMBIGUOUS classification fails closed as SPATIAL for revision/coordinate purposes', () => {
  it('an unrecognized reference-field change is treated as spatial (coordinates invalidated), not silently preserved', () => {
    const { snapshot: rev1 } = applyDestinationEdit(
      null,
      { rawReferenceText: 'Calle 5 #10-20, xyzzy', coordinates: { latitude: 3.2, longitude: -76.5, source: 'GPS_SHARE', confidence: 'HIGH' } },
      NOW,
    );
    const { snapshot: rev2, classification } = applyDestinationEdit(rev1, { rawReferenceText: 'Calle 5 #10-20, plugh' }, NOW);
    expect(classification).toBe('AMBIGUOUS');
    expect(rev2.revision).toBe(rev1.revision + 1);
    expect(isCoordinateUsableForPricing(rev2)).toBe(false);
  });
});

describe('QUOTE BINDING — quote.destinationRevision == currentDestination.revision', () => {
  it('a quote bound to an OLD revision is rejected once the destination has moved on (requote required)', () => {
    const { snapshot: rev1 } = applyDestinationEdit(null, { rawReferenceText: 'Calle 5 #10-20' }, NOW);
    const staleQuoteBinding = quoteBindingFor(rev1);
    const { snapshot: rev2 } = applyDestinationEdit(rev1, { rawReferenceText: 'Carrera 8 #40-12' }, NOW);
    expect(isQuoteBoundToCurrentDestination(staleQuoteBinding, rev2)).toBe(false);
  });

  it('a quote bound to the CURRENT revision is accepted', () => {
    const { snapshot: rev1 } = applyDestinationEdit(null, { rawReferenceText: 'Calle 5 #10-20' }, NOW);
    const binding = quoteBindingFor(rev1);
    expect(isQuoteBoundToCurrentDestination(binding, rev1)).toBe(true);
  });

  it('a same-numbered revision from a DIFFERENT destination lifecycle is still rejected (fingerprint check)', () => {
    const { snapshot: destinationOneRev1 } = applyDestinationEdit(null, { rawReferenceText: 'Calle 5 #10-20' }, NOW);
    const { snapshot: destinationTwoRev1 } = applyDestinationEdit(null, { rawReferenceText: 'Avenida 9 #50-30' }, NOW);
    const binding = quoteBindingFor(destinationOneRev1);
    expect(binding.destinationRevision).toBe(destinationTwoRev1.revision);
    expect(isQuoteBoundToCurrentDestination(binding, destinationTwoRev1)).toBe(false);
  });
});

// SOFIA Round 5 / A14 — closes the A13 blind red team finding: RULE 3/4 deliberately keep
// `revision`/`spatialFingerprint` UNCHANGED across a coordinate-only refinement of the SAME address
// (that is correct, see RULE 3). Before A14, that meant `isQuoteBoundToCurrentDestination` alone
// could not detect a quote/draft priced against coordinate evidence that has since been REPLACED
// (RULE 4) by a materially different pair for the SAME revision. These tests exercise that third
// axis directly, at the pure-function level (see `round5-a13-blind-redteam-coordinate-only-quote-bypass.spec.ts`
// for the end-to-end SOFIA regression, and `orders.phase6-atomicity.integration.spec.ts`'s "SOFIA
// Round 5 / A14" describe block for the legacy POS equivalent).
describe('QUOTE BINDING — A14: coordinate evidence materially changing invalidates a binding EVEN WITHOUT a revision bump', () => {
  it('a coordinate-only turn that replaces NEAR evidence with a materially-different FAR pair (same revision) invalidates the binding — requote required', () => {
    const { snapshot: rev1 } = applyDestinationEdit(
      null,
      { rawReferenceText: 'Avenida 9 #50-30', coordinates: { latitude: 3.255, longitude: -76.545, source: 'GPS_SHARE', confidence: 'HIGH' } },
      NOW,
    );
    const binding = quoteBindingFor(rev1);
    expect(binding.boundCoordinateLatitude).toBeCloseTo(3.255, 6);
    expect(binding.boundCoordinateLongitude).toBeCloseTo(-76.545, 6);

    // A LATER bare coordinate-only turn (no new address text) supplies a genuinely far (~53km) pair
    // for the SAME address text — RULE 4 replaces the active evidence, RULE 3 correctly leaves the
    // revision/fingerprint untouched.
    const { snapshot: rev2, revisionBumped } = applyDestinationEdit(
      rev1,
      { coordinates: { latitude: 3.62, longitude: -76.15, source: 'GPS_SHARE', confidence: 'HIGH' } },
      NOW,
    );
    expect(revisionBumped).toBe(false);
    expect(rev2.revision).toBe(rev1.revision);
    expect(rev2.spatialFingerprint).toBe(rev1.spatialFingerprint);

    // The OLD binding is no longer trustworthy — THIS is the A14 fix. Pre-A14, this returned `true`.
    expect(isQuoteBoundToCurrentDestination(binding, rev2)).toBe(false);
  });

  it('a coordinate-only turn within GPS jitter tolerance of the bound evidence does NOT invalidate the binding (no unnecessary requote)', () => {
    const { snapshot: rev1 } = applyDestinationEdit(
      null,
      { rawReferenceText: 'Avenida 9 #50-30', coordinates: { latitude: 3.255, longitude: -76.545, source: 'GPS_SHARE', confidence: 'HIGH' } },
      NOW,
    );
    const binding = quoteBindingFor(rev1);

    // ~30m offset — comfortably inside COORDINATE_EVIDENCE_MATERIAL_THRESHOLD_KM (150m): typical
    // smartphone GPS jitter re-sharing "the same spot", not a genuinely different point.
    const { snapshot: rev2, revisionBumped } = applyDestinationEdit(
      rev1,
      { coordinates: { latitude: 3.25527, longitude: -76.54503, source: 'GPS_SHARE', confidence: 'HIGH' } },
      NOW,
    );
    expect(revisionBumped).toBe(false);
    expect(isQuoteBoundToCurrentDestination(binding, rev2)).toBe(true);
  });

  it('evidence APPEARING (no coordinates at quote time, real coordinates arrive later, same revision) invalidates the binding', () => {
    const { snapshot: rev1 } = applyDestinationEdit(null, { rawReferenceText: 'Barrio Alborada' }, NOW);
    const binding = quoteBindingFor(rev1); // no usable coordinates yet — a bare zone-text match
    expect(binding.boundCoordinateLatitude).toBeNull();

    const { snapshot: rev2, revisionBumped } = applyDestinationEdit(
      rev1,
      { coordinates: { latitude: 3.62, longitude: -76.15, source: 'GPS_SHARE', confidence: 'HIGH' } },
      NOW,
    );
    expect(revisionBumped).toBe(false);
    expect(isQuoteBoundToCurrentDestination(binding, rev2)).toBe(false);
  });

  describe('isCoordinateEvidenceMateriallyDifferent (unit)', () => {
    it('two null pairs (no evidence either time) are not material', () => {
      expect(isCoordinateEvidenceMateriallyDifferent(null, null, null, null)).toBe(false);
    });

    it('evidence appearing or disappearing is always material', () => {
      expect(isCoordinateEvidenceMateriallyDifferent(null, null, 3.62, -76.15)).toBe(true);
      expect(isCoordinateEvidenceMateriallyDifferent(3.62, -76.15, null, null)).toBe(true);
    });

    it('a distance exactly at/under the threshold is not material; just over it is', () => {
      // ~0.001 degrees latitude ≈ 111m — inside the 150m threshold.
      expect(isCoordinateEvidenceMateriallyDifferent(3.255, -76.545, 3.256, -76.545)).toBe(false);
      // ~0.01 degrees latitude ≈ 1.1km — well past the 150m threshold.
      expect(isCoordinateEvidenceMateriallyDifferent(3.255, -76.545, 3.265, -76.545)).toBe(true);
    });

    it('the exported threshold constant is 0.15km (150m), matching the pre-existing legacy POS deliveryLocationConflicts threshold', () => {
      expect(COORDINATE_EVIDENCE_MATERIAL_THRESHOLD_KM).toBe(0.15);
    });
  });
});

describe('RULE 7 groundwork — snapshot is a pure value, safe to serialize/deserialize', () => {
  it('a JSON round-trip of a snapshot preserves every field needed for RULE 2 enforcement', () => {
    const { snapshot } = applyDestinationEdit(
      null,
      { rawReferenceText: 'Calle 5 #10-20', coordinates: { latitude: 3.62, longitude: -76.15, source: 'GPS_SHARE', confidence: 'HIGH' } },
      NOW,
    );
    const reloaded = JSON.parse(JSON.stringify(snapshot)) as DestinationSnapshot;
    expect(reloaded).toEqual(snapshot);
    expect(isCoordinateUsableForPricing(reloaded)).toBe(isCoordinateUsableForPricing(snapshot));
  });
});
