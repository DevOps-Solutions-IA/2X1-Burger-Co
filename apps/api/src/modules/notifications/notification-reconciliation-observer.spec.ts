import { NotificationIntentStatus, SofiaCommandFailureClass, SofiaCommandStatus } from '@prisma/client';
import { PrismaNotificationReconciliationObserver } from './notification-reconciliation-observer';
import type { NotificationReconciliationCandidate } from './persistence/notification-intent.repository';

function harness(input: {
  command?: Record<string, unknown> | null;
  outbound?: Record<string, unknown> | null;
} = {}) {
  const prisma = {
    sofiaCommand: {
      findUnique: jest.fn().mockResolvedValue(input.command ?? {
        status: SofiaCommandStatus.APPROVAL_REQUIRED,
        failureClass: null,
        failureCode: null,
      }),
    },
    whatsappOutboundMessage: {
      findUnique: jest.fn().mockResolvedValue(input.outbound ?? {
        id: 'outbound-1',
        status: 'APPROVAL_PENDING',
        unknownResult: false,
        providerMessageId: null,
        secureCommandId: null,
      }),
    },
  };
  return { observer: new PrismaNotificationReconciliationObserver(prisma as never), prisma };
}

const candidate: NotificationReconciliationCandidate = {
  id: 'notification-1',
  status: NotificationIntentStatus.COMMAND_PENDING,
  version: 2,
  attempts: 1,
  secureCommandId: 'command-1',
  outboundMessageId: 'outbound-1',
};

describe('PrismaNotificationReconciliationObserver', () => {
  it('observes a command waiting for approval without executing or resending it', async () => {
    await expect(harness().observer.observe(candidate)).resolves.toEqual({
      observation: 'COMMAND_PENDING',
      errorCode: null,
    });
  });

  it('treats an unknown provider result as terminal reconciliation evidence', async () => {
    const { observer } = harness({
      command: { status: SofiaCommandStatus.FAILED, failureClass: SofiaCommandFailureClass.UNKNOWN_RESULT, failureCode: 'PROVIDER_TIMEOUT' },
      outbound: { id: 'outbound-1', status: 'UNKNOWN_RESULT', unknownResult: true, providerMessageId: null, secureCommandId: 'command-1' },
    });
    await expect(observer.observe(candidate)).resolves.toEqual({
      observation: 'RESULT_UNKNOWN',
      errorCode: 'WHATSAPP_UNKNOWN_RESULT',
    });
  });

  it('fails closed when outbound and command bindings disagree', async () => {
    const { observer } = harness({
      outbound: { id: 'outbound-1', status: 'SENT', unknownResult: false, providerMessageId: 'provider-1', secureCommandId: 'other-command' },
    });
    await expect(observer.observe(candidate)).resolves.toEqual({
      observation: 'RESULT_UNKNOWN',
      errorCode: 'NOTIFICATION_OUTBOUND_BINDING_MISMATCH',
    });
  });
});
