import { Injectable } from '@nestjs/common';
import { NotificationIntentStatus, SofiaCommandFailureClass, SofiaCommandStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { NotificationReconciliationObservation } from './domain/notification.types';
import type { NotificationReconciliationCandidate } from './persistence/notification-intent.repository';

export type NotificationReconciliationEvidence = Readonly<{
  observation: NotificationReconciliationObservation;
  errorCode: string | null;
}>;

export abstract class NotificationReconciliationObserver {
  abstract observe(candidate: NotificationReconciliationCandidate): Promise<NotificationReconciliationEvidence>;
}

@Injectable()
export class PrismaNotificationReconciliationObserver extends NotificationReconciliationObserver {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async observe(candidate: NotificationReconciliationCandidate): Promise<NotificationReconciliationEvidence> {
    if (!candidate.secureCommandId) {
      return this.evidence('RESULT_UNKNOWN', 'NOTIFICATION_COMMAND_BINDING_MISSING');
    }
    const command = await this.prisma.sofiaCommand.findUnique({
      where: { id: candidate.secureCommandId },
      select: {
        status: true,
        failureClass: true,
        failureCode: true,
      },
    });
    if (!command) return this.evidence('RESULT_UNKNOWN', 'NOTIFICATION_COMMAND_EVIDENCE_MISSING');
    const outbound = candidate.outboundMessageId
      ? await this.prisma.whatsappOutboundMessage.findUnique({
        where: { id: candidate.outboundMessageId },
        select: { id: true, status: true, unknownResult: true, providerMessageId: true, secureCommandId: true },
      })
      : null;
    if (!outbound || (outbound.secureCommandId !== null && outbound.secureCommandId !== candidate.secureCommandId)) {
      return this.evidence('RESULT_UNKNOWN', 'NOTIFICATION_OUTBOUND_BINDING_MISMATCH');
    }
    if (outbound?.unknownResult || outbound?.status === 'UNKNOWN_RESULT') {
      return this.evidence('RESULT_UNKNOWN', 'WHATSAPP_UNKNOWN_RESULT');
    }
    if (outbound && ['SENT', 'DELIVERED', 'READ'].includes(outbound.status) && outbound.providerMessageId) {
      return this.evidence('OUTBOUND_SUCCEEDED', null);
    }
    if (outbound && ['FAILED', 'CANCELLED', 'REJECTED'].includes(outbound.status)) {
      return this.evidence('OUTBOUND_FAILED', 'WHATSAPP_OUTBOUND_FAILED');
    }
    if (command.failureClass === SofiaCommandFailureClass.UNKNOWN_RESULT) {
      return this.evidence('RESULT_UNKNOWN', command.failureCode ?? 'SOFIA_COMMAND_RESULT_UNKNOWN');
    }
    if (
      command.status === SofiaCommandStatus.FAILED
      || command.status === SofiaCommandStatus.REJECTED
      || command.status === SofiaCommandStatus.EXPIRED
    ) {
      return this.evidence('COMMAND_REJECTED', command.failureCode ?? 'SOFIA_COMMAND_REJECTED');
    }
    if (command.status === SofiaCommandStatus.SUCCEEDED) {
      return this.evidence('RESULT_UNKNOWN', 'NOTIFICATION_OUTBOUND_EVIDENCE_MISSING');
    }
    if (candidate.status === NotificationIntentStatus.DISPATCHED) {
      return this.evidence('OUTBOUND_PENDING', null);
    }
    return this.evidence('COMMAND_PENDING', null);
  }

  private evidence(
    observation: NotificationReconciliationObservation,
    errorCode: string | null,
  ): NotificationReconciliationEvidence {
    return Object.freeze({ observation, errorCode });
  }
}
