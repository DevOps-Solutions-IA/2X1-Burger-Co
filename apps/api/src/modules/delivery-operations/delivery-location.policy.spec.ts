import { OrderTicketType } from '@prisma/client';
import { DeliveryLocationPolicy } from './delivery-location.policy';

describe('DeliveryLocationPolicy', () => {
  const policy = new DeliveryLocationPolicy();

  it('allows an atomic coordinates update with logistics metadata', () => {
    expect(
      policy.evaluateMutation([
        'deliveryLatitude',
        'deliveryLongitude',
        'deliveryLocationSource',
        'deliveryLocationReceivedAt',
        'deliveryStatusUpdatedAt',
        'revision',
      ]),
    ).toEqual({ allowed: true });
  });

  it.each([
    'deliveryFee',
    'deliveryDistanceKm',
    'deliveryPricingBreakdown',
    'deliveryEstimatedMinutes',
    'subtotal',
    'items',
    'commercialVersion',
  ])('rejects logistics updates that include protected field %s', (field) => {
    expect(policy.evaluateMutation(['deliveryLatitude', 'deliveryLongitude', field])).toEqual({
      allowed: false,
      reason: 'PROTECTED_FIELD',
      fields: [field],
    });
  });

  it('fails closed for unknown fields and partial coordinates', () => {
    expect(policy.evaluateMutation(['deliveryLatitude', 'customerName'])).toEqual({
      allowed: false,
      reason: 'UNKNOWN_FIELD',
      fields: ['customerName'],
    });
    expect(policy.evaluateMutation(['deliveryLatitude'])).toEqual({
      allowed: false,
      reason: 'COORDINATES_REQUIRED',
      fields: ['deliveryLongitude'],
    });
  });

  it('matches one active delivery by exact normalized phone', () => {
    expect(
      policy.resolveMatch(['300 111 22 33'], [
        {
          orderId: 'delivery-1',
          fulfillment: OrderTicketType.DELIVERY,
          active: true,
          customerPhone: '+57 300 111 2233',
        },
        {
          orderId: 'takeaway-1',
          fulfillment: OrderTicketType.TAKEAWAY,
          active: true,
          customerPhone: '+57 300 111 2233',
        },
      ]),
    ).toEqual({
      status: 'MATCHED',
      orderId: 'delivery-1',
      rule: 'EXACT_NORMALIZED_PHONE',
    });
  });

  it('fails closed when the identity matches more than one active delivery', () => {
    expect(
      policy.resolveMatch(['573001112233'], [
        {
          orderId: 'delivery-older',
          fulfillment: OrderTicketType.DELIVERY,
          active: true,
          customerPhone: '3001112233',
        },
        {
          orderId: 'delivery-newer',
          fulfillment: OrderTicketType.DELIVERY,
          active: true,
          customerPhone: '3001112233',
        },
      ]),
    ).toEqual({
      status: 'REQUIRES_REVIEW',
      reason: 'AMBIGUOUS_MATCH',
      candidateOrderIds: ['delivery-older', 'delivery-newer'],
    });
  });

  it('requires manual review when identity is absent or unmatched', () => {
    expect(policy.resolveMatch([], [])).toEqual({
      status: 'REQUIRES_REVIEW',
      reason: 'NO_IDENTITY',
      candidateOrderIds: [],
    });
    expect(policy.resolveMatch(['573001112233'], [])).toEqual({
      status: 'REQUIRES_REVIEW',
      reason: 'NO_MATCH',
      candidateOrderIds: [],
    });
  });
});
