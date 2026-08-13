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
import { CAMPAIGN_SEND_BLOCK_REASON, SofiaCrmService } from './sofia-crm.service';
import type { Phase8CrmRepository } from './phase8-crm.repository';

describe('SofiaCrmService', () => {
  const customerFindUnique = jest.fn();
  const identityFindUnique = jest.fn();
  const consentFindFirst = jest.fn();
  const consentCreate = jest.fn();
  const campaignFindUnique = jest.fn();
  const campaignUpdate = jest.fn();
  const deliveryCreateMany = jest.fn();
  const deliveryUpdateMany = jest.fn();
  const auditLog = jest.fn();
  const prisma = {
    customer: { findUnique: customerFindUnique },
    customerIdentity: { findUnique: identityFindUnique },
    customerConsent: { findFirst: consentFindFirst, create: consentCreate },
    customerCampaign: { findUnique: campaignFindUnique, update: campaignUpdate },
    customerCampaignDelivery: { createMany: deliveryCreateMany, updateMany: deliveryUpdateMany },
  } as unknown as PrismaService;
  const audit = { log: auditLog } as unknown as AuditService;
  const assignTag = jest.fn();
  const unifiedTimeline = jest.fn();
  const phase8Repository = { assignTag, unifiedTimeline } as unknown as Phase8CrmRepository;
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

  beforeEach(() => {
    jest.clearAllMocks();
    customerFindUnique.mockResolvedValue({ id: 'customer-1' });
    auditLog.mockResolvedValue({ id: 'audit-1' });
    consentCreate.mockImplementation(({ data }) => Promise.resolve({ id: 'consent-1', ...data }));
    campaignUpdate.mockResolvedValue({ id: 'campaign-1' });
    deliveryCreateMany.mockResolvedValue({ count: 1 });
    deliveryUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('never serializes the normalized phone from an internal identity', async () => {
    identityFindUnique.mockResolvedValue({
      customerId: 'customer-1',
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
    });

    const result = await service.resolveOrCreateByPhone({ phone: '+57 323 796 3047' }, 'admin-1');

    expect(JSON.stringify(result)).not.toContain('3237963047');
    expect(JSON.stringify(identityFindUnique.mock.calls[0])).not.toContain('3237963047');
    expect(identityFindUnique.mock.calls[0][0].where.type_valueHash.valueHash).toMatch(/^[a-f0-9]{64}$/);
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
        unconfiguredService.resolveOrCreateByPhone({ phone: '3237963047' }, 'admin-1'),
      ).rejects.toThrow('CRM identity hashing is not configured.');
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it('resolves an existing phone identity with the previous rotation key without rewriting it', async () => {
    const previousSecret = 'test-previous-crm-identity-secret-000001';
    const rotatingService = new SofiaCrmService(prisma, audit, {
      get: jest.fn((key: string) => ({
        CRM_IDENTITY_HASH_SECRET: 'test-current-crm-identity-secret-0000001',
        CRM_IDENTITY_HASH_SECRET_PREVIOUS: previousSecret,
      })[key]),
    } as unknown as ConfigService, phase8Repository);
    identityFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        customerId: 'customer-1',
        customer: {
          id: 'customer-1', displayName: 'Cliente', status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date(),
          identities: [{
            id: 'identity-1', type: 'PHONE', valueMasked: '*** *** 3047', isPrimary: true, verifiedAt: null,
          }],
          tagAssignments: [],
        },
      });

    await expect(rotatingService.resolveOrCreateByPhone({ phone: '3237963047' }, 'admin-1'))
      .resolves.toMatchObject({ id: 'customer-1' });
    expect(identityFindUnique).toHaveBeenCalledTimes(2);
    expect(identityFindUnique.mock.calls[0][0].where.type_valueHash.valueHash)
      .not.toBe(identityFindUnique.mock.calls[1][0].where.type_valueHash.valueHash);
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
      roles: ['supervisor'], permissions: [],
    });
    expect(unifiedTimeline).toHaveBeenLastCalledWith('customer-1', query, {
      paymentFacts: true,
      serviceCaseFacts: true,
    });
  });

  it('records a versioned opt-in using only an evidence hash', async () => {
    consentFindFirst.mockResolvedValue(null);

    const consent = await service.grantOptIn('customer-1', consentDto, 'admin-1');

    expect(consent).toMatchObject({
      status: CustomerConsentStatus.GRANTED,
      version: 1,
      source: 'ADMIN_CONSOLE',
    });
    expect(consent.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(consentCreate.mock.calls[0])).not.toContain(consentDto.evidence);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'CRM_CONSENT_GRANTED' }));
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

    const consent = await service.revokeOptIn('customer-1', consentDto, 'supervisor-1');

    expect(consent).toMatchObject({
      status: CustomerConsentStatus.REVOKED,
      version: 4,
      grantedAt,
    });
    expect(consent.revokedAt).toBeInstanceOf(Date);
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'CRM_CONSENT_REVOKED' }));
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

    const result = await service.attemptCampaignSend('campaign-1', 'admin-1');

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

    await expect(service.assignTag('customer-1', 'tag-1', 'admin-1')).resolves.toEqual(customer);
  });
});
