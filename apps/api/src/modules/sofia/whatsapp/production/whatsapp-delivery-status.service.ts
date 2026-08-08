import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { WhatsappDeliveryStatus } from '@prisma/client';
import type { DeliveryStatusUpdate, NormalizedDeliveryStatus } from './whatsapp-production.types';
import { WHATSAPP_PRODUCTION_REPOSITORY, type WhatsappProductionRepository } from './whatsapp-production.repository';

const RANK: Record<NormalizedDeliveryStatus, number> = { UNKNOWN: 0, ACCEPTED: 1, SENT: 2, DELIVERED: 3, READ: 4, FAILED: 5 };

@Injectable()
export class WhatsappDeliveryStatusService {
  constructor(@Inject(WHATSAPP_PRODUCTION_REPOSITORY) private readonly repository: WhatsappProductionRepository) {}

  async apply(input: DeliveryStatusUpdate) {
    const previous = await this.repository.latestStatus(input.accountId, input.providerMessageId);
    if (previous && !this.allowed(previous, input.status)) {
      throw new BadRequestException({ code: 'WHATSAPP_STATUS_REGRESSION' });
    }
    try {
      return await this.repository.appendStatus({ ...input, status: WhatsappDeliveryStatus[input.status] });
    } catch (error) {
      if (error instanceof Error && error.message === 'WHATSAPP_STATUS_MESSAGE_NOT_FOUND') {
        throw new NotFoundException({ code: 'WHATSAPP_STATUS_MESSAGE_NOT_FOUND' });
      }
      if (error instanceof Error && error.message === 'WHATSAPP_STATUS_REGRESSION') {
        throw new BadRequestException({ code: 'WHATSAPP_STATUS_REGRESSION' });
      }
      throw error;
    }
  }

  private allowed(previous: WhatsappDeliveryStatus, next: NormalizedDeliveryStatus) {
    if (previous === next) return true;
    if (previous === 'FAILED' || previous === 'READ') return false;
    if (next === 'FAILED') return true;
    return RANK[next] >= RANK[previous];
  }
}
