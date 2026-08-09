import { OrderTicketType } from '@prisma/client';

export const LOGISTICS_ONLY_LOCATION_FIELDS = [
  'deliveryLatitude',
  'deliveryLongitude',
  'deliveryLocationSource',
  'deliveryLocationReceivedAt',
  'deliveryCustomerId',
  'deliveryStatusUpdatedAt',
  'revision',
] as const;

export const LOCATION_PROTECTED_FIELDS = [
  'deliveryReference',
  'deliveryAddressNormalized',
  'deliveryDistanceKm',
  'deliveryZoneLabel',
  'deliveryFee',
  'deliveryFeeSuggested',
  'deliveryFeeEdited',
  'deliveryFeeEditReason',
  'deliveryPricingStatus',
  'deliveryPricingConfidence',
  'deliveryPricingBreakdown',
  'deliveryCalculationVersion',
  'deliveryRequiresManualQuote',
  'deliveryRouteProvider',
  'deliveryWeatherProvider',
  'deliveryGeocodingProvider',
  'deliveryEstimatedMinutes',
  'subtotal',
  'items',
  'commercialVersion',
] as const;

const LOGISTICS_FIELDS = new Set<string>(LOGISTICS_ONLY_LOCATION_FIELDS);
const PROTECTED_FIELDS = new Set<string>(LOCATION_PROTECTED_FIELDS);

export type LocationMutationDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'COORDINATES_REQUIRED' | 'PROTECTED_FIELD' | 'UNKNOWN_FIELD';
      fields: string[];
    };

export interface DeliveryLocationMatchCandidate {
  orderId: string;
  fulfillment: OrderTicketType;
  active: boolean;
  customerPhone: string | null;
}

export type DeliveryLocationMatchDecision =
  | {
      status: 'MATCHED';
      orderId: string;
      rule: 'EXACT_NORMALIZED_PHONE';
    }
  | {
      status: 'REQUIRES_REVIEW';
      reason: 'NO_IDENTITY' | 'NO_MATCH' | 'AMBIGUOUS_MATCH';
      candidateOrderIds: string[];
    };

function normalizePhone(value: string | null | undefined): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 10) {
    return `57${digits}`;
  }
  return digits;
}

export class DeliveryLocationPolicy {
  evaluateMutation(changedFields: readonly string[]): LocationMutationDecision {
    const uniqueFields = [...new Set(changedFields)];
    const protectedFields = uniqueFields.filter((field) => PROTECTED_FIELDS.has(field));
    if (protectedFields.length > 0) {
      return { allowed: false, reason: 'PROTECTED_FIELD', fields: protectedFields };
    }

    const unknownFields = uniqueFields.filter((field) => !LOGISTICS_FIELDS.has(field));
    if (unknownFields.length > 0) {
      return { allowed: false, reason: 'UNKNOWN_FIELD', fields: unknownFields };
    }

    const coordinateFields = ['deliveryLatitude', 'deliveryLongitude'];
    const missingCoordinates = coordinateFields.filter((field) => !uniqueFields.includes(field));
    if (missingCoordinates.length > 0) {
      return { allowed: false, reason: 'COORDINATES_REQUIRED', fields: missingCoordinates };
    }

    return { allowed: true };
  }

  resolveMatch(
    senderIdentityCandidates: readonly string[],
    candidates: readonly DeliveryLocationMatchCandidate[],
  ): DeliveryLocationMatchDecision {
    const identities = new Set(senderIdentityCandidates.map(normalizePhone).filter(Boolean));
    if (identities.size === 0) {
      return { status: 'REQUIRES_REVIEW', reason: 'NO_IDENTITY', candidateOrderIds: [] };
    }

    const matchingOrderIds = [
      ...new Set(
        candidates
          .filter(
            (candidate) =>
              candidate.active &&
              candidate.fulfillment === OrderTicketType.DELIVERY &&
              identities.has(normalizePhone(candidate.customerPhone)),
          )
          .map((candidate) => candidate.orderId),
      ),
    ];

    if (matchingOrderIds.length === 1) {
      return {
        status: 'MATCHED',
        orderId: matchingOrderIds[0]!,
        rule: 'EXACT_NORMALIZED_PHONE',
      };
    }

    return {
      status: 'REQUIRES_REVIEW',
      reason: matchingOrderIds.length === 0 ? 'NO_MATCH' : 'AMBIGUOUS_MATCH',
      candidateOrderIds: matchingOrderIds,
    };
  }
}
