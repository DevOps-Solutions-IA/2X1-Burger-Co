import { Module } from '@nestjs/common';
import { NotificationOutboxService } from './notification-outbox.service';
import {
  NotificationDispatchPolicyPort,
  NotificationSecureCommandPort,
  SecureCommandNotificationAdapter,
  WhatsappNotificationDispatchPolicyAdapter,
} from './notification-dispatch.ports';
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
  providers: [
    NotificationOutboxService,
    NotificationIntentConsumerService,
    NotificationOutboxWorker,
    WhatsappNotificationDispatchPolicyAdapter,
    SecureCommandNotificationAdapter,
    { provide: NotificationDispatchPolicyPort, useExisting: WhatsappNotificationDispatchPolicyAdapter },
    { provide: NotificationSecureCommandPort, useExisting: SecureCommandNotificationAdapter },
    PrismaNotificationOutboundMaterializer,
    { provide: NotificationOutboundMaterializer, useExisting: PrismaNotificationOutboundMaterializer },
    PrismaNotificationReconciliationObserver,
    { provide: NotificationReconciliationObserver, useExisting: PrismaNotificationReconciliationObserver },
    PrismaNotificationIntentRepository,
    { provide: NotificationIntentRepository, useExisting: PrismaNotificationIntentRepository },
  ],
  exports: [NotificationOutboxService, NotificationIntentConsumerService],
})
export class NotificationsModule {}
