import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
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
import type { AuthUser } from '../common/types/auth-user.type';
import { opaqueCrmReference } from '../modules/sofia/crm/crm-privacy';
import { createHmac } from 'node:crypto';

describe('Phase 8 CRM PostgreSQL concurrency and relational invariants', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repository: Phase8CrmRepository;
  let auditService: AuditService;
  let crmService: SofiaCrmService;

  const operator = (actorId: string): AuthUser => ({
    sub: actorId,
    email: 'crm-concurrency@example.test',
    fullName: 'CRM Concurrency',
    sessionVersion: 1,
    roles: ['admin'],
    permissions: ['orders.update'],
  });

  const hashConfig = (current: string, previous?: string): ConfigService => ({
    get: jest.fn((key: string) => ({
      CRM_IDENTITY_HASH_SECRET: current,
      CRM_IDENTITY_HASH_SECRET_PREVIOUS_KEYS: previous,
    })[key]),
  } as unknown as ConfigService);

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
      crmService.grantOptIn(customer.id, consent, operator(actor.id)),
      crmService.grantOptIn(customer.id, consent, operator(actor.id)),
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

  it('promotes retained lead/task references with one compare-and-set audit winner', async () => {
    const oldSecret = 'crm-old-concurrency-hash-secret-0000001';
    const currentSecret = 'crm-current-concurrency-hash-secret-0001';
    const oldRepository = new Phase8CrmRepository(prisma, {
      get: jest.fn((key: string) => key === 'CRM_IDENTITY_HASH_SECRET' ? oldSecret : undefined),
    } as unknown as ConfigService, auditService);
    const rotatingRepository = new Phase8CrmRepository(prisma, {
      get: jest.fn((key: string) => ({
        CRM_IDENTITY_HASH_SECRET: currentSecret,
        CRM_IDENTITY_HASH_SECRET_PREVIOUS_KEYS: oldSecret,
      })[key]),
    } as unknown as ConfigService, auditService);
    const actor = await prisma.user.create({
      data: { email: 'crm-hash-race@example.test', fullName: 'CRM Hash Race', passwordHash: 'not-used' },
    });
    const customer = await prisma.customer.create({
      data: { displayName: 'Cliente Hash Race', displayNameNormalized: 'cliente hash race' },
    });
    const pipeline = await oldRepository.createPipeline({
      name: 'Pipeline Hash Race',
      stages: [{ name: 'Nuevo', position: 0, outcome: CrmPipelineStageOutcome.OPEN }],
    }, actor.id);
    const leadInput = {
      customerId: customer.id,
      pipelineId: pipeline.pipeline.id,
      currentStageId: pipeline.pipeline.stages[0]!.id,
      source: CrmLeadSource.AUTHORIZED_OPERATOR,
      sourceReference: 'lead-old-key-race',
      title: 'Lead old key race',
    };
    const taskInput = {
      customerId: customer.id,
      source: 'AUTHORIZED_OPERATOR',
      sourceReference: 'task-old-key-race',
      type: CrmTaskType.TASK,
      priority: CrmTaskPriority.MEDIUM,
      title: 'Task old key race',
    };
    const seededLead = await oldRepository.createLead(leadInput, actor.id);
    const seededTask = await oldRepository.createTask(taskInput, actor.id);

    const [leadReplays, taskReplays] = await Promise.all([
      Promise.all(Array.from({ length: 8 }, () => rotatingRepository.createLead(leadInput, actor.id))),
      Promise.all(Array.from({ length: 8 }, () => rotatingRepository.createTask(taskInput, actor.id))),
    ]);

    expect(new Set(leadReplays.map(({ lead }) => lead.id))).toEqual(new Set([seededLead.lead.id]));
    expect(new Set(taskReplays.map(({ task }) => task.id))).toEqual(new Set([seededTask.task.id]));
    expect((await prisma.crmLead.findUniqueOrThrow({ where: { id: seededLead.lead.id } })).sourceReference)
      .toBe(opaqueCrmReference(currentSecret, `lead:${CrmLeadSource.AUTHORIZED_OPERATOR}`, leadInput.sourceReference));
    expect((await prisma.crmTask.findUniqueOrThrow({ where: { id: seededTask.task.id } })).sourceReference)
      .toBe(opaqueCrmReference(currentSecret, 'task:AUTHORIZED_OPERATOR', taskInput.sourceReference));
    expect(await prisma.auditLog.count({
      where: { action: 'CRM_REFERENCE_HASH_ROTATED', entity: 'CrmLead', entityId: seededLead.lead.id },
    })).toBe(1);
    expect(await prisma.auditLog.count({
      where: { action: 'CRM_REFERENCE_HASH_ROTATED', entity: 'CrmTask', entityId: seededTask.task.id },
    })).toBe(1);
  });

  it('serializes old-first customer, lead and task writes, promotes once, then fences the old writer', async () => {
    const oldSecret = 'crm-old-first-generation-secret-000000001';
    const currentSecret = 'crm-current-generation-secret-000000001';
    const oldConfig = hashConfig(oldSecret);
    const currentConfig = hashConfig(currentSecret, oldSecret);
    const oldRepository = new Phase8CrmRepository(prisma, oldConfig, auditService);
    const currentRepository = new Phase8CrmRepository(prisma, currentConfig, auditService);
    const oldService = new SofiaCrmService(prisma, auditService, oldConfig, oldRepository);
    const currentService = new SofiaCrmService(prisma, auditService, currentConfig, currentRepository);
    const actor = await prisma.user.create({
      data: { email: 'crm-old-first@example.test', fullName: 'CRM Old First', passwordHash: 'not-used' },
    });
    const phone = '3237963047';
    const customer = await oldService.resolveOrCreateByPhone({ phone }, operator(actor.id));
    const pipeline = await oldRepository.createPipeline({
      name: 'Mixed generation old first',
      stages: [{ name: 'Nuevo', position: 0, outcome: CrmPipelineStageOutcome.OPEN }],
    }, actor.id);
    const leadInput = {
      customerId: customer.id,
      pipelineId: pipeline.pipeline.id,
      currentStageId: pipeline.pipeline.stages[0]!.id,
      source: CrmLeadSource.AUTHORIZED_OPERATOR,
      sourceReference: 'mixed-generation-lead-old-first',
      title: 'Mixed generation lead',
    };
    const taskInput = {
      customerId: customer.id,
      source: 'AUTHORIZED_OPERATOR',
      sourceReference: 'mixed-generation-task-old-first',
      type: CrmTaskType.TASK,
      priority: CrmTaskPriority.MEDIUM,
      title: 'Mixed generation task',
    };
    await oldRepository.createLead(leadInput, actor.id);
    await oldRepository.createTask(taskInput, actor.id);

    await expect(currentService.resolveOrCreateByPhone({ phone }, operator(actor.id)))
      .resolves.toMatchObject({ id: customer.id });
    await expect(currentRepository.createLead(leadInput, actor.id))
      .resolves.toMatchObject({ state: 'DETERMINISTIC_REPLAY' });
    await expect(currentRepository.createTask(taskInput, actor.id))
      .resolves.toMatchObject({ state: 'DETERMINISTIC_REPLAY' });

    await expect(oldService.resolveOrCreateByPhone({ phone }, operator(actor.id)))
      .rejects.toThrow('CRM_HASH_GENERATION_STALE_WRITER');
    await expect(oldRepository.createLead(leadInput, actor.id))
      .rejects.toThrow('CRM_HASH_GENERATION_STALE_WRITER');
    await expect(oldRepository.createTask(taskInput, actor.id))
      .rejects.toThrow('CRM_HASH_GENERATION_STALE_WRITER');
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.customerIdentity.count()).toBe(1);
    expect(await prisma.crmLead.count()).toBe(1);
    expect(await prisma.crmTask.count()).toBe(1);
  });

  it('fences old-only customer, lead and task writers when current wins first', async () => {
    const oldSecret = 'crm-old-second-generation-secret-00000001';
    const currentSecret = 'crm-current-first-generation-secret-00001';
    const oldConfig = hashConfig(oldSecret);
    const currentConfig = hashConfig(currentSecret, oldSecret);
    const oldRepository = new Phase8CrmRepository(prisma, oldConfig, auditService);
    const currentRepository = new Phase8CrmRepository(prisma, currentConfig, auditService);
    const oldService = new SofiaCrmService(prisma, auditService, oldConfig, oldRepository);
    const currentService = new SofiaCrmService(prisma, auditService, currentConfig, currentRepository);
    const actor = await prisma.user.create({
      data: { email: 'crm-current-first@example.test', fullName: 'CRM Current First', passwordHash: 'not-used' },
    });
    const phone = '3237963048';
    const customer = await currentService.resolveOrCreateByPhone({ phone }, operator(actor.id));
    const pipeline = await currentRepository.createPipeline({
      name: 'Mixed generation current first',
      stages: [{ name: 'Nuevo', position: 0, outcome: CrmPipelineStageOutcome.OPEN }],
    }, actor.id);
    const leadInput = {
      customerId: customer.id,
      pipelineId: pipeline.pipeline.id,
      currentStageId: pipeline.pipeline.stages[0]!.id,
      source: CrmLeadSource.AUTHORIZED_OPERATOR,
      sourceReference: 'mixed-generation-lead-current-first',
      title: 'Current first lead',
    };
    const taskInput = {
      customerId: customer.id,
      source: 'AUTHORIZED_OPERATOR',
      sourceReference: 'mixed-generation-task-current-first',
      type: CrmTaskType.TASK,
      priority: CrmTaskPriority.MEDIUM,
      title: 'Current first task',
    };
    await currentRepository.createLead(leadInput, actor.id);
    await currentRepository.createTask(taskInput, actor.id);

    await expect(oldService.resolveOrCreateByPhone({ phone }, operator(actor.id)))
      .rejects.toThrow('CRM_HASH_GENERATION_STALE_WRITER');
    await expect(oldRepository.createLead(leadInput, actor.id))
      .rejects.toThrow('CRM_HASH_GENERATION_STALE_WRITER');
    await expect(oldRepository.createTask(taskInput, actor.id))
      .rejects.toThrow('CRM_HASH_GENERATION_STALE_WRITER');
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.crmLead.count()).toBe(1);
    expect(await prisma.crmTask.count()).toBe(1);
  });

  it('allows one logical result when old-only and current-plus-old writers start concurrently', async () => {
    const oldSecret = 'crm-old-concurrent-generation-secret-000001';
    const currentSecret = 'crm-current-concurrent-generation-secret-01';
    const oldConfig = hashConfig(oldSecret);
    const currentConfig = hashConfig(currentSecret, oldSecret);
    const oldRepository = new Phase8CrmRepository(prisma, oldConfig, auditService);
    const currentRepository = new Phase8CrmRepository(prisma, currentConfig, auditService);
    const oldService = new SofiaCrmService(prisma, auditService, oldConfig, oldRepository);
    const currentService = new SofiaCrmService(prisma, auditService, currentConfig, currentRepository);
    const actor = await prisma.user.create({
      data: { email: 'crm-mixed-concurrent@example.test', fullName: 'CRM Mixed Concurrent', passwordHash: 'not-used' },
    });
    const phone = '3237963050';
    const customerAttempts = await Promise.allSettled([
      oldService.resolveOrCreateByPhone({ phone }, operator(actor.id)),
      currentService.resolveOrCreateByPhone({ phone }, operator(actor.id)),
    ]);
    expect(customerAttempts.some(({ status }) => status === 'fulfilled')).toBe(true);
    const customer = await prisma.customer.findFirstOrThrow();
    const pipeline = await currentRepository.createPipeline({
      name: 'Mixed concurrent pipeline',
      stages: [{ name: 'Nuevo', position: 0, outcome: CrmPipelineStageOutcome.OPEN }],
    }, actor.id);
    const leadInput = {
      customerId: customer.id,
      pipelineId: pipeline.pipeline.id,
      currentStageId: pipeline.pipeline.stages[0]!.id,
      source: CrmLeadSource.AUTHORIZED_OPERATOR,
      sourceReference: 'mixed-concurrent-lead',
      title: 'Mixed concurrent lead',
    };
    const taskInput = {
      customerId: customer.id,
      source: 'AUTHORIZED_OPERATOR',
      sourceReference: 'mixed-concurrent-task',
      type: CrmTaskType.TASK,
      priority: CrmTaskPriority.MEDIUM,
      title: 'Mixed concurrent task',
    };
    const [leadAttempts, taskAttempts] = await Promise.all([
      Promise.allSettled([
        oldRepository.createLead(leadInput, actor.id),
        currentRepository.createLead(leadInput, actor.id),
      ]),
      Promise.allSettled([
        oldRepository.createTask(taskInput, actor.id),
        currentRepository.createTask(taskInput, actor.id),
      ]),
    ]);

    expect(leadAttempts.some(({ status }) => status === 'fulfilled')).toBe(true);
    expect(taskAttempts.some(({ status }) => status === 'fulfilled')).toBe(true);
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.customerIdentity.count()).toBe(1);
    expect(await prisma.crmLead.count()).toBe(1);
    expect(await prisma.crmLeadStageHistory.count()).toBe(1);
    expect(await prisma.crmTask.count()).toBe(1);
  });

  it('rolls back phone hash promotion and generation advancement when audit persistence fails', async () => {
    const oldSecret = 'crm-old-audit-rollback-secret-000000001';
    const currentSecret = 'crm-current-audit-rollback-secret-00001';
    const oldConfig = hashConfig(oldSecret);
    const currentConfig = hashConfig(currentSecret, oldSecret);
    const oldRepository = new Phase8CrmRepository(prisma, oldConfig, auditService);
    const currentRepository = new Phase8CrmRepository(prisma, currentConfig, auditService);
    const oldService = new SofiaCrmService(prisma, auditService, oldConfig, oldRepository);
    const currentService = new SofiaCrmService(prisma, auditService, currentConfig, currentRepository);
    const actor = await prisma.user.create({
      data: { email: 'crm-identity-audit@example.test', fullName: 'CRM Identity Audit', passwordHash: 'not-used' },
    });
    const phone = '3237963049';
    const customer = await oldService.resolveOrCreateByPhone({ phone }, operator(actor.id));
    const oldHash = createHmac('sha256', oldSecret).update(`PHONE:${phone}`, 'utf8').digest('hex');
    const currentHash = createHmac('sha256', currentSecret).update(`PHONE:${phone}`, 'utf8').digest('hex');
    const originalLog = auditService.log.bind(auditService);
    const auditSpy = jest.spyOn(auditService, 'log').mockImplementation((input, client) => (
      input.action === 'CRM_IDENTITY_HASH_ROTATED'
        ? Promise.reject(new Error('AUDIT_WRITE_FAILED'))
        : originalLog(input, client)
    ));

    await expect(currentService.resolveOrCreateByPhone({ phone }, operator(actor.id)))
      .rejects.toThrow('AUDIT_WRITE_FAILED');
    expect(await prisma.customerIdentity.findUnique({
      where: { type_valueHash: { type: 'PHONE', valueHash: oldHash } },
    })).toMatchObject({ customerId: customer.id });
    expect(await prisma.customerIdentity.findUnique({
      where: { type_valueHash: { type: 'PHONE', valueHash: currentHash } },
    })).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'CRM_IDENTITY_HASH_ROTATED' } })).toBe(0);
    auditSpy.mockRestore();

    await expect(currentService.resolveOrCreateByPhone({ phone }, operator(actor.id)))
      .resolves.toMatchObject({ id: customer.id });
    expect(await prisma.customerIdentity.findUnique({
      where: { type_valueHash: { type: 'PHONE', valueHash: currentHash } },
    })).toMatchObject({ customerId: customer.id });
    expect(await prisma.auditLog.count({ where: { action: 'CRM_IDENTITY_HASH_ROTATED' } })).toBe(1);
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

    const attempts = await Promise.all(Array.from({ length: 8 }, () => repository.transitionLead(
      lead.id,
      {
        expectedVersion: 0,
        toStageId: first.pipeline.stages[1]!.id,
        toStatus: CrmLeadStatus.ACTIVE,
        idempotencyKey: 'lead-identical-transition-race',
        reasonCode: 'CUSTOMER_ENGAGED',
      },
      actor.id,
    )));
    expect(attempts.filter(({ state }) => state === 'UPDATED')).toHaveLength(1);
    expect(attempts.filter(({ state }) => state === 'DETERMINISTIC_REPLAY')).toHaveLength(7);
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

    await expect(prisma.crmLeadStageHistory.create({
      data: {
        leadId: lead.id,
        pipelineId: first.pipeline.id,
        version: 99,
        idempotencyKey: 'cross-pipeline-history',
        toStageId: second.pipeline.stages[0]!.id,
        toStatus: CrmLeadStatus.ACTIVE,
        reasonCode: 'INVALID_CROSS_PIPELINE_HISTORY',
      },
    })).rejects.toMatchObject({ code: 'P2003' });
  });

  it('enforces customer lineage for task/note bindings and append-only evidence in SQL', async () => {
    const actor = await prisma.user.create({
      data: { email: 'crm-lineage@example.test', fullName: 'CRM Lineage', passwordHash: 'not-used' },
    });
    const [customerA, customerB] = await Promise.all([
      prisma.customer.create({ data: { displayName: 'Cliente A', displayNameNormalized: 'cliente a' } }),
      prisma.customer.create({ data: { displayName: 'Cliente B', displayNameNormalized: 'cliente b' } }),
    ]);
    const pipeline = await repository.createPipeline({
      name: 'Pipeline lineage',
      stages: [{ name: 'Nuevo', position: 0, outcome: CrmPipelineStageOutcome.OPEN }],
    }, actor.id);
    const createdLead = await repository.createLead({
      customerId: customerA.id,
      pipelineId: pipeline.pipeline.id,
      currentStageId: pipeline.pipeline.stages[0]!.id,
      source: CrmLeadSource.AUTHORIZED_OPERATOR,
      sourceReference: 'lineage-lead',
      title: 'Lead A',
    }, actor.id);
    const [serviceCaseA, serviceCaseB] = await Promise.all([
      prisma.customerServiceCase.create({
        data: {
          category: 'OTHER', source: 'PHASE8_TEST', sourceReference: 'lineage-case-a',
          evidenceHash: 'a'.repeat(64), sanitizedSummary: 'Case A', customerId: customerA.id,
        },
      }),
      prisma.customerServiceCase.create({
        data: {
          category: 'OTHER', source: 'PHASE8_TEST', sourceReference: 'lineage-case-b',
          evidenceHash: 'b'.repeat(64), sanitizedSummary: 'Case B', customerId: customerB.id,
        },
      }),
    ]);
    const note = await repository.createNote({
      customerId: customerA.id,
      leadId: createdLead.lead.id,
      customerServiceCaseId: serviceCaseA.id,
      source: 'AUTHORIZED_OPERATOR',
      sourceReference: 'lineage-note',
      body: 'Evidencia inmutable',
    }, actor.id);
    const history = await prisma.crmLeadStageHistory.findFirstOrThrow({
      where: { leadId: createdLead.lead.id },
    });

    await expect(prisma.crmTask.create({
      data: {
        customerId: customerB.id,
        leadId: createdLead.lead.id,
        source: 'AUTHORIZED_OPERATOR',
        sourceReference: 'invalid-task-lineage',
        type: CrmTaskType.TASK,
        title: 'Invalid task lineage',
      },
    })).rejects.toMatchObject({ code: 'P2003' });
    await expect(prisma.crmNote.create({
      data: {
        customerId: customerB.id,
        leadId: createdLead.lead.id,
        source: 'AUTHORIZED_OPERATOR',
        sourceReference: 'invalid-note-lineage',
        body: 'Invalid note lineage',
        contentHash: 'a'.repeat(64),
      },
    })).rejects.toMatchObject({ code: 'P2003' });
    await expect(prisma.crmTask.create({
      data: {
        customerId: customerB.id,
        customerServiceCaseId: serviceCaseA.id,
        source: 'AUTHORIZED_OPERATOR',
        sourceReference: 'invalid-task-case-lineage',
        type: CrmTaskType.TASK,
        title: 'Invalid task case lineage',
      },
    })).rejects.toMatchObject({ code: 'P2003' });
    await expect(prisma.crmNote.create({
      data: {
        customerId: customerA.id,
        customerServiceCaseId: serviceCaseB.id,
        source: 'AUTHORIZED_OPERATOR',
        sourceReference: 'invalid-note-case-lineage',
        body: 'Invalid note case lineage',
        contentHash: 'c'.repeat(64),
      },
    })).rejects.toMatchObject({ code: 'P2003' });
    await expect(prisma.crmLeadStageHistory.update({
      where: { id: history.id },
      data: { reasonCode: 'MUTATED' },
    })).rejects.toBeDefined();
    await expect(prisma.crmLeadStageHistory.delete({ where: { id: history.id } })).rejects.toBeDefined();
    await expect(prisma.crmNote.update({
      where: { id: note.note.id },
      data: { body: 'mutated' },
    })).rejects.toBeDefined();
    await expect(prisma.crmNote.delete({ where: { id: note.note.id } })).rejects.toBeDefined();
    await expect(prisma.user.delete({ where: { id: actor.id } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(prisma.crmNote.findUnique({ where: { id: note.note.id } })).resolves.toMatchObject({
      authorId: actor.id,
    });
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
