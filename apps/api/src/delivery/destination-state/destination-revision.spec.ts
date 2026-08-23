import {
  applyDestinationEdit,
  createInitialDestinationSnapshot,
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
