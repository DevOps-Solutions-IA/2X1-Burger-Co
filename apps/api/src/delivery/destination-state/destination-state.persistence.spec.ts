import { applyDestinationEdit, isCoordinateUsableForPricing } from './destination-revision';
import {
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
