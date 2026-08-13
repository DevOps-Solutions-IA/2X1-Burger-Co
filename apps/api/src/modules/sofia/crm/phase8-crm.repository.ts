import { Injectable } from '@nestjs/common';
import {
  CrmLeadStatus,
  CrmPipelineStageOutcome,
  CrmTaskStatus,
  Prisma,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { normalizeSearchText } from '../../../common/normalization/customer-normalization';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateCrmLeadDto,
  CreateCrmNoteDto,
  CreateCrmPipelineDto,
  CreateCrmTaskDto,
  ListCrmLeadsDto,
  ListCrmNotesDto,
  ListCrmPipelinesDto,
  ListCrmTasksDto,
  ListTimelineDto,
  TransitionCrmLeadDto,
  UpdateCrmTaskDto,
} from './dto/crm.dto';
import { sanitizeTimelineMetadata, sanitizeTimelineText } from './crm-privacy';

export type CrmWriteState = 'CREATED' | 'UPDATED' | 'DETERMINISTIC_REPLAY';

export class CrmPersistenceError extends Error {
  constructor(
    readonly code:
      | 'CRM_CONFLICT'
      | 'CRM_IDEMPOTENCY_CONFLICT'
      | 'CRM_INVALID_RELATION'
      | 'CRM_NOT_FOUND'
      | 'STALE_CRM_VERSION',
  ) {
    super(code);
    this.name = 'CrmPersistenceError';
  }
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError
    ? error.code === 'P2002'
    : Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'P2002');
}

function page<T>(data: T[], total: number, input: { page: number; limit: number }) {
  return {
    data,
    pagination: {
      page: input.page,
      limit: input.limit,
      total,
      pages: Math.ceil(total / input.limit),
    },
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

@Injectable()
export class Phase8CrmRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listPipelines(input: ListCrmPipelinesDto) {
    const where: Prisma.CrmPipelineWhereInput = input.status ? { status: input.status } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.crmPipeline.findMany({
        where,
        include: { stages: { orderBy: { position: 'asc' } }, _count: { select: { leads: true } } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      this.prisma.crmPipeline.count({ where }),
    ]);
    return page(rows, total, input);
  }

  async createPipeline(input: CreateCrmPipelineDto, actorId: string) {
    const name = sanitizeTimelineText(input.name.trim()).slice(0, 100);
    const nameNormalized = normalizeSearchText(name);
    const description = input.description ? sanitizeTimelineText(input.description.trim()).slice(0, 500) : null;
    const stages = input.stages.map((stage) => ({
      name: sanitizeTimelineText(stage.name.trim()).slice(0, 80),
      nameNormalized: normalizeSearchText(stage.name),
      position: stage.position,
      outcome: stage.outcome,
    }));
    if (!stages.length || new Set(stages.map(({ position }) => position)).size !== stages.length
      || new Set(stages.map(({ nameNormalized: normalized }) => normalized)).size !== stages.length) {
      throw new CrmPersistenceError('CRM_CONFLICT');
    }

    const existing = await this.prisma.crmPipeline.findUnique({
      where: { nameNormalized },
      include: { stages: { orderBy: { position: 'asc' } }, _count: { select: { leads: true } } },
    });
    if (existing) {
      const same = existing.description === description
        && existing.stages.length === stages.length
        && existing.stages.every((stage, index) => stage.nameNormalized === stages[index]?.nameNormalized
          && stage.position === stages[index]?.position && stage.outcome === stages[index]?.outcome);
      if (!same) throw new CrmPersistenceError('CRM_IDEMPOTENCY_CONFLICT');
      return { state: 'DETERMINISTIC_REPLAY' as const, pipeline: existing };
    }

    try {
      const pipeline = await this.prisma.crmPipeline.create({
        data: {
          name,
          nameNormalized,
          description,
          createdById: actorId,
          stages: { create: stages },
        },
        include: { stages: { orderBy: { position: 'asc' } }, _count: { select: { leads: true } } },
      });
      return { state: 'CREATED' as const, pipeline };
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      throw new CrmPersistenceError('CRM_CONFLICT');
    }
  }

  async listLeads(input: ListCrmLeadsDto) {
    const where: Prisma.CrmLeadWhereInput = {
      customerId: input.customerId,
      pipelineId: input.pipelineId,
      ownerId: input.ownerId,
      status: input.status,
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.crmLead.findMany({
        where,
        include: {
          customer: { select: { id: true, displayName: true, status: true } },
          pipeline: { select: { id: true, name: true, status: true } },
          currentStage: { select: { id: true, name: true, position: true, outcome: true } },
          owner: { select: { id: true, fullName: true, isActive: true } },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      this.prisma.crmLead.count({ where }),
    ]);
    return page(rows, total, input);
  }

  async getLead(id: string) {
    const lead = await this.prisma.crmLead.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, displayName: true, status: true } },
        pipeline: { include: { stages: { orderBy: { position: 'asc' } } } },
        currentStage: true,
        owner: { select: { id: true, fullName: true, isActive: true } },
        stageHistory: { orderBy: { version: 'desc' }, take: 100 },
      },
    });
    if (!lead) throw new CrmPersistenceError('CRM_NOT_FOUND');
    return lead;
  }

  async createLead(input: CreateCrmLeadDto, actorId: string) {
    const title = sanitizeTimelineText(input.title.trim()).slice(0, 160);
    const sourceReference = input.sourceReference.trim();
    const existing = await this.prisma.crmLead.findUnique({
      where: { source_sourceReference: { source: input.source, sourceReference } },
    });
    if (existing) return this.leadCreateReplay(existing, input, title);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const [customer, pipeline, stage] = await Promise.all([
          tx.customer.findUnique({ where: { id: input.customerId }, select: { id: true } }),
          tx.crmPipeline.findUnique({ where: { id: input.pipelineId }, select: { id: true, status: true } }),
          tx.crmPipelineStage.findUnique({ where: { id: input.currentStageId } }),
        ]);
        if (!customer || !pipeline || pipeline.status !== 'ACTIVE' || !stage || stage.pipelineId !== pipeline.id) {
          throw new CrmPersistenceError('CRM_INVALID_RELATION');
        }
        if (stage.outcome !== CrmPipelineStageOutcome.OPEN) throw new CrmPersistenceError('CRM_INVALID_RELATION');

        const lead = await tx.crmLead.create({
          data: {
            customerId: input.customerId,
            pipelineId: input.pipelineId,
            currentStageId: input.currentStageId,
            source: input.source,
            sourceReference,
            title,
            ownerId: input.ownerId ?? null,
          },
        });
        await tx.crmLeadStageHistory.create({
          data: {
            leadId: lead.id,
            version: 0,
            idempotencyKey: `CREATE:${input.source}:${sourceReference}`.slice(0, 300),
            fromStageId: null,
            toStageId: input.currentStageId,
            fromStatus: null,
            toStatus: CrmLeadStatus.NEW,
            actorId,
            reasonCode: 'LEAD_CREATED',
            sanitizedMetadata: Prisma.JsonNull,
          },
        });
        return { state: 'CREATED' as const, lead };
      });
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const raced = await this.prisma.crmLead.findUnique({
        where: { source_sourceReference: { source: input.source, sourceReference } },
      });
      if (!raced) throw error;
      return this.leadCreateReplay(raced, input, title);
    }
  }

  async transitionLead(leadId: string, input: TransitionCrmLeadDto, actorId: string) {
    const metadata = sanitizeTimelineMetadata(input.metadata) as Prisma.InputJsonValue | undefined;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await tx.crmLeadStageHistory.findUnique({
          where: { leadId_idempotencyKey: { leadId, idempotencyKey: input.idempotencyKey } },
        });
        if (replay) return this.leadTransitionReplay(tx, replay, input, actorId, metadata);

        const current = await tx.crmLead.findUnique({ where: { id: leadId } });
        if (!current) throw new CrmPersistenceError('CRM_NOT_FOUND');
        if (current.version !== input.expectedVersion) throw new CrmPersistenceError('STALE_CRM_VERSION');
        const stage = await tx.crmPipelineStage.findUnique({ where: { id: input.toStageId } });
        if (!stage || stage.pipelineId !== current.pipelineId) throw new CrmPersistenceError('CRM_INVALID_RELATION');
        this.assertLeadTransition(current.status, stage.outcome, input.toStatus);

        const now = new Date();
        const changed = await tx.crmLead.updateMany({
          where: { id: leadId, version: input.expectedVersion },
          data: {
            currentStageId: input.toStageId,
            status: input.toStatus,
            version: { increment: 1 },
            qualifiedAt: input.toStatus === CrmLeadStatus.QUALIFIED ? now : undefined,
            wonAt: input.toStatus === CrmLeadStatus.WON ? now : undefined,
            lostAt: input.toStatus === CrmLeadStatus.LOST ? now : undefined,
            archivedAt: input.toStatus === CrmLeadStatus.ARCHIVED ? now : undefined,
          },
        });
        if (changed.count !== 1) throw new CrmPersistenceError('STALE_CRM_VERSION');
        await tx.crmLeadStageHistory.create({
          data: {
            leadId,
            version: input.expectedVersion + 1,
            idempotencyKey: input.idempotencyKey,
            fromStageId: current.currentStageId,
            toStageId: input.toStageId,
            fromStatus: current.status,
            toStatus: input.toStatus,
            actorId,
            reasonCode: input.reasonCode,
            sanitizedMetadata: metadata ?? Prisma.JsonNull,
          },
        });
        const lead = await tx.crmLead.findUniqueOrThrow({ where: { id: leadId } });
        return { state: 'UPDATED' as const, lead };
      });
    } catch (error) {
      if (!isUniqueConflict(error) && !(error instanceof CrmPersistenceError && error.code === 'STALE_CRM_VERSION')) {
        throw error;
      }
      const replay = await this.prisma.crmLeadStageHistory.findUnique({
        where: { leadId_idempotencyKey: { leadId, idempotencyKey: input.idempotencyKey } },
      });
      if (!replay) throw error;
      return this.leadTransitionReplay(this.prisma, replay, input, actorId, metadata);
    }
  }

  async listTasks(input: ListCrmTasksDto) {
    const where: Prisma.CrmTaskWhereInput = {
      customerId: input.customerId,
      leadId: input.leadId,
      assignedToId: input.assignedToId,
      type: input.type,
      status: input.status,
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.crmTask.findMany({
        where,
        include: {
          customer: { select: { id: true, displayName: true } },
          lead: { select: { id: true, title: true, status: true } },
          assignedTo: { select: { id: true, fullName: true, isActive: true } },
        },
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      this.prisma.crmTask.count({ where }),
    ]);
    return page(rows, total, input);
  }

  async createTask(input: CreateCrmTaskDto) {
    const source = input.source.trim();
    const sourceReference = input.sourceReference.trim();
    const normalized = {
      title: sanitizeTimelineText(input.title.trim()).slice(0, 160),
      description: input.description ? sanitizeTimelineText(input.description.trim()).slice(0, 1_000) : null,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
    };
    const existing = await this.prisma.crmTask.findUnique({
      where: { source_sourceReference: { source, sourceReference } },
    });
    if (existing) return this.taskCreateReplay(existing, input, normalized);
    try {
      const task = await this.prisma.$transaction(async (tx) => {
        await this.assertCustomerBindings(tx, input.customerId, input.leadId, input.customerServiceCaseId);
        return tx.crmTask.create({
          data: {
            customerId: input.customerId,
            leadId: input.leadId ?? null,
            customerServiceCaseId: input.customerServiceCaseId ?? null,
            source,
            sourceReference,
            type: input.type,
            priority: input.priority,
            title: normalized.title,
            sanitizedDescription: normalized.description,
            assignedToId: input.assignedToId ?? null,
            dueAt: normalized.dueAt,
          },
        });
      });
      return { state: 'CREATED' as const, task };
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const raced = await this.prisma.crmTask.findUnique({
        where: { source_sourceReference: { source, sourceReference } },
      });
      if (!raced) throw error;
      return this.taskCreateReplay(raced, input, normalized);
    }
  }

  async updateTask(taskId: string, input: UpdateCrmTaskDto) {
    const current = await this.prisma.crmTask.findUnique({ where: { id: taskId } });
    if (!current) throw new CrmPersistenceError('CRM_NOT_FOUND');
    if (current.version === input.expectedVersion + 1 && current.status === input.status
      && current.assignedToId === (input.assignedToId ?? current.assignedToId)) {
      return { state: 'DETERMINISTIC_REPLAY' as const, task: current };
    }
    if (current.version !== input.expectedVersion) throw new CrmPersistenceError('STALE_CRM_VERSION');
    if (current.status === CrmTaskStatus.COMPLETED || current.status === CrmTaskStatus.CANCELLED) {
      throw new CrmPersistenceError('CRM_CONFLICT');
    }
    const now = new Date();
    const changed = await this.prisma.crmTask.updateMany({
      where: { id: taskId, version: input.expectedVersion },
      data: {
        status: input.status,
        assignedToId: input.assignedToId,
        version: { increment: 1 },
        completedAt: input.status === CrmTaskStatus.COMPLETED ? now : undefined,
        cancelledAt: input.status === CrmTaskStatus.CANCELLED ? now : undefined,
      },
    });
    if (changed.count !== 1) throw new CrmPersistenceError('STALE_CRM_VERSION');
    return { state: 'UPDATED' as const, task: await this.prisma.crmTask.findUniqueOrThrow({ where: { id: taskId } }) };
  }

  async listNotes(input: ListCrmNotesDto) {
    const where: Prisma.CrmNoteWhereInput = { customerId: input.customerId, leadId: input.leadId };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.crmNote.findMany({
        where,
        include: { author: { select: { id: true, fullName: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      this.prisma.crmNote.count({ where }),
    ]);
    return page(rows, total, input);
  }

  async createNote(input: CreateCrmNoteDto, actorId: string) {
    const body = sanitizeTimelineText(input.body.trim()).slice(0, 2_000);
    const contentHash = createHash('sha256').update(body, 'utf8').digest('hex');
    const source = input.source.trim();
    const sourceReference = input.sourceReference.trim();
    const existing = await this.prisma.crmNote.findUnique({
      where: { source_sourceReference: { source, sourceReference } },
    });
    if (existing) {
      if (existing.customerId !== input.customerId || existing.leadId !== (input.leadId ?? null)
        || existing.customerServiceCaseId !== (input.customerServiceCaseId ?? null) || existing.contentHash !== contentHash) {
        throw new CrmPersistenceError('CRM_IDEMPOTENCY_CONFLICT');
      }
      return { state: 'DETERMINISTIC_REPLAY' as const, note: existing };
    }
    try {
      const note = await this.prisma.$transaction(async (tx) => {
        await this.assertCustomerBindings(tx, input.customerId, input.leadId, input.customerServiceCaseId);
        return tx.crmNote.create({
          data: {
            customerId: input.customerId,
            leadId: input.leadId ?? null,
            customerServiceCaseId: input.customerServiceCaseId ?? null,
            source,
            sourceReference,
            body,
            contentHash,
            authorId: actorId,
          },
        });
      });
      return { state: 'CREATED' as const, note };
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      throw new CrmPersistenceError('CRM_CONFLICT');
    }
  }

  listTags(input: { page: number; limit: number }) {
    return this.prisma.$transaction([
      this.prisma.customerTag.findMany({
        include: { _count: { select: { assignments: true } } },
        orderBy: { nameNormalized: 'asc' },
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      this.prisma.customerTag.count(),
    ]).then(([rows, total]) => page(rows, total, input));
  }

  async createTag(nameInput: string) {
    const name = sanitizeTimelineText(nameInput.trim()).slice(0, 64);
    const nameNormalized = normalizeSearchText(name);
    const existing = await this.prisma.customerTag.findUnique({ where: { nameNormalized } });
    if (existing) return { state: 'DETERMINISTIC_REPLAY' as const, tag: existing };
    try {
      return { state: 'CREATED' as const, tag: await this.prisma.customerTag.create({ data: { name, nameNormalized } }) };
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const raced = await this.prisma.customerTag.findUnique({ where: { nameNormalized } });
      if (!raced) throw error;
      return { state: 'DETERMINISTIC_REPLAY' as const, tag: raced };
    }
  }

  async assignTag(customerId: string, tagId: string, actorId: string) {
    await this.prisma.$transaction(async (tx) => {
      const [customer, tag] = await Promise.all([
        tx.customer.findUnique({ where: { id: customerId }, select: { id: true } }),
        tx.customerTag.findUnique({ where: { id: tagId }, select: { id: true } }),
      ]);
      if (!customer || !tag) throw new CrmPersistenceError('CRM_INVALID_RELATION');
      await tx.customerTagAssignment.upsert({
        where: { customerId_tagId: { customerId, tagId } },
        create: { customerId, tagId, assignedById: actorId },
        update: {},
      });
    });
    return this.prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: {
        id: true,
        tagAssignments: { include: { tag: true }, orderBy: { assignedAt: 'asc' } },
      },
    });
  }

  listSegments(input: { page: number; limit: number }) {
    return this.prisma.$transaction([
      this.prisma.customerSegment.findMany({
        include: { _count: { select: { memberships: true, campaigns: true } } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      this.prisma.customerSegment.count(),
    ]).then(([rows, total]) => page(rows, total, input));
  }

  async unifiedTimeline(customerId: string, input: ListTimelineDto) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!customer) throw new CrmPersistenceError('CRM_NOT_FOUND');
    const take = Math.min(input.page * input.limit, 500);
    const [interactions, conversations, checkouts, cases, leads, tasks, notes, deliveryEvents] = await Promise.all([
      this.prisma.customerInteraction.findMany({ where: { customerId }, orderBy: { occurredAt: 'desc' }, take }),
      this.prisma.whatsappConversation.findMany({
        where: { customerId },
        select: { id: true, status: true, humanStatus: true, lastMessageAt: true, createdAt: true },
        orderBy: { lastMessageAt: 'desc' }, take,
      }),
      this.prisma.orderCheckout.findMany({
        where: { customerId },
        select: {
          id: true, status: true, fulfillment: true, paymentPreference: true, total: true, currency: true,
          createdAt: true, updatedAt: true,
          paymentIntents: { select: { id: true, status: true, provider: true, amount: true, currency: true, updatedAt: true }, take: 20, orderBy: { updatedAt: 'desc' } },
        },
        orderBy: { createdAt: 'desc' }, take,
      }),
      this.prisma.customerServiceCase.findMany({
        where: { customerId },
        select: { id: true, category: true, status: true, sanitizedSummary: true, createdAt: true, updatedAt: true },
        orderBy: { createdAt: 'desc' }, take,
      }),
      this.prisma.crmLead.findMany({
        where: { customerId },
        select: { id: true, title: true, status: true, currentStage: { select: { name: true } }, createdAt: true, updatedAt: true },
        orderBy: { createdAt: 'desc' }, take,
      }),
      this.prisma.crmTask.findMany({
        where: { customerId },
        select: { id: true, type: true, title: true, status: true, priority: true, dueAt: true, createdAt: true, updatedAt: true },
        orderBy: { createdAt: 'desc' }, take,
      }),
      this.prisma.crmNote.findMany({
        where: { customerId }, select: { id: true, body: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take,
      }),
      this.prisma.deliveryWorkflowEvent.findMany({
        where: { orderTicket: { orderCheckout: { customerId } } },
        select: { id: true, orderTicketId: true, fromStatus: true, toStatus: true, reasonCode: true, createdAt: true },
        orderBy: { createdAt: 'desc' }, take,
      }),
    ]);

    const events = [
      ...interactions.map((item) => ({ id: item.id, type: 'INTERACTION', occurredAt: item.occurredAt, facts: {
        kind: item.kind, channel: item.channel, direction: item.direction, summary: sanitizeTimelineText(item.summary),
        metadata: sanitizeTimelineMetadata(item.metadata), actorId: item.actorId,
      } })),
      ...conversations.map((item) => ({ id: item.id, type: 'CONVERSATION', occurredAt: item.lastMessageAt ?? item.createdAt, facts: {
        status: item.status, handoffState: item.humanStatus,
      } })),
      ...checkouts.flatMap((item) => [
        { id: item.id, type: 'ORDER_CHECKOUT', occurredAt: item.createdAt, facts: {
          status: item.status, fulfillment: item.fulfillment, paymentPreference: item.paymentPreference,
          total: item.total.toString(), currency: item.currency,
        } },
        ...item.paymentIntents.map((payment) => ({ id: payment.id, type: 'PAYMENT_INTENT', occurredAt: payment.updatedAt, facts: {
          status: payment.status, provider: payment.provider, amount: payment.amount.toString(), currency: payment.currency,
        } })),
      ]),
      ...cases.map((item) => ({ id: item.id, type: 'SERVICE_CASE', occurredAt: item.createdAt, facts: {
        category: item.category, status: item.status, summary: sanitizeTimelineText(item.sanitizedSummary),
      } })),
      ...leads.map((item) => ({ id: item.id, type: 'CRM_LEAD', occurredAt: item.createdAt, facts: {
        title: sanitizeTimelineText(item.title), status: item.status, stage: item.currentStage.name,
      } })),
      ...tasks.map((item) => ({ id: item.id, type: 'CRM_TASK', occurredAt: item.createdAt, facts: {
        type: item.type, title: sanitizeTimelineText(item.title), status: item.status, priority: item.priority, dueAt: item.dueAt,
      } })),
      ...notes.map((item) => ({ id: item.id, type: 'CRM_NOTE', occurredAt: item.createdAt, facts: { body: sanitizeTimelineText(item.body) } })),
      ...deliveryEvents.map((item) => ({ id: item.id, type: 'DELIVERY_EVENT', occurredAt: item.createdAt, facts: {
        orderTicketId: item.orderTicketId, fromStatus: item.fromStatus, toStatus: item.toStatus, reasonCode: item.reasonCode,
      } })),
    ].sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime() || right.id.localeCompare(left.id));
    const offset = (input.page - 1) * input.limit;
    return {
      ...page(events.slice(offset, offset + input.limit), events.length, input),
      readModel: {
        boundedPerSource: take,
        potentiallyTruncated: [interactions, conversations, checkouts, cases, leads, tasks, notes, deliveryEvents]
          .some((source) => source.length === take),
      },
    };
  }

  private leadCreateReplay(row: {
    customerId: string; pipelineId: string; currentStageId: string; sourceReference: string;
    title: string; ownerId: string | null;
  }, input: CreateCrmLeadDto, title: string) {
    if (row.customerId !== input.customerId || row.pipelineId !== input.pipelineId
      || row.currentStageId !== input.currentStageId || row.sourceReference !== input.sourceReference.trim()
      || row.title !== title || row.ownerId !== (input.ownerId ?? null)) {
      throw new CrmPersistenceError('CRM_IDEMPOTENCY_CONFLICT');
    }
    return { state: 'DETERMINISTIC_REPLAY' as const, lead: row };
  }

  private taskCreateReplay(row: {
    customerId: string; leadId: string | null; customerServiceCaseId: string | null; type: string;
    priority: string; title: string; sanitizedDescription: string | null; assignedToId: string | null; dueAt: Date | null;
  }, input: CreateCrmTaskDto, normalized: { title: string; description: string | null; dueAt: Date | null }) {
    if (row.customerId !== input.customerId || row.leadId !== (input.leadId ?? null)
      || row.customerServiceCaseId !== (input.customerServiceCaseId ?? null) || row.type !== input.type
      || row.priority !== input.priority || row.title !== normalized.title || row.sanitizedDescription !== normalized.description
      || row.assignedToId !== (input.assignedToId ?? null) || row.dueAt?.getTime() !== normalized.dueAt?.getTime()) {
      throw new CrmPersistenceError('CRM_IDEMPOTENCY_CONFLICT');
    }
    return { state: 'DETERMINISTIC_REPLAY' as const, task: row };
  }

  private async assertCustomerBindings(
    client: Pick<Prisma.TransactionClient, 'customer' | 'crmLead' | 'customerServiceCase'>,
    customerId: string,
    leadId?: string,
    customerServiceCaseId?: string,
  ) {
    const [customer, lead, serviceCase] = await Promise.all([
      client.customer.findUnique({ where: { id: customerId }, select: { id: true } }),
      leadId ? client.crmLead.findUnique({ where: { id: leadId }, select: { customerId: true } }) : null,
      customerServiceCaseId
        ? client.customerServiceCase.findUnique({ where: { id: customerServiceCaseId }, select: { customerId: true } })
        : null,
    ]);
    if (!customer || (leadId && lead?.customerId !== customerId)
      || (customerServiceCaseId && serviceCase?.customerId !== customerId)) {
      throw new CrmPersistenceError('CRM_INVALID_RELATION');
    }
  }

  private assertLeadTransition(fromStatus: CrmLeadStatus, outcome: CrmPipelineStageOutcome, toStatus: CrmLeadStatus) {
    if (fromStatus === CrmLeadStatus.WON || fromStatus === CrmLeadStatus.LOST || fromStatus === CrmLeadStatus.ARCHIVED) {
      throw new CrmPersistenceError('CRM_CONFLICT');
    }
    if ((outcome === CrmPipelineStageOutcome.WON) !== (toStatus === CrmLeadStatus.WON)
      || (outcome === CrmPipelineStageOutcome.LOST) !== (toStatus === CrmLeadStatus.LOST)
      || (outcome === CrmPipelineStageOutcome.OPEN
        && (toStatus === CrmLeadStatus.WON || toStatus === CrmLeadStatus.LOST))) {
      throw new CrmPersistenceError('CRM_INVALID_RELATION');
    }
  }

  private async leadTransitionReplay(
    client: Pick<Prisma.TransactionClient, 'crmLead'>,
    event: { leadId: string; toStageId: string; toStatus: CrmLeadStatus; actorId: string | null; reasonCode: string; sanitizedMetadata: Prisma.JsonValue | null },
    input: TransitionCrmLeadDto,
    actorId: string,
    metadata: Prisma.InputJsonValue | undefined,
  ) {
    if (event.toStageId !== input.toStageId || event.toStatus !== input.toStatus || event.actorId !== actorId
      || event.reasonCode !== input.reasonCode || !sameJson(event.sanitizedMetadata, metadata)) {
      throw new CrmPersistenceError('CRM_IDEMPOTENCY_CONFLICT');
    }
    const lead = await client.crmLead.findUnique({ where: { id: event.leadId } });
    if (!lead) throw new CrmPersistenceError('CRM_NOT_FOUND');
    return { state: 'DETERMINISTIC_REPLAY' as const, lead };
  }
}
