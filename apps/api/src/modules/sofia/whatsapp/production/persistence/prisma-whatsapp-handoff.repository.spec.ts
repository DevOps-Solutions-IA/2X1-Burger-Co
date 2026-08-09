import type { AuditService } from '../../../../audit/audit.service';
import type { PrismaService } from '../../../../../prisma/prisma.service';
import { PrismaWhatsappProductionRepository } from './prisma-whatsapp-production.repository';

const transition = {
  conversationId: 'conversation-1',
  actorId: 'operator-1',
  expectedVersion: 4,
  previousState: 'HUMAN_REQUIRED',
  nextState: 'HUMAN_TAKEN',
  reasonCode: 'OPERATOR_TAKEOVER',
  status: 'HUMAN_TAKEN' as const,
  sofiaEnabled: false,
  assignedToUserId: 'operator-1',
};

describe('PrismaWhatsappProductionRepository handoff transitions', () => {
  const setup = (current: Record<string, unknown>, latestEvent: Record<string, unknown> | null = null) => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: transition.conversationId }]),
      whatsappConversation: {
        findUnique: jest.fn().mockResolvedValue(current),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      whatsappHandoffEvent: {
        findUnique: jest.fn().mockResolvedValue(latestEvent),
        create: jest.fn().mockResolvedValue({ id: 'event-1' }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    return {
      repository: new PrismaWhatsappProductionRepository(
        prisma as unknown as PrismaService,
        audit as unknown as AuditService,
      ),
      tx,
      audit,
    };
  };

  it('returns an immediate identical replay without mutating version or evidence', async () => {
    const { repository, tx, audit } = setup({
      status: 'HUMAN_TAKEN', humanStatus: 'HUMAN_TAKEN', sofiaEnabled: false,
      assignedToUserId: 'operator-1', handoffVersion: 5,
    }, {
      actorId: 'operator-1', nextState: 'HUMAN_TAKEN', reasonCode: 'OPERATOR_TAKEOVER',
    });

    await expect(repository.transitionHandoff(transition)).resolves.toEqual({
      state: 'HUMAN_TAKEN', version: 5, assignedActorId: 'operator-1', replayed: true,
    });
    expect(tx.whatsappConversation.updateMany).not.toHaveBeenCalled();
    expect(tx.whatsappHandoffEvent.create).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('fails closed when a stale transition disagrees with the persisted event', async () => {
    const { repository, tx } = setup({
      status: 'HUMAN_TAKEN', humanStatus: 'HUMAN_TAKEN', sofiaEnabled: false,
      assignedToUserId: 'operator-2', handoffVersion: 5,
    }, {
      actorId: 'operator-2', nextState: 'HUMAN_TAKEN', reasonCode: 'OTHER_TAKEOVER',
    });

    await expect(repository.transitionHandoff(transition)).rejects.toThrow('WHATSAPP_HANDOFF_VERSION_CONFLICT');
    expect(tx.whatsappConversation.updateMany).not.toHaveBeenCalled();
    expect(tx.whatsappHandoffEvent.create).not.toHaveBeenCalled();
  });

  it('conditionally updates the expected version and appends one event', async () => {
    const { repository, tx, audit } = setup({
      status: 'HUMAN_REQUIRED', humanStatus: 'HUMAN_REQUIRED', sofiaEnabled: false,
      assignedToUserId: null, handoffVersion: 4,
    });

    await expect(repository.transitionHandoff(transition)).resolves.toEqual({
      state: 'HUMAN_TAKEN', version: 5, assignedActorId: 'operator-1', replayed: false,
    });
    expect(tx.whatsappConversation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'conversation-1', handoffVersion: 4, humanStatus: 'HUMAN_REQUIRED',
      },
    }));
    expect(tx.whatsappHandoffEvent.create).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledTimes(1);
  });
});
