import {
  CrmLeadSource,
  CrmLeadStatus,
  CrmPipelineStageOutcome,
  CrmTaskPriority,
  CrmTaskStatus,
  CrmTaskType,
} from '@prisma/client';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { AuditService } from '../../audit/audit.service';
import { opaqueCrmReference } from './crm-privacy';
import { CrmPersistenceError, Phase8CrmRepository } from './phase8-crm.repository';

describe('Phase8CrmRepository', () => {
  function fencedClient<T extends object>(client: T): T & {
    $executeRaw: jest.Mock;
    setting: { findUnique: jest.Mock; upsert: jest.Mock };
  } {
    return Object.assign(client, {
      $executeRaw: jest.fn().mockResolvedValue(1),
      setting: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'crm-generation-fence' }),
      },
    });
  }
  const config = {
    get: jest.fn((key: string) => key === 'CRM_IDENTITY_HASH_SECRET'
      ? 'crm-test-only-identity-hash-secret'
      : undefined),
  } as unknown as ConfigService;
  const auditLog = jest.fn().mockResolvedValue({ id: 'audit-1' });
  const audit = { log: auditLog } as unknown as AuditService;
  const leadFindUnique = jest.fn();
  const leadFindUniqueOrThrow = jest.fn();
  const leadUpdateMany = jest.fn();
  const stageFindUnique = jest.fn();
  const historyFindUnique = jest.fn();
  const historyCreate = jest.fn();
  const noteFindUnique = jest.fn();
  const noteCreate = jest.fn();
  const customerFindUnique = jest.fn();
  const tx = fencedClient({
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
  });
  const prisma = {
    $transaction: jest.fn((operation: unknown) => (
      typeof operation === 'function' ? operation(tx) : Promise.all(operation as Promise<unknown>[])
    )),
    crmLead: { findUnique: leadFindUnique },
    crmLeadStageHistory: { findUnique: historyFindUnique },
    crmNote: { findUnique: noteFindUnique, create: noteCreate },
  } as unknown as PrismaService;
  const repository = new Phase8CrmRepository(prisma, config, audit);

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

  it.each([undefined, 'short-secret'])('fails closed outside tests when the HMAC secret is %s', async (secret) => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const unavailableRepository = new Phase8CrmRepository(prisma, {
      get: jest.fn().mockReturnValue(secret),
    } as unknown as ConfigService, audit);

    try {
      await expect(unavailableRepository.createTask({
        customerId: 'customer-001',
        source: 'AUTHORIZED_OPERATOR',
        sourceReference: 'task-1',
        type: CrmTaskType.TASK,
        priority: CrmTaskPriority.MEDIUM,
        title: 'Follow up',
      }, 'actor-1')).rejects.toThrow('CRM identity hashing is not configured.');
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('rejects a conflicting retained-key lead replay before promotion or audit', async () => {
    const currentSecret = 'crm-current-identity-hash-secret-0000001';
    const retainedSecret = 'crm-retained-identity-hash-secret-000001';
    const sourceReference = opaqueCrmReference(
      retainedSecret,
      `lead:${CrmLeadSource.AUTHORIZED_OPERATOR}`,
      'lead-before-rotation',
    );
    const leadUpdateMany = jest.fn();
    const replayClient = fencedClient({
      crmLead: {
        findUnique: jest.fn(({ where }) => Promise.resolve(
          where.source_sourceReference.sourceReference === sourceReference
            ? {
                id: 'lead-before-rotation', customerId: 'customer-001', pipelineId: 'pipeline-001',
                currentStageId: 'stage-001', sourceReference, title: 'Original title', ownerId: null,
              }
            : null,
        )),
        updateMany: leadUpdateMany,
      },
    });
    const transaction = jest.fn((operation) => operation(replayClient));
    const replayRepository = new Phase8CrmRepository({
      $transaction: transaction,
      crmLead: replayClient.crmLead,
    } as unknown as PrismaService, {
      get: jest.fn((key: string) => ({
        CRM_IDENTITY_HASH_SECRET: currentSecret,
        CRM_IDENTITY_HASH_SECRET_PREVIOUS_KEYS: retainedSecret,
      })[key]),
    } as unknown as ConfigService, audit);

    await expect(replayRepository.createLead({
      customerId: 'customer-001', pipelineId: 'pipeline-001', currentStageId: 'stage-001',
      source: CrmLeadSource.AUTHORIZED_OPERATOR, sourceReference: 'lead-before-rotation',
      title: 'Conflicting title',
    }, 'actor-1')).rejects.toEqual(expect.objectContaining<Partial<CrmPersistenceError>>({
      code: 'CRM_IDEMPOTENCY_CONFLICT',
    }));
    expect(leadUpdateMany).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(auditLog).not.toHaveBeenCalled();
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
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CRM_LEAD_TRANSITIONED',
      entityId: 'lead-1',
    }), tx);
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
      sanitizedMetadata: { redacted_field_1: '[REDACTED]', source: 'operator' },
    });
    leadFindUnique.mockResolvedValue({ id: 'lead-1', version: 3, status: CrmLeadStatus.ACTIVE });

    const result = await repository.transitionLead('lead-1', transition, 'actor-1');

    expect(result.state).toBe('DETERMINISTIC_REPLAY');
    expect(leadUpdateMany).not.toHaveBeenCalled();
    expect(historyCreate).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('treats reordered sanitized metadata as the same immutable transition evidence', async () => {
    historyFindUnique.mockResolvedValue({
      leadId: 'lead-1',
      toStageId: transition.toStageId,
      toStatus: transition.toStatus,
      actorId: 'actor-1',
      reasonCode: transition.reasonCode,
      sanitizedMetadata: { source: 'operator', redacted_field_1: '[REDACTED]' },
    });
    leadFindUnique.mockResolvedValue({ id: 'lead-1', version: 3, status: CrmLeadStatus.ACTIVE });

    await expect(repository.transitionLead('lead-1', {
      ...transition,
      metadata: { source: 'operator', phone: '3237963047' },
    }, 'actor-1')).resolves.toMatchObject({ state: 'DETERMINISTIC_REPLAY' });
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
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CRM_NOTE_CREATED',
      entityId: 'note-1',
    }), tx);
  });

  it('recognizes a note replay under any retained secret without rewriting append-only evidence', async () => {
    const previousSecret = 'crm-previous-identity-hash-secret-000001';
    const retainedSecret = 'crm-retained-identity-hash-secret-000001';
    const previousReference = opaqueCrmReference(retainedSecret, 'note:AUTHORIZED_OPERATOR', 'note-before-rotation');
    const noteUpdate = jest.fn();
    const existing = {
      id: 'note-before-rotation', customerId: 'customer-001', leadId: null, customerServiceCaseId: null,
      sourceReference: previousReference, body: 'Seguimiento',
      contentHash: '6b2421cb1936f25d645287a17496f6750e1a8202172f11463f7567c4f139d99e',
    };
    const noteLookup = jest.fn(({ where }) => Promise.resolve(
      where.source_sourceReference.sourceReference === previousReference ? existing : null,
    ));
    const rotatingRepository = new Phase8CrmRepository({
      crmNote: { findUnique: noteLookup, update: noteUpdate },
    } as unknown as PrismaService, {
      get: jest.fn((key: string) => ({
        CRM_IDENTITY_HASH_SECRET: 'crm-current-identity-hash-secret-0000001',
        CRM_IDENTITY_HASH_SECRET_PREVIOUS_KEYS: `${previousSecret},${retainedSecret}`,
      })[key]),
    } as unknown as ConfigService, audit);

    await expect(rotatingRepository.createNote({
      customerId: 'customer-001', source: 'AUTHORIZED_OPERATOR',
      sourceReference: 'note-before-rotation', body: 'Seguimiento',
    }, 'actor-1')).resolves.toMatchObject({ state: 'DETERMINISTIC_REPLAY', note: existing });
    expect(noteLookup).toHaveBeenCalledTimes(3);
    expect(noteUpdate).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('rejects a conflicting retained-key note replay without append or audit', async () => {
    const retainedSecret = 'crm-retained-identity-hash-secret-000001';
    const previousReference = opaqueCrmReference(
      retainedSecret,
      'note:AUTHORIZED_OPERATOR',
      'note-conflict-before-rotation',
    );
    const noteUpdate = jest.fn();
    const transaction = jest.fn();
    const noteRepository = new Phase8CrmRepository({
      $transaction: transaction,
      crmNote: {
        findUnique: jest.fn(({ where }) => Promise.resolve(
          where.source_sourceReference.sourceReference === previousReference
            ? {
                id: 'note-conflict-before-rotation', customerId: 'customer-001', leadId: null,
                customerServiceCaseId: null, sourceReference: previousReference,
                body: 'Original', contentHash: 'not-the-replayed-content-hash',
              }
            : null,
        )),
        update: noteUpdate,
      },
    } as unknown as PrismaService, {
      get: jest.fn((key: string) => ({
        CRM_IDENTITY_HASH_SECRET: 'crm-current-identity-hash-secret-0000001',
        CRM_IDENTITY_HASH_SECRET_PREVIOUS_KEYS: retainedSecret,
      })[key]),
    } as unknown as ConfigService, audit);

    await expect(noteRepository.createNote({
      customerId: 'customer-001', source: 'AUTHORIZED_OPERATOR',
      sourceReference: 'note-conflict-before-rotation', body: 'Conflicting',
    }, 'actor-1')).rejects.toEqual(expect.objectContaining<Partial<CrmPersistenceError>>({
      code: 'CRM_IDEMPOTENCY_CONFLICT',
    }));
    expect(noteUpdate).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('rejects a replay whose source identity points to different task facts', async () => {
    const taskFindUnique = jest.fn().mockResolvedValue({
      id: 'task-1', customerId: 'customer-001', leadId: null, customerServiceCaseId: null,
      type: CrmTaskType.TASK, priority: CrmTaskPriority.MEDIUM, title: 'Original',
      sanitizedDescription: null, assignedToId: null, dueAt: null,
    });
    const taskRepository = new Phase8CrmRepository({
      $transaction: jest.fn((operation) => operation(fencedClient({ crmTask: { findUnique: taskFindUnique } }))),
      crmTask: { findUnique: taskFindUnique },
    } as unknown as PrismaService, config, audit);

    await expect(taskRepository.createTask({
      customerId: 'customer-001', source: 'AUTHORIZED_OPERATOR', sourceReference: 'task-1',
      type: CrmTaskType.TASK, priority: CrmTaskPriority.MEDIUM, title: 'Different',
    }, 'actor-1')).rejects.toEqual(expect.objectContaining<Partial<CrmPersistenceError>>({ code: 'CRM_IDEMPOTENCY_CONFLICT' }));
  });

  it('recognizes and promotes a task replay hashed with the oldest retained CRM secret', async () => {
    const previousSecret = 'crm-previous-identity-hash-secret-000001';
    const retainedSecret = 'crm-retained-identity-hash-secret-000001';
    const previousReference = opaqueCrmReference(
      retainedSecret,
      'task:AUTHORIZED_OPERATOR',
      'task-before-rotation',
    );
    const currentReference = opaqueCrmReference(
      'crm-current-identity-hash-secret-0000001',
      'task:AUTHORIZED_OPERATOR',
      'task-before-rotation',
    );
    let stored = {
      id: 'task-before-rotation', customerId: 'customer-001', leadId: null, customerServiceCaseId: null,
      type: CrmTaskType.TASK, priority: CrmTaskPriority.MEDIUM, title: 'Follow up',
      sanitizedDescription: null, assignedToId: null, dueAt: null, sourceReference: previousReference,
    };
    const taskFindUnique = jest.fn(({ where }) => Promise.resolve(
      where.id === stored.id
        || where.source_sourceReference?.sourceReference === stored.sourceReference
        ? stored
        : null,
    ));
    const taskUpdateMany = jest.fn(({ where, data }) => {
      if (where.id !== stored.id || where.sourceReference !== stored.sourceReference) {
        return Promise.resolve({ count: 0 });
      }
      stored = { ...stored, ...data };
      return Promise.resolve({ count: 1 });
    });
    const replayClient = fencedClient({
      crmTask: {
        findUnique: taskFindUnique,
        findUniqueOrThrow: jest.fn(() => Promise.resolve(stored)),
        updateMany: taskUpdateMany,
      },
    });
    const rotatingRepository = new Phase8CrmRepository({
      $transaction: jest.fn((operation) => operation(replayClient)),
      crmTask: replayClient.crmTask,
    } as unknown as PrismaService, {
      get: jest.fn((key: string) => ({
        CRM_IDENTITY_HASH_SECRET: 'crm-current-identity-hash-secret-0000001',
        CRM_IDENTITY_HASH_SECRET_PREVIOUS_KEYS: `${previousSecret},${retainedSecret}`,
      })[key]),
    } as unknown as ConfigService, audit);

    await expect(rotatingRepository.createTask({
      customerId: 'customer-001', source: 'AUTHORIZED_OPERATOR', sourceReference: 'task-before-rotation',
      type: CrmTaskType.TASK, priority: CrmTaskPriority.MEDIUM, title: 'Follow up',
    }, 'actor-1')).resolves.toMatchObject({ state: 'DETERMINISTIC_REPLAY' });
    expect(taskFindUnique).toHaveBeenCalledTimes(3);
    expect(taskUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'task-before-rotation', sourceReference: previousReference },
      data: { sourceReference: currentReference },
    }));
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CRM_REFERENCE_HASH_ROTATED',
      entity: 'CrmTask',
    }), expect.anything());
  });

  it('lets a compare-and-set loser reread the promoted task without a second audit', async () => {
    const currentSecret = 'crm-current-identity-hash-secret-0000001';
    const retainedSecret = 'crm-retained-identity-hash-secret-000001';
    const previousReference = opaqueCrmReference(
      retainedSecret,
      'task:AUTHORIZED_OPERATOR',
      'task-concurrent-rotation',
    );
    const currentReference = opaqueCrmReference(
      currentSecret,
      'task:AUTHORIZED_OPERATOR',
      'task-concurrent-rotation',
    );
    const previous = {
      id: 'task-concurrent-rotation', customerId: 'customer-001', leadId: null,
      customerServiceCaseId: null, type: CrmTaskType.TASK, priority: CrmTaskPriority.MEDIUM,
      title: 'Follow up', sanitizedDescription: null, assignedToId: null, dueAt: null,
      sourceReference: previousReference,
    };
    const winner = { ...previous, sourceReference: currentReference };
    const taskFindUnique = jest.fn(({ where }) => Promise.resolve(
      where.id === winner.id
        ? winner
        : where.source_sourceReference?.sourceReference === previousReference
          ? previous
          : null,
    ));
    const taskUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    const replayClient = fencedClient({
      crmTask: { findUnique: taskFindUnique, updateMany: taskUpdateMany },
    });
    const replayRepository = new Phase8CrmRepository({
      $transaction: jest.fn((operation) => operation(replayClient)),
      crmTask: replayClient.crmTask,
    } as unknown as PrismaService, {
      get: jest.fn((key: string) => ({
        CRM_IDENTITY_HASH_SECRET: currentSecret,
        CRM_IDENTITY_HASH_SECRET_PREVIOUS_KEYS: retainedSecret,
      })[key]),
    } as unknown as ConfigService, audit);

    await expect(replayRepository.createTask({
      customerId: 'customer-001', source: 'AUTHORIZED_OPERATOR',
      sourceReference: 'task-concurrent-rotation', type: CrmTaskType.TASK,
      priority: CrmTaskPriority.MEDIUM, title: 'Follow up',
    }, 'actor-1')).resolves.toMatchObject({
      state: 'DETERMINISTIC_REPLAY',
      task: { sourceReference: currentReference },
    });
    expect(taskUpdateMany).toHaveBeenCalledTimes(1);
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('rejects a conflicting retained-key task replay with zero mutation or audit', async () => {
    const retainedSecret = 'crm-retained-identity-hash-secret-000001';
    const previousReference = opaqueCrmReference(
      retainedSecret,
      'task:AUTHORIZED_OPERATOR',
      'task-conflict-before-rotation',
    );
    const taskUpdate = jest.fn();
    const replayClient = fencedClient({
      crmTask: {
        findUnique: jest.fn(({ where }) => Promise.resolve(
          where.source_sourceReference.sourceReference === previousReference
            ? {
                id: 'task-conflict-before-rotation', customerId: 'customer-001', leadId: null,
                customerServiceCaseId: null, type: CrmTaskType.TASK, priority: CrmTaskPriority.MEDIUM,
                title: 'Original', sanitizedDescription: null, assignedToId: null, dueAt: null,
              }
            : null,
        )),
        update: taskUpdate,
      },
    });
    const transaction = jest.fn((operation) => operation(replayClient));
    const taskRepository = new Phase8CrmRepository({
      $transaction: transaction,
      crmTask: replayClient.crmTask,
    } as unknown as PrismaService, {
      get: jest.fn((key: string) => ({
        CRM_IDENTITY_HASH_SECRET: 'crm-current-identity-hash-secret-0000001',
        CRM_IDENTITY_HASH_SECRET_PREVIOUS_KEYS: retainedSecret,
      })[key]),
    } as unknown as ConfigService, audit);

    await expect(taskRepository.createTask({
      customerId: 'customer-001', source: 'AUTHORIZED_OPERATOR',
      sourceReference: 'task-conflict-before-rotation', type: CrmTaskType.TASK,
      priority: CrmTaskPriority.MEDIUM, title: 'Conflicting',
    }, 'actor-1')).rejects.toEqual(expect.objectContaining<Partial<CrmPersistenceError>>({
      code: 'CRM_IDEMPOTENCY_CONFLICT',
    }));
    expect(taskUpdate).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('recovers a lost task-update response only from the exact next semantic state', async () => {
    const current = {
      id: 'task-1', version: 6, status: CrmTaskStatus.COMPLETED, assignedToId: 'actor-1',
    };
    const taskUpdateMany = jest.fn();
    const updateAudit = {
      actorId: 'actor-1',
      after: { version: 6, status: CrmTaskStatus.COMPLETED, assignedToId: 'actor-1' },
      metadata: {
        requestIdentity: {
          expectedVersion: 5, status: CrmTaskStatus.COMPLETED,
          assignedToSpecified: true, assignedToId: 'actor-1',
        },
      },
    };
    const taskRepository = new Phase8CrmRepository({
      crmTask: { findUnique: jest.fn().mockResolvedValue(current), updateMany: taskUpdateMany },
      $transaction: jest.fn((operation) => operation({
        crmTask: { findUnique: jest.fn().mockResolvedValue(current), updateMany: taskUpdateMany },
        auditLog: { findFirst: jest.fn().mockResolvedValue(updateAudit) },
      })),
    } as unknown as PrismaService, config, audit);

    await expect(taskRepository.updateTask('task-1', {
      idempotencyKey: 'task-update-replay-1',
      expectedVersion: 5,
      status: CrmTaskStatus.COMPLETED,
      assignedToId: 'actor-1',
    }, 'actor-1')).resolves.toEqual({ state: 'DETERMINISTIC_REPLAY', task: current });
    expect(taskUpdateMany).not.toHaveBeenCalled();
  });

  it('replays an audited task update after later versions without mutating current state', async () => {
    const current = {
      id: 'task-1', version: 8, status: CrmTaskStatus.COMPLETED, assignedToId: 'actor-2',
    };
    const taskUpdateMany = jest.fn();
    const updateAudit = {
      actorId: 'actor-1',
      after: { version: 6, status: CrmTaskStatus.IN_PROGRESS, assignedToId: 'actor-1' },
      metadata: {
        requestIdentity: {
          expectedVersion: 5, status: CrmTaskStatus.IN_PROGRESS,
          assignedToSpecified: true, assignedToId: 'actor-1',
        },
      },
    };
    const taskRepository = new Phase8CrmRepository({
      $transaction: jest.fn((operation) => operation({
        crmTask: { findUnique: jest.fn().mockResolvedValue(current), updateMany: taskUpdateMany },
        auditLog: { findFirst: jest.fn().mockResolvedValue(updateAudit) },
      })),
    } as unknown as PrismaService, config, audit);

    await expect(taskRepository.updateTask('task-1', {
      idempotencyKey: 'task-update-historical-replay',
      expectedVersion: 5,
      status: CrmTaskStatus.IN_PROGRESS,
      assignedToId: 'actor-1',
    }, 'actor-1')).resolves.toEqual({ state: 'DETERMINISTIC_REPLAY', task: current });
    expect(taskUpdateMany).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it.each([
    ['different actor', 'actor-2', CrmTaskStatus.IN_PROGRESS, 'actor-1'],
    ['different status', 'actor-1', CrmTaskStatus.COMPLETED, 'actor-1'],
    ['different assignee', 'actor-1', CrmTaskStatus.IN_PROGRESS, 'actor-2'],
  ] as const)('rejects historical task replay with %s', async (_case, actorId, status, assignedToId) => {
    const taskUpdateMany = jest.fn();
    const taskRepository = new Phase8CrmRepository({
      $transaction: jest.fn((operation) => operation({
        crmTask: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'task-1', version: 8, status: CrmTaskStatus.COMPLETED, assignedToId: 'actor-3',
          }),
          updateMany: taskUpdateMany,
        },
        auditLog: { findFirst: jest.fn().mockResolvedValue({
          actorId: 'actor-1',
          after: { version: 6, status: CrmTaskStatus.IN_PROGRESS, assignedToId: 'actor-1' },
          metadata: { requestIdentity: {
            expectedVersion: 5, status: CrmTaskStatus.IN_PROGRESS,
            assignedToSpecified: true, assignedToId: 'actor-1',
          } },
        }) },
      })),
    } as unknown as PrismaService, config, audit);

    await expect(taskRepository.updateTask('task-1', {
      idempotencyKey: 'task-update-historical-conflict',
      expectedVersion: 5,
      status,
      assignedToId,
    }, actorId)).rejects.toEqual(expect.objectContaining<Partial<CrmPersistenceError>>({
      code: 'CRM_IDEMPOTENCY_CONFLICT',
    }));
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
      $transaction: jest.fn((operation) => operation({
        crmTask: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'task-1', version: 6, status: CrmTaskStatus.IN_PROGRESS, assignedToId: 'actor-2',
          }),
          updateMany: taskUpdateMany,
        },
        auditLog: { findFirst: jest.fn().mockResolvedValue(null) },
      })),
    } as unknown as PrismaService, config, audit);

    await expect(taskRepository.updateTask('task-1', {
      idempotencyKey: 'task-update-stale-1',
      expectedVersion: 5,
      status: CrmTaskStatus.IN_PROGRESS,
      assignedToId: 'actor-1',
    }, 'actor-1')).rejects.toEqual(expect.objectContaining<Partial<CrmPersistenceError>>({ code: 'STALE_CRM_VERSION' }));
    expect(taskUpdateMany).not.toHaveBeenCalled();
  });

  it('turns a concurrent identical task update into deterministic replay', async () => {
    const before = { id: 'task-1', version: 5, status: CrmTaskStatus.OPEN, assignedToId: null };
    const after = { id: 'task-1', version: 6, status: CrmTaskStatus.IN_PROGRESS, assignedToId: 'actor-1' };
    const taskFindUnique = jest.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    const auditFindFirst = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        actorId: 'actor-1',
        after: { version: 6, status: CrmTaskStatus.IN_PROGRESS, assignedToId: 'actor-1' },
        metadata: { requestIdentity: {
          expectedVersion: 5, status: CrmTaskStatus.IN_PROGRESS,
          assignedToSpecified: true, assignedToId: 'actor-1',
        } },
      });
    const taskRepository = new Phase8CrmRepository({
      $transaction: jest.fn((operation) => operation({
        crmTask: { findUnique: taskFindUnique, updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        auditLog: { findFirst: auditFindFirst },
      })),
    } as unknown as PrismaService, config, audit);

    await expect(taskRepository.updateTask('task-1', {
      idempotencyKey: 'task-update-race-1',
      expectedVersion: 5,
      status: CrmTaskStatus.IN_PROGRESS,
      assignedToId: 'actor-1',
    }, 'actor-1')).resolves.toEqual({ state: 'DETERMINISTIC_REPLAY', task: after });
  });
});
