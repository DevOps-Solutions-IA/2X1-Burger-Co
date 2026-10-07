import { resolveAtomicCoordinatePair } from './destination-coordinate-pair';

// RULE 1 PoC: before this fix, `orders.service.ts::resolveDeliverySnapshot` computed
//   const latitude = explicitLatitude ?? existingLatitude;
//   const longitude = explicitLongitude ?? existingLongitude;
// which, given a lone new latitude (no new longitude) and a stale existing longitude from a
// different capture event, produced a synthetic (newLat, oldLng) point that was never actually
// geocoded or GPS-proven together. These tests pin the correct, atomic replacement.
describe('resolveAtomicCoordinatePair (RULE 1 — coordinate atomicity)', () => {
  it('uses the full explicit pair when both axes are freshly supplied', () => {
    const result = resolveAtomicCoordinatePair({
      explicitLatitude: 4.711,
      explicitLongitude: -74.0721,
      existingLatitude: 4.6,
      existingLongitude: -74.08,
    });
    expect(result).toEqual({
      latitude: 4.711,
      longitude: -74.0721,
      source: 'EXPLICIT_PAIR',
      partialCoordinateDiscarded: false,
      discardedAxis: null,
    });
  });

  it('carries forward the full existing pair when neither axis is freshly supplied', () => {
    const result = resolveAtomicCoordinatePair({
      explicitLatitude: null,
      explicitLongitude: null,
      existingLatitude: 4.6,
      existingLongitude: -74.08,
    });
    expect(result).toEqual({
      latitude: 4.6,
      longitude: -74.08,
      source: 'EXISTING_PAIR',
      partialCoordinateDiscarded: false,
      discardedAxis: null,
    });
  });

  it('THE BUG (before fix): a lone new latitude without a new longitude must never be combined with the stale existing longitude', () => {
    const result = resolveAtomicCoordinatePair({
      explicitLatitude: 4.711, // fresh, THIS turn
      explicitLongitude: null, // not supplied this turn
      existingLatitude: 4.6, // stale, from a DIFFERENT earlier capture event
      existingLongitude: -74.08, // stale, from a DIFFERENT earlier capture event
    });
    // The buggy `explicitLatitude ?? existingLatitude` / `explicitLongitude ?? existingLongitude`
    // would have produced (4.711, -74.08) — a synthetic point never proven as a pair.
    expect(result.latitude).not.toBe(4.711);
    expect([result.latitude, result.longitude]).not.toEqual([4.711, -74.08]);
    // The only two legal outcomes are "both new" or "both existing" — since only one axis was
    // new, it must fall back to the full existing pair, never a mix.
    expect(result).toEqual({
      latitude: 4.6,
      longitude: -74.08,
      source: 'EXISTING_PAIR',
      partialCoordinateDiscarded: true,
      discardedAxis: 'latitude',
    });
  });

  it('a lone new longitude without a new latitude is likewise discarded, never combined', () => {
    const result = resolveAtomicCoordinatePair({
      explicitLatitude: null,
      explicitLongitude: -74.9999,
      existingLatitude: 4.6,
      existingLongitude: -74.08,
    });
    expect(result).toEqual({
      latitude: 4.6,
      longitude: -74.08,
      source: 'EXISTING_PAIR',
      partialCoordinateDiscarded: true,
      discardedAxis: 'longitude',
    });
  });

  it('a partial submission with no trusted existing pair resolves to NONE, never a lone axis', () => {
    const result = resolveAtomicCoordinatePair({
      explicitLatitude: 4.711,
      explicitLongitude: null,
      existingLatitude: null,
      existingLongitude: null,
    });
    expect(result).toEqual({
      latitude: null,
      longitude: null,
      source: 'NONE',
      partialCoordinateDiscarded: true,
      discardedAxis: 'latitude',
    });
  });

  it('no explicit submission and no existing pair resolves to NONE', () => {
    const result = resolveAtomicCoordinatePair({
      explicitLatitude: undefined,
      explicitLongitude: undefined,
      existingLatitude: null,
      existingLongitude: null,
    });
    expect(result).toEqual({
      latitude: null,
      longitude: null,
      source: 'NONE',
      partialCoordinateDiscarded: false,
      discardedAxis: null,
    });
  });

  it('a full explicit pair of (0, 0) is still a valid pair, not confused with "not supplied"', () => {
    const result = resolveAtomicCoordinatePair({
      explicitLatitude: 0,
      explicitLongitude: 0,
      existingLatitude: 4.6,
      existingLongitude: -74.08,
    });
    expect(result).toEqual({
      latitude: 0,
      longitude: 0,
      source: 'EXPLICIT_PAIR',
      partialCoordinateDiscarded: false,
      discardedAxis: null,
    });
  });
});
