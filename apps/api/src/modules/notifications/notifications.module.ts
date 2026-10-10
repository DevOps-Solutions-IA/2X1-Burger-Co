import { Module } from '@nestjs/common';
import { SecureCommandModule } from '../secure-command/secure-command.module';
import { SofiaModule } from '../sofia/sofia.module';
import { NotificationOutboxService } from './notification-outbox.service';
import {
  NotificationCommandExecutionPort,
  NotificationDispatchPolicyPort,
  NotificationSecureCommandPort,
  SecureCommandExecutionAdapter,
  SecureCommandNotificationAdapter,
  WhatsappNotificationDispatchPolicyAdapter,
} from './notification-dispatch.ports';
import { NotificationCommandExecutionService } from './notification-command-execution.service';
import { NotificationIntentConsumerService } from './notification-intent-consumer.service';
import {
  NotificationOutboundMaterializer,
  PrismaNotificationOutboundMaterializer,
} from './notification-outbound-materializer';
import { NotificationOutboxWorker } from './notification-outbox.worker';
import {
  NotificationReconciliationObserver,
  PrismaNotificationReconciliationObserver,
} from './notification-reconciliation-observer';
import { NotificationIntentRepository } from './persistence/notification-intent.repository';
import { PrismaNotificationIntentRepository } from './persistence/prisma-notification-intent.repository';

@Module({
  imports: [SofiaModule, SecureCommandModule],
  providers: [
    NotificationOutboxService,
    NotificationIntentConsumerService,
    NotificationCommandExecutionService,
    NotificationOutboxWorker,
    WhatsappNotificationDispatchPolicyAdapter,
    SecureCommandNotificationAdapter,
    SecureCommandExecutionAdapter,
    { provide: NotificationDispatchPolicyPort, useExisting: WhatsappNotificationDispatchPolicyAdapter },
    { provide: NotificationSecureCommandPort, useExisting: SecureCommandNotificationAdapter },
    { provide: NotificationCommandExecutionPort, useExisting: SecureCommandExecutionAdapter },
    PrismaNotificationOutboundMaterializer,
    { provide: NotificationOutboundMaterializer, useExisting: PrismaNotificationOutboundMaterializer },
    PrismaNotificationReconciliationObserver,
    { provide: NotificationReconciliationObserver, useExisting: PrismaNotificationReconciliationObserver },
    PrismaNotificationIntentRepository,
    { provide: NotificationIntentRepository, useExisting: PrismaNotificationIntentRepository },
  ],
  exports: [NotificationOutboxService, NotificationIntentConsumerService, NotificationCommandExecutionService],
})
export class NotificationsModule {}
