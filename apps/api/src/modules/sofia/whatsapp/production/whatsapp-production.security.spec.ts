import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import type { ParsedWhatsappInbound } from '../whatsapp-provider.adapter';
import { WhatsappEventNormalizer } from './whatsapp-event-normalizer';
import { WhatsappMediaSecurityService } from './whatsapp-media-security.service';
import { WhatsappProviderHealthService } from './whatsapp-provider-health.service';
import { sanitizeWhatsappInboundReceipt } from './whatsapp-inbound-receipt';
import type { WhatsappProductionRepository } from './whatsapp-production.repository';
import { WhatsappWebhookVerifier } from './whatsapp-webhook-verifier';

const account = {
  provider: 'qr_gateway' as const,
  externalAccountId: 'account-1',
  businessIdentity: 'business-1',
  sessionOwner: 'session-1',
};

const parsed: ParsedWhatsappInbound = {
  provider: 'qr_gateway',
  providerEventId: 'event-1',
  providerMessageId: 'message-1',
  phone: '300 123 4567',
  body: '  Hola\u0000 mundo  ',
  messageType: 'TEXT',
  timestamp: new Date('2026-08-07T12:00:00.000Z'),
  rawPayload: {},
};

describe('WhatsApp production security boundaries', () => {
  it('verifies Hermes against exact raw bytes and rejects byte changes', () => {
    const secret = 'test-hermes-webhook-secret';
    const verifier = new WhatsappWebhookVerifier({ get: () => secret } as unknown as ConfigService);
    const raw = Buffer.from('{"message":{"id":"1"}}');
    const signature = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

    expect(verifier.verifyHermes(raw, { 'x-hermes-signature': signature }).valid).toBe(true);
    expect(verifier.verifyHermes(Buffer.from('{ "message":{"id":"1"}}'), { 'x-hermes-signature': signature })).toMatchObject({
      valid: false,
      reasonCode: 'WHATSAPP_SIGNATURE_INVALID',
    });
    expect(verifier.verifyHermes(raw, {})).toMatchObject({ valid: false, reasonCode: 'WHATSAPP_SIGNATURE_MISSING' });
  });

  it('normalizes text without leaking provider payloads', () => {
    const event = new WhatsappEventNormalizer().normalize({
      provider: 'qr_gateway',
      rawPayload: { id: 'event-1', arbitraryProviderSecret: 'not-forwarded' },
      parsed,
      account,
    });

    expect(event).toMatchObject({ kind: 'INBOUND_MESSAGE', sender: '573001234567', sanitizedText: 'Hola mundo' });
    expect(JSON.stringify(event)).not.toContain('arbitraryProviderSecret');
  });

  it('classifies status and unsupported events before conversational processing', () => {
    const normalizer = new WhatsappEventNormalizer();
    expect(normalizer.normalize({
      provider: 'qr_gateway', rawPayload: { id: 'status-1', status: 'delivered', recipient: 'business-1' }, parsed, account,
    })).toMatchObject({ kind: 'STATUS_EVENT', status: 'DELIVERED' });
    expect(normalizer.normalize({
      provider: 'qr_gateway', rawPayload: { id: 'unsupported-1' }, parsed: { ...parsed, messageType: 'SYSTEM' }, account,
    })).toMatchObject({ kind: 'UNSUPPORTED_EVENT' });
  });

  it('normalizes media metadata without allowing fetch or AI ingestion', async () => {
    const createMediaEnvelope = jest.fn().mockResolvedValue(undefined);
    const service = new WhatsappMediaSecurityService({ createMediaEnvelope } as unknown as WhatsappProductionRepository);
    const accepted = await service.persist('message-1', {
      providerReference: 'provider-media-1', declaredMimeType: 'image/jpeg', declaredSizeBytes: 1024,
    });

    expect(accepted).toMatchObject({ accepted: true, fetchAllowed: false, aiIngestionAllowed: false });
    expect(createMediaEnvelope).toHaveBeenCalledWith(expect.objectContaining({ providerReferenceHash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
    expect(createMediaEnvelope.mock.calls[0]?.[0]).not.toHaveProperty('providerReference');
  });

  it.each([
    [{ providerReference: null, declaredMimeType: 'image/jpeg', declaredSizeBytes: 1 }, 'MEDIA_REFERENCE_UNSAFE'],
    [{ providerReference: 'media-1', declaredMimeType: 'application/x-msdownload', declaredSizeBytes: 1 }, 'MEDIA_MIME_UNSUPPORTED'],
    [{ providerReference: 'media-1', declaredMimeType: 'image/jpeg', declaredSizeBytes: null }, 'MEDIA_SIZE_REQUIRED'],
    [{ providerReference: 'media-1', declaredMimeType: 'image/jpeg', declaredSizeBytes: 11 * 1024 * 1024 }, 'MEDIA_TOO_LARGE'],
  ])('fails closed for unsafe media metadata', (media, reasonCode) => {
    const service = new WhatsappMediaSecurityService({} as WhatsappProductionRepository);
    expect(service.evaluate(media)).toMatchObject({ accepted: false, reasonCode, fetchAllowed: false, aiIngestionAllowed: false });
  });

  it('binds the exact configured account and rejects a different session', async () => {
    const repository = { resolveAccount: jest.fn().mockResolvedValue({ id: 'account-row', status: 'VERIFIED_RECEIVE_ONLY' }) };
    const values: Record<string, unknown> = {
      NODE_ENV: 'production',
      WHATSAPP_EXPECTED_ACCOUNT_ID: account.externalAccountId,
      WHATSAPP_EXPECTED_BUSINESS_IDENTITY: account.businessIdentity,
      WHATSAPP_EXPECTED_SESSION_OWNER: account.sessionOwner,
    };
    const health = new WhatsappProviderHealthService(
      { get: (key: string) => values[key] } as unknown as ConfigService,
      repository as never,
    );

    await expect(health.bind(account)).resolves.toMatchObject({ id: 'account-row' });
    await expect(health.bind({ ...account, sessionOwner: 'wrong-session' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an exact provider binding when the persisted account is disabled', async () => {
    const repository = { resolveAccount: jest.fn().mockResolvedValue({ id: 'account-row', status: 'DISABLED' }) };
    const values: Record<string, unknown> = {
      NODE_ENV: 'production',
      WHATSAPP_EXPECTED_ACCOUNT_ID: account.externalAccountId,
      WHATSAPP_EXPECTED_BUSINESS_IDENTITY: account.businessIdentity,
      WHATSAPP_EXPECTED_SESSION_OWNER: account.sessionOwner,
    };
    const health = new WhatsappProviderHealthService(
      { get: (key: string) => values[key] } as unknown as ConfigService,
      repository as never,
    );

    await expect(health.bind(account)).rejects.toMatchObject({
      response: { code: 'WHATSAPP_PROVIDER_ACCOUNT_DISABLED' },
    });
  });

  it('persists and replays only a metadata receipt without business or personal data', () => {
    const receipt = sanitizeWhatsappInboundReceipt({
      mode: 'receive_only',
      provider: 'qr_gateway',
      processingStatus: 'SUGGESTED_ONLY',
      inboundEventId: 'event-row',
      conversationId: 'conversation-row',
      outbound: { body: 'Entrega en Carrera 10', status: 'SUGGESTED' },
      sofiaResult: {
        customer: { phone: '+573001234567', address: 'Carrera 10' },
        draft: { customerPhone: '+573001234567', deliveryAddress: 'Carrera 10' },
      },
    });

    expect(receipt).toEqual({
      mode: 'receive_only',
      provider: 'qr_gateway',
      processingStatus: 'SUGGESTED_ONLY',
      inboundEventId: 'event-row',
    });
    expect(JSON.stringify(receipt)).not.toContain('+573001234567');
    expect(JSON.stringify(receipt)).not.toContain('Carrera 10');
  });
});
