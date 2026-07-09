import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DeliveryExternalDataService } from '../providers/delivery-external-data.service';
import { DeliveryPricingEngine } from './delivery-pricing.engine';
import type { DeliveryPricingRequest, DeliveryPricingResult } from './delivery-pricing.types';

@Injectable()
export class DeliveryPricingService {
  private readonly engine = new DeliveryPricingEngine();

  constructor(
    @Optional() private readonly externalDataService?: DeliveryExternalDataService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  quote(request: DeliveryPricingRequest) {
    return this.engine.quote(request);
  }

  async estimate(request: DeliveryPricingRequest) {
    const context = this.externalDataService
      ? await this.externalDataService.resolveDeliveryContext({
          customerId: request.customerId ?? undefined,
          addressText: request.addressText ?? undefined,
          neighborhood: request.neighborhood ?? undefined,
          reference: request.reference ?? undefined,
          city: request.city ?? undefined,
          state: request.state ?? undefined,
          country: request.country ?? undefined,
          latitude: request.location?.latitude ?? request.latitude ?? undefined,
          longitude: request.location?.longitude ?? request.longitude ?? undefined,
          locationProvider: request.location?.provider ?? undefined,
          locationPlaceId: request.location?.placeId ?? undefined,
          locationFormattedAddress: request.location?.formattedAddress ?? undefined,
          locationConfidence: request.location?.confidence ?? undefined,
          orderSubtotal: request.orderSubtotal,
          requestedAt: request.requestedAt ? new Date(request.requestedAt) : undefined,
        })
      : null;
    const result = this.engine.quote({ ...request, context });

    const auditId = await this.auditEstimate(request, result).catch(() => null);

    return { ...result, auditId };
  }

  private async auditEstimate(request: DeliveryPricingRequest, result: DeliveryPricingResult) {
    if (!this.prisma) return null;

    const audit = await this.prisma.deliveryPricingAudit.create({
      data: {
        customerId: request.customerId ?? null,
        operatorId: request.operatorId ?? null,
        requestJson: sanitizeJson(request),
        resultJson: sanitizeJson(result),
        suggestedFee: result.suggestedFee != null ? new Prisma.Decimal(result.suggestedFee) : null,
        finalFee: result.finalFee != null ? new Prisma.Decimal(result.finalFee) : null,
        manualEdited: result.manualEdited,
        manualEditReason: result.manualEditReason,
        calculationVersion: result.calculationVersion,
        providerSummaryJson: sanitizeJson(result.providerUsage),
      },
    });
    return audit.id;
  }
}

function sanitizeJson(value: unknown) {
  return JSON.parse(JSON.stringify(value, (_key, nested) => (nested instanceof Date ? nested.toISOString() : nested))) as Prisma.InputJsonValue;
}
