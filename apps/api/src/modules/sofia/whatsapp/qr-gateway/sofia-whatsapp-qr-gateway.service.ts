import { BadRequestException, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AuditService } from '../../../audit/audit.service';
import { SofiaWhatsappService } from '../../sofia-whatsapp.service';
import { SofiaWhatsappQrGatewayProvider } from './sofia-whatsapp-qr-gateway.provider';
import {
  SofiaWhatsappQrConnectionStatus,
  SofiaWhatsappQrStatusResponse,
} from './sofia-whatsapp-qr-gateway.types';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const QR_SESSION_SETTING_KEY = 'SOFIA_WHATSAPP_QR_SESSION_STATE';

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

/** Real Baileys socket internal state — `any` for socket matches existing whatsapp.service.ts pattern */
type RealSocketState = {
  socket: any;
  connectionStatus: SofiaWhatsappQrConnectionStatus;
  qrString: string | null;
  qrImageDataUrl: string | null;
  qrIssuedAt: string | null;
  lastError: string | null;
  lastErrorCode: string | null;
  lastConnectionUpdateAt: string | null;
  phoneNumber: string | null;
  deviceName: string | null;
  bootstrapPromise: Promise<void> | null;
  loggedOutCode: number | null;
};

@Injectable()
export class SofiaWhatsappQrGatewayService implements OnModuleDestroy {
  private readonly logger = new Logger(SofiaWhatsappQrGatewayService.name);

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
  ) {}

  async onModuleDestroy() {
    await this.teardownRealSocket(false);
  }

  /* ================================================================ */
  /*  PUBLIC API                                                       */
  /* ================================================================ */

  async getStatus(): Promise<SofiaWhatsappQrStatusResponse> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    /* If we have a real socket, return real state */
    const [state, inboundToday, outboundToday, pendingOutbound, sessionStorage] = await Promise.all([
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
    ]);

    /* Merge real socket state with persisted state */
    const realConnected = this.real.connectionStatus === 'CONNECTED';
    const realQrAvailable =
      this.real.connectionStatus === 'QR_READY' && Boolean(this.real.qrImageDataUrl);

    /*
     * F8B hardening: public QR/CONNECTED state must only come from the live
     * Baileys socket. Persisted state is audit metadata, not connection proof.
     */
    const enabled = this.configService.get<boolean>('WHATSAPP_QR_ENABLED') === true;
    const status: SofiaWhatsappQrConnectionStatus = !enabled
      ? 'DISABLED'
      : this.real.socket
        ? this.real.connectionStatus
        : this.safePersistedStatus(state.status);

    const qrAvailable = realQrAvailable;

    const connected = realConnected;
    const adapterReal = Boolean(this.real.socket);
    const ok = adapterReal && (qrAvailable || connected);
    const reason = this.statusReason({ status, adapterReal, qrAvailable, connected });
    const operatorMessage = this.operatorMessage({ status, adapterReal, qrAvailable, connected });

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

  async connect(actorId: string) {
    if (this.configService.get<boolean>('WHATSAPP_QR_ENABLED') !== true) {
      return this.getStatus();
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
      await this.bootstrapRealSocket(sessionName);
      await this.waitForRealQrOrConnection(15_000);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error al iniciar adapter real';
      this.real.connectionStatus = 'FAILED';
      this.real.lastError = message;
      this.real.lastErrorCode = 'REAL_ADAPTER_BOOTSTRAP_FAILED';
      this.logger.error(`Real QR bootstrap failed: ${message}`);
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

  async disconnect(actorId: string) {
    const now = new Date();
    const state = await this.getSessionState();

    /* Tear down real socket */
    await this.teardownRealSocket(true);

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

  async logout(actorId: string) {
    const now = new Date();
    const state = await this.getSessionState();

    /* Logout real socket */
    if (this.real.socket) {
      try {
        await this.real.socket.logout();
      } catch {
        // ignore transport errors
      }
    }
    await this.teardownRealSocket(true);
    await this.clearAuthDir();

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

  async testInbound(input: {
    phone: string;
    text?: string;
    externalMessageId?: string;
    messageType?: 'TEXT' | 'IMAGE' | 'AUDIO' | 'INTERACTIVE' | 'SYSTEM';
    fromMe?: boolean;
    mediaUrl?: string;
    mediaMimeType?: string;
    transcript?: string;
  }) {
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
      timestamp: new Date().toISOString(),
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

  async testSend(input: { to?: string; phone?: string; body?: string; text?: string }) {
    const to = input.to ?? input.phone ?? '';
    const body = input.body ?? input.text ?? '';
    if (!to || !body)
      throw new BadRequestException(
        'phone/text o to/body son requeridos para validar bloqueo de envío QR.',
      );

    const result = await this.qrProvider.sendTextMessage({
      to,
      body,
      idempotencyKey: `qr-test-send:${createHash('sha256').update(`${to}:${body}`).digest('hex')}`,
    });

    await this.audit('SOFIA_QR_REAL_SEND_BLOCKED', 'system', {
      reason: result.errorMessage ?? 'BLOCKED_REAL_SEND_DISABLED',
    });

    return {
      provider: 'qr_gateway' as const,
      status: 'BLOCKED_REAL_SEND_DISABLED' as const,
      sent: false,
      realSendingEnabled: false,
      result,
    };
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

  private async createRealSocket(sessionName: string) {
    const authDir = this.sessionPath();
    const sessionStorage = await this.ensureSessionStorageReady(true);
    if (!sessionStorage.ok) {
      throw new Error(sessionStorage.error ?? 'QR session storage is not writable.');
    }

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

    /* ---- Event handlers ---- */
    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('connection.update', (update) => {
      void this.onRealConnectionUpdate(update);
    });

    socket.ev.on('messages.upsert', (payload) => {
      void this.onRealMessagesUpsert(payload);
    });
  }

  private async onRealConnectionUpdate(update: any) {
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
      const rawJid = (this.real.socket as any)?.user?.id ?? null;
      const phoneNumber = typeof rawJid === 'string' ? rawJid.replace(/:\d+$/, '') : null;
      this.real.connectionStatus = 'CONNECTED';
      this.real.qrString = null;
      this.real.qrImageDataUrl = null;
      this.real.phoneNumber = phoneNumber;
      this.real.lastError = null;
      this.real.lastErrorCode = null;
      this.logger.log(`WhatsApp QR Gateway CONNECTED${phoneNumber ? ` (${phoneNumber})` : ''}`);
    }

    /* Disconnected / Error */
    if (update.connection === 'close') {
      const statusCode = this.extractDisconnectCode(update.lastDisconnect?.error);
      const loggedOut = statusCode !== null && statusCode === this.real.loggedOutCode;

      if (loggedOut) {
        await this.clearAuthDir();
      }

      await this.teardownRealSocket(false);

      this.real.connectionStatus = loggedOut ? 'LOGGED_OUT' : 'FAILED';
      this.real.qrString = null;
      this.real.qrImageDataUrl = null;
      this.real.lastError = loggedOut
        ? 'La sesión de WhatsApp se cerró. Genera un nuevo QR.'
        : 'WhatsApp perdió la conexión. Vuelve a preparar el QR.';
      this.real.lastErrorCode = loggedOut ? 'LOGGED_OUT' : 'CONNECTION_CLOSED';
    }
  }

  private async onRealMessagesUpsert(payload: any) {
    if (!payload?.messages?.length) return;

    for (const msg of payload.messages) {
      const key = msg?.key ?? {};
      /* Ignore outbound from this device */
      if (key.fromMe) continue;

      const remoteJid: string = key?.remoteJid ?? '';
      const phone = remoteJid.replace(/@s\.whatsapp\.net$|@g\.us$/, '').replace(/:\d+$/, '');

      if (!phone) continue;

      /* Extract text from WhatsApp message */
      const msgContent = msg?.message ?? {};
      const conversation =
        (msgContent as any).conversation ??
        (msgContent as any).extendedTextMessage?.text ??
        (msgContent as any).imageMessage?.caption ??
        (msgContent as any).videoMessage?.caption ??
        '';
      const text = typeof conversation === 'string' ? conversation : '';

      /* Build inbound payload matching existing format */
      const rawPayload = {
        provider: 'qr_gateway',
        externalMessageId: key?.id ?? `real-${Date.now()}`,
        providerEventId: `wa-${key?.id ?? Date.now()}`,
        providerMessageId: String(key?.id ?? ''),
        phone,
        text,
        messageType: 'TEXT' as const,
        fromMe: false,
        timestamp: new Date().toISOString(),
        rawSummaryJson: {
          source: 'REAL_BAILEYS_INBOUND',
          hasText: Boolean(text),
          remoteJid,
        },
      };

      try {
        await this.sofiaWhatsappService.processInboundWebhook('qr_gateway', rawPayload, {
          'x-sofia-whatsapp-mode': 'receive_only',
          'x-sofia-whatsapp-provider': 'qr_gateway',
        });
        this.logger.log(`Real inbound processed from ${this.maskPhone(phone)}`);
      } catch (error) {
        this.logger.error(
          `Failed to process real inbound from ${this.maskPhone(phone)}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }

  private async teardownRealSocket(resetPhone: boolean) {
    const socket = this.real.socket;
    this.real.socket = null;

    if (!socket) return;

    try {
      socket.ev.removeAllListeners('creds.update');
      socket.ev.removeAllListeners('connection.update');
      socket.ev.removeAllListeners('messages.upsert');
    } catch {
      // best effort
    }

    try {
      await (socket as any)?.end?.(undefined);
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
      const e = error as any;
      if (typeof e.statusCode === 'number') return e.statusCode;
      if (typeof e.output?.statusCode === 'number') return e.output.statusCode;
    }
    return null;
  }

  private async clearAuthDir() {
    try {
      const files = await fs.readdir(this.sessionPath());
      await Promise.all(files.map((f) => fs.unlink(path.join(this.sessionPath(), f))));
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
        rawPayload: parsed.rawPayload as Prisma.InputJsonValue,
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
    return message
      .replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED_SECRET]')
      .replace(/AIza[A-Za-z0-9_-]+/g, '[REDACTED_SECRET]')
      .replace(/\/app\/storage/g, '[REDACTED_STORAGE_PATH]')
      .replace(/\/[^\s]+whatsapp-sessions\/[^\s]+/g, '[REDACTED_SESSION_PATH]')
      .slice(0, 240);
  }

  private resolveMode(
    state: QrSessionState,
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

  private sessionPath() {
    const configured =
      this.configService.get<string>('WHATSAPP_QR_SESSION_PATH') || './storage/whatsapp-sessions';
    return path.resolve(
      process.cwd(),
      configured,
      this.configService.get<string>('WHATSAPP_QR_SESSION_NAME') || 'sofia-main',
    );
  }

  private async ensureSessionStorageReady(writeTest: boolean) {
    try {
      const sessionPath = this.sessionPath();
      await fs.mkdir(sessionPath, { recursive: true, mode: 0o700 });
      if (writeTest) {
        const testFile = path.join(sessionPath, `.write-test-${process.pid}-${Date.now()}`);
        await fs.writeFile(testFile, 'ok', { mode: 0o600 });
        const content = await fs.readFile(testFile, 'utf8');
        await fs.unlink(testFile);
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
