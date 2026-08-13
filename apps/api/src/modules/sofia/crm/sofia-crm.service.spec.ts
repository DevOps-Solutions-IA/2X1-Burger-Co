import {
  CustomerCampaignDeliveryStatus,
  CustomerCampaignStatus,
  CustomerConsentChannel,
  CustomerConsentPurpose,
  CustomerConsentStatus,
} from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { ConfigService } from '@nestjs/config';
import type { AuditService } from '../../audit/audit.service';
import type { AuthUser } from '../../../common/types/auth-user.type';
import { CAMPAIGN_SEND_BLOCK_REASON, SofiaCrmService } from './sofia-crm.service';
import type { Phase8CrmRepository } from './phase8-crm.repository';
import { TrustedCrmCustomerResolutionCapability } from './crm-customer-resolution.capability';

describe('SofiaCrmService', () => {
  const customerFindUnique = jest.fn();
  const identityFindUnique = jest.fn();
  const identityFindMany = jest.fn();
  const identityUpdateMany = jest.fn();
  const settingFindUnique = jest.fn();
  const settingUpsert = jest.fn();
  const executeRaw = jest.fn();
  const consentFindFirst = jest.fn();
  const consentCreate = jest.fn();
  const campaignFindUnique = jest.fn();
  const campaignUpdate = jest.fn();
  const deliveryCreateMany = jest.fn();
  const deliveryUpdateMany = jest.fn();
  const auditLog = jest.fn();
  const consentTransactionClient = {
    $executeRaw: executeRaw,
    setting: { findUnique: settingFindUnique, upsert: settingUpsert },
    customer: {
      findUnique: customerFindUnique,
      findUniqueOrThrow: customerFindUnique,
      update: jest.fn(),
      create: jest.fn(),
    },
    customerIdentity: {
      findMany: identityFindMany,
      findUnique: identityFindUnique,
      updateMany: identityUpdateMany,
    },
    customerConsent: { findFirst: consentFindFirst, create: consentCreate },
  };
  const prisma = {
    $transaction: jest.fn((operation: (client: typeof consentTransactionClient) => unknown) => (
      operation(consentTransactionClient)
    )),
    customer: { findUnique: customerFindUnique },
    customerIdentity: { findUnique: identityFindUnique, findMany: identityFindMany, updateMany: identityUpdateMany },
    customerConsent: { findFirst: consentFindFirst, create: consentCreate },
    customerCampaign: { findUnique: campaignFindUnique, update: campaignUpdate },
    customerCampaignDelivery: { createMany: deliveryCreateMany, updateMany: deliveryUpdateMany },
  } as unknown as PrismaService;
  const audit = { log: auditLog } as unknown as AuditService;
  const createPipeline = jest.fn();
  const createLead = jest.fn();
  const transitionLead = jest.fn();
  const createTask = jest.fn();
  const updateTask = jest.fn();
  const createNote = jest.fn();
  const createTag = jest.fn();
  const assignTag = jest.fn();
  const unifiedTimeline = jest.fn();
  const phase8Repository = {
    createPipeline,
    createLead,
    transitionLead,
    createTask,
    updateTask,
    createNote,
    createTag,
    assignTag,
    unifiedTimeline,
  } as unknown as Phase8CrmRepository;
  const config = {
    get: jest.fn((key: string) => key === 'CRM_IDENTITY_HASH_SECRET'
      ? 'test-crm-identity-secret-at-least-32-bytes'
      : undefined),
  } as unknown as ConfigService;
  const service = new SofiaCrmService(prisma, audit, config, phase8Repository);
  const consentDto = {
    purpose: CustomerConsentPurpose.MARKETING,
    channel: CustomerConsentChannel.WHATSAPP,
    source: 'ADMIN_CONSOLE',
    evidence: 'customer-confirmed-at-counter',
  };
  const actor = (roles: string[], permissions: string[]): AuthUser => ({
    sub: 'admin-1',
    email: 'admin@example.test',
    fullName: 'Admin',
    sessionVersion: 1,
    roles,
    permissions,
  });
  const authorizedAdmin = actor(['admin'], ['orders.update']);

  beforeEach(() => {
    jest.clearAllMocks();
    customerFindUnique.mockResolvedValue({ id: 'customer-1' });
    auditLog.mockResolvedValue({ id: 'audit-1' });
    consentCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'consent-1', ...data }));
    campaignUpdate.mockResolvedValue({ id: 'campaign-1' });
    deliveryCreateMany.mockResolvedValue({ count: 1 });
    deliveryUpdateMany.mockResolvedValue({ count: 1 });
    identityUpdateMany.mockResolvedValue({ count: 1 });
    settingFindUnique.mockResolvedValue(null);
    settingUpsert.mockResolvedValue({ id: 'crm-generation-fence' });
    executeRaw.mockResolvedValue(1);
  });

  it('never serializes the normalized phone from an internal identity', async () => {
    identityFindMany.mockImplementation(({ where }) => Promise.resolve([{
      id: 'identity-1',
      customerId: 'customer-1',
      valueHash: where.valueHash.in[0],
      customer: {
        id: 'customer-1',
        displayName: 'Cliente',
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
        identities: [
          {
            id: 'identity-1',
            type: 'PHONE',
            valueHash: 'internal-hmac-hash',
            valueMasked: '*** *** 3047',
            isPrimary: true,
            verifiedAt: null,
          },
        ],
        tagAssignments: [],
      },
    }]));
    customerFindUnique.mockImplementation(({ where }) => Promise.resolve(where.id === 'customer-1'
      ? (identityFindMany.mock.results.at(-1)?.value as Promise<Array<{ customer: unknown }>>).then(([row]) => row?.customer)
      : { id: 'customer-1' }));

    const result = await service.resolveOrCreateByPhone(
      { phone: '+57 323 796 3047' },
      authorizedAdmin,
    );

    expect(JSON.stringify(result)).not.toContain('3237963047');
    expect(JSON.stringify(identityFindMany.mock.calls[0])).not.toContain('3237963047');
    expect(identityFindMany.mock.calls[0][0].where.valueHash.in[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(result.identities[0]).toEqual(
      expect.objectContaining({ valueMasked: '*** *** 3047' }),
    );
    expect(result.identities[0]).not.toHaveProperty('valueHash');
  });

  it('fails closed outside tests when the identity hash secret is absent', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const missingConfig = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService;
    const unconfiguredService = new SofiaCrmService(prisma, audit, missingConfig, phase8Repository);

    try {
      await expect(
        unconfiguredService.resolveOrCreateByPhone(
          { phone: '3237963047' },
          TrustedCrmCustomerResolutionCapability.issue('sofia-system', 'WHATSAPP_INBOUND'),
        ),
      ).rejects.toThrow('CRM identity hashing is not configured.');
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('promotes an existing phone identity from the previous rotation key', async () => {
    const previousSecret = 'test-previous-crm-identity-secret-000001';
    const rotatingService = new SofiaCrmService(prisma, audit, {
      get: jest.fn((key: string) => ({
        CRM_IDENTITY_HASH_SECRET: 'test-current-crm-identity-secret-0000001',
        CRM_IDENTITY_HASH_SECRET_PREVIOUS: previousSecret,
      })[key]),
    } as unknown as ConfigService, phase8Repository);
    identityFindMany.mockImplementation(({ where }) => Promise.resolve([{
        id: 'identity-1',
        customerId: 'customer-1',
        valueHash: where.valueHash.in[1],
        customer: {
          id: 'customer-1', displayName: 'Cliente', status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date(),
          identities: [{
            id: 'identity-1', type: 'PHONE', valueMasked: '*** *** 3047', isPrimary: true, verifiedAt: null,
          }],
          tagAssignments: [],
        },
      }]));
    customerFindUnique.mockResolvedValue({
      id: 'customer-1', displayName: 'Cliente', status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date(),
      identities: [{ id: 'identity-1', type: 'PHONE', valueMasked: '*** *** 3047', isPrimary: true, verifiedAt: null }],
      tagAssignments: [],
    });

    await expect(rotatingService.resolveOrCreateByPhone(
      { phone: '3237963047' },
      TrustedCrmCustomerResolutionCapability.issue('sofia-system', 'WHATSAPP_INBOUND'),
    ))
      .resolves.toMatchObject({ id: 'customer-1' });
    expect(identityFindMany).toHaveBeenCalledTimes(1);
    const [currentHash, previousHash] = identityFindMany.mock.calls[0][0].where.valueHash.in;
    expect(currentHash).not.toBe(previousHash);
    expect(identityUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'identity-1' }),
      data: { valueHash: currentHash },
    }));
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CRM_IDENTITY_HASH_ROTATED' }),
      consentTransactionClient,
    );
  });

  it('lets a phone hash compare-and-set loser validate the winner without a second audit', async () => {
    const previousSecret = 'test-previous-crm-identity-secret-000001';
    const rotatingService = new SofiaCrmService(prisma, audit, {
      get: jest.fn((key: string) => ({
        CRM_IDENTITY_HASH_SECRET: 'test-current-crm-identity-secret-0000001',
        CRM_IDENTITY_HASH_SECRET_PREVIOUS: previousSecret,
      })[key]),
    } as unknown as ConfigService, phase8Repository);
    identityFindMany.mockImplementation(({ where }) => Promise.resolve([{
      id: 'identity-1',
      customerId: 'customer-1',
      valueHash: where.valueHash.in[1],
    }]));
    identityUpdateMany.mockResolvedValue({ count: 0 });
    identityFindUnique.mockImplementation(({ where }) => Promise.resolve({
      customerId: 'customer-1',
      valueHash: where.type_valueHash.valueHash,
    }));
    customerFindUnique.mockResolvedValue({
      id: 'customer-1', displayName: 'Cliente', status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date(),
      identities: [{ id: 'identity-1', type: 'PHONE', valueMasked: '*** *** 3047', isPrimary: true, verifiedAt: null }],
      tagAssignments: [],
    });

    await expect(rotatingService.resolveOrCreateByPhone(
      { phone: '3237963047' },
      TrustedCrmCustomerResolutionCapability.issue('sofia-system', 'WHATSAPP_INBOUND'),
    )).resolves.toMatchObject({ id: 'customer-1' });
    expect(identityUpdateMany).toHaveBeenCalledTimes(1);
    expect(identityFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { type_valueHash: { type: 'PHONE', valueHash: expect.stringMatching(/^[a-f0-9]{64}$/) } },
    }));
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('rejects a phone hash compare-and-set loser when the winning identity belongs to another customer', async () => {
    const previousSecret = 'test-previous-crm-identity-secret-000001';
    const rotatingService = new SofiaCrmService(prisma, audit, {
      get: jest.fn((key: string) => ({
        CRM_IDENTITY_HASH_SECRET: 'test-current-crm-identity-secret-0000001',
        CRM_IDENTITY_HASH_SECRET_PREVIOUS: previousSecret,
      })[key]),
    } as unknown as ConfigService, phase8Repository);
    identityFindMany.mockImplementation(({ where }) => Promise.resolve([{
      id: 'identity-1',
      customerId: 'customer-1',
      valueHash: where.valueHash.in[1],
    }]));
    identityUpdateMany.mockResolvedValue({ count: 0 });
    identityFindUnique.mockResolvedValue({ customerId: 'customer-2', valueHash: 'different-winner-hash' });

    await expect(rotatingService.resolveOrCreateByPhone(
      { phone: '3237963047' },
      TrustedCrmCustomerResolutionCapability.issue('sofia-system', 'WHATSAPP_INBOUND'),
    )).rejects.toThrow('CRM_IDENTITY_ROTATION_CONFLICT');
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('projects restricted unified-timeline facts from the authenticated role', async () => {
    unifiedTimeline.mockResolvedValue({ data: [] });
    const query = { page: 1, limit: 20 };

    await service.listUnifiedTimeline('customer-1', query, {
      sub: 'cashier-1', email: 'cashier@example.test', fullName: 'Cashier', sessionVersion: 1,
      roles: ['cashier'], permissions: [],
    });
    expect(unifiedTimeline).toHaveBeenLastCalledWith('customer-1', query, {
      paymentFacts: false,
      serviceCaseFacts: false,
    });

    await service.listUnifiedTimeline('customer-1', query, {
      sub: 'supervisor-1', email: 'supervisor@example.test', fullName: 'Supervisor', sessionVersion: 1,
      roles: ['supervisor'], permissions: ['orders.read'],
    });
    expect(unifiedTimeline).toHaveBeenLastCalledWith('customer-1', query, {
      paymentFacts: false,
      serviceCaseFacts: false,
    });

    await service.listUnifiedTimeline('customer-1', query, {
      sub: 'supervisor-1', email: 'supervisor@example.test', fullName: 'Supervisor', sessionVersion: 1,
      roles: ['supervisor'], permissions: ['orders.read', 'reports.read'],
    });
    expect(unifiedTimeline).toHaveBeenLastCalledWith('customer-1', query, {
      paymentFacts: true,
      serviceCaseFacts: true,
    });
  });

  it('records a versioned opt-in using only an evidence hash', async () => {
    consentFindFirst.mockResolvedValue(null);

    const consent = await service.grantOptIn('customer-1', consentDto, authorizedAdmin);

    expect(consent).toMatchObject({
      status: CustomerConsentStatus.GRANTED,
      version: 1,
      source: 'ADMIN_CONSOLE',
    });
    expect(consent.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(consentCreate.mock.calls[0])).not.toContain(consentDto.evidence);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CRM_CONSENT_GRANTED' }),
      consentTransactionClient,
    );
  });

  it('appends a revoked consent version without overwriting the grant', async () => {
    const grantedAt = new Date('2026-07-27T10:00:00.000Z');
    consentFindFirst.mockResolvedValue({
      id: 'consent-1',
      customerId: 'customer-1',
      status: CustomerConsentStatus.GRANTED,
      version: 3,
      grantedAt,
    });

    const consent = await service.revokeOptIn(
      'customer-1',
      consentDto,
      actor(['supervisor'], ['orders.update']),
    );

    expect(consent).toMatchObject({
      status: CustomerConsentStatus.REVOKED,
      version: 4,
      grantedAt,
    });
    expect(consent.revokedAt).toBeInstanceOf(Date);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CRM_CONSENT_REVOKED' }),
      consentTransactionClient,
    );
  });

  it('blocks every campaign send attempt and only records blocked deliveries', async () => {
    campaignFindUnique.mockResolvedValue({
      id: 'campaign-1',
      segment: {
        memberships: [
          {
            customer: {
              id: 'customer-1',
              identities: [{ id: 'identity-1', valueMasked: '*** *** 3047' }],
            },
          },
        ],
      },
    });

    const result = await service.attemptCampaignSend('campaign-1', authorizedAdmin);

    expect(result).toEqual({
      campaignId: 'campaign-1',
      status: CustomerCampaignStatus.BLOCKED,
      reason: CAMPAIGN_SEND_BLOCK_REASON,
      blockedDeliveries: 1,
      sent: false,
    });
    expect(campaignUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: CustomerCampaignStatus.BLOCKED,
          blockedReason: CAMPAIGN_SEND_BLOCK_REASON,
        },
      }),
    );
    expect(deliveryCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            status: CustomerCampaignDeliveryStatus.BLOCKED,
            blockedReason: CAMPAIGN_SEND_BLOCK_REASON,
            recipientMasked: '*** *** 3047',
          }),
        ],
      }),
    );
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'BLOCKED',
        reasonCode: CAMPAIGN_SEND_BLOCK_REASON,
      }),
    );
  });

  it('preserves the customer-only response contract when assigning a tag', async () => {
    const customer = { id: 'customer-1', tagAssignments: [{ tag: { id: 'tag-1', name: 'Preferente' } }] };
    assignTag.mockResolvedValue({ state: 'CREATED', customer });

    await expect(service.assignTag('customer-1', 'tag-1', authorizedAdmin)).resolves.toEqual(customer);
    expect(assignTag).toHaveBeenCalledWith('customer-1', 'tag-1', 'admin-1');
  });

  it.each([
    ['resolveOrCreateByPhone', (unauthorized: AuthUser) => service.resolveOrCreateByPhone({ phone: '3237963047' }, unauthorized)],
    ['grantOptIn', (unauthorized: AuthUser) => service.grantOptIn('customer-1', consentDto, unauthorized)],
    ['revokeOptIn', (unauthorized: AuthUser) => service.revokeOptIn('customer-1', consentDto, unauthorized)],
    ['recordInteraction', (unauthorized: AuthUser) => service.recordInteraction('customer-1', {} as never, unauthorized)],
    ['createSegment', (unauthorized: AuthUser) => service.createSegment({} as never, unauthorized)],
    ['createDraftCampaign', (unauthorized: AuthUser) => service.createDraftCampaign({} as never, unauthorized)],
    ['attemptCampaignSend', (unauthorized: AuthUser) => service.attemptCampaignSend('campaign-1', unauthorized)],
    ['createPipeline', (unauthorized: AuthUser) => service.createPipeline({} as never, unauthorized)],
    ['createLead', (unauthorized: AuthUser) => service.createLead({} as never, unauthorized)],
    ['transitionLead', (unauthorized: AuthUser) => service.transitionLead('lead-1', {} as never, unauthorized)],
    ['createTask', (unauthorized: AuthUser) => service.createTask({} as never, unauthorized)],
    ['updateTask', (unauthorized: AuthUser) => service.updateTask('task-1', {} as never, unauthorized)],
    ['createNote', (unauthorized: AuthUser) => service.createNote({} as never, unauthorized)],
    ['createTag', (unauthorized: AuthUser) => service.createTag({ name: 'Preferente' }, unauthorized)],
    ['assignTag', (unauthorized: AuthUser) => service.assignTag('customer-1', 'tag-1', unauthorized)],
  ])('blocks direct %s provider calls without role and permission', async (_name, mutation) => {
    await expect(mutation(actor(['admin'], []))).rejects.toMatchObject({
      response: { code: 'CRM_PHASE8_MUTATION_FORBIDDEN' },
    });
    await expect(mutation(actor(['cashier'], ['orders.update']))).rejects.toMatchObject({
      response: { code: 'CRM_PHASE8_MUTATION_FORBIDDEN' },
    });

    expect(createPipeline).not.toHaveBeenCalled();
    expect(createLead).not.toHaveBeenCalled();
    expect(transitionLead).not.toHaveBeenCalled();
    expect(createTask).not.toHaveBeenCalled();
    expect(updateTask).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
    expect(createTag).not.toHaveBeenCalled();
    expect(assignTag).not.toHaveBeenCalled();
  });

  it('accepts only the issued narrow capability for trusted customer resolution', async () => {
    identityFindMany.mockImplementation(({ where }) => Promise.resolve([{
      id: 'identity-1', valueHash: where.valueHash.in[0],
      customerId: 'customer-1',
      customer: {
        id: 'customer-1', displayName: 'Cliente', status: 'ACTIVE',
        createdAt: new Date(), updatedAt: new Date(), identities: [], tagAssignments: [],
      },
    }]));
    customerFindUnique.mockResolvedValue({
      id: 'customer-1', displayName: 'Cliente', status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date(),
      identities: [], tagAssignments: [],
    });

    await expect(service.resolveOrCreateByPhone(
      { phone: '3237963047' },
      TrustedCrmCustomerResolutionCapability.issue('sofia-system', 'SOFIA_DOMAIN_ADAPTER'),
    )).resolves.toMatchObject({ id: 'customer-1' });
    await expect(service.resolveOrCreateByPhone(
      { phone: '3237963047' },
      { kind: 'TRUSTED_CRM_CUSTOMER_RESOLUTION', actorId: 'forged' } as never,
    )).rejects.toMatchObject({ response: { code: 'CRM_PHASE8_MUTATION_FORBIDDEN' } });
  });
});
