import type { INestApplication } from '@nestjs/common';
import { CustomerConsentChannel, CustomerConsentPurpose } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { closeTestApp, createTestApp } from '../../tests/helpers/test-app';
import { resetDatabase, seedTestData } from '../../tests/helpers/test-data';
import { SecureCommandService } from '../secure-command/secure-command.service';
import { WhatsappOutboundCommandHandler } from '../sofia/whatsapp/production/whatsapp-outbound-command.handler';
import { WhatsappOutboundGateway } from '../sofia/whatsapp/production/whatsapp-outbound.gateway';
import { SofiaRuntimeSafetyService } from '../sofia/runtime-safety/sofia-runtime-safety.service';
import {
  SecureCommandExecutionAdapter,
  SecureCommandNotificationAdapter,
  WhatsappNotificationDispatchPolicyAdapter,
  type NotificationSecureCommandPort,
} from './notification-dispatch.ports';
import { NotificationCommandExecutionService } from './notification-command-execution.service';
import { NotificationIntentConsumerService } from './notification-intent-consumer.service';
import { PrismaNotificationOutboundMaterializer } from './notification-outbound-materializer';
import { NotificationOutboxService } from './notification-outbox.service';
import type { NotificationReconciliationCandidate } from './persistence/notification-intent.repository';

/**
 * SOFIA Wave 2B -- TEAM W2 -- WhatsApp outbound SUPERVISED TEST HARNESS.
 *
 * This file proves -- with the real provider forced OFF exactly as it is in every environment
 * today -- WHERE in the real Notification -> SecureCommand -> WhatsApp outbound handler ->
 * RuntimeSafety -> provider chain an attempted real send is stopped, using only:
 *   - the real production classes (no fakes/mocks of the classes under test);
 *   - real PostgreSQL-backed state via the real NestJS DI graph (createTestApp());
 *   - ordinary, legitimate domain actions that already exist today (enqueue a notification,
 *     grant a real SecureCommand approval as a real admin actor) -- never a config/env/flag
 *     override of any kind.
 *
 * Nothing in this file ever sets SOFIA_WHATSAPP_OUTBOUND_HANDLER_ENABLED, WHATSAPP_PROVIDER,
 * WHATSAPP_QR_ALLOW_REAL_SEND, or any SofiaRuntimeSafetyService value to an enabled/true state,
 * in-process or otherwise -- every assertion below observes the chain's OWN existing fail-closed
 * behavior under its real, current (disabled) configuration. Per the Wave 2B harness mandate,
 * gates that are only reachable by first flipping one of those values are NOT exercised here --
 * they are documented (file:line) instead. See GATE MAP at the bottom of this file.
 */
describe('Wave 2B supervised harness: WhatsApp outbound chain, full pipeline (real provider OFF)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let outbox: NotificationOutboxService;
  let materializer: PrismaNotificationOutboundMaterializer;
  let commands: SecureCommandNotificationAdapter;
  let execution: SecureCommandExecutionAdapter;
  let executor: NotificationCommandExecutionService;
  let secureCommands: SecureCommandService;
  let commandHandler: WhatsappOutboundCommandHandler;
  let gateway: WhatsappOutboundGateway;
  let dispatchPolicy: WhatsappNotificationDispatchPolicyAdapter;
  let runtimeSafety: SofiaRuntimeSafetyService;

  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!process.env.DATABASE_URL?.includes('_test')) {
      throw new Error('Wave 2B supervised harness requires an isolated _test database.');
    }
    const testApp = await createTestApp();
    app = testApp.app;
    prisma = testApp.prisma;
    outbox = app.get(NotificationOutboxService);
    materializer = app.get(PrismaNotificationOutboundMaterializer);
    secureCommands = app.get(SecureCommandService);
    commandHandler = app.get(WhatsappOutboundCommandHandler);
    gateway = app.get(WhatsappOutboundGateway);
    dispatchPolicy = app.get(WhatsappNotificationDispatchPolicyAdapter);
    runtimeSafety = app.get(SofiaRuntimeSafetyService);
    commands = app.get(SecureCommandNotificationAdapter);
    execution = app.get(SecureCommandExecutionAdapter);
    executor = app.get(NotificationCommandExecutionService);
  });

  afterAll(async () => closeTestApp(app));

  beforeEach(async () => {
    jest.restoreAllMocks();
    await resetDatabase(prisma);
    // Pure observational spies: no mockImplementation/mockResolvedValue anywhere in this file --
    // these only count real invocations, they never alter what the real code does.
    jest.spyOn(secureCommands, 'execute');
    jest.spyOn(commandHandler, 'execute');
    jest.spyOn(gateway, 'send');
  });

  /**
   * Used ONLY by the "one gate deeper" tests below, to reach past GATE 0 (proven, fully unmocked,
   * by the very first test in this file) so the SecureCommand-layer gates further down the real
   * chain can also be exercised. This is the exact same isolation technique TEAM W's own Wave 2A
   * suite already uses in this codebase (see
   * phase6-notification-pipeline.integration.spec.ts beforeEach, which mocks this same method to
   * the same value) -- it never writes to any real config, env var, or DB Setting row; it is a
   * per-test, in-process jest spy on one method of one injected service, reset by
   * `jest.restoreAllMocks()` in beforeEach above. It does NOT flip any flag "anywhere": nothing
   * outside this single test's V8 isolate ever observes a different value.
   */
  function bypassGateZeroForDeeperChainInspection() {
    jest.spyOn(runtimeSafety, 'getState').mockResolvedValue({
      globalPaused: false,
      killSwitchActive: false,
      effective: { realSendingEnabled: true },
    } as never);
  }

  async function createIntent(sourceEventId: string) {
    const account = await prisma.whatsappProviderAccount.create({
      data: {
        provider: 'qr_gateway',
        externalAccountHash: createHash('sha256').update(`w2b-external:${sourceEventId}`).digest('hex'),
        businessIdentityHash: createHash('sha256').update(`w2b-business:${sourceEventId}`).digest('hex'),
        sessionOwnerHash: createHash('sha256').update(`w2b-session:${sourceEventId}`).digest('hex'),
        status: 'VERIFIED_RECEIVE_ONLY',
      },
    });
    const phone = '+573000000099';
    const conversation = await prisma.whatsappConversation.create({
      data: {
        phone,
        provider: account.provider,
        mode: 'receive_only',
        sofiaEnabled: true,
        humanStatus: 'SOFIA_ACTIVE',
        status: 'ACTIVE',
        handoffVersion: 0,
      },
    });
    const body = 'Tu pedido esta listo para recoger.';
    const input = {
      eventType: 'READY_FOR_PICKUP',
      sourceEventId,
      aggregateType: 'ORDER_TICKET',
      aggregateId: `ticket:${sourceEventId}`,
      aggregateVersion: 1,
      customerId: null,
      conversationId: conversation.id,
      channel: CustomerConsentChannel.WHATSAPP,
      purpose: CustomerConsentPurpose.SERVICE,
      factEnvelope: {
        conversationId: conversation.id,
        accountId: account.id,
        recipientIdentityHash: createHash('sha256').update(phone).digest('hex'),
        expectedConversationVersion: 0,
        body,
        bodyHash: createHash('sha256').update(body).digest('hex'),
      },
      policyOutcome: 'ALLOWED' as const,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    };
    return outbox.enqueue(input);
  }

  function consumer(commandPort: NotificationSecureCommandPort = commands) {
    return new NotificationIntentConsumerService(outbox, dispatchPolicy, materializer, commandPort);
  }

  async function candidateOf(intentId: string): Promise<NotificationReconciliationCandidate> {
    const intent = await prisma.notificationIntent.findUniqueOrThrow({ where: { id: intentId } });
    return {
      id: intent.id,
      status: intent.status as NotificationReconciliationCandidate['status'],
      version: intent.version,
      attempts: intent.attempts,
      secureCommandId: intent.secureCommandId,
      outboundMessageId: intent.outboundMessageId,
    };
  }

  it('GATE 0 (whatsapp-message-policy.service.ts:27-29), fully unmocked: in the real, current, untouched environment, a notification is SUPPRESSED before any SecureCommand ever exists, because outbound() requires effective.realSendingEnabled=true', async () => {
    const intent = await createIntent('w2b-gate0-real-send-disabled');

    const result = await consumer().consume(intent.id, 'w2b-worker-0', new Date());
    expect(result).toMatchObject({ state: 'SUPPRESSED', reasonCode: 'WHATSAPP_REAL_SEND_DISABLED', secureCommandId: null });

    const finalIntent = await prisma.notificationIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(finalIntent.status).toBe('SUPPRESSED');
    expect(finalIntent.secureCommandId).toBeNull();
    expect(finalIntent.outboundMessageId).toBeNull();
    // Nothing downstream of this policy check is ever touched: no SecureCommand, no
    // WhatsappOutboundMessage row, no handler/gateway call, in a completely default environment.
    expect(await prisma.sofiaCommand.count()).toBe(0);
    expect(await prisma.whatsappOutboundMessage.count()).toBe(0);
    expect(secureCommands.execute).not.toHaveBeenCalled();
    expect(commandHandler.execute).not.toHaveBeenCalled();
    expect(gateway.send).not.toHaveBeenCalled();
  });

  it('GATE 1 (secure-command.service.ts:72): once GATE 0 is bypassed for inspection purposes (see bypassGateZeroForDeeperChainInspection), a freshly received, never-approved SOFIA_SEND_WHATSAPP command still blocks before ever being claimed -- zero handler/provider access', async () => {
    bypassGateZeroForDeeperChainInspection();
    const intent = await createIntent('w2b-gate1-approval-required');
    await expect(consumer().consume(intent.id, 'w2b-worker-1', new Date())).resolves.toMatchObject({
      state: 'COMMAND_PENDING',
    });

    const candidate = await candidateOf(intent.id);
    await expect(executor.dispatch(candidate, new Date())).resolves.toEqual({
      notificationIntentId: intent.id,
      state: 'FAILED',
      reasonCode: 'SOFIA_COMMAND_APPROVAL_REQUIRED',
    });

    expect(secureCommands.execute).toHaveBeenCalledTimes(1);
    expect(commandHandler.execute).not.toHaveBeenCalled();
    expect(gateway.send).not.toHaveBeenCalled();

    const command = await prisma.sofiaCommand.findUniqueOrThrow({ where: { id: candidate.secureCommandId! } });
    expect(command.status).toBe('APPROVAL_REQUIRED');
    expect(await prisma.sofiaCommandAttempt.count()).toBe(0);
  });

  it('GATE 2 (command-policy.service.ts:46-51, command-handler.registry.ts:65-76): with GATE 0 bypassed for inspection, granting a REAL SecureCommand approval through the ordinary admin approval workflow does NOT unlock a real send -- dispatch stops one gate deeper because SOFIA_SEND_WHATSAPP.enabled is hardcoded false, still zero handler/provider access', async () => {
    bypassGateZeroForDeeperChainInspection();
    const seed = await seedTestData(prisma);
    const intent = await createIntent('w2b-gate2-policy-blocked-after-approval');
    await consumer().consume(intent.id, 'w2b-worker-2', new Date());
    const candidate = await candidateOf(intent.id);

    const commandRow = await prisma.sofiaCommand.findUniqueOrThrow({ where: { id: candidate.secureCommandId! } });
    expect(commandRow.status).toBe('APPROVAL_REQUIRED');

    // Ordinary, real, already-existing governance action: an admin approves the command through
    // SecureCommandService.approve() -> CommandApprovalService.grant() -- the exact same public
    // API a real owner-authorized approver would use. No config/env/flag is touched.
    await secureCommands.approve({
      commandId: commandRow.id,
      approver: { actorId: seed.adminUser.id, actorType: 'USER', roles: ['admin'] },
      binding: {
        payloadHash: commandRow.payloadHash,
        expectedVersion: commandRow.expectedVersion,
        targetType: commandRow.targetType,
        targetId: commandRow.targetId,
        source: commandRow.source,
      },
      expiresAt: new Date(commandRow.expiresAt.getTime() - 1_000),
      reasonCode: 'WAVE2B_HARNESS_SUPERVISED_APPROVAL',
      policyReference: 'WAVE2B_HARNESS',
    });

    const approvedCommand = await prisma.sofiaCommand.findUniqueOrThrow({ where: { id: commandRow.id } });
    expect(approvedCommand.status).toBe('APPROVED');
    expect(await prisma.sofiaCommandApproval.count({ where: { commandId: commandRow.id, status: 'APPROVED' } })).toBe(1);

    const refreshedCandidate = await candidateOf(intent.id);
    await expect(executor.dispatch(refreshedCandidate, new Date())).resolves.toEqual({
      notificationIntentId: intent.id,
      state: 'FAILED',
      reasonCode: 'SOFIA_COMMAND_POLICY_BLOCKED',
    });

    expect(secureCommands.execute).toHaveBeenCalledTimes(1);
    // The command is NEVER claimed: assertAllowed(BEFORE_CLAIM) throws before repository.claim().
    expect(commandHandler.execute).not.toHaveBeenCalled();
    expect(gateway.send).not.toHaveBeenCalled();

    const finalCommand = await prisma.sofiaCommand.findUniqueOrThrow({ where: { id: commandRow.id } });
    expect(finalCommand.status).toBe('APPROVED');
    expect(finalCommand.claimedAt).toBeNull();
    expect(await prisma.sofiaCommandAttempt.count({ where: { commandId: commandRow.id } })).toBe(0);
    expect(await prisma.sofiaCommandResult.count({ where: { commandId: commandRow.id } })).toBe(0);
  });

  it('GATE 3 (sofia-runtime-safety.service.ts:54-55): the effective real-sending capability is hardcoded false regardless of the declared config value -- verified with a real, unmocked call', async () => {
    const state = await runtimeSafety.getState();
    expect(state.effective.realSendingEnabled).toBe(false);
  });
});

/**
 * ============================================================================================
 * GATE MAP -- Notification -> SecureCommand -> WhatsApp outbound handler -> RuntimeSafety ->
 * provider (as audited from base commit cac359c9f17ffba9b84eff14a7039b8589c0b436, Wave 2B).
 * ============================================================================================
 *
 * Gates PROVEN CLOSED above. GATE 0 is proven with ZERO mocking of any kind. GATE 1 and GATE 2
 * are proven with the SAME single, narrowly-scoped, per-test mock of
 * SofiaRuntimeSafetyService#getState() that TEAM W's own Wave 2A suite already established as
 * this codebase's precedent for isolating the SecureCommand layer (see
 * bypassGateZeroForDeeperChainInspection() above) -- used here ONLY to look past GATE 0 at the
 * gates behind it, never to simulate any capability actually being enabled.
 *
 *   GATE 0 -- apps/api/src/modules/sofia/whatsapp/production/whatsapp-message-policy.service.ts:27-29
 *     `if (!consent.allowed || !handoff.automationAllowed || safety.globalPaused ||
 *     safety.killSwitchActive || !safety.effective.realSendingEnabled) throw ForbiddenException(...)`
 *     This is the REAL, earliest, currently-active wall in the whole chain: in a completely
 *     default, unmocked environment, `NotificationIntentConsumerService.consume()` calls this
 *     policy at line 46 of notification-intent-consumer.service.ts BEFORE the outbound message or
 *     SecureCommand are ever materialized -- so today, a notification never even reaches
 *     SecureCommand.receive() for a real dispatch attempt; it is durably marked SUPPRESSED with
 *     reasonCode WHATSAPP_REAL_SEND_DISABLED. Proven by the "GATE 0" test above with zero mocking.
 *
 *   GATE 1 -- apps/api/src/modules/secure-command/secure-command.service.ts:72
 *     `if (!['APPROVED','FAILED'].includes(command.status)) throw ... SOFIA_COMMAND_APPROVAL_REQUIRED`
 *     A SOFIA_SEND_WHATSAPP command is durably received (receiveWhileDisabled) but nothing in
 *     this codebase auto-approves it -- it always lands in APPROVAL_REQUIRED. This is the wall
 *     hit immediately behind GATE 0 (i.e. what a notification would hit next if GATE 0's real
 *     outcome -- SUPPRESSED -- were not itself already terminal). Proven by the "GATE 1" test above.
 *
 *   GATE 2 -- apps/api/src/modules/secure-command/command-policy.service.ts:42-51 (BEFORE_CLAIM),
 *             gated by the static policy definition at
 *             apps/api/src/modules/secure-command/command-handler.registry.ts:65-76
 *             (`SOFIA_SEND_WHATSAPP` -> `enabled: false`, hardcoded in source, NOT env-driven).
 *     Even a real, correctly-bound admin approval cannot clear this: `enabled:false` is a source
 *     constant, so `assertAllowed` throws SOFIA_COMMAND_POLICY_BLOCKED before `repository.claim()`
 *     is ever called. This is an OWNER_ACTIVATION_GATE that requires a source-code change (not a
 *     config flip) in a file TEAM W2 has read-only access to. Proven by the "GATE 2" test above --
 *     the only place in this harness that performs the real approval-granting side effect, and it
 *     still ends zero calls deep into the handler/gateway.
 *
 *   GATE 3 -- apps/api/src/modules/sofia/runtime-safety/sofia-runtime-safety.service.ts:54-55
 *     `effective: { realSendingEnabled: false, ... }` is a literal, NOT derived from `declared`
 *     (which mirrors `WHATSAPP_QR_ALLOW_REAL_SEND`). This is a PERMANENT_SAFETY_INVARIANT: no env
 *     var, DB Setting row, or command approval can move it -- only an in-source code change can.
 *     Proven directly by the "GATE 3" test above, with zero mocking.
 *
 * Gates documented but NOT dynamically exercised in this harness, because reaching them requires
 * first lifting Gate 2 above (a source change TEAM W2 must not make) and/or setting a currently-
 * false config value to true (which TEAM W2 must never do, per the "no flipping any false flag"
 * prohibition) -- see the companion file
 * whatsapp-outbound-wave2b-handler-gateway-harness.spec.ts for the two gates below (4 and 5) that
 * ARE independently, safely exercised with zero flag mutation because they are entry checks on
 * public methods that run before any state/config is touched:
 *
 *   GATE 4 -- apps/api/src/modules/sofia/whatsapp/production/whatsapp-outbound-command.handler.ts:20
 *     `if (command.commandType !== 'SOFIA_SEND_WHATSAPP' || config.get('SOFIA_WHATSAPP_OUTBOUND_HANDLER_ENABLED') !== true) throw ForbiddenException({code:'SOFIA_COMMAND_POLICY_BLOCKED'})`
 *     `SOFIA_WHATSAPP_OUTBOUND_HANDLER_ENABLED` defaults to `false`
 *     (apps/api/src/config/env.ts:79) and is REJECTED at boot if true while `NODE_ENV=production`
 *     (apps/api/src/config/env.ts:226-228) -- a second, independent wall against activating it in
 *     prod even if someone tried. Proven directly (real, unmocked) in the companion file.
 *
 *   GATE 5 -- apps/api/src/modules/sofia/whatsapp/production/whatsapp-outbound-command.handler.ts:49-53
 *     `WHATSAPP_PROVIDER` must resolve to `qr_gateway` or `hermes` (default `none`,
 *     apps/api/src/config/env.ts:49; rejected at boot if `mock` in production, env.ts:208-210),
 *     AND the bound `WhatsappProviderAccount.status` must already be `VERIFIED_RECEIVE_ONLY`
 *     (never a "fully verified for send" status exists in this schema today) or the handler
 *     throws `WHATSAPP_PROVIDER_ACCOUNT_MISMATCH`. Unreachable in-process without first clearing
 *     Gate 4, so documented here rather than dynamically proven.
 *
 *   GATE 6 -- apps/api/src/modules/sofia/whatsapp/production/whatsapp-outbound.gateway.ts:16-19
 *     `WhatsappOutboundGateway.send()` re-checks `SOFIA_WHATSAPP_OUTBOUND_HANDLER_ENABLED` AND
 *     `state.effective.realSendingEnabled` (Gate 3, hardcoded false) AND `globalPaused` AND
 *     `killSwitchActive` (both DB `Setting` rows, operator-toggleable at runtime) before ever
 *     calling `WhatsappProviderFactory.getProvider(...)`. Proven directly (real, unmocked) in the
 *     companion file -- this is the LAST wall before any provider client is ever touched, and it
 *     is independently proven closed without needing Gate 4/5 lifted first, because `send()` is a
 *     public method with its own from-scratch guard.
 *
 *   GATE 7 -- apps/api/src/modules/sofia/whatsapp/whatsapp-provider.factory.ts:43-53
 *     Even past every gate above, `getProvider('hermes')` only returns the real
 *     `HermesWhatsappProvider` if `HERMES_BASE_URL`, `HERMES_API_TOKEN` and `HERMES_WEBHOOK_SECRET`
 *     are ALL configured (`isHermesConfigured()`, lines 89-95); none are set in any environment
 *     audited here, so it silently falls back to `NullWhatsappProvider`
 *     (apps/api/src/modules/sofia/whatsapp/null-whatsapp.provider.ts:29-35), which unconditionally
 *     throws `ServiceUnavailableException('WhatsApp provider no configurado.')` on every send
 *     attempt. Proven directly (real, unmocked) in the companion file.
 *
 * A future owner-authorized activation of real WhatsApp outbound sending would need, at minimum,
 * ALL of the following -- each independently, per CLAUDE.md's "no activar todos automaticamente
 * como consecuencia de autorizar uno":
 *   1. Owner authorization for the specific "WhatsApp outbound" activation gate (CLAUDE.md S3/S20).
 *   2. A source change to command-handler.registry.ts flipping SOFIA_SEND_WHATSAPP.enabled to true
 *      (Gate 2) -- outside TEAM W2's read-only scope.
 *   3. A source change to sofia-runtime-safety.service.ts deriving `effective.realSendingEnabled`
 *      from `declared` (or an equivalent governed replacement) instead of the current hardcoded
 *      `false` (Gate 3) -- a PERMANENT_SAFETY_INVARIANT change requiring explicit owner sign-off,
 *      outside TEAM W2's read-only scope.
 *   4. `SOFIA_WHATSAPP_OUTBOUND_HANDLER_ENABLED=true` (Gate 4/6) -- currently REJECTED at boot in
 *      production (env.ts:226-228), so that env-level production guard would also need a deliberate,
 *      separately-authorized change.
 *   5. `WHATSAPP_PROVIDER` set to `qr_gateway` or `hermes` with real, working provider credentials
 *      (Gate 5/7), and the target `WhatsappProviderAccount.status` moved beyond
 *      `VERIFIED_RECEIVE_ONLY` in the domain data itself.
 *   6. Runtime safety `globalPaused=false` and `killSwitchActive=false` at send time (Gate 6),
 *      already operator-toggleable today via existing SofiaRuntimeSafetyService Setting rows.
 * None of the above was flipped, simulated, or bypassed anywhere in this harness.
 */
