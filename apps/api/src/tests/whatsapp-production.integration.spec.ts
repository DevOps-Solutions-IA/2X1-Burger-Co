import type { INestApplication } from '@nestjs/common';
import { CustomerConsentChannel, CustomerConsentPurpose, CustomerConsentStatus, WhatsappInboundEventKind } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaWhatsappProductionRepository } from '../modules/sofia/whatsapp/production/persistence/prisma-whatsapp-production.repository';
import { WhatsappConsentService } from '../modules/sofia/whatsapp/production/whatsapp-consent.service';
import { WhatsappDeliveryStatusService } from '../modules/sofia/whatsapp/production/whatsapp-delivery-status.service';
import { PrismaService } from '../prisma/prisma.service';
import { closeTestApp, createTestApp } from './helpers/test-app';
import { resetDatabase, seedTestData } from './helpers/test-data';

describe('WhatsApp production persistence integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let repository: PrismaWhatsappProductionRepository;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) throw new Error('WhatsApp integration requires an isolated _test database.');
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    repository = app.get(PrismaWhatsappProductionRepository);
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => {
    await resetDatabase(prisma);
    await seedTestData(prisma);
  });

  it('allows one atomic inbound claimant and deterministically replays concurrent duplicates', async () => {
    const account = await repository.resolveAccount({
      provider: 'qr_gateway', externalAccountId: 'account-1', businessIdentity: 'business-1', sessionOwner: 'session-1',
    });
    const input = {
      accountId: account.id,
      provider: 'qr_gateway',
      eventId: 'provider-event-1',
      messageId: 'provider-message-1',
      phone: '573001234567',
      eventHash: 'event-hash-1',
      eventKind: WhatsappInboundEventKind.INBOUND_MESSAGE,
      normalizedPayloadHash: 'payload-hash-1',
    };
    const claims = await Promise.all(Array.from({ length: 12 }, () => repository.claimInbound(input)));

    expect(claims.filter((claim) => claim.created)).toHaveLength(1);
    expect(new Set(claims.map((claim) => claim.id)).size).toBe(1);
    expect(await prisma.whatsappInboundEvent.count()).toBe(1);

    const winner = claims.find((claim) => claim.disposition === 'ACQUIRED');
    expect(winner?.claimToken).toEqual(expect.any(String));
    await repository.completeInbound(winner!.id, 'PROCESSED', { code: 'INBOUND_STORED' }, null, winner!.claimToken);
    const replay = await repository.claimInbound(input);
    expect(replay).toMatchObject({ created: false, deterministicResult: { code: 'INBOUND_STORED' } });
  });

  it('uses the latest consent version and lets revocation override older grants', async () => {
    const customer = await prisma.customer.create({ data: { displayName: 'Consent test' } });
    await prisma.customerConsent.createMany({
      data: [
        {
          customerId: customer.id, purpose: CustomerConsentPurpose.MARKETING, channel: CustomerConsentChannel.WHATSAPP,
          status: CustomerConsentStatus.GRANTED, source: 'operator', evidenceHash: 'grant-hash', version: 1, grantedAt: new Date(),
        },
        {
          customerId: customer.id, purpose: CustomerConsentPurpose.MARKETING, channel: CustomerConsentChannel.WHATSAPP,
          status: CustomerConsentStatus.REVOKED, source: 'customer', evidenceHash: 'revoke-hash', version: 2, revokedAt: new Date(),
        },
      ],
    });
    const consent = app.get(WhatsappConsentService);
    await expect(consent.evaluate(customer.id, 'MARKETING')).resolves.toMatchObject({
      allowed: false, version: 2, reasonCode: 'CONSENT_REVOKED',
    });
  });

  it('persists delivery statuses once and rejects a monotonic regression', async () => {
    const account = await repository.resolveAccount({
      provider: 'qr_gateway', externalAccountId: 'account-1', businessIdentity: 'business-1', sessionOwner: 'session-1',
    });
    const recipient = '573001234567';
    const recipientIdentityHash = createHash('sha256').update(recipient).digest('hex');
    const conversation = await prisma.whatsappConversation.create({
      data: { phone: recipient, provider: 'qr_gateway', mode: 'receive_only', humanStatus: 'SOFIA_ACTIVE' },
    });
    await prisma.whatsappOutboundMessage.create({
      data: {
        conversationId: conversation.id,
        provider: 'qr_gateway',
        providerMessageId: 'provider-message-1',
        localMessageId: 'local-message-1',
        body: 'sanitized test body',
        status: 'SENT',
        idempotencyKey: 'outbound-status-test-1',
        accountId: account.id,
        recipientIdentityHash,
        purpose: 'SERVICE',
      },
    });
    const statuses = app.get(WhatsappDeliveryStatusService);
    const delivered = {
      accountId: account.id,
      providerStatusEventId: 'status-event-1',
      providerMessageId: 'provider-message-1',
      recipientIdentityHash,
      status: 'DELIVERED' as const,
      occurredAt: new Date(),
      payloadHash: 'status-payload-1',
    };

    await expect(statuses.apply(delivered)).resolves.toMatchObject({ duplicate: false });
    await expect(statuses.apply(delivered)).resolves.toMatchObject({ duplicate: true });
    await expect(statuses.apply({ ...delivered, providerStatusEventId: 'status-event-2', status: 'SENT' })).rejects.toMatchObject({
      response: { code: 'WHATSAPP_STATUS_REGRESSION' },
    });
    expect(await prisma.whatsappMessageStatusEvent.count()).toBe(1);
  });
});
