import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type {
  BaileysEventMap,
  WASocket,
  WAMessageContent,
} from '@whiskeysockets/baileys';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import type { AuthUser } from '../../../../common/types/auth-user.type';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AuditService } from '../../../audit/audit.service';
import { SofiaWhatsappService } from '../../sofia-whatsapp.service';
import { redactSensitiveText } from '../../privacy/sofia-pii-redaction';
import { SofiaWhatsappQrGatewayProvider } from './sofia-whatsapp-qr-gateway.provider';
import {
  QrSessionLease,
  QrSessionOwnershipCoordinator,
} from './qr-session-ownership.coordinator';
import {
  SofiaWhatsappQrConnectionStatus,
  SofiaWhatsappQrDiscoveryResult,
  SofiaWhatsappQrStatusResponse,
} from './sofia-whatsapp-qr-gateway.types';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const QR_SESSION_SETTING_KEY = 'SOFIA_WHATSAPP_QR_SESSION_STATE';
const QR_SESSION_LEASE_MS = 30_000;
const QR_SESSION_HEARTBEAT_MS = 10_000;
/** Bootstrap-only: cuánto vive en memoria un resultado de `WHATSAPP_QR_DISCOVERY_MODE` sin leerse. */
const QR_DISCOVERY_RESULT_TTL_MS = 5 * 60_000;
const QR_RUNTIME_GATE_SETTING_KEYS = {
  globalPaused: 'SOFIA_GLOBAL_PAUSED',
  killSwitch: 'SOFIA_KILL_SWITCH',
  qrRealAllowed: 'SOFIA_QR_REAL_ALLOWED',
} as const;

type QrSessionState = {
  status?: SofiaWhatsappQrConnectionStatus;
  mode?: 'disabled' | 'receive_only' | 'supervised' | 'auto_safe';
  sessionName?: string;
  qrString?: string | null;
  qrImageDataUrl?: string | null;
  lastQrAt?: string | null;
  lastConnectedAt?: string | null;
  lastDisconnectedAt?: string | null;
  lastError?: string | null;
  phoneNumber?: string | null;
  deviceName?: string | null;
  reconnectAttempts?: number;
  updatedAt?: string;
};

type RealSocketState = {
  socket: WASocket | null;
  connectionStatus: SofiaWhatsappQrConnectionStatus;
  qrString: string | null;
  qrImageDataUrl: string | null;
  qrIssuedAt: string | null;
  lastError: string | null;
  lastErrorCode: string | null;
  lastConnectionUpdateAt: string | null;
  phoneNumber: string | null;
  verifiedBinding: VerifiedQrBinding | null;
  deviceName: string | null;
  bootstrapPromise: Promise<void> | null;
  loggedOutCode: number | null;
};

type VerifiedQrBinding = {
  providerAccountId: string;
  businessIdentity: string;
  sessionOwner: string;
};

@Injectable()
export class SofiaWhatsappQrGatewayService implements OnModuleDestroy {
  private readonly logger = new Logger(SofiaWhatsappQrGatewayService.name);
  private readonly ownership: QrSessionOwnershipCoordinator;
  private activeLease: QrSessionLease | null = null;
  private leaseHeartbeat: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private intentionalShutdown = false;
  private fencedEffects = 0;
  /** Solo `WHATSAPP_QR_DISCOVERY_MODE` — nunca persistido, se lee una vez y se borra. */
  private discoveryResult: SofiaWhatsappQrDiscoveryResult | null = null;

  /* Real Baileys socket state */
  private real: RealSocketState = {
    socket: null,
    connectionStatus: 'DISCONNECTED',
    qrString: null,
    qrImageDataUrl: null,
    qrIssuedAt: null,
    lastError: null,
    lastErrorCode: null,
    lastConnectionUpdateAt: null,
    phoneNumber: null,
    verifiedBinding: null,
    deviceName: null,
    bootstrapPromise: null,
    loggedOutCode: null,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly configService: ConfigService,
    private readonly sofiaWhatsappService: SofiaWhatsappService,
    private readonly qrProvider: SofiaWhatsappQrGatewayProvider,
  ) {
    this.ownership = new QrSessionOwnershipCoordinator(this.prisma, QR_SESSION_LEASE_MS);
  }

  async onModuleDestroy() {
    this.intentionalShutdown = true;
    this.cancelReconnect();
    this.stopLeaseHeartbeat();
    await this.teardownRealSocket(false);
    await this.releaseSessionOwnership();
  }

  /* ================================================================ */
  /*  PUBLIC API                                                       */
  /* ================================================================ */

  async getStatus(): Promise<SofiaWhatsappQrStatusResponse> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    /* If we have a real socket, return real state */
    const [state, inboundToday, outboundToday, pendingOutbound, sessionStorage, runtimeGate] = await Promise.all([
      this.getSessionState(),
      this.prisma.whatsappInboundEvent.count({
        where: { provider: 'qr_gateway', receivedAt: { gte: todayStart } },
      }),
      this.prisma.whatsappOutboundMessage.count({
        where: { provider: 'qr_gateway', sentAt: { gte: todayStart } },
      }),
      this.prisma.whatsappOutboundMessage.count({
        where: {
          provider: 'qr_gateway',
          status: { in: ['QUEUED', 'RETRYING', 'APPROVAL_PENDING', 'SUGGESTED'] },
        },
      }),
      this.ensureSessionStorageReady(false),
      this.getQrRuntimeGate(),
    ]);

    /* Merge real socket state with persisted state */
    const realConnected = this.real.connectionStatus === 'CONNECTED';
    const realQrAvailable =
      this.real.connectionStatus === 'QR_READY' && Boolean(this.real.qrImageDataUrl);

    /*
     * F8B hardening: public QR/CONNECTED state must only come from the live
     * Baileys socket. Persisted state is audit metadata, not connection proof.
     */
    const enabled = runtimeGate.allowed;
    const status: SofiaWhatsappQrConnectionStatus = !enabled
      ? 'DISABLED'
      : this.real.socket
        ? this.real.connectionStatus
        : this.safePersistedStatus(state.status);

    const qrAvailable = realQrAvailable;

    const connected = realConnected;
    const adapterReal = Boolean(this.real.socket);
    const ok = adapterReal && (qrAvailable || connected);
    const reason = runtimeGate.allowed
      ? this.statusReason({ status, adapterReal, qrAvailable, connected })
      : runtimeGate.reason;
    const operatorMessage = runtimeGate.allowed
      ? this.operatorMessage({ status, adapterReal, qrAvailable, connected })
      : runtimeGate.reason === 'QR_GATEWAY_DISABLED'
        ? 'WhatsApp QR está deshabilitado por configuración.'
        : 'WhatsApp QR está bloqueado por gobernanza operativa.';

    return {
      provider: 'qr_gateway',
      mode: this.resolveMode(state),
      status,
      ok,
      connected,
      adapterReal,
      phoneNumber: this.real.phoneNumber
        ? this.maskPhone(this.real.phoneNumber)
        : state.phoneNumber
          ? this.maskPhone(state.phoneNumber)
          : null,
      deviceName: this.real.deviceName ?? state.deviceName ?? null,
      qrAvailable,
      qrImageDataUrl: qrAvailable ? this.real.qrImageDataUrl : null,
      qrString: null,
      qrIssuedAt: this.real.qrIssuedAt ?? state.lastQrAt ?? null,
      qrExpiresAt: realQrAvailable
        ? new Date(Date.now() + 60_000).toISOString()
        : null,
      lastQrAt: state.lastQrAt ?? null,
      lastConnectedAt: state.lastConnectedAt ?? null,
      lastDisconnectedAt: state.lastDisconnectedAt ?? null,
      lastError: this.sanitizeErrorMessage(this.real.lastError ?? state.lastError ?? null),
      lastErrorCode: this.real.lastErrorCode ?? (status === 'FAILED' ? 'REAL_ADAPTER_BOOTSTRAP_FAILED' : null),
      lastErrorMessage: this.sanitizeErrorMessage(this.real.lastError ?? state.lastError ?? null),
      lastConnectionUpdateAt: this.real.lastConnectionUpdateAt ?? null,
      sessionName: this.sessionName(state),
      sessionPathSanitized: this.sessionPathSanitized(),
      storageWritable: sessionStorage.ok,
      sessionStorageReady: sessionStorage.ok,
      inboundToday,
      outboundToday,
      pendingOutbound,
      realSendingEnabled: false,
      autoReplyEnabled: false,
      deepSeekEnabled: false,
      productionBlocked: true,
      blockers: this.blockers(),
      warnings: [
        this.real.socket
          ? 'F8B: adapter real Baileys activo en receive_only.'
          : 'F8B: adapter real pendiente de iniciar; no hay QR/CONNECTED sin socket Baileys vivo.',
        'El envío real permanece bloqueado.',
        'Escanea el QR con WhatsApp Business para conectar.',
      ],
      reason,
      operatorMessage,
      updatedAt: state.updatedAt ?? now.toISOString(),
    };
  }

  async connect(actor: AuthUser) {
    this.assertSessionMutationAccess(actor);
    const actorId = actor.sub;
    this.intentionalShutdown = false;
    const runtimeGate = await this.getQrRuntimeGate();
    if (!runtimeGate.allowed) {
      await this.audit('SOFIA_QR_CONNECT_BLOCKED', actorId, {
        reason: runtimeGate.reason,
        valuesSanitized: true,
      });
      throw new BadRequestException({
        status: 'BLOCKED',
        reason: runtimeGate.reason,
        message: 'WhatsApp QR permanece bloqueado por gobernanza operativa.',
      });
    }

    const now = new Date();
    const sessionName = this.sessionName(await this.getSessionState());
    const sessionStorage = await this.ensureSessionStorageReady(true);

    if (!sessionStorage.ok) {
      const message = sessionStorage.error ?? 'QR session storage is not writable.';
      this.real.connectionStatus = 'FAILED';
      this.real.lastError = message;
      this.real.lastErrorCode = 'QR_SESSION_STORAGE_NOT_WRITABLE';
      await this.saveSessionState(
        {
          status: 'FAILED',
          mode: 'receive_only',
          sessionName,
          lastError: message,
          updatedAt: new Date().toISOString(),
        },
        actorId,
        'SOFIA_QR_CONNECT_STORAGE_NOT_WRITABLE',
      );
      return this.getStatus();
    }

    /* Bootstrap the REAL Baileys socket */
    try {
      this.activeLease = await this.ownership.acquire(sessionName);
      this.startLeaseHeartbeat();
      await this.bootstrapRealSocket(sessionName);
      await this.waitForRealQrOrConnection(15_000);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al iniciar adapter real';
      this.real.connectionStatus = 'FAILED';
      this.real.lastError = message;
      this.real.lastErrorCode = 'REAL_ADAPTER_BOOTSTRAP_FAILED';
      this.logger.error(`Real QR bootstrap failed: ${message}`);
      await this.teardownRealSocket(false);
      await this.releaseSessionOwnership();
      await this.saveSessionState(
        {
          status: 'FAILED',
          mode: 'receive_only',
          sessionName,
          lastError: message,
          updatedAt: new Date().toISOString(),
        },
        actorId,
        'SOFIA_QR_CONNECT_REAL_FAILED',
      );
      return this.getStatus();
    }

    /* Save the real QR reference in persisted state */
    await this.saveSessionState(
      {
        status: this.real.connectionStatus,
        mode: 'receive_only',
        sessionName,
        qrString: null,
        qrImageDataUrl: null,
        lastQrAt: this.real.qrIssuedAt ?? now.toISOString(),
        lastError: null,
        updatedAt: now.toISOString(),
      },
      actorId,
      'SOFIA_QR_CONNECT_REAL',
    );

    return this.getStatus();
  }

  async getCode() {
    const status = await this.getStatus();
    return {
      provider: 'qr_gateway' as const,
      mode: status.mode,
      status: status.status,
      ok: status.ok,
      adapterReal: status.adapterReal,
      qrAvailable: status.qrAvailable,
      qrString: null,
      imageDataUrl: status.qrImageDataUrl,
      lastQrAt: status.lastQrAt,
      expiresHint: status.qrAvailable
        ? 'QR real de WhatsApp. Escanea con WhatsApp Business. Válido por ~60 segundos.'
        : null,
      reason: status.reason,
      operatorMessage: status.operatorMessage,
      noSecrets: true,
      noSessionAuth: true,
      noQrRaw: true,
    };
  }

  async disconnect(actor: AuthUser) {
    this.assertSessionMutationAccess(actor);
    const actorId = actor.sub;
    this.intentionalShutdown = true;
    const now = new Date();
    const state = await this.getSessionState();

    /* Tear down real socket */
    this.cancelReconnect();
    await this.teardownRealSocket(true);
    await this.releaseSessionOwnership();

    await this.saveSessionState(
      {
        ...state,
        status: 'DISCONNECTED',
        qrString: null,
        qrImageDataUrl: null,
        lastDisconnectedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      actorId,
      'SOFIA_QR_DISCONNECT',
    );
    return this.getStatus();
  }

  async logout(actor: AuthUser) {
    this.assertSessionMutationAccess(actor);
    const actorId = actor.sub;
    this.intentionalShutdown = true;
    const now = new Date();
    const state = await this.getSessionState();

    this.cancelReconnect();
    if (!this.activeLease) {
      this.activeLease = await this.ownership.acquire(this.sessionName(state));
    }

    const socket = this.real.socket;
    await this.runFencedLeaseEffect(async () => {
      if (socket) {
        try {
          await socket.logout();
        } catch {
          // A local cleanup remains necessary after a transport failure.
        }
      }
      await this.teardownRealSocket(true);
      await this.clearAuthDir();
    });
    await this.releaseSessionOwnership();

    await this.saveSessionState(
      {
        sessionName: this.sessionName(state),
        status: 'LOGGED_OUT',
        mode: 'receive_only',
        qrString: null,
        qrImageDataUrl: null,
        lastDisconnectedAt: now.toISOString(),
        lastError: null,
        updatedAt: now.toISOString(),
      },
      actorId,
      'SOFIA_QR_LOGOUT',
    );
    return this.getStatus();
  }

  private assertSessionMutationAccess(actor: AuthUser) {
    const hasAllowedRole = Array.isArray(actor?.roles)
      && actor.roles.some((role) => role === 'admin' || role === 'supervisor');
    const hasCapability = Array.isArray(actor?.permissions)
      && actor.permissions.includes('settings.update');
    if (!actor?.sub || !hasAllowedRole || !hasCapability) {
      throw new ForbiddenException({ code: 'SOFIA_QR_SESSION_MUTATION_FORBIDDEN' });
    }
  }

  async testInbound(input: {
    phone: string;
    text?: string;
    externalMessageId?: string;
    messageType?: 'TEXT' | 'IMAGE' | 'AUDIO' | 'DOCUMENT' | 'INTERACTIVE' | 'SYSTEM';
    fromMe?: boolean;
    mediaUrl?: string;
    mediaMimeType?: string;
    transcript?: string;
  }, actor: AuthUser) {
    this.assertTestMutationAccess(actor);
    if (!input.phone) throw new BadRequestException('phone es requerido para inbound QR.');

    const externalMessageId =
      input.externalMessageId ||
      `qr-test-${createHash('sha256')
        .update(`${input.phone}:${input.text ?? ''}`)
        .digest('hex')
        .slice(0, 16)}`;

    const rawPayload = {
      provider: 'qr_gateway',
      externalMessageId,
      providerEventId: `qr-event-${externalMessageId}`,
      phone: input.phone,
      text: input.text ?? '',
      messageType: input.messageType ?? 'TEXT',
      fromMe: input.fromMe === true,
      mediaUrl: input.mediaUrl,
      mediaMimeType: input.mediaMimeType,
      transcript: input.transcript,
      rawSummaryJson: {
        source: 'F5_TEST_INBOUND',
        hasText: Boolean(input.text),
        hasMedia: Boolean(input.mediaUrl),
        fromMe: input.fromMe === true,
      },
    };

    if (input.fromMe === true) {
      await this.persistFromMeInbound(rawPayload);
      return {
        provider: 'qr_gateway' as const,
        mode: 'receive_only' as const,
        processingStatus: 'FROM_ME_IGNORED',
        duplicate: false,
        outbound: null,
        noWhatsappReal: true,
      };
    }

    const result = await this.sofiaWhatsappService.processInboundWebhook(
      'qr_gateway',
      rawPayload,
      {
        'x-sofia-whatsapp-mode': 'receive_only',
        'x-sofia-whatsapp-provider': 'qr_gateway',
      },
      { trustedInternalValidation: true },
    );

    return {
      ...result,
      provider: 'qr_gateway' as const,
      mode: 'receive_only' as const,
      realSendingEnabled: false,
      noWhatsappReal: true,
    };
  }

  async listInboundEvents(limit = 20) {
    const safeLimit = Math.min(Math.max(Number.isFinite(limit) ? limit : 20, 1), 100);
    const events = await this.prisma.whatsappInboundEvent.findMany({
      where: { provider: 'qr_gateway' },
      orderBy: { receivedAt: 'desc' },
      take: safeLimit,
      select: {
        id: true,
        provider: true,
        providerEventId: true,
        providerMessageId: true,
        phone: true,
        processingStatus: true,
        errorMessage: true,
        receivedAt: true,
        processedAt: true,
        rawPayload: true,
      },
    });
    return {
      provider: 'qr_gateway' as const,
      mode: 'receive_only' as const,
      realSendingEnabled: false,
      events: events.map((event) => ({
        ...event,
        phone: event.phone ? this.maskPhone(event.phone) : event.phone,
        rawPayloadSummary:
          event.rawPayload && typeof event.rawPayload === 'object' && !Array.isArray(event.rawPayload)
            ? (event.rawPayload as { summary?: unknown }).summary ?? null
            : null,
        rawPayload: undefined,
      })),
    };
  }

  async testSend(
    input: { to?: string; phone?: string; body?: string; text?: string },
    actor: AuthUser,
  ) {
    this.assertTestMutationAccess(actor);
    const to = input.to ?? input.phone ?? '';
    const body = input.body ?? input.text ?? '';
    if (!to || !body)
      throw new BadRequestException(
        'phone/text o to/body son requeridos para validar bloqueo de envío QR.',
      );

    await this.audit('SOFIA_QR_REAL_SEND_BLOCKED', actor.sub, {
      reason: 'BLOCKED_REAL_SEND_DISABLED',
    });

    return {
      provider: 'qr_gateway' as const,
      status: 'BLOCKED_REAL_SEND_DISABLED' as const,
      sent: false,
      realSendingEnabled: false,
    };
  }

  private assertTestMutationAccess(actor: AuthUser) {
    this.assertSessionMutationAccess(actor);
    if (this.configService.get<string>('NODE_ENV') !== 'test') {
      throw new NotFoundException({ code: 'SOFIA_TEST_ONLY_ROUTE_UNAVAILABLE' });
    }
  }

  /* ================================================================ */
  /*  REAL BAILEYS SOCKET                                             */
  /* ================================================================ */

  private async bootstrapRealSocket(sessionName: string) {
    /* If already connected or connecting, don't restart */
    if (this.real.socket && this.real.connectionStatus === 'CONNECTED') {
      return;
    }

    /* If bootstrapping in progress, wait for it */
    if (this.real.bootstrapPromise) {
      await this.real.bootstrapPromise;
      return;
    }

    await this.assertSessionOwnership();
    this.real.bootstrapPromise = this.createRealSocket(sessionName);
    try {
      await this.real.bootstrapPromise;
    } finally {
      this.real.bootstrapPromise = null;
    }
  }

  private async waitForRealQrOrConnection(timeoutMs: number) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (
        this.real.connectionStatus === 'QR_READY' ||
        this.real.connectionStatus === 'CONNECTED' ||
        this.real.connectionStatus === 'FAILED' ||
        this.real.connectionStatus === 'LOGGED_OUT'
      ) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  private async createRealSocket(_sessionName: string) {
    await this.assertSessionOwnership();
    const sessionStorage = await this.ensureSessionStorageReady(true);
    if (!sessionStorage.ok) {
      throw new Error(sessionStorage.error ?? 'QR session storage is not writable.');
    }
    const authDir = await this.resolveSessionDirectory();

    this.real.connectionStatus = 'CONNECTING';
    this.real.lastError = null;
    this.real.lastErrorCode = null;

    const baileys = await import('@whiskeysockets/baileys');
    const { state, saveCreds } = await baileys.useMultiFileAuthState(authDir);
    const { version } = await baileys.fetchLatestBaileysVersion();
    this.real.loggedOutCode = baileys.DisconnectReason.loggedOut;

    const socket = baileys.default({
      auth: state,
      version,
      browser: baileys.Browsers.macOS('2x1 Burger Co'),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      defaultQueryTimeoutMs: 45000,
    });

    this.real.socket = socket;
    this.real.connectionStatus = 'WAITING_QR';
    const fencingToken = this.activeLease!.fencingToken;

    /* ---- Event handlers ---- */
    socket.ev.on('creds.update', () => {
      void this.runFencedOwnerEffect(socket, fencingToken, saveCreds).catch((error) => {
        this.logger.warn(
          `QR credential write blocked: ${this.sanitizeErrorMessage(error instanceof Error ? error.message : String(error))}`,
        );
      });
    });

    socket.ev.on('connection.update', (update) => {
      void this.runIfCurrentOwner(socket, fencingToken, () =>
        this.onRealConnectionUpdate(update, socket, fencingToken),
      );
    });

    socket.ev.on('messages.upsert', (payload) => {
      void this.runIfCurrentOwner(socket, fencingToken, () =>
        this.onRealMessagesUpsert(payload, socket, fencingToken),
      );
    });
    socket.ev.on('messages.update', (updates) => {
      void this.runIfCurrentOwner(socket, fencingToken, () =>
        this.onRealMessageUpdates(updates, socket, fencingToken),
      );
    });
  }

  private async onRealConnectionUpdate(
    update: BaileysEventMap['connection.update'],
    socket: WASocket,
    fencingToken: number,
  ) {
    this.real.lastConnectionUpdateAt = new Date().toISOString();

    /* Real QR received from WhatsApp servers */
    if (update.qr) {
      try {
        const qrImageDataUrl = await QRCode.toDataURL(update.qr, {
          margin: 1,
          width: 280,
          color: { dark: '#111827', light: '#ffffff' },
        });
        this.real.qrString = update.qr;
        this.real.qrImageDataUrl = qrImageDataUrl;
        this.real.qrIssuedAt = new Date().toISOString();
        this.real.connectionStatus = 'QR_READY';
        this.real.lastError = null;
        this.real.lastErrorCode = null;
        this.logger.log('Real WhatsApp QR generated — scan with WhatsApp Business.');
      } catch (error) {
        this.logger.error('Failed to encode real QR', error);
      }
    }

    /* Connected */
    if (update.connection === 'open') {
      const discoveryMode = this.configService.get<boolean>('WHATSAPP_QR_DISCOVERY_MODE') === true;
      const runtimeGate = await this.getQrRuntimeGate({ skipGovernanceApproval: discoveryMode });
      if (!runtimeGate.allowed) {
        await this.rejectConnectedSocket(socket, runtimeGate.reason);
        return;
      }

      if (discoveryMode) {
        await this.completeDiscoverySession(socket, fencingToken);
        return;
      }

      const binding = this.connectedAccountBinding(socket, fencingToken);
      if (!binding.ok) {
        await this.rejectConnectedSocket(socket, binding.reason);
        return;
      }

      this.real.connectionStatus = 'CONNECTED';
      this.real.qrString = null;
      this.real.qrImageDataUrl = null;
      this.real.phoneNumber = binding.value.providerAccountId;
      this.real.verifiedBinding = binding.value;
      this.real.lastError = null;
      this.real.lastErrorCode = null;
      this.reconnectAttempts = 0;
      this.logger.log(
        `WhatsApp QR Gateway CONNECTED (${this.maskPhone(binding.value.providerAccountId)})`,
      );
    }

    /* Disconnected / Error */
    if (update.connection === 'close') {
      const statusCode = this.extractDisconnectCode(update.lastDisconnect?.error);
      const loggedOut = statusCode !== null && statusCode === this.real.loggedOutCode;

      if (loggedOut) {
        await this.runFencedOwnerEffect(socket, fencingToken, () => this.clearAuthDir());
      }

      await this.teardownRealSocket(false);

      this.real.connectionStatus = loggedOut ? 'LOGGED_OUT' : 'RECONNECTING';
      this.real.qrString = null;
      this.real.qrImageDataUrl = null;
      this.real.lastError = loggedOut
        ? 'La sesión de WhatsApp se cerró. Genera un nuevo QR.'
        : 'WhatsApp perdió la conexión. Se aplicará reconexión acotada.';
      this.real.lastErrorCode = loggedOut ? 'LOGGED_OUT' : 'CONNECTION_CLOSED';
      if (loggedOut || this.intentionalShutdown) {
        await this.releaseSessionOwnership();
      } else {
        await this.scheduleReconnect();
      }
    }
  }

  private async onRealMessagesUpsert(
    payload: BaileysEventMap['messages.upsert'],
    socket: WASocket,
    fencingToken: number,
  ) {
    if (!payload?.messages?.length) return;

    const runtimeGate = await this.getQrRuntimeGate();
    if (!runtimeGate.allowed) {
      await this.audit('SOFIA_QR_INBOUND_BLOCKED', 'system', {
        reason: runtimeGate.reason,
        valuesSanitized: true,
      });
      this.real.connectionStatus = 'FAILED';
      this.real.lastErrorCode = runtimeGate.reason;
      await this.teardownRealSocket(false);
      await this.releaseSessionOwnership();
      return;
    }

    for (const msg of payload.messages) {
      const binding = this.real.verifiedBinding;
      if (!binding) {
        await this.rejectUnverifiedInbound(socket);
        return;
      }
      const key = msg?.key ?? {};
      /* Ignore outbound from this device */
      if (key.fromMe) continue;

      const remoteJid = key?.remoteJid ?? '';
      if (remoteJid === 'status@broadcast') continue;
      const phone = this.phoneFromMessageAddress(remoteJid, key.remoteJidAlt);

      if (!phone) continue;

      /* Extract text from WhatsApp message */
      const msgContent: WAMessageContent = msg.message ?? {};
      const conversation =
        msgContent.conversation ??
        msgContent.extendedTextMessage?.text ??
        msgContent.imageMessage?.caption ??
        msgContent.videoMessage?.caption ??
        '';
      const text = typeof conversation === 'string' ? conversation : '';
      const mediaContent =
        msgContent.audioMessage ??
        msgContent.imageMessage ??
        msgContent.videoMessage ??
        msgContent.documentMessage;
      const messageType = msgContent.audioMessage
        ? 'AUDIO'
        : msgContent.imageMessage || msgContent.videoMessage
          ? 'IMAGE'
          : msgContent.documentMessage
            ? 'DOCUMENT'
          : msgContent.buttonsResponseMessage || msgContent.listResponseMessage
            ? 'INTERACTIVE'
            : msgContent.locationMessage
              ? 'SYSTEM'
              : 'TEXT';
      const providerTimestamp = Number(msg.messageTimestamp ?? 0);

      /* Build inbound payload matching existing format */
      const rawPayload = {
        provider: 'qr_gateway',
        providerAccountId: binding.providerAccountId,
        businessIdentity: binding.businessIdentity,
        sessionOwner: binding.sessionOwner,
        externalMessageId: key?.id ?? `real-${Date.now()}`,
        providerEventId: `wa-${key?.id ?? Date.now()}`,
        providerMessageId: String(key?.id ?? ''),
        phone,
        text,
        messageType,
        mediaReference: mediaContent ? String(key?.id ?? '') : undefined,
        mediaMimeType: mediaContent?.mimetype ?? undefined,
        mediaSizeBytes: mediaContent?.fileLength == null ? undefined : Number(mediaContent.fileLength),
        fromMe: false,
        timestamp:
          Number.isFinite(providerTimestamp) && providerTimestamp > 0
            ? new Date(providerTimestamp * 1_000).toISOString()
            : undefined,
        receivedAt: new Date().toISOString(),
        rawSummaryJson: {
          source: 'REAL_BAILEYS_INBOUND',
          hasText: Boolean(text),
          hasMedia: Boolean(mediaContent),
          jidType: 'individual',
        },
      };

      try {
        await this.runFencedOwnerEffect(socket, fencingToken, () =>
          this.sofiaWhatsappService.processInboundWebhook(
            'qr_gateway',
            rawPayload,
            {
              'x-sofia-whatsapp-mode': 'receive_only',
              'x-sofia-whatsapp-provider': 'qr_gateway',
            },
            { trustedBaileysTransport: true },
          ),
        );
        this.logger.log(`Real inbound processed from ${this.maskPhone(phone)}`);
      } catch (error) {
        this.logger.error(
          `Failed to process real inbound from ${this.maskPhone(phone)}: ${this.sanitizeErrorMessage(error instanceof Error ? error.message : String(error)) ?? 'UNKNOWN_ERROR'}`,
        );
      }
    }
  }

  private async onRealMessageUpdates(
    updates: BaileysEventMap['messages.update'],
    socket: WASocket,
    fencingToken: number,
  ) {
    const binding = this.real.verifiedBinding;
    if (!binding) {
      await this.rejectUnverifiedInbound(socket);
      return;
    }
    for (const item of updates) {
      const messageId = item.key.id;
      const remoteJid = item.key.remoteJid ?? '';
      const status = this.normalizedDeliveryStatus(item.update.status);
      const recipient = this.phoneFromMessageAddress(remoteJid, item.key.remoteJidAlt);
      if (!messageId || !recipient || !status) continue;
      try {
        await this.runFencedOwnerEffect(socket, fencingToken, () =>
          this.sofiaWhatsappService.processInboundWebhook(
            'qr_gateway',
            {
              provider: 'qr_gateway',
              providerAccountId: binding.providerAccountId,
              businessIdentity: binding.businessIdentity,
              sessionOwner: binding.sessionOwner,
              providerEventId: `wa-status-${messageId}-${status}`,
              providerMessageId: messageId,
              recipient,
              status,
              eventType: 'status',
              receivedAt: new Date().toISOString(),
            },
            { 'x-sofia-whatsapp-mode': 'receive_only', 'x-sofia-whatsapp-provider': 'qr_gateway' },
            { trustedBaileysTransport: true },
          ),
        );
      } catch (error) {
        this.logger.warn(
          `Baileys status event rejected: ${this.sanitizeErrorMessage(error instanceof Error ? error.message : String(error)) ?? 'UNKNOWN_ERROR'}`,
        );
      }
    }
  }

  private normalizedDeliveryStatus(status: number | null | undefined) {
    const values: Record<number, 'ACCEPTED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'> = {
      0: 'FAILED',
      1: 'ACCEPTED',
      2: 'SENT',
      3: 'DELIVERED',
      4: 'READ',
      5: 'READ',
    };
    return status == null ? null : values[status] ?? null;
  }

  private async runIfCurrentOwner(
    socket: WASocket,
    fencingToken: number,
    operation: () => Promise<unknown> | unknown,
  ): Promise<void> {
    if (
      this.intentionalShutdown ||
      this.real.socket !== socket ||
      this.activeLease?.fencingToken !== fencingToken
    ) {
      return;
    }
    try {
      await this.assertSessionOwnership();
    } catch (error) {
      const code = error instanceof Error ? error.message : 'QR_SESSION_FENCE_LOST';
      this.logger.warn(`QR owner operation blocked: ${this.sanitizeErrorMessage(code)}`);
      if (this.real.socket === socket) {
        await this.handleOwnershipLoss();
      }
      return;
    }
    try {
      if (
        this.intentionalShutdown ||
        this.real.socket !== socket ||
        this.activeLease?.fencingToken !== fencingToken
      ) {
        return;
      }
      await operation();
    } catch (error) {
      this.logger.warn(
        `QR owner callback failed: ${this.sanitizeErrorMessage(error instanceof Error ? error.message : String(error))}`,
      );
    }
  }

  private async runFencedOwnerEffect<T>(
    socket: WASocket,
    fencingToken: number,
    operation: () => Promise<T> | T,
  ): Promise<T | undefined> {
    if (
      this.intentionalShutdown ||
      this.real.socket !== socket ||
      this.activeLease?.fencingToken !== fencingToken
    ) {
      return undefined;
    }

    return this.runFencedLeaseEffect(() => {
      if (
        this.intentionalShutdown ||
        this.real.socket !== socket ||
        this.activeLease?.fencingToken !== fencingToken
      ) {
        return undefined;
      }
      return operation();
    });
  }

  private async runFencedLeaseEffect<T>(
    operation: () => Promise<T> | T,
  ): Promise<T> {
    if (!this.activeLease) {
      throw new Error('QR_SESSION_OWNER_REQUIRED');
    }
    const lease = this.activeLease;
    this.fencedEffects += 1;
    try {
      const fenced = await this.ownership.runFenced(lease, operation);
      if (this.activeLease?.fencingToken === lease.fencingToken) {
        this.activeLease = fenced.lease;
      }
      return fenced.result;
    } catch (error) {
      try {
        await this.ownership.assertCurrent(lease);
      } catch {
        await this.handleOwnershipLoss();
      }
      throw error;
    } finally {
      this.fencedEffects = Math.max(0, this.fencedEffects - 1);
    }
  }

  private async assertSessionOwnership(): Promise<void> {
    if (!this.activeLease) {
      throw new Error('QR_SESSION_OWNER_REQUIRED');
    }
    await this.ownership.assertCurrent(this.activeLease);
  }

  private startLeaseHeartbeat(): void {
    this.stopLeaseHeartbeat();
    this.leaseHeartbeat = setInterval(() => {
      void this.renewSessionOwnership();
    }, QR_SESSION_HEARTBEAT_MS);
    this.leaseHeartbeat.unref();
  }

  private stopLeaseHeartbeat(): void {
    if (this.leaseHeartbeat) {
      clearInterval(this.leaseHeartbeat);
      this.leaseHeartbeat = null;
    }
  }

  private async renewSessionOwnership(): Promise<void> {
    if (!this.activeLease || this.fencedEffects > 0) return;
    try {
      this.activeLease = await this.ownership.renew(this.activeLease);
    } catch {
      await this.handleOwnershipLoss();
    }
  }

  private async handleOwnershipLoss(): Promise<void> {
    this.stopLeaseHeartbeat();
    this.cancelReconnect();
    this.activeLease = null;
    this.real.connectionStatus = 'FAILED';
    this.real.lastError = 'La propiedad exclusiva de la sesión WhatsApp se perdió.';
    this.real.lastErrorCode = 'QR_SESSION_FENCE_LOST';
    await this.teardownRealSocket(false);
  }

  private async releaseSessionOwnership(): Promise<void> {
    this.stopLeaseHeartbeat();
    const lease = this.activeLease;
    this.activeLease = null;
    if (!lease) return;
    try {
      await this.ownership.release(lease);
    } catch (error) {
      this.logger.warn(
        `QR owner release failed: ${this.sanitizeErrorMessage(error instanceof Error ? error.message : String(error))}`,
      );
    }
  }

  private async scheduleReconnect(): Promise<void> {
    this.cancelReconnect();
    const enabled = this.configService.get<boolean>('WHATSAPP_QR_RECONNECT_ENABLED') === true;
    const configuredMax = this.configService.get<number>('WHATSAPP_QR_MAX_RECONNECT_ATTEMPTS') ?? 5;
    const maxAttempts = Math.max(1, Math.min(10, configuredMax));
    if (!enabled || this.reconnectAttempts >= maxAttempts) {
      this.real.connectionStatus = 'FAILED';
      this.real.lastErrorCode = enabled ? 'RECONNECT_ATTEMPTS_EXHAUSTED' : 'RECONNECT_DISABLED';
      await this.releaseSessionOwnership();
      return;
    }

    this.reconnectAttempts += 1;
    const delayMs = Math.min(30_000, 1_000 * 2 ** (this.reconnectAttempts - 1));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.performReconnect();
    }, delayMs);
    this.reconnectTimer.unref();
  }

  private async performReconnect(): Promise<void> {
    try {
      const gate = await this.getQrRuntimeGate();
      if (!gate.allowed) {
        this.real.connectionStatus = 'FAILED';
        this.real.lastErrorCode = gate.reason;
        await this.releaseSessionOwnership();
        return;
      }
      await this.renewSessionOwnership();
      await this.assertSessionOwnership();
      await this.bootstrapRealSocket(this.safeSessionName());
    } catch (error) {
      if (!this.activeLease) {
        this.real.connectionStatus = 'FAILED';
        this.real.lastErrorCode = 'QR_SESSION_FENCE_LOST';
        return;
      }
      this.real.connectionStatus = 'RECONNECTING';
      this.real.lastError = 'La reconexión acotada de WhatsApp falló.';
      this.real.lastErrorCode = this.sanitizeErrorMessage(
        error instanceof Error ? error.message : 'RECONNECT_FAILED',
      );
      await this.scheduleReconnect();
    }
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private async teardownRealSocket(resetPhone: boolean) {
    const socket = this.real.socket;
    this.real.socket = null;
    this.real.verifiedBinding = null;

    if (!socket) return;

    try {
      socket.ev.removeAllListeners('creds.update');
      socket.ev.removeAllListeners('connection.update');
      socket.ev.removeAllListeners('messages.upsert');
      socket.ev.removeAllListeners('messages.update');
    } catch {
      // best effort
    }

    try {
      await socket.end(undefined);
    } catch {
      // best effort
    }

    if (resetPhone) {
      this.real.phoneNumber = null;
      this.real.deviceName = null;
    }

    if (!this.real.socket) {
      this.real.qrString = null;
      this.real.qrImageDataUrl = null;
      this.real.qrIssuedAt = null;
    }
  }

  private extractDisconnectCode(error: unknown): number | null {
    if (typeof error === 'object' && error !== null) {
      const candidate = error as Record<string, unknown>;
      if (typeof candidate.statusCode === 'number') return candidate.statusCode;

      const output = candidate.output;
      if (typeof output === 'object' && output !== null) {
        const outputRecord = output as Record<string, unknown>;
        if (typeof outputRecord.statusCode === 'number') return outputRecord.statusCode;
      }
    }
    return null;
  }

  private async clearAuthDir() {
    try {
      const sessionRoot = await this.resolveSessionDirectory();
      const files = await this.readDirectory(sessionRoot);
      await Promise.all(files.map((fileName) => this.unlinkSessionEntry(sessionRoot, fileName)));
    } catch {
      // directory might not exist
    }
  }

  /* ================================================================ */
  /*  PERSISTED STATE (settings table)                                 */
  /* ================================================================ */

  private async persistFromMeInbound(rawPayload: Record<string, unknown>) {
    const parsed = this.qrProvider.parseInboundWebhook(rawPayload);
    const eventHash = createHash('sha256')
      .update(
        [
          'qr_gateway',
          parsed.providerEventId,
          parsed.providerMessageId,
          parsed.phone,
          parsed.body ?? '',
          'fromMe',
        ].join('|'),
      )
      .digest('hex');

    await this.prisma.whatsappInboundEvent.upsert({
      where: { provider_eventHash: { provider: 'qr_gateway', eventHash } },
      create: {
        provider: 'qr_gateway',
        providerEventId: parsed.providerEventId,
        providerMessageId: parsed.providerMessageId,
        phone: parsed.phone,
        eventHash,
        rawPayload: {
          redacted: true,
          source: 'qr_gateway',
          fromMe: true,
        },
        processingStatus: 'FROM_ME_IGNORED',
        processedAt: new Date(),
      },
      update: {
        processingStatus: 'DUPLICATE_IGNORED',
        processedAt: new Date(),
      },
    });
  }

  private defaultStatus(): SofiaWhatsappQrConnectionStatus {
    return 'DISCONNECTED';
  }

  private async getQrRuntimeGate(options: { skipGovernanceApproval?: boolean } = {}) {
    if (this.configService.get<boolean>('WHATSAPP_QR_ENABLED') !== true) {
      return { allowed: false, reason: 'QR_GATEWAY_DISABLED' as const };
    }
    if (this.configService.get<boolean>('WHATSAPP_QR_ALLOW_RECEIVE') !== true) {
      return { allowed: false, reason: 'QR_RECEIVE_DISABLED' as const };
    }
    if (this.configService.get<boolean>('WHATSAPP_QR_SANDBOX_ONLY') !== false) {
      return { allowed: false, reason: 'QR_SANDBOX_ONLY' as const };
    }
    if (this.configService.get<string>('WHATSAPP_MODE') !== 'receive_only') {
      return { allowed: false, reason: 'QR_RECEIVE_ONLY_MODE_REQUIRED' as const };
    }
    if (this.configService.get<string>('WHATSAPP_PROVIDER') !== 'qr_gateway') {
      return { allowed: false, reason: 'QR_PROVIDER_NOT_SELECTED' as const };
    }
    if (this.configService.get<boolean>('WHATSAPP_QR_ALLOW_REAL_SEND') === true) {
      return { allowed: false, reason: 'QR_REAL_SEND_MUST_REMAIN_DISABLED' as const };
    }
    if (
      this.configService.get<boolean>('SOFIA_AUTO_REPLY_ENABLED') === true ||
      this.configService.get<boolean>('SOFIA_AUTO_SAFE_ENABLED') === true ||
      this.configService.get<boolean>('SOFIA_WHATSAPP_OUTBOUND_HANDLER_ENABLED') === true
    ) {
      return { allowed: false, reason: 'QR_AUTOMATION_MUST_REMAIN_DISABLED' as const };
    }

    const settings = await this.prisma.setting.findMany({
      where: { key: { in: Object.values(QR_RUNTIME_GATE_SETTING_KEYS) } },
      select: { key: true, value: true },
    });
    const values = new Map(
      settings.map((setting) => [
        setting.key,
        setting.value && typeof setting.value === 'object' && !Array.isArray(setting.value)
          ? (setting.value as Record<string, unknown>)
          : {},
      ]),
    );

    if (values.get(QR_RUNTIME_GATE_SETTING_KEYS.killSwitch)?.active === true) {
      return { allowed: false, reason: 'KILL_SWITCH_ACTIVE' as const };
    }
    if (values.get(QR_RUNTIME_GATE_SETTING_KEYS.globalPaused)?.paused === true) {
      return { allowed: false, reason: 'GLOBAL_PAUSED' as const };
    }
    // La aprobación de gobernanza (`qrRealAllowed`) exige un `@lid` con
    // formato válido ya configurado (`qrReceiveOnlyConfigurationIsSafe()`
    // en sofia-governance.service.ts) — imposible de tener antes de un
    // primer descubrimiento. `WHATSAPP_QR_DISCOVERY_MODE` es la ÚNICA
    // razón legítima para omitir esta verificación; todo lo demás arriba
    // (kill-switch, pausa, real-send, auto-reply/auto-safe/handler) se
    // sigue exigiendo sin excepción.
    if (!options.skipGovernanceApproval && values.get(QR_RUNTIME_GATE_SETTING_KEYS.qrRealAllowed)?.allowed !== true) {
      return { allowed: false, reason: 'QR_GOVERNANCE_NOT_APPROVED' as const };
    }

    return { allowed: true, reason: 'QR_GOVERNANCE_APPROVED' as const };
  }

  private connectedPhoneNumber(socket: WASocket): string | null {
    const user = socket.user;
    return this.phoneFromPnJid(user?.phoneNumber ?? '') ?? this.phoneFromPnJid(user?.id ?? '');
  }

  private connectedAccountBinding(
    socket: WASocket,
    fencingToken: number,
  ):
    | { ok: true; value: VerifiedQrBinding }
    | { ok: false; reason: string } {
    const providerAccountId = this.connectedPhoneNumber(socket);
    if (!providerAccountId) {
      return { ok: false, reason: 'WHATSAPP_CONNECTED_ACCOUNT_IDENTITY_MISSING' };
    }
    const businessIdentity = this.connectedBusinessIdentity(socket);
    if (!businessIdentity) {
      return { ok: false, reason: 'WHATSAPP_BUSINESS_IDENTITY_EVIDENCE_MISSING' };
    }
    const sessionOwner = this.connectedSessionOwner(fencingToken);
    if (!sessionOwner) {
      return { ok: false, reason: 'WHATSAPP_SESSION_OWNER_EVIDENCE_MISSING' };
    }
    const expectedAccount = this.expectedPhoneIdentity('WHATSAPP_EXPECTED_ACCOUNT_ID');
    const expectedBusiness = this.expectedBusinessIdentity();
    const expectedSessionOwner = this.configService
      .get<string>('WHATSAPP_EXPECTED_SESSION_OWNER')
      ?.trim();

    if (!expectedAccount || !expectedBusiness || !expectedSessionOwner) {
      return { ok: false, reason: 'WHATSAPP_EXPECTED_BINDING_INCOMPLETE' };
    }
    if (
      expectedAccount !== providerAccountId ||
      expectedBusiness !== businessIdentity ||
      expectedSessionOwner !== sessionOwner
    ) {
      return { ok: false, reason: 'WHATSAPP_PROVIDER_ACCOUNT_MISMATCH' };
    }
    return {
      ok: true,
      value: { providerAccountId, businessIdentity, sessionOwner },
    };
  }

  private connectedBusinessIdentity(socket: WASocket): string | null {
    const user = socket.user;
    return this.lidIdentity(user?.lid ?? '') ?? this.lidIdentity(user?.id ?? '');
  }

  private expectedBusinessIdentity(): string | null {
    return this.lidIdentity(
      this.configService.get<string>('WHATSAPP_EXPECTED_BUSINESS_IDENTITY')?.trim() ?? '',
    );
  }

  private connectedSessionOwner(fencingToken: number): string | null {
    const lease = this.activeLease;
    if (
      !lease ||
      lease.sessionName !== this.safeSessionName() ||
      lease.ownerHash !== this.ownership.ownerHash ||
      lease.fencingToken !== fencingToken ||
      !Number.isFinite(Date.parse(lease.leaseExpiresAt)) ||
      Date.parse(lease.leaseExpiresAt) <= Date.now()
    ) {
      return null;
    }
    return lease.sessionName;
  }

  private expectedPhoneIdentity(key: string): string | null {
    const value = this.configService.get<string>(key)?.trim();
    if (!value) return null;
    const plainPhone = value.match(/^\+?(\d{6,20})$/)?.[1] ?? null;
    return this.phoneFromPnJid(value) ?? plainPhone;
  }

  private phoneFromMessageAddress(primary: string, alternate?: string | null): string | null {
    const primaryPhone = this.phoneFromPnJid(primary);
    if (primaryPhone) return primaryPhone;
    if (!/^\d{6,20}(?::\d+)?@lid$/i.test(primary.trim())) return null;
    return this.phoneFromPnJid(alternate ?? '');
  }

  private phoneFromPnJid(value: string): string | null {
    const match = value.trim().match(/^(\d{6,20})(?::\d+)?@s\.whatsapp\.net$/i);
    return match?.[1] ?? null;
  }

  private lidIdentity(value: string): string | null {
    const match = value.trim().match(/^(\d{6,20})(?::\d+)?@lid$/i);
    return match ? `${match[1]}@lid` : null;
  }

  private async rejectUnverifiedInbound(_socket: WASocket): Promise<void> {
    await this.audit('SOFIA_QR_INBOUND_BLOCKED', 'system', {
      reason: 'WHATSAPP_VERIFIED_BINDING_MISSING',
      valuesSanitized: true,
    });
    this.real.connectionStatus = 'FAILED';
    this.real.lastErrorCode = 'WHATSAPP_VERIFIED_BINDING_MISSING';
    await this.teardownRealSocket(false);
    await this.releaseSessionOwnership();
  }

  private async rejectConnectedSocket(socket: WASocket, reason: string): Promise<void> {
    this.real.connectionStatus = 'FAILED';
    this.real.qrString = null;
    this.real.qrImageDataUrl = null;
    this.real.phoneNumber = null;
    this.real.verifiedBinding = null;
    this.real.lastError = 'La identidad de la cuenta WhatsApp no cumple el binding autorizado.';
    this.real.lastErrorCode = reason;
    await this.audit('SOFIA_QR_CONNECTED_BINDING_REJECTED', 'system', {
      reason,
      valuesSanitized: true,
    });
    try {
      await socket.logout();
    } catch {
      // Local credential cleanup still prevents reuse of a rejected binding.
    }
    await this.clearAuthDir();
    await this.teardownRealSocket(false);
    await this.releaseSessionOwnership();
  }

  /**
   * `WHATSAPP_QR_DISCOVERY_MODE` únicamente — captura la identidad real de
   * WhatsApp (cuenta + `@lid`) UNA vez, sin exigir el binding exacto (que
   * todavía no se conoce en un primer bootstrap), nunca deja el estado en
   * `CONNECTED`, y cierra la sesión de inmediato. El valor crudo vive solo
   * en memoria (`this.discoveryResult`, TTL de 5 minutos) y nunca se
   * escribe en Prisma ni en auditoría sin enmascarar.
   */
  private async completeDiscoverySession(socket: WASocket, fencingToken: number): Promise<void> {
    const providerAccountId = this.connectedPhoneNumber(socket);
    const businessIdentity = this.connectedBusinessIdentity(socket);
    const sessionOwner = this.connectedSessionOwner(fencingToken);
    const captured = Boolean(providerAccountId && businessIdentity && sessionOwner);

    this.real.connectionStatus = 'DISCOVERY_CAPTURED';
    this.real.qrString = null;
    this.real.qrImageDataUrl = null;
    this.real.lastError = captured
      ? null
      : 'No se pudo capturar la identidad completa de WhatsApp. Vuelve a escanear el QR.';
    this.real.lastErrorCode = captured ? null : 'WHATSAPP_DISCOVERY_IDENTITY_INCOMPLETE';

    if (providerAccountId && businessIdentity && sessionOwner) {
      this.discoveryResult = {
        accountId: providerAccountId,
        businessIdentity,
        sessionOwner,
        capturedAt: new Date().toISOString(),
      };
      setTimeout(() => {
        this.discoveryResult = null;
      }, QR_DISCOVERY_RESULT_TTL_MS).unref();
    }

    await this.audit('SOFIA_QR_DISCOVERY_SESSION_RAN', 'system', {
      captured,
      valuesSanitized: true,
    });

    try {
      await socket.logout();
    } catch {
      // Local credential cleanup below still prevents reuse of the discovery session.
    }
    await this.clearAuthDir();
    await this.teardownRealSocket(true);
    await this.releaseSessionOwnership();
  }

  /**
   * Lectura única del resultado de `WHATSAPP_QR_DISCOVERY_MODE` — se borra
   * de memoria al leerse (o expira solo a los 5 minutos). Nunca aparece en
   * `getStatus()` ni en ningún otro endpoint/reporte.
   */
  getDiscoveryResult(): SofiaWhatsappQrDiscoveryResult | { available: false } {
    const result = this.discoveryResult;
    this.discoveryResult = null;
    return result ?? { available: false };
  }

  private safePersistedStatus(status?: SofiaWhatsappQrConnectionStatus): SofiaWhatsappQrConnectionStatus {
    if (status === 'FAILED' || status === 'LOGGED_OUT' || status === 'DISABLED') return status;
    return this.defaultStatus();
  }

  private statusReason(input: {
    status: SofiaWhatsappQrConnectionStatus;
    adapterReal: boolean;
    qrAvailable: boolean;
    connected: boolean;
  }) {
    if (input.status === 'DISABLED') return 'QR_GATEWAY_DISABLED';
    if (input.connected) return 'CONNECTED_REAL';
    if (input.adapterReal && input.qrAvailable && input.status === 'QR_READY') return 'BAILEYS_QR_READY';
    if (input.adapterReal && (input.status === 'WAITING_QR' || input.status === 'CONNECTING')) return 'WAITING_FOR_BAILEYS_QR';
    if (input.status === 'FAILED' && this.real.lastErrorCode === 'QR_SESSION_STORAGE_NOT_WRITABLE') {
      return 'QR_SESSION_STORAGE_NOT_WRITABLE';
    }
    if (input.status === 'FAILED') return 'REAL_ADAPTER_FAILED';
    if (input.status === 'LOGGED_OUT') return 'LOGGED_OUT';
    if (!input.adapterReal) return 'REAL_ADAPTER_NOT_AVAILABLE';
    return 'QR_NOT_AVAILABLE';
  }

  private operatorMessage(input: {
    status: SofiaWhatsappQrConnectionStatus;
    adapterReal: boolean;
    qrAvailable: boolean;
    connected: boolean;
  }) {
    if (input.status === 'DISABLED') return 'WhatsApp QR está deshabilitado por configuración.';
    if (input.connected) return 'WhatsApp Business conectado en receive-only.';
    if (input.adapterReal && input.qrAvailable && input.status === 'QR_READY') {
      return 'QR real de WhatsApp disponible para escanear.';
    }
    if (input.adapterReal && (input.status === 'WAITING_QR' || input.status === 'CONNECTING')) {
      return 'Esperando QR real de WhatsApp.';
    }
    if (input.status === 'FAILED' && this.real.lastErrorCode === 'QR_SESSION_STORAGE_NOT_WRITABLE') {
      return 'La sesión QR no puede escribirse. Revisa permisos del storage.';
    }
    if (input.status === 'FAILED') return 'Adapter real falló. Revisa logs backend sanitizados.';
    if (input.status === 'LOGGED_OUT') return 'Sesión cerrada. Genera un nuevo QR real.';
    return 'Adapter real no disponible. No se generó QR de WhatsApp.';
  }

  private sanitizeErrorMessage(message: string | null) {
    if (!message) return null;
    return (redactSensitiveText(message) ?? '')
      .replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED_SECRET]')
      .replace(/AIza[A-Za-z0-9_-]+/g, '[REDACTED_SECRET]')
      .replace(/\/app\/storage/g, '[REDACTED_STORAGE_PATH]')
      .replace(/\/[^\s]+whatsapp-sessions\/[^\s]+/g, '[REDACTED_SESSION_PATH]')
      .slice(0, 240);
  }

  private resolveMode(
    _state: QrSessionState,
  ): 'disabled' | 'receive_only' | 'supervised' | 'auto_safe' {
    return 'receive_only';
  }

  private sessionName(state?: QrSessionState) {
    return (
      state?.sessionName ||
      this.configService.get<string>('WHATSAPP_QR_SESSION_NAME') ||
      'sofia-main'
    );
  }

  private sessionPathSanitized() {
    const configured =
      this.configService.get<string>('WHATSAPP_QR_SESSION_PATH') || './storage/whatsapp-sessions';
    const withoutAppPrefix = configured.replace(/^\/app\//, '').replace(/^\.\//, '');
    return `${withoutAppPrefix}/${this.configService.get<string>('WHATSAPP_QR_SESSION_NAME') || 'sofia-main'}`;
  }

  private async ensureSessionStorageReady(writeTest: boolean) {
    try {
      const sessionPath = await this.resolveSessionDirectory();
      if (writeTest) {
        const testFile = this.resolveChildPath(
          sessionPath,
          `.write-test-${process.pid}-${Date.now()}`,
        );
        const content = await this.writeReadAndRemoveTestFile(testFile);
        if (content !== 'ok') {
          return { ok: false, error: 'QR_SESSION_STORAGE_WRITE_TEST_FAILED' };
        }
      }
      return { ok: true, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'QR session storage is not writable.';
      return { ok: false, error: message };
    }
  }

  private sessionRootPath(): string {
    const configured =
      this.configService.get<string>('WHATSAPP_QR_SESSION_PATH') || './storage/whatsapp-sessions';
    return path.isAbsolute(configured)
      ? path.normalize(configured)
      : path.resolve(process.cwd(), configured);
  }

  private safeSessionName(): string {
    const sessionName =
      this.configService.get<string>('WHATSAPP_QR_SESSION_NAME') || 'sofia-main';
    if (
      sessionName.length > 80 ||
      sessionName === '.' ||
      sessionName === '..' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sessionName)
    ) {
      throw new Error('QR_SESSION_NAME_INVALID');
    }
    return sessionName;
  }

  private resolveChildPath(root: string, childName: string): string {
    if (!childName || childName === '.' || childName === '..' || path.basename(childName) !== childName) {
      throw new Error('QR_SESSION_PATH_OUTSIDE_ROOT');
    }
    const normalizedRoot = path.resolve(root);
    const candidate = path.resolve(normalizedRoot, childName);
    const relative = path.relative(normalizedRoot, candidate);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('QR_SESSION_PATH_OUTSIDE_ROOT');
    }
    return candidate;
  }

  private async resolveSessionDirectory(): Promise<string> {
    const configuredRoot = this.sessionRootPath();
    await this.createDirectory(configuredRoot);
    const canonicalRoot = await this.realPath(configuredRoot);
    const sessionDirectory = this.resolveChildPath(canonicalRoot, this.safeSessionName());
    await this.createDirectory(sessionDirectory);
    const canonicalSessionDirectory = await this.realPath(sessionDirectory);
    const relative = path.relative(canonicalRoot, canonicalSessionDirectory);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('QR_SESSION_PATH_OUTSIDE_ROOT');
    }
    return canonicalSessionDirectory;
  }

  private async unlinkSessionEntry(sessionRoot: string, fileName: string): Promise<void> {
    const targetPath = this.resolveChildPath(sessionRoot, fileName);
    // unlink removes a symlink itself and never follows it to an external target.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await fs.unlink(targetPath);
  }

  private async writeReadAndRemoveTestFile(testFile: string): Promise<string> {
    let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
    try {
      // The exclusive create prevents replacing or following an existing entry.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      handle = await fs.open(testFile, 'wx', 0o600);
      await handle.writeFile('ok', 'utf8');
      const content = Buffer.alloc(2);
      const { bytesRead } = await handle.read(content, 0, content.length, 0);
      return content.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle?.close();
      try {
        // testFile is generated internally and resolved inside the canonical session root.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await fs.unlink(testFile);
      } catch {
        // The storage readiness result is determined by the primary operation.
      }
    }
  }

  private async createDirectory(directory: string): Promise<void> {
    // Callers provide either the configured root or a child validated by resolveChildPath().
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  }

  private async realPath(directory: string): Promise<string> {
    // Canonicalization is required to reject directory symlink escapes.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return fs.realpath(directory);
  }

  private async readDirectory(directory: string): Promise<string[]> {
    // directory is the canonical session root returned by resolveSessionDirectory().
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return fs.readdir(directory);
  }

  private blockers() {
    return ['REAL_SEND_DISABLED', 'AUTO_SAFE_PRODUCTION_DISABLED', 'DEEPSEEK_REAL_DISABLED'];
  }

  private maskPhone(phone: string) {
    const digits = phone.replace(/\D/g, '');
    if (digits.length <= 4) return digits;
    return `${digits.slice(0, 4)}****${digits.slice(-2)}`;
  }

  private async getSessionState(): Promise<QrSessionState> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: QR_SESSION_SETTING_KEY },
    });
    if (
      !setting ||
      !setting.value ||
      typeof setting.value !== 'object' ||
      Array.isArray(setting.value)
    ) {
      return {
        status: this.defaultStatus(),
        mode: 'receive_only',
        sessionName:
          this.configService.get<string>('WHATSAPP_QR_SESSION_NAME') || 'sofia-main',
      };
    }
    return setting.value as QrSessionState;
  }

  private async saveSessionState(
    state: QrSessionState,
    actorId: string,
    action: string,
  ) {
    await this.prisma.setting.upsert({
      where: { key: QR_SESSION_SETTING_KEY },
      create: {
        key: QR_SESSION_SETTING_KEY,
        value: state as Prisma.InputJsonValue,
        category: 'sofia_whatsapp_qr',
        description: 'Estado sanitizado del WhatsApp QR Gateway de Sofía (8B.2 real adapter)',
      },
      update: {
        value: state as Prisma.InputJsonValue,
        category: 'sofia_whatsapp_qr',
        description: 'Estado sanitizado del WhatsApp QR Gateway de Sofía (8B.2 real adapter)',
      },
    });
    await this.audit(action, actorId, {
      status: state.status,
      mode: state.mode,
      sessionName: state.sessionName,
      adapterReal: Boolean(this.real.socket),
    });
  }

  private async audit(
    action: string,
    actorId: string,
    details: Record<string, unknown>,
  ) {
    await this.auditService.log({
      action,
      module: 'SofiaWhatsappQrGateway',
      entity: 'qr_gateway',
      entityId:
        this.configService.get<string>('WHATSAPP_QR_SESSION_NAME') || 'sofia-main',
      userId: actorId === 'system' ? null : actorId,
      actorType: actorId === 'system' ? 'SYSTEM' : 'USER',
      newValues: details as Prisma.InputJsonValue,
    });
  }
}
