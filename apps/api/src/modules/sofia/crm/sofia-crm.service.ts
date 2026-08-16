import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CustomerCampaignDeliveryStatus,
  CustomerCampaignStatus,
  CustomerConsentChannel,
  CustomerConsentStatus,
  CustomerIdentityType,
  Prisma,
} from '@prisma/client';
import { createHash, createHmac } from 'node:crypto';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { normalizePhone, normalizeSearchText } from '../../../common/normalization/customer-normalization';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  CreateCustomerCampaignDto,
  CreateCustomerInteractionDto,
  CreateCustomerSegmentDto,
  CreateCrmLeadDto,
  CreateCrmNoteDto,
  CreateCrmPipelineDto,
  CreateCrmTaskDto,
  CreateCustomerTagDto,
  CustomerConsentDto,
  ListCrmCampaignsDto,
  ListCrmLeadsDto,
  ListCrmNotesDto,
  ListCrmPipelinesDto,
  ListCrmTasksDto,
  ListCustomersDto,
  ListTimelineDto,
  ResolveCustomerByPhoneDto,
  TransitionCrmLeadDto,
  UpdateCrmTaskDto,
} from './dto/crm.dto';
import { maskPhone, sanitizeTimelineMetadata, sanitizeTimelineText } from './crm-privacy';
import { CrmPersistenceError, Phase8CrmRepository } from './phase8-crm.repository';
import { resolveCrmHashSecrets } from './crm-hash-secrets';
import { TrustedCrmCustomerResolutionCapability } from './crm-customer-resolution.capability';
import { acquireCrmHashWriteFence } from './crm-advisory-lock';

export const CAMPAIGN_SEND_BLOCK_REASON = 'BAILEYS_PROACTIVE_OUTREACH_DISABLED';

const customerSummaryInclude = {
  identities: {
    select: { id: true, type: true, valueMasked: true, isPrimary: true, verifiedAt: true },
    orderBy: { createdAt: 'asc' as const },
  },
  tagAssignments: {
    include: { tag: { select: { id: true, name: true } } },
    orderBy: { assignedAt: 'asc' as const },
  },
} satisfies Prisma.CustomerInclude;

@Injectable()
export class SofiaCrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
    private readonly phase8Repository: Phase8CrmRepository,
  ) {}

  async resolveOrCreateByPhone(
    dto: ResolveCustomerByPhoneDto,
    principal: AuthUser | TrustedCrmCustomerResolutionCapability,
  ) {
    const actorId = this.customerResolutionActorId(principal);
    const phone = normalizePhone(dto.phone);
    if (!phone) throw new BadRequestException('El telefono no es valido para Colombia.');
    const hashSecrets = resolveCrmHashSecrets(this.configService);
    const valueHashes = this.identityHashes(phone, hashSecrets);
    const valueHash = valueHashes[0];
    const displayName = dto.displayName?.trim() || null;
    return this.prisma.$transaction(async (tx) => {
      await acquireCrmHashWriteFence(tx, hashSecrets, 'customer-phone', [phone]);
      const identities = await tx.customerIdentity.findMany({
        where: { type: CustomerIdentityType.PHONE, valueHash: { in: [...valueHashes] } },
        include: { customer: { include: customerSummaryInclude } },
      });
      const customerIds = new Set(identities.map(({ customerId }) => customerId));
      if (customerIds.size > 1) throw new ConflictException('CRM_IDENTITY_ROTATION_CONFLICT');

      if (identities.length) {
        const matched = identities.find(({ valueHash: hash }) => hash === valueHash) ?? identities[0]!;
        await this.promotePhoneIdentity(tx, matched, valueHashes, valueHash, actorId);
        const customer = await tx.customer.findUniqueOrThrow({
          where: { id: matched.customerId },
          include: customerSummaryInclude,
        });
        const shouldUpdateName = Boolean(displayName && displayName !== customer.displayName);
        if (!shouldUpdateName) return this.serializeCustomerSummary(customer);
        const updated = await tx.customer.update({
          where: { id: customer.id },
          data: { displayName, displayNameNormalized: normalizeSearchText(displayName) },
          include: customerSummaryInclude,
        });
        await this.auditService.log({
          actorId,
          action: 'CRM_CUSTOMER_PROFILE_UPDATED',
          module: 'sofia.crm',
          entity: 'Customer',
          entityId: updated.id,
          after: { displayNameUpdated: true },
        }, tx);
        return this.serializeCustomerSummary(updated);
      }

      const customer = await tx.customer.create({
        data: {
          displayName,
          displayNameNormalized: displayName ? normalizeSearchText(displayName) : null,
          identities: {
            create: {
              type: CustomerIdentityType.PHONE,
              valueHash,
              valueMasked: maskPhone(phone),
              isPrimary: true,
            },
          },
        },
        include: customerSummaryInclude,
      });
      await this.auditService.log({
        actorId,
        action: 'CRM_CUSTOMER_CREATED',
        module: 'sofia.crm',
        entity: 'Customer',
        entityId: customer.id,
        after: { identityType: 'PHONE', identityMasked: maskPhone(phone) },
      }, tx);
      return this.serializeCustomerSummary(customer);
    });
  }

  async listCustomers(dto: ListCustomersDto, options: { allowPhoneSearch?: boolean } = {}) {
    const query = normalizeSearchText(dto.q);
    const containsPhone = /\d(?:[\s()+-]*\d){6}/.test(dto.q ?? '');
    if (containsPhone && !options.allowPhoneSearch) {
      throw new BadRequestException('La búsqueda por teléfono requiere el endpoint seguro POST.');
    }
    const phone = options.allowPhoneSearch ? normalizePhone(dto.q) : null;
    const valueHashes = phone ? this.identityHashes(phone) : [];
    const where: Prisma.CustomerWhereInput = query
      ? {
          OR: [
            { displayNameNormalized: { contains: query, mode: 'insensitive' } },
            ...(phone
              ? [
                  {
                    identities: {
                      some: { type: CustomerIdentityType.PHONE, valueHash: { in: [...valueHashes] } },
                    },
                  } satisfies Prisma.CustomerWhereInput,
                ]
              : []),
          ],
        }
      : {};

    const [customers, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        include: customerSummaryInclude,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (dto.page - 1) * dto.limit,
        take: dto.limit,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return {
      data: customers.map((customer) => this.serializeCustomerSummary(customer)),
      pagination: {
        page: dto.page,
        limit: dto.limit,
        total,
        pages: Math.ceil(total / dto.limit),
      },
    };
  }

  async getCustomer(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        ...customerSummaryInclude,
        consents: { orderBy: [{ createdAt: 'desc' }, { version: 'desc' }] },
        interactions: { orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 100 },
        segmentMemberships: {
          include: { segment: { select: { id: true, name: true, status: true } } },
          orderBy: { addedAt: 'desc' },
        },
        campaignDeliveries: {
          select: {
            id: true,
            campaignId: true,
            recipientMasked: true,
            status: true,
            blockedReason: true,
            attemptedAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });
    if (!customer) throw new NotFoundException('Cliente CRM no encontrado.');

    return {
      ...this.serializeCustomerSummary(customer),
      consents: customer.consents.map((consent) => ({
        id: consent.id,
        purpose: consent.purpose,
        channel: consent.channel,
        status: consent.status,
        source: consent.source,
        evidenceHash: consent.evidenceHash,
        version: consent.version,
        grantedAt: consent.grantedAt,
        revokedAt: consent.revokedAt,
        createdAt: consent.createdAt,
      })),
      timeline: customer.interactions.map((interaction) => this.serializeInteraction(interaction)),
      segments: customer.segmentMemberships.map(({ segment, addedAt }) => ({ ...segment, addedAt })),
      deliveries: customer.campaignDeliveries,
    };
  }

  async grantOptIn(customerId: string, dto: CustomerConsentDto, actor: AuthUser) {
    this.assertOperatorMutationAccess(actor);
    const actorId = actor.sub;
    const source = dto.source.trim();
    const evidenceHash = this.hashEvidence(dto.evidence);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertCustomer(customerId, tx);
        const previous = await this.latestConsent(customerId, dto, tx);
        if (previous?.status === CustomerConsentStatus.GRANTED) {
          if (previous.source === source && previous.evidenceHash === evidenceHash) return previous;
          throw new ConflictException('Ya existe un opt-in vigente con evidencia diferente.');
        }
        const consent = await tx.customerConsent.create({
          data: {
            customerId,
            purpose: dto.purpose,
            channel: dto.channel,
            status: CustomerConsentStatus.GRANTED,
            source,
            evidenceHash,
            version: (previous?.version ?? 0) + 1,
            grantedAt: new Date(),
          },
        });
        await this.auditConsent('CRM_CONSENT_GRANTED', consent, actorId, tx);
        return consent;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      return this.recoverConsentReplay(error, customerId, dto, actorId, CustomerConsentStatus.GRANTED, source, evidenceHash);
    }
  }

  async revokeOptIn(customerId: string, dto: CustomerConsentDto, actor: AuthUser) {
    this.assertOperatorMutationAccess(actor);
    const actorId = actor.sub;
    const source = dto.source.trim();
    const evidenceHash = this.hashEvidence(dto.evidence);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertCustomer(customerId, tx);
        const previous = await this.latestConsent(customerId, dto, tx);
        if (previous?.status === CustomerConsentStatus.REVOKED
          && previous.source === source && previous.evidenceHash === evidenceHash) return previous;
        if (!previous || previous.status !== CustomerConsentStatus.GRANTED) {
          throw new BadRequestException('No existe un opt-in vigente para revocar.');
        }
        const consent = await tx.customerConsent.create({
          data: {
            customerId,
            purpose: dto.purpose,
            channel: dto.channel,
            status: CustomerConsentStatus.REVOKED,
            source,
            evidenceHash,
            version: previous.version + 1,
            grantedAt: previous.grantedAt,
            revokedAt: new Date(),
          },
        });
        await this.auditConsent('CRM_CONSENT_REVOKED', consent, actorId, tx);
        return consent;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      return this.recoverConsentReplay(error, customerId, dto, actorId, CustomerConsentStatus.REVOKED, source, evidenceHash);
    }
  }

  async listTimeline(customerId: string, dto: ListTimelineDto) {
    await this.assertCustomer(customerId);
    const where = { customerId };
    const [interactions, total] = await this.prisma.$transaction([
      this.prisma.customerInteraction.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (dto.page - 1) * dto.limit,
        take: dto.limit,
      }),
      this.prisma.customerInteraction.count({ where }),
    ]);

    return {
      data: interactions.map((interaction) => this.serializeInteraction(interaction)),
      pagination: {
        page: dto.page,
        limit: dto.limit,
        total,
        pages: Math.ceil(total / dto.limit),
      },
    };
  }

  async recordInteraction(customerId: string, dto: CreateCustomerInteractionDto, actor: AuthUser) {
    this.assertOperatorMutationAccess(actor);
    const actorId = actor.sub;
    await this.assertCustomer(customerId);
    const interaction = await this.prisma.customerInteraction.create({
      data: {
        customerId,
        kind: dto.kind.trim(),
        channel: dto.channel,
        direction: dto.direction,
        summary: sanitizeTimelineText(dto.summary),
        metadata: sanitizeTimelineMetadata(dto.metadata) as Prisma.InputJsonValue | undefined,
        actorId,
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
      },
    });

    return this.serializeInteraction(interaction);
  }

  async createSegment(dto: CreateCustomerSegmentDto, actor: AuthUser) {
    this.assertOperatorMutationAccess(actor);
    const actorId = actor.sub;
    const customerIds = [...new Set(dto.customerIds ?? [])];
    const name = dto.name.trim();
    const segment = await this.prisma.customerSegment.create({
      data: {
        name,
        nameNormalized: normalizeSearchText(name),
        description: dto.description?.trim() || null,
        definitionJson: { type: 'STATIC', memberCount: customerIds.length },
        createdById: actorId,
        memberships: customerIds.length
          ? { create: customerIds.map((customerId) => ({ customerId })) }
          : undefined,
      },
      include: { _count: { select: { memberships: true } } },
    });

    await this.auditService.log({
      actorId,
      action: 'CRM_SEGMENT_CREATED',
      module: 'sofia.crm',
      entity: 'CustomerSegment',
      entityId: segment.id,
      after: { status: segment.status, memberCount: segment._count.memberships },
    });
    return segment;
  }

  listCampaigns(dto: ListCrmCampaignsDto) {
    return this.phase8Repository.listCampaigns(dto);
  }

  async createDraftCampaign(dto: CreateCustomerCampaignDto, actor: AuthUser) {
    this.assertOperatorMutationAccess(actor);
    const actorId = actor.sub;
    const campaign = await this.prisma.customerCampaign.create({
      data: {
        name: dto.name.trim(),
        segmentId: dto.segmentId,
        channel: CustomerConsentChannel.WHATSAPP,
        messageTemplate: dto.messageTemplate,
        status: CustomerCampaignStatus.DRAFT,
        createdById: actorId,
      },
    });

    await this.auditService.log({
      actorId,
      action: 'CRM_CAMPAIGN_DRAFT_CREATED',
      module: 'sofia.crm',
      entity: 'CustomerCampaign',
      entityId: campaign.id,
      after: { status: campaign.status, channel: campaign.channel, segmentId: campaign.segmentId },
    });
    return campaign;
  }

  async attemptCampaignSend(campaignId: string, actor: AuthUser) {
    this.assertOperatorMutationAccess(actor);
    const actorId = actor.sub;
    const campaign = await this.prisma.customerCampaign.findUnique({
      where: { id: campaignId },
      include: {
        segment: {
          include: {
            memberships: {
              include: {
                customer: {
                  include: {
                    identities: {
                      where: { type: CustomerIdentityType.PHONE },
                      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
                      take: 1,
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!campaign) throw new NotFoundException('Campana CRM no encontrada.');

    const attemptedAt = new Date();
    await this.prisma.customerCampaign.update({
      where: { id: campaign.id },
      data: { status: CustomerCampaignStatus.BLOCKED, blockedReason: CAMPAIGN_SEND_BLOCK_REASON },
    });

    const deliveries =
      campaign.segment?.memberships.flatMap(({ customer }) => {
        const identity = customer.identities[0];
        return identity
          ? [
              {
                campaignId: campaign.id,
                customerId: customer.id,
                identityId: identity.id,
                recipientMasked: identity.valueMasked,
                status: CustomerCampaignDeliveryStatus.BLOCKED,
                blockedReason: CAMPAIGN_SEND_BLOCK_REASON,
                attemptedAt,
              },
            ]
          : [];
      }) ?? [];
    if (deliveries.length) {
      await this.prisma.customerCampaignDelivery.createMany({ data: deliveries, skipDuplicates: true });
      await this.prisma.customerCampaignDelivery.updateMany({
        where: { campaignId: campaign.id },
        data: {
          status: CustomerCampaignDeliveryStatus.BLOCKED,
          blockedReason: CAMPAIGN_SEND_BLOCK_REASON,
          attemptedAt,
        },
      });
    }

    await this.auditService.log({
      actorId,
      action: 'CRM_CAMPAIGN_SEND_BLOCKED',
      module: 'sofia.crm',
      entity: 'CustomerCampaign',
      entityId: campaign.id,
      result: 'BLOCKED',
      reasonCode: CAMPAIGN_SEND_BLOCK_REASON,
      after: { status: CustomerCampaignStatus.BLOCKED, blockedDeliveries: deliveries.length },
    });

    return {
      campaignId: campaign.id,
      status: CustomerCampaignStatus.BLOCKED,
      reason: CAMPAIGN_SEND_BLOCK_REASON,
      blockedDeliveries: deliveries.length,
      sent: false,
    };
  }

  listPipelines(dto: ListCrmPipelinesDto) {
    return this.phase8Repository.listPipelines(dto);
  }

  async createPipeline(dto: CreateCrmPipelineDto, actor: AuthUser) {
    this.assertOperatorMutationAccess(actor);
    try {
      return await this.phase8Repository.createPipeline(dto, actor.sub);
    } catch (error) {
      return this.mapPersistenceError(error);
    }
  }

  listLeads(dto: ListCrmLeadsDto) {
    return this.phase8Repository.listLeads(dto);
  }

  async getLead(leadId: string) {
    try {
      return await this.phase8Repository.getLead(leadId);
    } catch (error) {
      return this.mapPersistenceError(error);
    }
  }

  async createLead(dto: CreateCrmLeadDto, actor: AuthUser) {
    this.assertOperatorMutationAccess(actor);
    try {
      return await this.phase8Repository.createLead(dto, actor.sub);
    } catch (error) {
      return this.mapPersistenceError(error);
    }
  }

  async transitionLead(leadId: string, dto: TransitionCrmLeadDto, actor: AuthUser) {
    this.assertOperatorMutationAccess(actor);
    try {
      return await this.phase8Repository.transitionLead(leadId, dto, actor.sub);
    } catch (error) {
      return this.mapPersistenceError(error);
    }
  }

  listTasks(dto: ListCrmTasksDto) {
    return this.phase8Repository.listTasks(dto);
  }

  async createTask(dto: CreateCrmTaskDto, actor: AuthUser) {
    this.assertOperatorMutationAccess(actor);
    try {
      return await this.phase8Repository.createTask(dto, actor.sub);
    } catch (error) {
      return this.mapPersistenceError(error);
    }
  }

  async updateTask(taskId: string, dto: UpdateCrmTaskDto, actor: AuthUser) {
    this.assertOperatorMutationAccess(actor);
    try {
      return await this.phase8Repository.updateTask(taskId, dto, actor.sub);
    } catch (error) {
      return this.mapPersistenceError(error);
    }
  }

  listNotes(dto: ListCrmNotesDto) {
    return this.phase8Repository.listNotes(dto);
  }

  async createNote(dto: CreateCrmNoteDto, actor: AuthUser) {
    this.assertOperatorMutationAccess(actor);
    try {
      return await this.phase8Repository.createNote(dto, actor.sub);
    } catch (error) {
      return this.mapPersistenceError(error);
    }
  }

  listTags(dto: ListTimelineDto) {
    return this.phase8Repository.listTags(dto);
  }

  async createTag(dto: CreateCustomerTagDto, actor: AuthUser) {
    this.assertOperatorMutationAccess(actor);
    try {
      return await this.phase8Repository.createTag(dto.name, actor.sub);
    } catch (error) {
      return this.mapPersistenceError(error);
    }
  }

  async assignTag(customerId: string, tagId: string, actor: AuthUser) {
    this.assertOperatorMutationAccess(actor);
    try {
      const result = await this.phase8Repository.assignTag(customerId, tagId, actor.sub);
      return result.customer;
    } catch (error) {
      return this.mapPersistenceError(error);
    }
  }

  listSegments(dto: ListTimelineDto) {
    return this.phase8Repository.listSegments(dto);
  }

  async listUnifiedTimeline(customerId: string, dto: ListTimelineDto, actor: AuthUser) {
    try {
      const hasRestrictedRole = actor.roles.some((role) => role === 'admin' || role === 'supervisor');
      return await this.phase8Repository.unifiedTimeline(customerId, dto, {
        paymentFacts: hasRestrictedRole && actor.permissions.includes('reports.read'),
        serviceCaseFacts: hasRestrictedRole && actor.permissions.includes('reports.read'),
      });
    } catch (error) {
      return this.mapPersistenceError(error);
    }
  }

  private async assertCustomer(
    customerId: string,
    client: Pick<Prisma.TransactionClient, 'customer'> = this.prisma,
  ) {
    const customer = await client.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!customer) throw new NotFoundException('Cliente CRM no encontrado.');
  }

  private customerResolutionActorId(
    principal: AuthUser | TrustedCrmCustomerResolutionCapability,
  ): string {
    if (principal instanceof TrustedCrmCustomerResolutionCapability) return principal.actorId;
    this.assertOperatorMutationAccess(principal);
    return principal.sub;
  }

  private assertOperatorMutationAccess(actor: AuthUser) {
    const hasAllowedRole = Array.isArray(actor?.roles)
      && actor.roles.some((role) => role === 'admin' || role === 'supervisor');
    const hasCapability = Array.isArray(actor?.permissions)
      && actor.permissions.includes('orders.update');
    if (!actor?.sub || !hasAllowedRole || !hasCapability) {
      throw new ForbiddenException({ code: 'CRM_PHASE8_MUTATION_FORBIDDEN' });
    }
  }

  private mapPersistenceError(error: unknown): never {
    if (!(error instanceof CrmPersistenceError)) throw error;
    if (error.code === 'CRM_NOT_FOUND') throw new NotFoundException('Recurso CRM no encontrado.');
    if (error.code === 'STALE_CRM_VERSION') throw new ConflictException('STALE_CRM_VERSION');
    if (error.code === 'CRM_INVALID_RELATION') throw new BadRequestException('Relacion o transicion CRM invalida.');
    throw new ConflictException(error.code);
  }

  private latestConsent(
    customerId: string,
    dto: CustomerConsentDto,
    client: Pick<Prisma.TransactionClient, 'customerConsent'> = this.prisma,
  ) {
    return client.customerConsent.findFirst({
      where: { customerId, purpose: dto.purpose, channel: dto.channel },
      orderBy: { version: 'desc' },
    });
  }

  private hashEvidence(evidence: string) {
    return createHash('sha256').update(evidence, 'utf8').digest('hex');
  }

  private identityHashes(
    normalizedPhone: string,
    secrets = resolveCrmHashSecrets(this.configService),
  ): readonly [string, ...string[]] {
    return secrets
      .map((secret) => createHmac('sha256', secret).update(`PHONE:${normalizedPhone}`, 'utf8').digest('hex')) as [string, ...string[]];
  }

  private async promotePhoneIdentity(
    tx: Prisma.TransactionClient,
    matched: { id: string; customerId: string; valueHash: string },
    valueHashes: readonly [string, ...string[]],
    currentHash: string,
    actorId: string,
  ): Promise<void> {
    if (matched.valueHash === currentHash) return;
    try {
      const promoted = await tx.customerIdentity.updateMany({
        where: { id: matched.id, valueHash: matched.valueHash },
        data: { valueHash: currentHash },
      });
      if (promoted.count === 1) {
        await this.auditService.log({
          actorId,
          action: 'CRM_IDENTITY_HASH_ROTATED',
          module: 'sofia.crm',
          entity: 'CustomerIdentity',
          entityId: matched.id,
          after: { hashVersion: 'CURRENT' },
        }, tx);
        return;
      }
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
    }
    const winner = await tx.customerIdentity.findUnique({
      where: { type_valueHash: { type: CustomerIdentityType.PHONE, valueHash: currentHash } },
      select: { customerId: true, valueHash: true },
    });
    if (winner?.customerId !== matched.customerId || !valueHashes.includes(winner.valueHash)) {
      throw new ConflictException('CRM_IDENTITY_ROTATION_CONFLICT');
    }
  }

  private async auditConsent(
    action: 'CRM_CONSENT_GRANTED' | 'CRM_CONSENT_REVOKED',
    consent: {
      id: string;
      customerId: string;
      purpose: string;
      channel: string;
      status: string;
      source: string;
      version: number;
    },
    actorId: string,
    client: Prisma.TransactionClient,
  ) {
    await this.auditService.log({
      actorId,
      action,
      module: 'sofia.crm',
      entity: 'CustomerConsent',
      entityId: consent.id,
      after: {
        customerId: consent.customerId,
        purpose: consent.purpose,
        channel: consent.channel,
        status: consent.status,
        source: consent.source,
        version: consent.version,
      },
    }, client);
  }

  private async recoverConsentReplay(
    error: unknown,
    customerId: string,
    dto: CustomerConsentDto,
    actorId: string,
    status: CustomerConsentStatus,
    source: string,
    evidenceHash: string,
  ) {
    const concurrencyConflict = error instanceof Prisma.PrismaClientKnownRequestError
      && (error.code === 'P2002' || error.code === 'P2034');
    if (!concurrencyConflict) throw error;
    const winner = await this.latestConsent(customerId, dto);
    if (winner?.status === status && winner.source === source && winner.evidenceHash === evidenceHash) {
      return winner;
    }
    await this.auditService.log({
      actorId,
      action: 'CRM_CONSENT_CONFLICT',
      module: 'sofia.crm',
      entity: 'CustomerConsent',
      entityId: customerId,
      result: 'REJECTED',
      reasonCode: 'CRM_CONSENT_CONCURRENCY_CONFLICT',
      after: { purpose: dto.purpose, channel: dto.channel, requestedStatus: status },
    });
    throw new ConflictException('El consentimiento cambió en otra sesión.');
  }

  private serializeCustomerSummary(customer: {
    id: string;
    displayName: string | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    identities: Array<{
      id: string;
      type: string;
      valueMasked: string;
      isPrimary: boolean;
      verifiedAt: Date | null;
    }>;
    tagAssignments: Array<{ assignedAt: Date; tag: { id: string; name: string } }>;
  }) {
    return {
      id: customer.id,
      displayName: customer.displayName,
      status: customer.status,
      identities: customer.identities.map((identity) => ({
        id: identity.id,
        type: identity.type,
        valueMasked: identity.valueMasked,
        isPrimary: identity.isPrimary,
        verifiedAt: identity.verifiedAt,
      })),
      tags: customer.tagAssignments.map(({ tag, assignedAt }) => ({ ...tag, assignedAt })),
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    };
  }

  private serializeInteraction(interaction: {
    id: string;
    kind: string;
    channel: string;
    direction: string;
    summary: string;
    metadata: unknown;
    actorId: string | null;
    occurredAt: Date;
    createdAt: Date;
  }) {
    return {
      id: interaction.id,
      kind: interaction.kind,
      channel: interaction.channel,
      direction: interaction.direction,
      summary: sanitizeTimelineText(interaction.summary),
      metadata: sanitizeTimelineMetadata(interaction.metadata),
      actorId: interaction.actorId,
      occurredAt: interaction.occurredAt,
      createdAt: interaction.createdAt,
    };
  }
}
