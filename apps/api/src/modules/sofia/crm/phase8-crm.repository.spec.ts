import {
  CrmLeadStatus,
  CrmPipelineStageOutcome,
  CrmTaskPriority,
  CrmTaskStatus,
  CrmTaskType,
} from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { CrmPersistenceError, Phase8CrmRepository } from './phase8-crm.repository';

describe('Phase8CrmRepository', () => {
  const leadFindUnique = jest.fn();
  const leadFindUniqueOrThrow = jest.fn();
  const leadUpdateMany = jest.fn();
  const stageFindUnique = jest.fn();
  const historyFindUnique = jest.fn();
  const historyCreate = jest.fn();
  const noteFindUnique = jest.fn();
  const noteCreate = jest.fn();
  const customerFindUnique = jest.fn();
  const tx = {
    crmLead: {
      findUnique: leadFindUnique,
      findUniqueOrThrow: leadFindUniqueOrThrow,
      updateMany: leadUpdateMany,
    },
    crmPipelineStage: { findUnique: stageFindUnique },
    crmLeadStageHistory: { findUnique: historyFindUnique, create: historyCreate },
    crmNote: { create: noteCreate },
    customer: { findUnique: customerFindUnique },
    customerServiceCase: { findUnique: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn((operation: unknown) => (
      typeof operation === 'function' ? operation(tx) : Promise.all(operation as Promise<unknown>[])
    )),
    crmLead: { findUnique: leadFindUnique },
    crmLeadStageHistory: { findUnique: historyFindUnique },
    crmNote: { findUnique: noteFindUnique, create: noteCreate },
  } as unknown as PrismaService;
  const repository = new Phase8CrmRepository(prisma);

  const transition = {
    expectedVersion: 2,
    toStageId: 'stage-target',
    toStatus: CrmLeadStatus.ACTIVE,
    idempotencyKey: 'lead-transition-001',
    reasonCode: 'CUSTOMER_ENGAGED',
    metadata: { phone: '3237963047', source: 'operator' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    historyFindUnique.mockResolvedValue(null);
    leadFindUnique.mockResolvedValue({
      id: 'lead-1',
      pipelineId: 'pipeline-1',
      currentStageId: 'stage-current',
      status: CrmLeadStatus.QUALIFIED,
      version: 2,
    });
    stageFindUnique.mockResolvedValue({
      id: 'stage-target',
      pipelineId: 'pipeline-1',
      outcome: CrmPipelineStageOutcome.OPEN,
    });
    leadUpdateMany.mockResolvedValue({ count: 1 });
    historyCreate.mockResolvedValue({ id: 'history-1' });
    customerFindUnique.mockResolvedValue({ id: 'customer-001' });
    leadFindUniqueOrThrow.mockResolvedValue({
      id: 'lead-1', currentStageId: 'stage-target', status: CrmLeadStatus.ACTIVE, version: 3,
    });
  });

  it('updates the lead once and appends the matching immutable version event', async () => {
    const result = await repository.transitionLead('lead-1', transition, 'actor-1');

    expect(result).toMatchObject({ state: 'UPDATED', lead: { version: 3 } });
    expect(leadUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'lead-1', version: 2 },
      data: expect.objectContaining({ version: { increment: 1 } }),
    }));
    expect(historyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leadId: 'lead-1', version: 3, idempotencyKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        fromStageId: 'stage-current', toStageId: 'stage-target',
      }),
    });
    expect(JSON.stringify(historyCreate.mock.calls[0])).not.toContain('3237963047');
  });

  it('rejects a stale version before any lead or history mutation', async () => {
    leadFindUnique.mockResolvedValueOnce({
      id: 'lead-1', pipelineId: 'pipeline-1', currentStageId: 'stage-current',
      status: CrmLeadStatus.QUALIFIED, version: 3,
    });

    await expect(repository.transitionLead('lead-1', transition, 'actor-1'))
      .rejects.toEqual(expect.objectContaining({ code: 'STALE_CRM_VERSION' }));
    expect(leadUpdateMany).not.toHaveBeenCalled();
    expect(historyCreate).not.toHaveBeenCalled();
  });

  it('returns a deterministic replay without applying another transition', async () => {
    historyFindUnique.mockResolvedValue({
      leadId: 'lead-1',
      toStageId: transition.toStageId,
      toStatus: transition.toStatus,
      actorId: 'actor-1',
      reasonCode: transition.reasonCode,
      sanitizedMetadata: { phone: '[REDACTED]', source: 'operator' },
    });
    leadFindUnique.mockResolvedValue({ id: 'lead-1', version: 3, status: CrmLeadStatus.ACTIVE });

    const result = await repository.transitionLead('lead-1', transition, 'actor-1');

    expect(result.state).toBe('DETERMINISTIC_REPLAY');
    expect(leadUpdateMany).not.toHaveBeenCalled();
    expect(historyCreate).not.toHaveBeenCalled();
  });

  it('sanitizes a note and stores only its deterministic content hash', async () => {
    noteFindUnique.mockResolvedValue(null);
    noteCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'note-1', ...data }));

    const result = await repository.createNote({
      customerId: 'customer-001',
      source: 'AUTHORIZED_OPERATOR',
      sourceReference: 'note-event-1',
      body: 'Llamar al 3237963047 y escribir a client@example.com',
    }, 'actor-1');

    expect(result.state).toBe('CREATED');
    const persisted = noteCreate.mock.calls[0][0].data;
    expect(persisted.body).toContain('*** *** 3047');
    expect(persisted.body).toContain('***@example.com');
    expect(persisted.body).not.toContain('3237963047');
    expect(persisted.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(persisted.sourceReference).toMatch(/^[a-f0-9]{64}$/);
    expect(persisted.sourceReference).not.toContain('note-event-1');
  });

  it('rejects a replay whose source identity points to different task facts', async () => {
    const taskFindUnique = jest.fn().mockResolvedValue({
      customerId: 'customer-001', leadId: null, customerServiceCaseId: null,
      type: CrmTaskType.TASK, priority: CrmTaskPriority.MEDIUM, title: 'Original',
      sanitizedDescription: null, assignedToId: null, dueAt: null,
    });
    const taskRepository = new Phase8CrmRepository({
      crmTask: { findUnique: taskFindUnique },
    } as unknown as PrismaService);

    await expect(taskRepository.createTask({
      customerId: 'customer-001', source: 'AUTHORIZED_OPERATOR', sourceReference: 'task-1',
      type: CrmTaskType.TASK, priority: CrmTaskPriority.MEDIUM, title: 'Different',
    })).rejects.toEqual(expect.objectContaining<Partial<CrmPersistenceError>>({ code: 'CRM_IDEMPOTENCY_CONFLICT' }));
  });

  it('recovers a lost task-update response only from the exact next semantic state', async () => {
    const current = {
      id: 'task-1', version: 6, status: CrmTaskStatus.COMPLETED, assignedToId: 'actor-1',
    };
    const taskUpdateMany = jest.fn();
    const taskRepository = new Phase8CrmRepository({
      crmTask: { findUnique: jest.fn().mockResolvedValue(current), updateMany: taskUpdateMany },
    } as unknown as PrismaService);

    await expect(taskRepository.updateTask('task-1', {
      expectedVersion: 5,
      status: CrmTaskStatus.COMPLETED,
      assignedToId: 'actor-1',
    })).resolves.toEqual({ state: 'DETERMINISTIC_REPLAY', task: current });
    expect(taskUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects stale task updates with a materially different state or assignee', async () => {
    const taskUpdateMany = jest.fn();
    const taskRepository = new Phase8CrmRepository({
      crmTask: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'task-1', version: 6, status: CrmTaskStatus.IN_PROGRESS, assignedToId: 'actor-2',
        }),
        updateMany: taskUpdateMany,
      },
    } as unknown as PrismaService);

    await expect(taskRepository.updateTask('task-1', {
      expectedVersion: 5,
      status: CrmTaskStatus.IN_PROGRESS,
      assignedToId: 'actor-1',
    })).rejects.toEqual(expect.objectContaining<Partial<CrmPersistenceError>>({ code: 'STALE_CRM_VERSION' }));
    expect(taskUpdateMany).not.toHaveBeenCalled();
  });

  it('turns a concurrent identical task update into deterministic replay', async () => {
    const before = { id: 'task-1', version: 5, status: CrmTaskStatus.OPEN, assignedToId: null };
    const after = { id: 'task-1', version: 6, status: CrmTaskStatus.IN_PROGRESS, assignedToId: 'actor-1' };
    const taskFindUnique = jest.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    const taskRepository = new Phase8CrmRepository({
      crmTask: { findUnique: taskFindUnique, updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    } as unknown as PrismaService);

    await expect(taskRepository.updateTask('task-1', {
      expectedVersion: 5,
      status: CrmTaskStatus.IN_PROGRESS,
      assignedToId: 'actor-1',
    })).resolves.toEqual({ state: 'DETERMINISTIC_REPLAY', task: after });
  });
});
