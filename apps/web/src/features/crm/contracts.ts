import { z } from 'zod';

export const crmLeadStatusSchema = z.enum(['NEW', 'QUALIFIED', 'ACTIVE', 'WON', 'LOST', 'ARCHIVED']);
export const crmTaskStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
export const crmTaskTypeSchema = z.enum(['TASK', 'FOLLOW_UP']);
export const crmTaskPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
export const crmPipelineStatusSchema = z.enum(['ACTIVE', 'ARCHIVED']);
export const crmStageOutcomeSchema = z.enum(['OPEN', 'WON', 'LOST']);

const paginationSchema = z.object({
  page: z.number().int().positive(),
  limit: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  pages: z.number().int().nonnegative(),
});

const nullableUserSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  isActive: z.boolean().optional(),
}).nullable();

export const crmPipelineStageSchema = z.object({
  id: z.string(),
  pipelineId: z.string(),
  name: z.string(),
  nameNormalized: z.string().optional(),
  position: z.number().int(),
  outcome: crmStageOutcomeSchema,
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const crmPipelineSchema = z.object({
  id: z.string(),
  name: z.string(),
  nameNormalized: z.string().optional(),
  description: z.string().nullable(),
  status: crmPipelineStatusSchema,
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  stages: z.array(crmPipelineStageSchema),
  _count: z.object({ leads: z.number().int().nonnegative() }),
});

export const crmLeadSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  pipelineId: z.string(),
  currentStageId: z.string(),
  source: z.enum(['WHATSAPP', 'POS', 'DELIVERY', 'CUSTOMER_SERVICE', 'AUTHORIZED_OPERATOR']),
  sourceReference: z.string(),
  title: z.string(),
  status: crmLeadStatusSchema,
  ownerId: z.string().nullable(),
  version: z.number().int().nonnegative(),
  qualifiedAt: z.string().nullable().optional(),
  wonAt: z.string().nullable().optional(),
  lostAt: z.string().nullable().optional(),
  archivedAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  customer: z.object({ id: z.string(), displayName: z.string().nullable(), status: z.string() }),
  pipeline: z.object({ id: z.string(), name: z.string(), status: crmPipelineStatusSchema }),
  currentStage: z.object({ id: z.string(), name: z.string(), position: z.number().int(), outcome: crmStageOutcomeSchema }),
  owner: nullableUserSchema,
});

export const crmTaskSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  leadId: z.string().nullable(),
  customerServiceCaseId: z.string().nullable(),
  source: z.string(),
  sourceReference: z.string(),
  type: crmTaskTypeSchema,
  status: crmTaskStatusSchema,
  priority: crmTaskPrioritySchema,
  title: z.string(),
  sanitizedDescription: z.string().nullable(),
  assignedToId: z.string().nullable(),
  dueAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  version: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
  customer: z.object({ id: z.string(), displayName: z.string().nullable() }),
  lead: z.object({ id: z.string(), title: z.string(), status: crmLeadStatusSchema }).nullable(),
  assignedTo: nullableUserSchema,
});

export const crmNoteSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  leadId: z.string().nullable(),
  customerServiceCaseId: z.string().nullable(),
  source: z.string(),
  sourceReference: z.string(),
  body: z.string(),
  contentHash: z.string(),
  authorId: z.string().nullable(),
  createdAt: z.string(),
  author: z.object({ id: z.string(), fullName: z.string() }).nullable(),
});

export const crmTagSchema = z.object({
  id: z.string(),
  name: z.string(),
  nameNormalized: z.string().optional(),
  createdAt: z.string(),
  _count: z.object({ assignments: z.number().int().nonnegative() }),
});

export const crmSegmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  _count: z.object({ memberships: z.number().int().nonnegative(), campaigns: z.number().int().nonnegative() }),
});

export const crmTimelineEventSchema = z.object({
  id: z.string(),
  type: z.enum([
    'INTERACTION',
    'CONVERSATION',
    'ORDER_CHECKOUT',
    'PAYMENT_INTENT',
    'SERVICE_CASE',
    'CRM_LEAD',
    'CRM_TASK',
    'CRM_NOTE',
    'DELIVERY_EVENT',
  ]),
  occurredAt: z.string(),
  facts: z.record(z.unknown()),
});

function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({ data: z.array(item), pagination: paginationSchema });
}

export const crmPipelinesResponseSchema = paginated(crmPipelineSchema);
export const crmLeadsResponseSchema = paginated(crmLeadSchema);
export const crmTasksResponseSchema = paginated(crmTaskSchema);
export const crmNotesResponseSchema = paginated(crmNoteSchema);
export const crmTagsResponseSchema = paginated(crmTagSchema);
export const crmSegmentsResponseSchema = paginated(crmSegmentSchema);
export const crmTimelineResponseSchema = paginated(crmTimelineEventSchema).extend({
  readModel: z.object({ boundedPerSource: z.number().int(), potentiallyTruncated: z.boolean() }),
});

export const crmLeadTransitionResponseSchema = z.object({
  state: z.enum(['UPDATED', 'DETERMINISTIC_REPLAY']),
  lead: z.object({
    id: z.string(),
    currentStageId: z.string(),
    status: crmLeadStatusSchema,
    version: z.number().int(),
  }).passthrough(),
});

export const crmTaskUpdateResponseSchema = z.object({
  state: z.enum(['UPDATED', 'DETERMINISTIC_REPLAY']),
  task: crmTaskSchema.omit({ customer: true, lead: true, assignedTo: true }).passthrough(),
});

export type CrmPipeline = z.infer<typeof crmPipelineSchema>;
export type CrmLead = z.infer<typeof crmLeadSchema>;
export type CrmLeadStatus = z.infer<typeof crmLeadStatusSchema>;
export type CrmTask = z.infer<typeof crmTaskSchema>;
export type CrmTaskStatus = z.infer<typeof crmTaskStatusSchema>;
export type CrmTaskType = z.infer<typeof crmTaskTypeSchema>;
export type CrmTimelineEvent = z.infer<typeof crmTimelineEventSchema>;
