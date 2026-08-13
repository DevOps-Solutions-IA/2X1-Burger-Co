import type { INestApplication } from '@nestjs/common';
import {
  CrmLeadSource,
  CrmLeadStatus,
  CrmPipelineStageOutcome,
  CrmTaskPriority,
  CrmTaskStatus,
  CrmTaskType,
  CustomerConsentChannel,
  CustomerConsentPurpose,
  CustomerConsentStatus,
} from '@prisma/client';
import { Phase8CrmRepository } from '../modules/sofia/crm/phase8-crm.repository';
import { SofiaCrmService } from '../modules/sofia/crm/sofia-crm.service';
import { AuditService } from '../modules/audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { closeTestApp, createTestApp } from './helpers/test-app';
import { resetDatabase } from './helpers/test-data';

describe('Phase 8 CRM PostgreSQL concurrency and relational invariants', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repository: Phase8CrmRepository;
  let auditService: AuditService;
  let crmService: SofiaCrmService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('Phase 8 CRM integration requires an isolated _test database.');
    }
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    repository = app.get(Phase8CrmRepository);
    auditService = app.get(AuditService);
    crmService = app.get(SofiaCrmService);
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('deduplicates pipeline and note creation under concurrent replay', async () => {
    const actor = await prisma.user.create({
      data: { email: 'crm-concurrency-1@example.test', fullName: 'CRM Test', passwordHash: 'not-used' },
    });
    const customer = await prisma.customer.create({
      data: { displayName: 'Cliente CRM', displayNameNormalized: 'cliente crm' },
    });
    const pipelineInput = {
      name: 'Ventas Phase 8',
      description: 'Pipeline operacional',
      stages: [
        { name: 'Nuevo', position: 0, outcome: CrmPipelineStageOutcome.OPEN },
        { name: 'Ganado', position: 1, outcome: CrmPipelineStageOutcome.WON },
      ],
    };

    const pipelines = await Promise.all(
      Array.from({ length: 8 }, () => repository.createPipeline(pipelineInput, actor.id)),
    );
    expect(new Set(pipelines.map(({ pipeline }) => pipeline.id)).size).toBe(1);
    expect(await prisma.crmPipeline.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'CRM_PIPELINE_CREATED' } })).toBe(1);

    const notes = await Promise.all(Array.from({ length: 8 }, () => repository.createNote({
      customerId: customer.id,
      source: 'AUTHORIZED_OPERATOR',
      sourceReference: 'same external event with phone +57 323 796 3047',
      body: 'Bearer secret.token password=hunter2 llamar +1 (202) 555-0143',
    }, actor.id)));
    expect(new Set(notes.map(({ note }) => note.id)).size).toBe(1);
    expect(await prisma.crmNote.count()).toBe(1);
    const note = await prisma.crmNote.findFirstOrThrow();
    expect(note.sourceReference).toMatch(/^[a-f0-9]{64}$/);
    expect(note.body).not.toMatch(/secret\.token|hunter2|202/);
    expect(await prisma.auditLog.count({ where: { action: 'CRM_NOTE_CREATED' } })).toBe(1);
  });

  it('atomically deduplicates concurrent consent evidence with one audit event', async () => {
    const actor = await prisma.user.create({
      data: { email: 'crm-consent@example.test', fullName: 'CRM Consent', passwordHash: 'not-used' },
    });
    const customer = await prisma.customer.create({
      data: { displayName: 'Cliente Consent', displayNameNormalized: 'cliente consent' },
    });
    const consent = {
      purpose: CustomerConsentPurpose.MARKETING,
      channel: CustomerConsentChannel.WHATSAPP,
      source: 'ADMIN_CONSOLE',
      evidence: 'bounded-customer-consent-evidence',
    };

    const results = await Promise.all([
      crmService.grantOptIn(customer.id, consent, actor.id),
      crmService.grantOptIn(customer.id, consent, actor.id),
    ]);

    expect(new Set(results.map(({ id }) => id)).size).toBe(1);
    expect(results[0]).toMatchObject({ status: CustomerConsentStatus.GRANTED, version: 1 });
    expect(await prisma.customerConsent.count({ where: { customerId: customer.id } })).toBe(1);
    expect(await prisma.auditLog.count({
      where: { action: 'CRM_CONSENT_GRANTED', entityId: results[0]!.id },
    })).toBe(1);
  });

  it('deduplicates concurrent lead creation with one row, history event and audit record', async () => {
    const actor = await prisma.user.create({
      data: { email: 'crm-lead-create-race@example.test', fullName: 'CRM Lead Race', passwordHash: 'not-used' },
    });
    const customer = await prisma.customer.create({
      data: { displayName: 'Cliente Lead Race', displayNameNormalized: 'cliente lead race' },
    });
    const pipeline = await repository.createPipeline({
      name: 'Pipeline Lead Race',
      stages: [{ name: 'Nuevo', position: 0, outcome: CrmPipelineStageOutcome.OPEN }],
    }, actor.id);
    const input = {
      customerId: customer.id,
      pipelineId: pipeline.pipeline.id,
      currentStageId: pipeline.pipeline.stages[0]!.id,
      source: CrmLeadSource.AUTHORIZED_OPERATOR,
      sourceReference: 'same-lead-create-event',
      title: 'Oportunidad concurrente',
    };

    const results = await Promise.all(Array.from({ length: 8 }, () => repository.createLead(input, actor.id)));

    expect(new Set(results.map(({ lead }) => lead.id)).size).toBe(1);
    expect(results.filter(({ state }) => state === 'CREATED')).toHaveLength(1);
    expect(await prisma.crmLead.count({ where: { customerId: customer.id } })).toBe(1);
    expect(await prisma.crmLeadStageHistory.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'CRM_LEAD_CREATED' } })).toBe(1);
  });

  it('deduplicates concurrent task creation with one row and audit record', async () => {
    const actor = await prisma.user.create({
      data: { email: 'crm-task-create-race@example.test', fullName: 'CRM Task Race', passwordHash: 'not-used' },
    });
    const customer = await prisma.customer.create({
      data: { displayName: 'Cliente Task Race', displayNameNormalized: 'cliente task race' },
    });
    const input = {
      customerId: customer.id,
      source: 'AUTHORIZED_OPERATOR',
      sourceReference: 'same-task-create-event',
      type: CrmTaskType.TASK,
      priority: CrmTaskPriority.HIGH,
      title: 'Seguimiento concurrente',
    };

    const results = await Promise.all(Array.from({ length: 8 }, () => repository.createTask(input, actor.id)));

    expect(new Set(results.map(({ task }) => task.id)).size).toBe(1);
    expect(results.filter(({ state }) => state === 'CREATED')).toHaveLength(1);
    expect(await prisma.crmTask.count({ where: { customerId: customer.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'CRM_TASK_CREATED' } })).toBe(1);
  });

  it('allows one lead transition winner and enforces its pipeline-stage binding in SQL', async () => {
    const actor = await prisma.user.create({
      data: { email: 'crm-concurrency-2@example.test', fullName: 'CRM Test', passwordHash: 'not-used' },
    });
    const customer = await prisma.customer.create({
      data: { displayName: 'Cliente Lead', displayNameNormalized: 'cliente lead' },
    });
    const first = await repository.createPipeline({
      name: 'Pipeline A',
      stages: [
        { name: 'Nuevo', position: 0, outcome: CrmPipelineStageOutcome.OPEN },
        { name: 'Activo', position: 1, outcome: CrmPipelineStageOutcome.OPEN },
      ],
    }, actor.id);
    const second = await repository.createPipeline({
      name: 'Pipeline B',
      stages: [{ name: 'Otro', position: 0, outcome: CrmPipelineStageOutcome.OPEN }],
    }, actor.id);
    await repository.createLead({
      customerId: customer.id,
      pipelineId: first.pipeline.id,
      currentStageId: first.pipeline.stages[0]!.id,
      source: CrmLeadSource.AUTHORIZED_OPERATOR,
      sourceReference: 'lead-source-1',
      title: 'Oportunidad',
    }, actor.id);
    const lead = await prisma.crmLead.findFirstOrThrow({ where: { customerId: customer.id } });

    const attempts = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => repository.transitionLead(
      lead.id,
      {
        expectedVersion: 0,
        toStageId: first.pipeline.stages[1]!.id,
        toStatus: CrmLeadStatus.ACTIVE,
        idempotencyKey: `lead-race-${index}`,
        reasonCode: 'CUSTOMER_ENGAGED',
      },
      actor.id,
    )));
    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.crmLeadStageHistory.count({ where: { leadId: lead.id } })).toBe(2);
    expect(await prisma.auditLog.count({
      where: { action: 'CRM_LEAD_TRANSITIONED', entityId: lead.id },
    })).toBe(1);

    await expect(prisma.crmLead.create({
      data: {
        customerId: customer.id,
        pipelineId: first.pipeline.id,
        currentStageId: second.pipeline.stages[0]!.id,
        source: CrmLeadSource.AUTHORIZED_OPERATOR,
        sourceReference: 'cross-pipeline',
        title: 'Invalid cross-pipeline lead',
      },
    })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('recovers an identical concurrent task update without accepting a different stale request', async () => {
    const [actor, otherActor] = await Promise.all([
      prisma.user.create({
        data: { email: 'crm-task-owner@example.test', fullName: 'CRM Task Owner', passwordHash: 'not-used' },
      }),
      prisma.user.create({
        data: { email: 'crm-task-other@example.test', fullName: 'CRM Task Other', passwordHash: 'not-used' },
      }),
    ]);
    const customer = await prisma.customer.create({
      data: { displayName: 'Cliente Task', displayNameNormalized: 'cliente task' },
    });
    await repository.createTask({
      customerId: customer.id,
      source: 'AUTHORIZED_OPERATOR',
      sourceReference: 'crm-task-replay-1',
      type: CrmTaskType.TASK,
      priority: CrmTaskPriority.MEDIUM,
      title: 'Seguimiento seguro',
    }, actor.id);
    const task = await prisma.crmTask.findFirstOrThrow({ where: { customerId: customer.id } });
    const update = {
      idempotencyKey: 'crm-task-update-replay-1',
      expectedVersion: 0,
      status: CrmTaskStatus.IN_PROGRESS,
      assignedToId: actor.id,
    };

    const concurrent = await Promise.all([
      repository.updateTask(task.id, update, actor.id),
      repository.updateTask(task.id, update, actor.id),
    ]);
    expect(concurrent.map(({ state }) => state).sort()).toEqual(['DETERMINISTIC_REPLAY', 'UPDATED']);
    expect(await prisma.crmTask.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      version: 1,
      status: CrmTaskStatus.IN_PROGRESS,
      assignedToId: actor.id,
    });
    expect(await prisma.auditLog.count({ where: { action: 'CRM_TASK_UPDATED', entityId: task.id } })).toBe(1);

    await expect(repository.updateTask(task.id, update, actor.id)).resolves.toMatchObject({
      state: 'DETERMINISTIC_REPLAY',
      task: { version: 1 },
    });
    await expect(repository.updateTask(task.id, {
      ...update,
      idempotencyKey: 'crm-task-update-different-request',
      assignedToId: otherActor.id,
    }, actor.id)).rejects.toMatchObject({ code: 'STALE_CRM_VERSION' });

    await expect(repository.updateTask(task.id, update, otherActor.id))
      .rejects.toMatchObject({ code: 'CRM_IDEMPOTENCY_CONFLICT' });
  });

  it('rolls back the business write when transactional audit persistence fails', async () => {
    const actor = await prisma.user.create({
      data: { email: 'crm-audit-failure@example.test', fullName: 'CRM Audit Failure', passwordHash: 'not-used' },
    });
    jest.spyOn(auditService, 'log').mockRejectedValueOnce(new Error('AUDIT_WRITE_FAILED'));

    await expect(repository.createPipeline({
      name: 'Pipeline debe revertirse',
      stages: [{ name: 'Nuevo', position: 0, outcome: CrmPipelineStageOutcome.OPEN }],
    }, actor.id)).rejects.toThrow('AUDIT_WRITE_FAILED');

    expect(await prisma.crmPipeline.count()).toBe(0);
    expect(await prisma.crmPipelineStage.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'CRM_PIPELINE_CREATED' } })).toBe(0);
  });

  it('deduplicates concurrent tag assignment with one assignment and one audit event', async () => {
    const actor = await prisma.user.create({
      data: { email: 'crm-tag-replay@example.test', fullName: 'CRM Tag Replay', passwordHash: 'not-used' },
    });
    const customer = await prisma.customer.create({
      data: { displayName: 'Cliente Tags', displayNameNormalized: 'cliente tags' },
    });
    const tagResult = await repository.createTag('Preferente', actor.id);

    const results = await Promise.all(Array.from({ length: 8 }, () => (
      repository.assignTag(customer.id, tagResult.tag.id, actor.id)
    )));

    expect(results.filter(({ state }) => state === 'CREATED')).toHaveLength(1);
    expect(results.filter(({ state }) => state === 'DETERMINISTIC_REPLAY')).toHaveLength(7);
    expect(await prisma.customerTagAssignment.count({ where: { customerId: customer.id } })).toBe(1);
    expect(await prisma.auditLog.count({
      where: { action: 'CRM_TAG_ASSIGNED', entityId: customer.id },
    })).toBe(1);
  });
});
