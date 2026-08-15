import type { ConfigService } from '@nestjs/config';
import type { AuthUser } from '../../../../common/types/auth-user.type';
import type { PrismaService } from '../../../../prisma/prisma.service';
import type { AuditService } from '../../../audit/audit.service';
import type { SofiaWhatsappService } from '../../sofia-whatsapp.service';
import type { SofiaWhatsappQrGatewayProvider } from './sofia-whatsapp-qr-gateway.provider';
import { SofiaWhatsappQrGatewayService } from './sofia-whatsapp-qr-gateway.service';

describe('SofiaWhatsappQrGatewayService governance gate', () => {
  const settingFindMany = jest.fn();
  const auditLog = jest.fn();
  const configGet = jest.fn();
  const service = new SofiaWhatsappQrGatewayService(
    { setting: { findMany: settingFindMany } } as unknown as PrismaService,
    { log: auditLog } as unknown as AuditService,
    { get: configGet } as unknown as ConfigService,
    {} as SofiaWhatsappService,
    {} as SofiaWhatsappQrGatewayProvider,
  );
  const actor = (roles: string[], permissions: string[]): AuthUser => ({
    sub: 'operator-id',
    email: 'operator@example.test',
    fullName: 'Operator',
    sessionVersion: 1,
    roles,
    permissions,
  });
  const authorizedOperator = actor(['supervisor'], ['settings.update']);

  beforeEach(() => {
    jest.clearAllMocks();
    configGet.mockImplementation((key: string) => {
      if (key === 'WHATSAPP_QR_ENABLED' || key === 'WHATSAPP_QR_ALLOW_RECEIVE') return true;
      if (key === 'WHATSAPP_QR_SANDBOX_ONLY' || key === 'WHATSAPP_QR_ALLOW_REAL_SEND') return false;
      if (key === 'WHATSAPP_MODE') return 'receive_only';
      if (key === 'WHATSAPP_PROVIDER') return 'qr_gateway';
      return undefined;
    });
    settingFindMany.mockResolvedValue([]);
    auditLog.mockResolvedValue({ id: 'audit-qr-blocked' });
  });

  afterAll(async () => {
    await service.onModuleDestroy();
  });

  it('does not bootstrap Baileys when governance has not approved real QR', async () => {
    await expect(service.connect(authorizedOperator)).rejects.toMatchObject({
      response: expect.objectContaining({ reason: 'QR_GOVERNANCE_NOT_APPROVED' }),
    });

    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SOFIA_QR_CONNECT_BLOCKED',
        newValues: expect.objectContaining({ reason: 'QR_GOVERNANCE_NOT_APPROVED' }),
      }),
    );
  });

  it.each([
    ['SOFIA_KILL_SWITCH', { active: true }, 'KILL_SWITCH_ACTIVE'],
    ['SOFIA_GLOBAL_PAUSED', { paused: true }, 'GLOBAL_PAUSED'],
  ])('blocks QR when %s is active', async (key, value, reason) => {
    settingFindMany.mockResolvedValue([
      { key: 'SOFIA_QR_REAL_ALLOWED', value: { allowed: true } },
      { key, value },
    ]);

    await expect(service.connect(authorizedOperator)).rejects.toMatchObject({
      response: expect.objectContaining({ reason }),
    });
  });

  it.each([
    ['WHATSAPP_QR_ALLOW_RECEIVE', false, 'QR_RECEIVE_DISABLED'],
    ['WHATSAPP_QR_SANDBOX_ONLY', true, 'QR_SANDBOX_ONLY'],
    ['WHATSAPP_MODE', 'supervised', 'QR_RECEIVE_ONLY_MODE_REQUIRED'],
    ['WHATSAPP_QR_ALLOW_REAL_SEND', true, 'QR_REAL_SEND_MUST_REMAIN_DISABLED'],
  ])('fails closed when %s is %s', async (configKey, value, reason) => {
    settingFindMany.mockResolvedValue([
      { key: 'SOFIA_QR_REAL_ALLOWED', value: { allowed: true } },
    ]);
    const baseConfig = configGet.getMockImplementation();
    configGet.mockImplementation((key: string) =>
      key === configKey ? value : baseConfig?.(key),
    );

    await expect(service.connect(authorizedOperator)).rejects.toMatchObject({
      response: expect.objectContaining({ reason }),
    });
  });

  it.each([
    ['connect', (unauthorized: AuthUser) => service.connect(unauthorized)],
    ['disconnect', (unauthorized: AuthUser) => service.disconnect(unauthorized)],
    ['logout', (unauthorized: AuthUser) => service.logout(unauthorized)],
  ])('blocks direct %s calls without role and permission', async (_operation, mutation) => {
    await expect(mutation(actor(['admin'], []))).rejects.toMatchObject({
      response: { code: 'SOFIA_QR_SESSION_MUTATION_FORBIDDEN' },
    });
    await expect(mutation(actor(['cashier'], ['settings.update']))).rejects.toMatchObject({
      response: { code: 'SOFIA_QR_SESSION_MUTATION_FORBIDDEN' },
    });

    expect(settingFindMany).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });
});

describe('SofiaWhatsappQrGatewayService account and LID safety', () => {
  const safeValues: Record<string, unknown> = {
    NODE_ENV: 'test',
    WHATSAPP_QR_ENABLED: true,
    WHATSAPP_QR_ALLOW_RECEIVE: true,
    WHATSAPP_QR_SANDBOX_ONLY: false,
    WHATSAPP_QR_ALLOW_REAL_SEND: false,
    WHATSAPP_MODE: 'receive_only',
    WHATSAPP_PROVIDER: 'qr_gateway',
    WHATSAPP_QR_SESSION_NAME: 'sofia-main',
    WHATSAPP_EXPECTED_ACCOUNT_ID: '573001234567',
    WHATSAPP_EXPECTED_BUSINESS_IDENTITY: '123456789012345@lid',
    WHATSAPP_EXPECTED_SESSION_OWNER: 'sofia-main',
  };

  function subject(overrides: Record<string, unknown> = {}) {
    const processInboundWebhook = jest.fn().mockResolvedValue({ processingStatus: 'SUGGESTED_ONLY' });
    const auditLog = jest.fn().mockResolvedValue({ id: 'audit-id' });
    const prisma = {
      setting: {
        findMany: jest.fn().mockResolvedValue([
          { key: 'SOFIA_QR_REAL_ALLOWED', value: { allowed: true } },
        ]),
      },
    };
    const config = {
      get: jest.fn((key: string) => ({ ...safeValues, ...overrides })[key]),
    };
    const instance = new SofiaWhatsappQrGatewayService(
      prisma as unknown as PrismaService,
      { log: auditLog } as unknown as AuditService,
      config as unknown as ConfigService,
      { processInboundWebhook } as unknown as SofiaWhatsappService,
      {} as SofiaWhatsappQrGatewayProvider,
    );
    return { instance, processInboundWebhook, auditLog };
  }

  const testOperator: AuthUser = {
    sub: 'test-operator',
    email: 'test-operator@example.test',
    fullName: 'Test Operator',
    sessionVersion: 1,
    roles: ['supervisor'],
    permissions: ['settings.update'],
  };

  it('rejects direct test-inbound and test-send service calls outside explicit test mode', async () => {
    const { instance, processInboundWebhook, auditLog } = subject({ NODE_ENV: 'production' });

    await expect(instance.testInbound({ phone: '573109876543', text: 'Hola' }, testOperator))
      .rejects.toMatchObject({ response: { code: 'SOFIA_TEST_ONLY_ROUTE_UNAVAILABLE' } });
    await expect(instance.testSend({ to: '573109876543', body: 'Hola' }, testOperator))
      .rejects.toMatchObject({ response: { code: 'SOFIA_TEST_ONLY_ROUTE_UNAVAILABLE' } });
    expect(processInboundWebhook).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('requires operator role and capability even in explicit test mode', async () => {
    const { instance, processInboundWebhook } = subject();
    const unauthorized = { ...testOperator, roles: ['cashier'] };

    await expect(instance.testInbound({ phone: '573109876543', text: 'Hola' }, unauthorized))
      .rejects.toMatchObject({ response: { code: 'SOFIA_QR_SESSION_MUTATION_FORBIDDEN' } });
    expect(processInboundWebhook).not.toHaveBeenCalled();
  });

  it('fails closed for a malformed direct-service actor', async () => {
    const { instance, processInboundWebhook } = subject();

    await expect(instance.testInbound(
      { phone: '573109876543', text: 'Hola' },
      { sub: 'forged-actor' } as AuthUser,
    )).rejects.toMatchObject({ response: { code: 'SOFIA_QR_SESSION_MUTATION_FORBIDDEN' } });
    expect(processInboundWebhook).not.toHaveBeenCalled();
  });

  it('allows bounded direct test inbound only for an authorized operator in test mode', async () => {
    const { instance, processInboundWebhook } = subject();

    await expect(instance.testInbound({ phone: '573109876543', text: 'Hola' }, testOperator))
      .resolves.toMatchObject({ processingStatus: 'SUGGESTED_ONLY', noWhatsappReal: true });
    expect(processInboundWebhook).toHaveBeenCalledTimes(1);
  });

  function authorizeLease(instance: SofiaWhatsappQrGatewayService, fencingToken = 1) {
    const internal = instance as unknown as {
      ownership: { ownerHash: string };
      activeLease: {
        sessionName: string;
        ownerHash: string;
        fencingToken: number;
        leaseExpiresAt: string;
      } | null;
    };
    internal.activeLease = {
      sessionName: 'sofia-main',
      ownerHash: internal.ownership.ownerHash,
      fencingToken,
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
  }

  function authorizeBinding(instance: SofiaWhatsappQrGatewayService) {
    const internal = instance as unknown as {
      real: {
        phoneNumber: string | null;
        verifiedBinding: {
          providerAccountId: string;
          businessIdentity: string;
          sessionOwner: string;
        } | null;
      };
    };
    internal.real.phoneNumber = '573001234567';
    internal.real.verifiedBinding = {
      providerAccountId: '573001234567',
      businessIdentity: '123456789012345@lid',
      sessionOwner: 'sofia-main',
    };
  }

  it('normalizes the Baileys device suffix before exact binding', () => {
    const { instance } = subject();
    const internal = instance as unknown as {
      connectedPhoneNumber(socket: unknown): string | null;
    };

    expect(
      internal.connectedPhoneNumber({
        user: { id: '573001234567:42@s.whatsapp.net' },
      }),
    ).toBe('573001234567');
  });

  it('reports CONNECTED only after account, business identity, and owner are independently proven', async () => {
    const { instance } = subject();
    authorizeLease(instance);
    const socket = {
      user: {
        id: '123456789012345:42@lid',
        lid: '123456789012345:42@lid',
        phoneNumber: '573001234567@s.whatsapp.net',
      },
    };
    const internal = instance as unknown as {
      real: { socket: unknown; connectionStatus: string; phoneNumber: string | null };
      onRealConnectionUpdate(update: unknown, socket: unknown, fencingToken: number): Promise<void>;
    };
    internal.real.socket = socket;

    await internal.onRealConnectionUpdate({ connection: 'open' }, socket, 1);

    expect(internal.real).toMatchObject({
      connectionStatus: 'CONNECTED',
      phoneNumber: '573001234567',
      verifiedBinding: {
        providerAccountId: '573001234567',
        businessIdentity: '123456789012345@lid',
        sessionOwner: 'sofia-main',
      },
    });
  });

  it('fails closed when Baileys does not expose a distinct business identity', async () => {
    const { instance } = subject();
    authorizeLease(instance);
    const socket = {
      user: { id: '573001234567:42@s.whatsapp.net' },
      logout: jest.fn().mockResolvedValue(undefined),
    };
    const internal = instance as unknown as {
      real: { socket: unknown; connectionStatus: string; lastErrorCode: string | null };
      onRealConnectionUpdate(update: unknown, socket: unknown, fencingToken: number): Promise<void>;
      clearAuthDir(): Promise<void>;
      teardownRealSocket(resetPhone: boolean): Promise<void>;
      releaseSessionOwnership(): Promise<void>;
    };
    internal.real.socket = socket;
    jest.spyOn(internal, 'clearAuthDir').mockResolvedValue(undefined);
    jest.spyOn(internal, 'teardownRealSocket').mockResolvedValue(undefined);
    jest.spyOn(internal, 'releaseSessionOwnership').mockResolvedValue(undefined);

    await internal.onRealConnectionUpdate({ connection: 'open' }, socket, 1);

    expect(internal.real).toMatchObject({
      connectionStatus: 'FAILED',
      lastErrorCode: 'WHATSAPP_BUSINESS_IDENTITY_EVIDENCE_MISSING',
    });
    expect(socket.logout).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the fenced session-owner evidence is missing', async () => {
    const { instance } = subject();
    const socket = {
      user: {
        id: '123456789012345@lid',
        phoneNumber: '573001234567@s.whatsapp.net',
      },
      logout: jest.fn().mockResolvedValue(undefined),
    };
    const internal = instance as unknown as {
      real: { socket: unknown; connectionStatus: string; lastErrorCode: string | null };
      onRealConnectionUpdate(update: unknown, socket: unknown, fencingToken: number): Promise<void>;
      clearAuthDir(): Promise<void>;
      teardownRealSocket(resetPhone: boolean): Promise<void>;
      releaseSessionOwnership(): Promise<void>;
    };
    internal.real.socket = socket;
    jest.spyOn(internal, 'clearAuthDir').mockResolvedValue(undefined);
    jest.spyOn(internal, 'teardownRealSocket').mockResolvedValue(undefined);
    jest.spyOn(internal, 'releaseSessionOwnership').mockResolvedValue(undefined);

    await internal.onRealConnectionUpdate({ connection: 'open' }, socket, 1);

    expect(internal.real).toMatchObject({
      connectionStatus: 'FAILED',
      lastErrorCode: 'WHATSAPP_SESSION_OWNER_EVIDENCE_MISSING',
    });
    expect(socket.logout).toHaveBeenCalledTimes(1);
  });

  it('rejects and cleans a socket whose connected account does not match', async () => {
    const { instance, auditLog } = subject();
    authorizeLease(instance);
    const socket = {
      user: {
        id: '123456789012345@lid',
        phoneNumber: '573009999999:7@s.whatsapp.net',
      },
      logout: jest.fn().mockResolvedValue(undefined),
    };
    const internal = instance as unknown as {
      real: { socket: unknown; connectionStatus: string; lastErrorCode: string | null };
      onRealConnectionUpdate(update: unknown, socket: unknown, fencingToken: number): Promise<void>;
      clearAuthDir(): Promise<void>;
      teardownRealSocket(resetPhone: boolean): Promise<void>;
      releaseSessionOwnership(): Promise<void>;
    };
    internal.real.socket = socket;
    jest.spyOn(internal, 'clearAuthDir').mockResolvedValue(undefined);
    jest.spyOn(internal, 'teardownRealSocket').mockResolvedValue(undefined);
    jest.spyOn(internal, 'releaseSessionOwnership').mockResolvedValue(undefined);

    await internal.onRealConnectionUpdate({ connection: 'open' }, socket, 1);

    expect(internal.real).toMatchObject({
      connectionStatus: 'FAILED',
      lastErrorCode: 'WHATSAPP_PROVIDER_ACCOUNT_MISMATCH',
    });
    expect(socket.logout).toHaveBeenCalledTimes(1);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SOFIA_QR_CONNECTED_BINDING_REJECTED' }),
    );
  });

  it('uses a PN remoteJidAlt for an inbound LID without exposing the LID as a phone', async () => {
    const { instance, processInboundWebhook } = subject();
    const internal = instance as unknown as {
      real: {
        phoneNumber: string | null;
        verifiedBinding: {
          providerAccountId: string;
          businessIdentity: string;
          sessionOwner: string;
        } | null;
      };
      onRealMessagesUpsert(payload: unknown, socket: unknown, fencingToken: number): Promise<void>;
    };
    authorizeBinding(instance);
    jest
      .spyOn(instance as never, 'runFencedOwnerEffect' as never)
      .mockImplementation((async (_socket: unknown, _token: number, operation: () => unknown) =>
        operation()) as never);

    await internal.onRealMessagesUpsert(
      {
        messages: [
          {
            key: {
              id: 'lid-message-1',
              fromMe: false,
              remoteJid: '123456789012345@lid',
              remoteJidAlt: '573109876543:9@s.whatsapp.net',
            },
            message: { conversation: 'Hola' },
            messageTimestamp: 1_786_000_000,
          },
        ],
      },
      {} as never,
      1,
    );

    expect(processInboundWebhook).toHaveBeenCalledWith(
      'qr_gateway',
      expect.objectContaining({
        providerAccountId: '573001234567',
        businessIdentity: '123456789012345@lid',
        sessionOwner: 'sofia-main',
        phone: '573109876543',
        text: 'Hola',
      }),
      expect.any(Object),
      { trustedBaileysTransport: true },
    );
  });

  it('rejects LID inbound without a PN alternative and never invokes processing', async () => {
    const { instance, processInboundWebhook } = subject();
    authorizeBinding(instance);
    const internal = instance as unknown as {
      onRealMessagesUpsert(payload: unknown, socket: unknown, fencingToken: number): Promise<void>;
    };
    jest
      .spyOn(instance as never, 'runFencedOwnerEffect' as never)
      .mockImplementation((async (_socket: unknown, _token: number, operation: () => unknown) =>
        operation()) as never);

    await internal.onRealMessagesUpsert(
      {
        messages: [
          {
            key: { id: 'lid-message-2', fromMe: false, remoteJid: '123456789012345@lid' },
            message: { conversation: 'Ignorar' },
          },
        ],
      },
      {} as never,
      1,
    );

    expect(processInboundWebhook).not.toHaveBeenCalled();
  });

  it('does not treat a PN alternate on a group or unknown JID as a direct customer', async () => {
    const { instance, processInboundWebhook } = subject();
    authorizeBinding(instance);
    const internal = instance as unknown as {
      onRealMessagesUpsert(payload: unknown, socket: unknown, fencingToken: number): Promise<void>;
    };

    await internal.onRealMessagesUpsert(
      {
        messages: [
          {
            key: {
              id: 'group-message',
              fromMe: false,
              remoteJid: '1234567890@g.us',
              remoteJidAlt: '573109876543@s.whatsapp.net',
            },
            message: { conversation: 'No es chat individual' },
          },
        ],
      },
      {} as never,
      1,
    );

    expect(processInboundWebhook).not.toHaveBeenCalled();
  });

  it('stops a live socket when receive permission is revoked before inbound processing', async () => {
    const { instance, processInboundWebhook, auditLog } = subject({
      WHATSAPP_QR_ALLOW_RECEIVE: false,
    });
    const internal = instance as unknown as {
      real: { socket: unknown; connectionStatus: string; lastErrorCode: string | null };
      onRealMessagesUpsert(payload: unknown, socket: unknown, fencingToken: number): Promise<void>;
      teardownRealSocket(resetPhone: boolean): Promise<void>;
      releaseSessionOwnership(): Promise<void>;
    };
    const socket = {};
    internal.real.socket = socket;
    const teardown = jest.spyOn(internal, 'teardownRealSocket').mockResolvedValue(undefined);
    const release = jest.spyOn(internal, 'releaseSessionOwnership').mockResolvedValue(undefined);

    await internal.onRealMessagesUpsert(
      {
        messages: [
          {
            key: {
              id: 'blocked-message',
              fromMe: false,
              remoteJid: '573109876543@s.whatsapp.net',
            },
            message: { conversation: 'No procesar' },
          },
        ],
      },
      socket,
      1,
    );

    expect(processInboundWebhook).not.toHaveBeenCalled();
    expect(internal.real).toMatchObject({
      connectionStatus: 'FAILED',
      lastErrorCode: 'QR_RECEIVE_DISABLED',
    });
    expect(teardown).toHaveBeenCalledWith(false);
    expect(release).toHaveBeenCalledTimes(1);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SOFIA_QR_INBOUND_BLOCKED' }),
    );
  });
});
