import { Module } from '@nestjs/common';
import { NotificationOutboxService } from './notification-outbox.service';
import {
  NotificationDispatchPolicyPort,
  NotificationSecureCommandPort,
  SecureCommandNotificationAdapter,
  WhatsappNotificationDispatchPolicyAdapter,
} from './notification-dispatch.ports';
import { NotificationIntentConsumerService } from './notification-intent-consumer.service';
import { NotificationIntentRepository } from './persistence/notification-intent.repository';
import { PrismaNotificationIntentRepository } from './persistence/prisma-notification-intent.repository';

@Module({
  providers: [
    NotificationOutboxService,
    NotificationIntentConsumerService,
    WhatsappNotificationDispatchPolicyAdapter,
    SecureCommandNotificationAdapter,
    { provide: NotificationDispatchPolicyPort, useExisting: WhatsappNotificationDispatchPolicyAdapter },
    { provide: NotificationSecureCommandPort, useExisting: SecureCommandNotificationAdapter },
    PrismaNotificationIntentRepository,
    { provide: NotificationIntentRepository, useExisting: PrismaNotificationIntentRepository },
  ],
  exports: [NotificationOutboxService, NotificationIntentConsumerService],
})
export class NotificationsModule {}
