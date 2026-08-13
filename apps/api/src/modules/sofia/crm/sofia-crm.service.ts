import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
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

  async resolveOrCreateByPhone(dto: ResolveCustomerByPhoneDto, actorId: string) {
    const phone = normalizePhone(dto.phone);
    if (!phone) throw new BadRequestException('El telefono no es valido para Colombia.');
    const valueHash = this.identityHash(phone);

    const existing = await this.prisma.customerIdentity.findUnique({
      where: { type_valueHash: { type: CustomerIdentityType.PHONE, valueHash } },
      include: { customer: { include: customerSummaryInclude } },
    });

    if (existing) {
      const displayName = dto.displayName?.trim();
      const shouldUpdateName = Boolean(displayName && displayName !== existing.customer.displayName);
      const customer = shouldUpdateName
        ? await this.prisma.customer.update({
            where: { id: existing.customerId },
            data: { displayName, displayNameNormalized: normalizeSearchText(displayName) },
            include: customerSummaryInclude,
          })
        : existing.customer;
      if (shouldUpdateName) {
        await this.auditService.log({
          actorId,
          action: 'CRM_CUSTOMER_PROFILE_UPDATED',
          module: 'sofia.crm',
          entity: 'Customer',
          entityId: customer.id,
          after: { displayNameUpdated: true },
        });
      }
      return this.serializeCustomerSummary(customer);
    }

    const displayName = dto.displayName?.trim() || null;
    let customer;
    try {
      customer = await this.prisma.customer.create({
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
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const racedIdentity = await this.prisma.customerIdentity.findUnique({
          where: { type_valueHash: { type: CustomerIdentityType.PHONE, valueHash } },
          include: { customer: { include: customerSummaryInclude } },
        });
        if (racedIdentity) return this.serializeCustomerSummary(racedIdentity.customer);
      }
      throw error;
    }

    await this.auditService.log({
      actorId,
      action: 'CRM_CUSTOMER_CREATED',
      module: 'sofia.crm',
      entity: 'Customer',
      entityId: customer.id,
      after: { identityType: 'PHONE', identityMasked: maskPhone(phone) },
    });

    return this.serializeCustomerSummary(customer);
  }

  async listCustomers(dto: ListCustomersDto, options: { allowPhoneSearch?: boolean } = {}) {
    const query = normalizeSearchText(dto.q);
    const containsPhone = /\d(?:[\s()+-]*\d){6}/.test(dto.q ?? '');
    if (containsPhone && !options.allowPhoneSearch) {
      throw new BadRequestException('La búsqueda por teléfono requiere el endpoint seguro POST.');
    }
    const phone = options.allowPhoneSearch ? normalizePhone(dto.q) : null;
    const valueHash = phone ? this.identityHash(phone) : null;
    const where: Prisma.CustomerWhereInput = query
      ? {
          OR: [
            { displayNameNormalized: { contains: query, mode: 'insensitive' } },
            ...(phone
              ? [
                  {
                    identities: {
                      some: { type: CustomerIdentityType.PHONE, valueHash: valueHash! },
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

  async grantOptIn(customerId: string, dto: CustomerConsentDto, actorId: string) {
    await this.assertCustomer(customerId);
    const previous = await this.latestConsent(customerId, dto);
    const now = new Date();
    const consent = await this.prisma.customerConsent.create({
      data: {
        customerId,
        purpose: dto.purpose,
        channel: dto.channel,
        status: CustomerConsentStatus.GRANTED,
        source: dto.source.trim(),
        evidenceHash: this.hashEvidence(dto.evidence),
        version: (previous?.version ?? 0) + 1,
        grantedAt: now,
      },
    });

    await this.auditConsent('CRM_CONSENT_GRANTED', consent, actorId);
    return consent;
  }

  async revokeOptIn(customerId: string, dto: CustomerConsentDto, actorId: string) {
    await this.assertCustomer(customerId);
    const previous = await this.latestConsent(customerId, dto);
    if (!previous || previous.status !== CustomerConsentStatus.GRANTED) {
      throw new BadRequestException('No existe un opt-in vigente para revocar.');
    }

    const consent = await this.prisma.customerConsent.create({
      data: {
        customerId,
        purpose: dto.purpose,
        channel: dto.channel,
        status: CustomerConsentStatus.REVOKED,
        source: dto.source.trim(),
        evidenceHash: this.hashEvidence(dto.evidence),
        version: previous.version + 1,
        grantedAt: previous.grantedAt,
        revokedAt: new Date(),
      },
    });

    await this.auditConsent('CRM_CONSENT_REVOKED', consent, actorId);
    return consent;
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

  async recordInteraction(customerId: string, dto: CreateCustomerInteractionDto, actorId: string) {
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

  async createSegment(dto: CreateCustomerSegmentDto, actorId: string) {
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

  async createDraftCampaign(dto: CreateCustomerCampaignDto, actorId: string) {
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

  async attemptCampaignSend(campaignId: string, actorId: string) {
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

  async createPipeline(dto: CreateCrmPipelineDto, actorId: string) {
    try {
      return await this.phase8Repository.createPipeline(dto, actorId);
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

  async createLead(dto: CreateCrmLeadDto, actorId: string) {
    try {
      return await this.phase8Repository.createLead(dto, actorId);
    } catch (error) {
      return this.mapPersistenceError(error);
    }
  }

  async transitionLead(leadId: string, dto: TransitionCrmLeadDto, actorId: string) {
    try {
      return await this.phase8Repository.transitionLead(leadId, dto, actorId);
    } catch (error) {
      return this.mapPersistenceError(error);
    }
  }

  listTasks(dto: ListCrmTasksDto) {
    return this.phase8Repository.listTasks(dto);
  }

  async createTask(dto: CreateCrmTaskDto, actorId: string) {
    try {
      return await this.phase8Repository.createTask(dto, actorId);
    } catch (error) {
      return this.mapPersistenceError(error);
    }
  }

  async updateTask(taskId: string, dto: UpdateCrmTaskDto, actorId: string) {
    try {
      return await this.phase8Repository.updateTask(taskId, dto, actorId);
    } catch (error) {
      return this.mapPersistenceError(error);
    }
  }

  listNotes(dto: ListCrmNotesDto) {
    return this.phase8Repository.listNotes(dto);
  }

  async createNote(dto: CreateCrmNoteDto, actorId: string) {
    try {
      return await this.phase8Repository.createNote(dto, actorId);
    } catch (error) {
      return this.mapPersistenceError(error);
    }
  }

  listTags(dto: ListTimelineDto) {
    return this.phase8Repository.listTags(dto);
  }

  async createTag(dto: CreateCustomerTagDto, actorId: string) {
    try {
      return await this.phase8Repository.createTag(dto.name, actorId);
    } catch (error) {
      return this.mapPersistenceError(error);
    }
  }

  async assignTag(customerId: string, tagId: string, actorId: string) {
    try {
      const result = await this.phase8Repository.assignTag(customerId, tagId, actorId);
      return result.customer;
    } catch (error) {
      return this.mapPersistenceError(error);
    }
  }

  listSegments(dto: ListTimelineDto) {
    return this.phase8Repository.listSegments(dto);
  }

  async listUnifiedTimeline(customerId: string, dto: ListTimelineDto) {
    try {
      return await this.phase8Repository.unifiedTimeline(customerId, dto);
    } catch (error) {
      return this.mapPersistenceError(error);
    }
  }

  private async assertCustomer(customerId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
    if (!customer) throw new NotFoundException('Cliente CRM no encontrado.');
  }

  private mapPersistenceError(error: unknown): never {
    if (!(error instanceof CrmPersistenceError)) throw error;
    if (error.code === 'CRM_NOT_FOUND') throw new NotFoundException('Recurso CRM no encontrado.');
    if (error.code === 'STALE_CRM_VERSION') throw new ConflictException('STALE_CRM_VERSION');
    if (error.code === 'CRM_INVALID_RELATION') throw new BadRequestException('Relacion o transicion CRM invalida.');
    throw new ConflictException(error.code);
  }

  private latestConsent(customerId: string, dto: CustomerConsentDto) {
    return this.prisma.customerConsent.findFirst({
      where: { customerId, purpose: dto.purpose, channel: dto.channel },
      orderBy: { version: 'desc' },
    });
  }

  private hashEvidence(evidence: string) {
    return createHash('sha256').update(evidence, 'utf8').digest('hex');
  }

  private identityHash(normalizedPhone: string) {
    const configuredSecret = this.configService.get<string>('CRM_IDENTITY_HASH_SECRET')?.trim();
    const secret =
      configuredSecret ||
      (process.env.NODE_ENV === 'test' ? 'crm-test-only-identity-hash-secret' : undefined);
    if (!secret || secret.length < 32) {
      throw new ServiceUnavailableException('CRM identity hashing is not configured.');
    }
    return createHmac('sha256', secret).update(`PHONE:${normalizedPhone}`, 'utf8').digest('hex');
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
    });
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
