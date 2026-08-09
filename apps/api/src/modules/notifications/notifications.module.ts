import { Module } from '@nestjs/common';
import { NotificationOutboxService } from './notification-outbox.service';
import { NotificationIntentRepository } from './persistence/notification-intent.repository';
import { PrismaNotificationIntentRepository } from './persistence/prisma-notification-intent.repository';

@Module({
  providers: [
    NotificationOutboxService,
    PrismaNotificationIntentRepository,
    { provide: NotificationIntentRepository, useExisting: PrismaNotificationIntentRepository },
  ],
  exports: [NotificationOutboxService],
})
export class NotificationsModule {}
