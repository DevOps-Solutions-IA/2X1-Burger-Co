import { Injectable } from '@nestjs/common';
import type { OperationalBacklogSnapshot } from './operational-backlog.service';

export type HealthAlert = Readonly<{
  code: string;
  severity: 'MEDIUM' | 'HIGH' | 'CRITICAL';
  active: true;
  condition: string;
  notificationChannel: 'OWNER_GATE_NOT_CONFIGURED';
  runbook: string;
}>;

@Injectable()
export class OperationalAlertPolicy {
  evaluate(snapshot: OperationalBacklogSnapshot): HealthAlert[] {
    if (!snapshot.available) {
      return [this.alert('OPERATIONAL_METRICS_UNAVAILABLE', 'HIGH', 'operational.available == false')];
    }

    return [
      this.when('NOTIFICATION_LEASE_EXPIRED', 'HIGH', snapshot.notifications.expiredLeases > 0, 'notifications.expiredLeases > 0'),
      this.when('NOTIFICATION_FAILED', 'HIGH', snapshot.notifications.failed > 0, 'notifications.failed > 0'),
      this.when('NOTIFICATION_UNKNOWN_RESULT', 'HIGH', snapshot.notifications.unknownResult > 0, 'notifications.unknownResult > 0'),
      this.when('NOTIFICATION_BACKLOG_STALE', 'HIGH', snapshot.notifications.oldestActiveAgeSeconds >= 300, 'notifications.oldestActiveAgeSeconds >= 300'),
      this.when('PAYMENT_WEBHOOK_LEASE_EXPIRED', 'CRITICAL', snapshot.paymentWebhooks.expiredLeases > 0, 'paymentWebhooks.expiredLeases > 0'),
      this.when('PAYMENT_WEBHOOK_RETRY_READY', 'HIGH', snapshot.paymentWebhooks.retryReady > 0, 'paymentWebhooks.retryReady > 0'),
      this.when('PAYMENT_WEBHOOK_FINANCIAL_REVIEW', 'CRITICAL', snapshot.paymentWebhooks.financialReviewRequired > 0, 'paymentWebhooks.financialReviewRequired > 0'),
      this.when('PAYMENT_WEBHOOK_INVALID_BURST', 'HIGH', snapshot.paymentWebhooks.invalidRecent >= 5, 'paymentWebhooks.invalidRecent >= 5 in 15m'),
      this.when('PAYMENT_WEBHOOK_BACKLOG_STALE', 'CRITICAL', snapshot.paymentWebhooks.oldestActiveAgeSeconds >= 60, 'paymentWebhooks.oldestActiveAgeSeconds >= 60'),
      this.when('WHATSAPP_INBOUND_LEASE_EXPIRED', 'HIGH', snapshot.whatsappInbound.expiredLeases > 0, 'whatsappInbound.expiredLeases > 0'),
      this.when('WHATSAPP_INBOUND_ATTEMPTS_EXHAUSTED', 'HIGH', snapshot.whatsappInbound.attemptsExhausted > 0, 'whatsappInbound.attemptsExhausted > 0'),
      this.when('WHATSAPP_INBOUND_RESULT_MISSING', 'HIGH', snapshot.whatsappInbound.missingDeterministicResult > 0, 'whatsappInbound.missingDeterministicResult > 0'),
      this.when('WHATSAPP_INBOUND_BACKLOG_STALE', 'HIGH', snapshot.whatsappInbound.oldestActiveAgeSeconds >= 60, 'whatsappInbound.oldestActiveAgeSeconds >= 60'),
      this.when('SECURE_COMMAND_LEASE_EXPIRED', 'HIGH', snapshot.secureCommands.expiredLeases > 0, 'secureCommands.expiredLeases > 0'),
      this.when('SECURE_COMMAND_FAILED', 'HIGH', snapshot.secureCommands.failed > 0, 'secureCommands.failed > 0'),
      this.when('SECURE_COMMAND_UNKNOWN_RESULT', 'CRITICAL', snapshot.secureCommands.unknownResult > 0, 'secureCommands.unknownResult > 0'),
      this.when('SECURE_COMMAND_BACKLOG_STALE', 'HIGH', snapshot.secureCommands.oldestActiveAgeSeconds >= 120, 'secureCommands.oldestActiveAgeSeconds >= 120'),
      this.when('PAYMENT_UNKNOWN_RESULT', 'CRITICAL', snapshot.commerce.paymentUnknownResult > 0, 'commerce.paymentUnknownResult > 0'),
      this.when(
        'FINANCIAL_REVIEW_REQUIRED',
        'CRITICAL',
        snapshot.commerce.paymentFinancialReviewRequired > 0 || snapshot.commerce.checkoutFinancialReviewRequired > 0,
        'commerce.paymentFinancialReviewRequired + checkoutFinancialReviewRequired > 0',
      ),
    ].filter((alert): alert is HealthAlert => alert !== null);
  }

  private when(
    code: string,
    severity: HealthAlert['severity'],
    active: boolean,
    condition: string,
  ): HealthAlert | null {
    return active ? this.alert(code, severity, condition) : null;
  }

  private alert(code: string, severity: HealthAlert['severity'], condition: string): HealthAlert {
    return {
      code,
      severity,
      active: true,
      condition,
      notificationChannel: 'OWNER_GATE_NOT_CONFIGURED',
      runbook: '/docs/runbooks/operational-backlog.md',
    };
  }
}
