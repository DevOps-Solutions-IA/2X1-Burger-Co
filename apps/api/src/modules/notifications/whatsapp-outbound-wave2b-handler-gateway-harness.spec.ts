import type { INestApplication, HttpException } from '@nestjs/common';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { createTestApp, closeTestApp } from '../../tests/helpers/test-app';
import { WhatsappOutboundCommandHandler } from '../sofia/whatsapp/production/whatsapp-outbound-command.handler';
import { WhatsappOutboundGateway } from '../sofia/whatsapp/production/whatsapp-outbound.gateway';
import { WhatsappProviderFactory } from '../sofia/whatsapp/whatsapp-provider.factory';
import { NullWhatsappProvider } from '../sofia/whatsapp/null-whatsapp.provider';
import type { CommandRecord } from '../secure-command/secure-command.types';

/**
 * SOFIA Wave 2B -- TEAM W2 -- WhatsApp outbound SUPERVISED TEST HARNESS (handler/gateway/provider
 * layer, direct invocation).
 *
 * Gates 2 and 4 in the real chain (see the companion
 * whatsapp-outbound-wave2b-supervised-harness.integration.spec.ts GATE MAP) make it impossible to
 * reach `WhatsappOutboundCommandHandler.execute()` or `WhatsappOutboundGateway.send()` through the
 * real `SecureCommandService.execute()` path without either (a) a source change TEAM W2 is
 * forbidden to make, or (b) flipping a currently-false flag to true, which TEAM W2 is forbidden to
 * do anywhere, even transiently in a mock.
 *
 * This file instead calls the two REAL, unmodified, DI-constructed classes DIRECTLY, under their
 * real (100% default, untouched) configuration, to independently prove that each one refuses a
 * real send from its own first line of code -- with zero flag mutation anywhere in this file.
 * Every ConfigService/RuntimeSafety value observed below is the real one resolved by the real
 * NestJS DI graph from the real (test) environment, exactly as booted in every environment today.
 */
describe('Wave 2B supervised harness: WhatsApp outbound handler + gateway + provider factory (direct, real provider OFF)', () => {
  let app: INestApplication;
  let commandHandler: WhatsappOutboundCommandHandler;
  let gateway: WhatsappOutboundGateway;
  let providerFactory: WhatsappProviderFactory;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    commandHandler = app.get(WhatsappOutboundCommandHandler);
    gateway = app.get(WhatsappOutboundGateway);
    providerFactory = app.get(WhatsappProviderFactory);
  });

  afterAll(async () => closeTestApp(app));

  function forbiddenCode(error: unknown): unknown {
    const response = (error as HttpException).getResponse?.();
    return typeof response === 'object' && response !== null && 'code' in response
      ? (response as { code: unknown }).code
      : response;
  }

  function syntheticCommand(overrides: Partial<CommandRecord> = {}): CommandRecord {
    const now = new Date();
    return {
      id: 'w2b-synthetic-command',
      commandType: 'SOFIA_SEND_WHATSAPP',
      scope: 'whatsapp_notification',
      idempotencyKey: 'w2b-synthetic-idempotency-key',
      status: 'EXECUTING',
      actorId: 'notification-outbox',
      actorType: 'SYSTEM',
      actorRoles: ['system'],
      source: 'notification_outbox',
      targetType: 'WhatsappOutboundMessage',
      targetId: 'w2b-synthetic-outbound-message',
      expectedVersion: '0',
      payloadHash: 'w2b-synthetic-payload-hash',
      policyHash: 'w2b-synthetic-policy-hash',
      releaseVersion: 'test',
      correlationId: null,
      traceId: null,
      claimOwnerHash: null,
      leaseExpiresAt: null,
      expiresAt: new Date(now.getTime() + 60_000),
      claimedAt: now,
      completedAt: null,
      failureClass: null,
      failureCode: null,
      retryable: false,
      version: 0,
      result: null,
      ...overrides,
    };
  }

  it('GATE 4 (whatsapp-outbound-command.handler.ts:20): the outbound handler refuses any SOFIA_SEND_WHATSAPP command before touching persistence or the provider, because SOFIA_WHATSAPP_OUTBOUND_HANDLER_ENABLED is false by default (env.ts:79)', async () => {
    await expect(commandHandler.execute(syntheticCommand())).rejects.toBeInstanceOf(ForbiddenException);
    try {
      await commandHandler.execute(syntheticCommand());
      throw new Error('expected commandHandler.execute to reject');
    } catch (error) {
      expect(forbiddenCode(error)).toBe('SOFIA_COMMAND_POLICY_BLOCKED');
    }
  });

  it('GATE 4b: a non-SOFIA_SEND_WHATSAPP command type also hits the same first-line refusal (defense in depth: type AND flag are both checked before anything else)', async () => {
    try {
      await commandHandler.execute(syntheticCommand({ commandType: 'SOFIA_INTERNAL_VALIDATE' }));
      throw new Error('expected commandHandler.execute to reject');
    } catch (error) {
      expect(forbiddenCode(error)).toBe('SOFIA_COMMAND_POLICY_BLOCKED');
    }
  });

  it('GATE 6 (whatsapp-outbound.gateway.ts:16-19): the outbound gateway independently refuses to contact ANY provider while SOFIA_WHATSAPP_OUTBOUND_HANDLER_ENABLED is false, regardless of which provider is requested -- the last wall before a provider client is ever touched', async () => {
    for (const provider of ['qr_gateway', 'hermes'] as const) {
      try {
        await gateway.send({
          provider,
          to: '+573000000099',
          body: 'w2b-harness-should-never-send',
          mediaUrl: null,
          idempotencyKey: `w2b-harness-gate6-${provider}`,
        });
        throw new Error('expected gateway.send to reject');
      } catch (error) {
        expect(forbiddenCode(error)).toBe('WHATSAPP_REAL_SEND_DISABLED');
      }
    }
  });

  it('GATE 7 (whatsapp-provider.factory.ts:43-53, null-whatsapp.provider.ts:29-35): with no Hermes credentials configured in this environment, the "hermes" provider name resolves to the safe NullWhatsappProvider, which unconditionally refuses to send', async () => {
    const provider = providerFactory.getProvider('hermes');
    expect(provider).toBeInstanceOf(NullWhatsappProvider);

    await expect(
      provider.sendTextMessage({ to: '+573000000099', body: 'w2b-harness-should-never-send', idempotencyKey: 'w2b-harness-gate7' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('GATE 7b: WhatsappProviderFactory.getStatus() currently reports safeByDefault=true, confirming the factory itself classifies the current mode/provider combination as safe', async () => {
    const status = providerFactory.getStatus();
    expect(status.safeByDefault).toBe(true);
    expect(status.hermesConfigured).toBe(false);
  });
});
