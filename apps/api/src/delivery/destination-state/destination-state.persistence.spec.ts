import { applyDestinationEdit, isCoordinateProvisionallyUsable, isCoordinateUsableForPricing } from './destination-revision';
import {
  fromDeliveryPricingAudit,
  fromDeliveryQuoteAuditEnvelope,
  fromOrderTicketDeliveryColumns,
  toDeliveryQuoteAuditEnvelope,
  toOrderTicketDeliveryColumns,
} from './destination-state.persistence';

const NOW = new Date('2026-08-23T12:00:00.000Z');

describe('toOrderTicketDeliveryColumns / fromOrderTicketDeliveryColumns — Tier 1 (collapsed, safe)', () => {
  it('persists a TRUSTED, current-revision pair as usable columns', () => {
    const { snapshot } = applyDestinationEdit(
      null,
      { rawReferenceText: 'Calle 5 #10-20', coordinates: { latitude: 3.62, longitude: -76.15, source: 'GPS_SHARE', confidence: 'HIGH' } },
      NOW,
    );
    const columns = toOrderTicketDeliveryColumns(snapshot, NOW);
    expect(columns.deliveryLatitude).toBe(3.62);
    expect(columns.deliveryLongitude).toBe(-76.15);
    expect(columns.deliveryLocationSource).toBe('whatsapp_live_location');
    expect(columns.deliveryLocationReceivedAt).toEqual(NOW);
  });

  it('SAFETY: never persists a STALE pair as if it were current — writes NULL instead', () => {
    const { snapshot: rev1 } = applyDestinationEdit(
      null,
      { rawReferenceText: 'Calle 5 #10-20', coordinates: { latitude: 3.62, longitude: -76.15, source: 'GPS_SHARE', confidence: 'HIGH' } },
      NOW,
    );
    const { snapshot: rev2 } = applyDestinationEdit(rev1, { rawReferenceText: 'Carrera 8 #40-12' }, NOW);
    expect(rev2.coordinateTrust).toBe('STALE');
    expect(rev2.latitude).not.toBeNull(); // preserved in-memory for audit

    const columns = toOrderTicketDeliveryColumns(rev2, NOW);
    // But NEVER persisted as a usable pair — this is the exact property that fixes the CRITICAL
    // finding's downstream risk (a stale-but-present pair being misread as current evidence).
    expect(columns.deliveryLatitude).toBeNull();
    expect(columns.deliveryLongitude).toBeNull();
    expect(columns.deliveryLocationReceivedAt).toBeNull();
  });

  it('round-trips a usable pair through OrderTicket columns with no in-memory state required (RULE 7)', () => {
    const { snapshot } = applyDestinationEdit(
      null,
      { rawReferenceText: 'Calle 5 #10-20', coordinates: { latitude: 3.62, longitude: -76.15, source: 'MAP_PIN', confidence: 'HIGH' } },
      NOW,
    );
    const columns = toOrderTicketDeliveryColumns(snapshot, NOW);
    const reconstructed = fromOrderTicketDeliveryColumns(columns);
    expect(reconstructed.latitude).toBe(3.62);
    expect(reconstructed.longitude).toBe(-76.15);
    expect(reconstructed.spatialFingerprint).toBe(snapshot.spatialFingerprint);
    expect(isCoordinateUsableForPricing(reconstructed)).toBe(true);
  });

  it('reconstructs UNTRUSTED with no spatial fingerprint claim when no address/coords were ever set', () => {
    const reconstructed = fromOrderTicketDeliveryColumns({
      deliveryReference: null,
      deliveryAddressNormalized: null,
      deliveryLatitude: null,
      deliveryLongitude: null,
      deliveryLocationSource: null,
      deliveryLocationReceivedAt: null,
      deliveryGeocodingProvider: null,
    });
    expect(reconstructed.coordinateTrust).toBe('UNTRUSTED');
    expect(reconstructed.latitude).toBeNull();
  });

  it('accepts a Prisma.Decimal-like value for latitude/longitude (numeric coercion)', () => {
    const decimalLike = { toString: () => '3.6200000' } as unknown as number;
    const reconstructed = fromOrderTicketDeliveryColumns({
      deliveryReference: 'Calle 5 #10-20',
      deliveryAddressNormalized: 'calle 5 10 20',
      deliveryLatitude: decimalLike,
      deliveryLongitude: decimalLike,
      deliveryLocationSource: 'whatsapp_live_location',
      deliveryLocationReceivedAt: NOW,
      deliveryGeocodingProvider: null,
    });
    expect(reconstructed.latitude).toBeCloseTo(3.62);
  });
});

describe('DeliveryPricingAudit resultJson envelope — Tier 2 (full fidelity)', () => {
  it('round-trips EVERY field, including revision/coordinateBoundRevision/coordinateTrust', () => {
    const { snapshot: rev1 } = applyDestinationEdit(
      null,
      { rawReferenceText: 'Calle 5 #10-20', coordinates: { latitude: 3.62, longitude: -76.15, source: 'GPS_SHARE', confidence: 'HIGH' } },
      NOW,
    );
    const { snapshot: rev2 } = applyDestinationEdit(rev1, { rawReferenceText: 'Carrera 8 #40-12' }, NOW);

    const envelope = toDeliveryQuoteAuditEnvelope(rev2);
    const asJson = JSON.parse(JSON.stringify(envelope));
    const reconstructed = fromDeliveryQuoteAuditEnvelope(asJson);

    expect(reconstructed).toEqual(rev2);
    expect(reconstructed?.revision).toBe(2);
    expect(reconstructed?.coordinateBoundRevision).toBe(1);
    expect(reconstructed?.coordinateTrust).toBe('STALE');
  });

  it('returns null for malformed/unrelated JSON rather than throwing', () => {
    expect(fromDeliveryQuoteAuditEnvelope(null)).toBeNull();
    expect(fromDeliveryQuoteAuditEnvelope([1, 2, 3])).toBeNull();
    expect(fromDeliveryQuoteAuditEnvelope({ someOtherShape: true })).toBeNull();
  });
});

describe('fromDeliveryPricingAudit — Tier 2b (SOFIA Round 5 / A20 CLOSURE, raw request/result reconstruction)', () => {
  it('prefers the Tier 2 envelope when resultJson already carries one', () => {
    const { snapshot } = applyDestinationEdit(
      null,
      { rawReferenceText: 'Calle 5 #10-20', coordinates: { latitude: 3.62, longitude: -76.15, source: 'GPS_SHARE', confidence: 'HIGH' } },
      NOW,
    );
    const envelope = JSON.parse(JSON.stringify(toDeliveryQuoteAuditEnvelope(snapshot)));
    const reconstructed = fromDeliveryPricingAudit({ id: 'audit-1', requestJson: {}, resultJson: envelope });
    expect(reconstructed).toEqual(snapshot);
  });

  it('reconstructs a TRUSTED, usable coordinate pair from the RAW DeliveryPricingRequest shape (location.{latitude,longitude,provider})', () => {
    const reconstructed = fromDeliveryPricingAudit({
      id: 'audit-2',
      requestJson: {
        addressText: 'Calle 5 #10-20',
        reference: 'Calle 5 #10-20',
        latitude: 3.265,
        longitude: -76.543,
        location: { latitude: 3.265, longitude: -76.543, provider: 'whatsapp_live_location', confidence: 'HIGH' },
      },
      resultJson: { pricingStatus: 'AUTO_PRICED', finalFee: 6500 },
    });
    expect(reconstructed).not.toBeNull();
    expect(reconstructed?.latitude).toBe(3.265);
    expect(reconstructed?.longitude).toBe(-76.543);
    expect(reconstructed?.coordinateSource).toBe('GPS_SHARE');
    expect(reconstructed?.coordinateTrust).toBe('TRUSTED');
    expect(reconstructed?.referenceText).toBe('Calle 5 #10-20');
    expect(reconstructed ? isCoordinateProvisionallyUsable(reconstructed) : false).toBe(true);
  });

  it('falls back to top-level requestJson.{latitude,longitude} when no `location` object is present', () => {
    const reconstructed = fromDeliveryPricingAudit({
      id: 'audit-3',
      requestJson: { addressText: 'Carrera 8 #40-12', latitude: 3.1, longitude: -76.2 },
      resultJson: { pricingStatus: 'AUTO_PRICED' },
    });
    expect(reconstructed?.latitude).toBe(3.1);
    expect(reconstructed?.longitude).toBe(-76.2);
    // No recognized provider label -> UNKNOWN source, but still PROVISIONAL (usable), never
    // silently discarded just because provenance wasn't labeled.
    expect(reconstructed?.coordinateSource).toBe('UNKNOWN');
    expect(reconstructed?.coordinateTrust).toBe('PROVISIONAL');
  });

  it('reconstructs a legitimate coordinate-less snapshot for a LOCAL_FREE zone-alias audit (no GPS ever submitted)', () => {
    const reconstructed = fromDeliveryPricingAudit({
      id: 'audit-4',
      requestJson: { addressText: 'Barrio Condados, sin GPS', reference: 'Barrio Condados, sin GPS' },
      resultJson: { pricingStatus: 'LOCAL_FREE', finalFee: 0 },
    });
    expect(reconstructed).not.toBeNull();
    expect(reconstructed?.latitude).toBeNull();
    expect(reconstructed?.longitude).toBeNull();
    expect(reconstructed?.coordinateTrust).toBe('UNTRUSTED');
    expect(reconstructed?.referenceText).toBe('Barrio Condados, sin GPS');
  });

  it('returns null when the audit row carries genuinely no spatial evidence at all (no coordinates, no reference text)', () => {
    expect(fromDeliveryPricingAudit({ id: 'audit-5', requestJson: {}, resultJson: {} })).toBeNull();
    expect(fromDeliveryPricingAudit({ id: 'audit-6', requestJson: null as unknown as object, resultJson: {} })).toBeNull();
  });

  it('never lets an incomplete single-axis coordinate pair in requestJson be treated as usable evidence', () => {
    const reconstructed = fromDeliveryPricingAudit({
      id: 'audit-7',
      requestJson: { addressText: 'Calle 1', latitude: 3.1 }, // longitude missing
      resultJson: { pricingStatus: 'AUTO_PRICED' },
    });
    expect(reconstructed?.latitude).toBeNull();
    expect(reconstructed?.longitude).toBeNull();
    expect(reconstructed?.coordinateTrust).toBe('UNTRUSTED');
  });
});
