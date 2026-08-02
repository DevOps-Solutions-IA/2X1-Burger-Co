import { Injectable } from '@nestjs/common';
import type { DeliveryQuoteService } from '../application/contracts/sofia-domain-contracts';
import { DeliveryPricingService } from './delivery-pricing/delivery-pricing.service';

@Injectable()
export class AuthoritativeDeliveryQuoteAdapter implements DeliveryQuoteService {
  constructor(private readonly pricing: DeliveryPricingService) {}

  async quote(input: Parameters<DeliveryQuoteService['quote']>[0]) {
    const result = await this.pricing.estimate({
      addressText: input.addressText,
      neighborhood: input.neighborhood,
      latitude: input.latitude,
      longitude: input.longitude,
      orderSubtotal: input.orderSubtotal,
      operatorId: input.actor.actorId,
    });
    return {
      auditId: result.auditId ?? null,
      status: result.status,
      finalFee: result.finalFee,
      currency: result.currency,
      distanceKm: result.distanceKm,
      estimatedMinutes: result.estimatedMinutes,
      reasonCode: result.reasonCode,
      calculationVersion: result.calculationVersion,
      canCheckout: result.canCheckout,
    };
  }
}
