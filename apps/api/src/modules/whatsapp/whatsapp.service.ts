import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import QRCode from 'qrcode';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrdersService } from '../orders/orders.service';
import { ReportsService } from '../reports/reports.service';
import { SalesService } from '../sales/sales.service';
import { formatReceiptNumber } from '../../common/utils/receipt-number.util';

type WhatsappConnectionState =
  | 'DISABLED'
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'QR_REQUIRED'
  | 'CONNECTED'
  | 'ERROR';

type WhatsappSessionSnapshot = {
  enabled: boolean;
  connectionState: WhatsappConnectionState;
  qrDataUrl: string | null;
  businessPhone: string | null;
  linkedAt: string | null;
  updatedAt: string;
  lastError: string | null;
};

type ClosingSummarySettings = {
  enabled?: boolean;
  groupInviteCode?: string | null;
  groupJid?: string | null;
  groupLabel?: string | null;
};

const DELIVERY_PAYMENT_METHOD_LABEL = 'Nequi';
const DELIVERY_PAYMENT_TARGET = '3160527403';

@Injectable()
export class WhatsappService implements OnModuleDestroy {
  private readonly logger = new Logger(WhatsappService.name);
  private socket: any = null;
  private bootstrapPromise: Promise<void> | null = null;
  private loggedOutStatusCode: number | null = null;
  private snapshot: WhatsappSessionSnapshot = {
    enabled: false,
    connectionState: 'DISABLED',
    qrDataUrl: null,
    businessPhone: null,
    linkedAt: null,
    updatedAt: new Date().toISOString(),
    lastError: null,
  };

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly salesService: SalesService,
    private readonly ordersService: OrdersService,
    private readonly reportsService: ReportsService,
    private readonly auditService: AuditService,
  ) {
    const enabled = this.isEnabled();
    this.snapshot = {
      ...this.snapshot,
      enabled,
      connectionState: enabled ? 'DISCONNECTED' : 'DISABLED',
    };
  }

  async onModuleDestroy() {
    await this.teardownSocket(false);
  }

  async getSessionStatus() {
    if (this.isEnabled() && !this.socket && !this.bootstrapPromise) {
      void this.ensureSocket();
    }

    return { ...this.snapshot };
  }

  async refreshSession() {
    this.assertEnabled();
    await this.teardownSocket(false);
    await this.ensureSocket();
    return this.getSessionStatus();
  }

  async listParticipatingGroups() {
    this.assertEnabled();
    await this.ensureConnectedOrThrow(
      'WhatsApp del negocio no está vinculado todavía. Escanea el QR antes de consultar grupos.',
    );

    const participating = await Promise.race([
      this.socket.groupFetchAllParticipating?.() ?? Promise.resolve({}),
      this.timeoutAfter(this.configService.get<number>('WHATSAPP_SEND_TIMEOUT_MS') ?? 45000),
    ]);

    return Object.values(participating ?? {})
      .map((group: any) => ({
        groupJid: String(group?.id ?? ''),
        groupLabel: String(group?.subject ?? '').trim() || null,
        participantCount: Array.isArray(group?.participants) ? group.participants.length : 0,
      }))
      .filter((group) => group.groupJid)
      .sort((left, right) => String(left.groupLabel ?? left.groupJid).localeCompare(String(right.groupLabel ?? right.groupJid), 'es'));
  }

  async disconnectSession() {
    this.assertEnabled();

    if (this.socket) {
      try {
        await this.socket.logout();
      } catch {
        // ignore transport logout errors
      }
    }

    await this.clearAuthDir();
    await this.teardownSocket(true);

    this.setSnapshot({
      connectionState: 'DISCONNECTED',
      qrDataUrl: null,
      businessPhone: null,
      linkedAt: null,
      lastError: null,
    });

    return this.getSessionStatus();
  }

  async sendSaleReceipt(saleId: string, phone: string, actorId: string) {
    this.assertEnabled();
    await this.ensureConnectedOrThrow(
      'WhatsApp del negocio no está vinculado todavía. Escanea el QR antes de enviar comprobantes.',
    );

    const normalizedPhone = this.normalizeRecipientPhone(phone);
    const sale = await this.salesService.findOne(saleId);

    if (sale.status !== 'PAID') {
      throw new BadRequestException('Solo puedes enviar por WhatsApp ventas que ya estén pagadas.');
    }

    const pdf = await this.salesService.generateReceiptPdf(saleId);
    const businessProfile = await this.prisma.setting.findUnique({ where: { key: 'business.profile' } });
    const businessName = this.readBusinessName(businessProfile?.value);
    const receiptNumber = formatReceiptNumber(sale.number);
    const jid = `${normalizedPhone}@s.whatsapp.net`;

    await Promise.race([
      this.socket.sendMessage(jid, {
        document: pdf,
        mimetype: 'application/pdf',
        fileName: `${receiptNumber}.pdf`,
        caption: this.buildCaption({
          businessName,
          customerName: sale.customerName,
          receiptNumber,
          total: Number(sale.total),
        }),
      }),
      this.timeoutAfter(this.configService.get<number>('WHATSAPP_SEND_TIMEOUT_MS') ?? 45000),
    ]);

    await this.auditService.log({
      userId: actorId,
      action: 'SEND',
      module: 'whatsapp',
      entity: 'sale_receipt',
      entityId: saleId,
      newValues: {
        channel: 'whatsapp_internal',
        phone: normalizedPhone,
        receiptNumber,
      },
    });

    return {
      success: true,
      phone: normalizedPhone,
      receiptNumber,
      sentAt: new Date().toISOString(),
    };
  }

  async sendDeliveryOrderSummary(orderId: string, actorId: string) {
    this.assertEnabled();
    await this.ensureConnectedOrThrow(
      'WhatsApp del negocio no está vinculado todavía. Escanea el QR antes de enviar cuentas de domicilio.',
    );

    const order = await this.ordersService.findOne(orderId);

    if (order.type !== 'DELIVERY') {
      throw new BadRequestException('Solo las comandas de domicilio pueden enviarse automáticamente por WhatsApp.');
    }

    if (order.status === 'PAID' || order.status === 'CANCELLED') {
      throw new BadRequestException('Solo puedes enviar cuentas pendientes de domicilio mientras la comanda siga abierta.');
    }

    if (!order.customerPhone) {
      throw new BadRequestException('La comanda de domicilio necesita un número del cliente para enviarse por WhatsApp.');
    }

    const normalizedPhone = this.normalizeRecipientPhone(order.customerPhone);
    const pdf = await this.ordersService.generateDeliveryReceiptPdf(orderId);
    const businessProfile = await this.prisma.setting.findUnique({ where: { key: 'business.profile' } });
    const businessName = this.readBusinessName(businessProfile?.value);
    const jid = `${normalizedPhone}@s.whatsapp.net`;

    await Promise.race([
      this.socket.sendMessage(jid, {
        document: pdf,
        mimetype: 'application/pdf',
        fileName: `${order.number.toLowerCase()}.pdf`,
        caption: this.buildDeliveryCaption({
          businessName,
          customerName: order.customerName,
          orderNumber: order.number,
          total: Number(order.subtotal),
        }),
      }),
      this.timeoutAfter(this.configService.get<number>('WHATSAPP_SEND_TIMEOUT_MS') ?? 45000),
    ]);

    await this.auditService.log({
      userId: actorId,
      action: 'SEND',
      module: 'whatsapp',
      entity: 'delivery_order_summary',
      entityId: orderId,
      newValues: {
        channel: 'whatsapp_internal_delivery',
        phone: normalizedPhone,
        orderNumber: order.number,
      },
    });

    return {
      success: true,
      phone: normalizedPhone,
      orderNumber: order.number,
      sentAt: new Date().toISOString(),
    };
  }

  async linkDailyCloseGroup(inviteLink: string, actorId: string) {
    this.assertEnabled();
    await this.ensureConnectedOrThrow(
      'WhatsApp del negocio no está vinculado todavía. Escanea el QR antes de enlazar el grupo.',
    );

    const current = await this.readClosingSummarySettings();
    const inviteCode = this.normalizeInviteCode(inviteLink);

    if (!inviteCode) {
      throw new BadRequestException('Pega un enlace o código válido del grupo de WhatsApp.');
    }

    const metadata = await Promise.race([
      this.socket.groupGetInviteInfo(inviteCode),
      this.timeoutAfter(this.configService.get<number>('WHATSAPP_SEND_TIMEOUT_MS') ?? 45000),
    ]);

    let groupJid = current.groupJid ?? null;

    try {
      groupJid =
        (await Promise.race([
          this.socket.groupAcceptInvite(inviteCode),
          this.timeoutAfter(this.configService.get<number>('WHATSAPP_SEND_TIMEOUT_MS') ?? 45000),
        ])) ?? null;
    } catch (error) {
      const discoveredGroupId = metadata?.id ? `${metadata.id}` : null;
      groupJid = discoveredGroupId ? (discoveredGroupId.endsWith('@g.us') ? discoveredGroupId : `${discoveredGroupId}@g.us`) : groupJid;
      if (!groupJid) {
        throw error;
      }
    }

    if (!groupJid) {
      throw new BadRequestException('No fue posible resolver el grupo desde el enlace suministrado.');
    }

    await this.persistClosingGroupJid(groupJid, {
      ...current,
      enabled: true,
      groupInviteCode: inviteCode,
      groupLabel: metadata?.subject ?? current.groupLabel ?? null,
    });

    await this.auditService.log({
      userId: actorId,
      action: 'LINK_GROUP',
      module: 'whatsapp',
      entity: 'daily_closure_group',
      entityId: groupJid,
      newValues: {
        inviteCode,
        groupJid,
        groupLabel: metadata?.subject ?? current.groupLabel ?? null,
      },
    });

    return {
      success: true,
      inviteCode,
      groupJid,
      groupLabel: metadata?.subject ?? current.groupLabel ?? null,
      linkedAt: new Date().toISOString(),
    };
  }

  async selectDailyCloseGroup(groupJid: string, actorId: string, preferredLabel?: string | null) {
    this.assertEnabled();
    await this.ensureConnectedOrThrow(
      'WhatsApp del negocio no está vinculado todavía. Escanea el QR antes de seleccionar el grupo.',
    );

    const normalizedGroupJid = groupJid.trim();
    if (!normalizedGroupJid.endsWith('@g.us')) {
      throw new BadRequestException('Selecciona un grupo válido de WhatsApp.');
    }

    const participating = await this.listParticipatingGroups();
    const selected = participating.find((group) => group.groupJid === normalizedGroupJid);
    if (!selected) {
      throw new BadRequestException('El grupo seleccionado no está disponible para el WhatsApp del negocio.');
    }

    const current = await this.readClosingSummarySettings();
    await this.persistClosingGroupJid(normalizedGroupJid, {
      ...current,
      enabled: true,
      groupLabel: preferredLabel?.trim() || selected.groupLabel || current.groupLabel || null,
    });

    await this.auditService.log({
      userId: actorId,
      action: 'SELECT_GROUP',
      module: 'whatsapp',
      entity: 'daily_closure_group',
      entityId: normalizedGroupJid,
      newValues: {
        groupJid: normalizedGroupJid,
        groupLabel: preferredLabel?.trim() || selected.groupLabel || null,
      },
    });

    return {
      success: true,
      groupJid: normalizedGroupJid,
      groupLabel: preferredLabel?.trim() || selected.groupLabel || null,
      linkedAt: new Date().toISOString(),
    };
  }

  async sendClosingSummary(snapshotId: string, actorId: string) {
    if (!this.isEnabled()) {
      return {
        success: false,
        skipped: true,
        reason: 'El envío interno por WhatsApp está deshabilitado en este entorno.',
      };
    }

    await this.ensureSocket();

    if (!(await this.waitForConnectedSession())) {
      return {
        success: false,
        skipped: true,
        reason: 'WhatsApp del negocio no está vinculado todavía.',
      };
    }

    const settings = await this.readClosingSummarySettings();
    if (!settings.enabled) {
      return {
        success: false,
        skipped: true,
        reason: 'El envío automático de cierre por WhatsApp está deshabilitado.',
      };
    }

    const groupJid = await this.resolveClosingGroupJid(settings);
    if (!groupJid) {
      return {
        success: false,
        skipped: true,
        reason: 'No hay un grupo de WhatsApp configurado para el cierre diario.',
      };
    }

    const closure = await this.reportsService.getDailyClosure(snapshotId);
    const pdf = await this.reportsService.generateDailyClosurePdf(snapshotId);
    const summaryText = this.buildClosingSummaryMessage(closure, settings.groupLabel ?? null);
    const closureDateLabel = String(closure.period?.start ?? new Date().toISOString().slice(0, 10));
    const fileName = `cierre-diario-${closureDateLabel}.pdf`;

    try {
      await Promise.race([
        this.socket.sendMessage(groupJid, {
          text: summaryText,
        }),
        this.timeoutAfter(this.configService.get<number>('WHATSAPP_SEND_TIMEOUT_MS') ?? 45000),
      ]);

      await Promise.race([
        this.socket.sendMessage(groupJid, {
          document: pdf,
          mimetype: 'application/pdf',
          fileName,
          caption: `Cierre diario ${closureDateLabel}`,
        }),
        this.timeoutAfter(this.configService.get<number>('WHATSAPP_SEND_TIMEOUT_MS') ?? 45000),
      ]);
    } catch (error) {
      throw new ConflictException(this.describeClosingSendFailure(error, settings.groupLabel ?? null));
    }

    await this.auditService.log({
      userId: actorId,
      action: 'SEND',
      module: 'whatsapp',
      entity: 'daily_closure',
      entityId: snapshotId,
      newValues: {
        channel: 'whatsapp_internal_group',
        groupJid,
        groupLabel: settings.groupLabel ?? null,
        snapshotId,
      },
    });

    return {
      success: true,
      groupJid,
      groupLabel: settings.groupLabel ?? null,
      sentAt: new Date().toISOString(),
    };
  }

  private async ensureSocket() {
    if (!this.isEnabled()) {
      return;
    }

    if (this.socket) {
      return;
    }

    if (this.bootstrapPromise) {
      await this.bootstrapPromise;
      return;
    }

    this.bootstrapPromise = this.bootstrapSocket();
    await this.bootstrapPromise.finally(() => {
      this.bootstrapPromise = null;
    });
  }

  private async ensureConnectedOrThrow(message: string) {
    await this.ensureSocket();

    if (!(await this.waitForConnectedSession())) {
      throw new ConflictException(message);
    }
  }

  private async waitForConnectedSession() {
    if (this.socket && this.snapshot.connectionState === 'CONNECTED') {
      return true;
    }

    const timeoutMs = this.configService.get<number>('WHATSAPP_CONNECT_TIMEOUT_MS') ?? 15000;
    const pollIntervalMs = 250;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (this.socket && this.snapshot.connectionState === 'CONNECTED') {
        return true;
      }

      if (this.snapshot.connectionState === 'QR_REQUIRED' || this.snapshot.connectionState === 'DISABLED') {
        return false;
      }

      if (this.snapshot.connectionState === 'DISCONNECTED') {
        return false;
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    return Boolean(this.socket && this.snapshot.connectionState === 'CONNECTED');
  }

  private async bootstrapSocket() {
    this.setSnapshot({
      connectionState: 'CONNECTING',
      qrDataUrl: null,
      lastError: null,
    });

    const authDir = this.getAuthDir();
    await fs.mkdir(authDir, { recursive: true });

    const baileys = await import('@whiskeysockets/baileys');
    const { state, saveCreds } = await baileys.useMultiFileAuthState(authDir);
    const { version } = await baileys.fetchLatestBaileysVersion();
    this.loggedOutStatusCode = baileys.DisconnectReason.loggedOut;
    const socket = baileys.default({
      auth: state,
      version,
      browser: baileys.Browsers.macOS('2x1 Burger Co'),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      defaultQueryTimeoutMs: this.configService.get<number>('WHATSAPP_SEND_TIMEOUT_MS') ?? 45000,
    });

    this.socket = socket;
    socket.ev.on('creds.update', saveCreds);
    socket.ev.on('connection.update', (update) => {
      void this.handleConnectionUpdate(update);
    });
    socket.ev.on('messages.upsert', (payload) => {
      void this.handleMessagesUpsert(payload);
    });
  }

  private async handleConnectionUpdate(update: {
    connection?: string;
    qr?: string;
    lastDisconnect?: { error?: unknown };
  }) {
    if (update.qr) {
      this.setSnapshot({
        connectionState: 'QR_REQUIRED',
        qrDataUrl: await QRCode.toDataURL(update.qr, {
          margin: 1,
          width: 280,
          color: {
            dark: '#111827',
            light: '#ffffff',
          },
        }),
        lastError: null,
      });
    }

    if (update.connection === 'open') {
      const businessPhone = this.normalizeBusinessPhone(this.socket?.user?.id ?? null);
      this.setSnapshot({
        connectionState: 'CONNECTED',
        qrDataUrl: null,
        businessPhone,
        linkedAt: new Date().toISOString(),
        lastError: null,
      });
      this.logger.log(`WhatsApp conectado${businessPhone ? ` (${businessPhone})` : ''}.`);
      return;
    }

    if (update.connection === 'close') {
      const statusCode = this.extractStatusCode(update.lastDisconnect?.error);
      const loggedOut = statusCode !== null && statusCode === this.loggedOutStatusCode;

      if (loggedOut) {
        await this.clearAuthDir();
      }

      await this.teardownSocket(false);

      this.setSnapshot({
        connectionState: loggedOut ? 'DISCONNECTED' : 'ERROR',
        qrDataUrl: null,
        businessPhone: null,
        linkedAt: loggedOut ? null : this.snapshot.linkedAt,
        lastError: loggedOut
          ? 'La sesión de WhatsApp del negocio se cerró. Escanea el QR otra vez.'
          : 'WhatsApp perdió la conexión. Actualiza el QR o vuelve a intentar.',
      });
    }
  }

  private async teardownSocket(resetBusinessPhone: boolean) {
    const socket = this.socket;
    this.socket = null;

    if (!socket) {
      return;
    }

    try {
      socket.ev.removeAllListeners('creds.update');
      socket.ev.removeAllListeners('connection.update');
      socket.ev.removeAllListeners('messages.upsert');
    } catch {
      // ignore cleanup errors
    }

    try {
      socket.end(new Error('Sesión reiniciada por el sistema.'));
    } catch {
      // ignore transport shutdown errors
    }

    if (resetBusinessPhone) {
      this.setSnapshot({
        businessPhone: null,
        linkedAt: null,
      });
    }
  }

  private async clearAuthDir() {
    const authDir = this.getAuthDir();
    await fs.mkdir(authDir, { recursive: true });

    const entries = await fs.readdir(authDir, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const targetPath = path.join(authDir, entry.name);

        try {
          await fs.rm(targetPath, { recursive: true, force: true });
        } catch (error) {
          const code =
            error && typeof error === 'object' && 'code' in error ? String((error as { code?: string }).code) : '';

          if (code === 'EBUSY' || code === 'EPERM') {
            this.logger.warn(`No fue posible limpiar ${targetPath} porque está en uso. Se conserva para evitar tumbar la sesión.`);
            return;
          }

          throw error;
        }
      }),
    );
  }

  private normalizeRecipientPhone(phone: string) {
    const digits = phone.replace(/\D/g, '');

    if (!digits) {
      throw new BadRequestException('Ingresa un número de celular válido.');
    }

    if (digits.startsWith('57') && digits.length === 12) {
      return digits;
    }

    if (digits.length === 10) {
      return `57${digits}`;
    }

    if (digits.length >= 11 && digits.length <= 15) {
      return digits;
    }

    throw new BadRequestException('Ingresa un número de celular válido.');
  }

  private normalizeBusinessPhone(rawJid: string | null) {
    if (!rawJid) {
      return null;
    }

    const baseJid = rawJid.split(':')[0] ?? rawJid;
    const [phone] = baseJid.split('@');
    const digits = phone?.replace(/\D/g, '') ?? '';
    return digits ? `+${digits}` : null;
  }

  private buildCaption(input: {
    businessName: string;
    customerName: string | null;
    receiptNumber: string;
    total: number;
  }) {
    const lines = [
      input.customerName ? `Hola ${input.customerName}.` : 'Hola.',
      `Te compartimos tu comprobante ${input.receiptNumber} de ${input.businessName}.`,
      `Total: ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(input.total)}.`,
      'Gracias por tu compra.',
    ];

    return lines.join('\n');
  }

  private buildDeliveryCaption(input: {
    businessName: string;
    customerName: string | null;
    orderNumber: string;
    total: number;
  }) {
    const lines = [
      input.customerName ? `Hola ${input.customerName}.` : 'Hola.',
      `Te compartimos tu cuenta pendiente ${input.orderNumber} de ${input.businessName}.`,
      `Total por cobrar: ${new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(input.total)}.`,
      `Pago sugerido: ${DELIVERY_PAYMENT_METHOD_LABEL} ${DELIVERY_PAYMENT_TARGET}.`,
      'Por favor compártenos tu ubicación actual para reenviarla al domiciliario y confirmar la tarifa final.',
      'Cuando el pago quede confirmado, cerramos la comanda.',
    ];

    return lines.join('\n');
  }

  private async handleMessagesUpsert(payload: any) {
    if (!payload || !Array.isArray(payload.messages)) {
      return;
    }

    const messages = payload.messages;
    for (const message of messages) {
      const remoteJid = String(message?.key?.remoteJid ?? '');
      if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') {
        continue;
      }

      const normalizedContent = this.unwrapWhatsappMessageContent(message?.message);
      const locationMessage = this.extractLocationPayload(normalizedContent);

      if (!locationMessage) {
        continue;
      }

      const latitude = Number(
        locationMessage.degreesLatitude ??
          locationMessage.latitude ??
          locationMessage.lat ??
          NaN,
      );
      const longitude = Number(
        locationMessage.degreesLongitude ??
          locationMessage.longitude ??
          locationMessage.lng ??
          NaN,
      );
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        continue;
      }

      const senderPhoneCandidates = this.extractSenderPhoneCandidates(message)
        .map((candidate) => this.normalizeDeliveryPhoneCandidate(candidate))
        .filter((candidate, index, collection) => Boolean(candidate) && collection.indexOf(candidate) === index);
      const attemptedSenderCandidates = senderPhoneCandidates.length ? senderPhoneCandidates : [''];
      if (!senderPhoneCandidates.length) {
        this.logger.warn(
          `Se recibió ubicación con remitente no reconocible (${remoteJid}). Se intentará aplicar sobre una única comanda activa de domicilio si el contexto es inequívoco.`,
        );
      }

      const captureResult = await this.ordersService.captureDeliveryLocationFromWhatsapp({
        rawSenderJid: remoteJid,
        participantJid: String(message?.key?.participant ?? message?.participant ?? ''),
        remoteJid,
        senderPhoneCandidates,
        latitude,
        longitude,
        rawPayload: normalizedContent as Prisma.InputJsonValue,
      });

      const updatedOrder = captureResult.order;
      const matchedSender = senderPhoneCandidates[0] ?? '';
      const usedSingleOrderFallback =
        captureResult.matchedRule === 'single_active_delivery_order' ||
        captureResult.matchedRule === 'single_active_phone_most_recent_order' ||
        captureResult.matchedRule === 'same_phone_most_recent_active_order';

      if (!updatedOrder || !this.socket) {
        this.logger.warn(
          `Se recibió ubicación de ${remoteJid}, pero no hay comanda de domicilio activa para actualizar. Candidatos evaluados: ${senderPhoneCandidates.join(', ') || 'ninguno'}.`,
        );
        continue;
      }

      this.logger.log(
        `Ubicación aplicada a ${updatedOrder.number} para ${matchedSender || remoteJid}${usedSingleOrderFallback ? ' usando fallback de única comanda activa' : ''}: ${updatedOrder.deliveryZoneLabel ?? 'Zona urbana'} · ${Number(updatedOrder.deliveryDistanceKm ?? 0).toFixed(2)} km.`,
      );

      const total = new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 0,
      }).format(Number(updatedOrder.subtotal ?? 0));
      const fee = new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 0,
      }).format(Number(updatedOrder.deliveryFee ?? 0));
      const distance =
        updatedOrder.deliveryDistanceKm != null ? `${Number(updatedOrder.deliveryDistanceKm).toFixed(1)} km` : 'sin distancia';

      await Promise.race([
        this.socket.sendMessage(remoteJid, {
          text: [
            `Ubicación recibida para tu pedido ${updatedOrder.number}.`,
            `${updatedOrder.deliveryZoneLabel ?? 'Zona urbana'} · ${distance}.`,
            `Domicilio: ${fee}.`,
            `Total actualizado: ${total}.`,
            `Pago sugerido: ${DELIVERY_PAYMENT_METHOD_LABEL} ${DELIVERY_PAYMENT_TARGET}.`,
          ].join('\n'),
        }),
        this.timeoutAfter(this.configService.get<number>('WHATSAPP_SEND_TIMEOUT_MS') ?? 45000),
      ]);
    }
  }

  private unwrapWhatsappMessageContent(message: any): any {
    let current = message ?? null;

    while (current) {
      if (
        current.locationMessage ||
        current.liveLocationMessage ||
        current.extendedTextMessage ||
        current.conversation
      ) {
        return current;
      }

      current =
        current.ephemeralMessage?.message ??
        current.viewOnceMessage?.message ??
        current.viewOnceMessageV2?.message ??
        current.viewOnceMessageV2Extension?.message ??
        current.documentWithCaptionMessage?.message ??
        current.imageMessage?.contextInfo?.quotedMessage ??
        null;
    }

    return message ?? null;
  }

  private extractLocationPayload(input: any): Record<string, unknown> | null {
    if (!input || typeof input !== 'object') {
      return null;
    }

    const queue: unknown[] = [input];
    const visited = new Set<unknown>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || typeof current !== 'object') {
        continue;
      }

      if (visited.has(current)) {
        continue;
      }
      visited.add(current);

      const candidate = current as Record<string, unknown>;
      const latitude = candidate.degreesLatitude ?? candidate.latitude ?? candidate.lat;
      const longitude = candidate.degreesLongitude ?? candidate.longitude ?? candidate.lng;

      if (latitude != null && longitude != null) {
        return candidate;
      }

      for (const value of Object.values(candidate)) {
        if (value && typeof value === 'object') {
          queue.push(value);
        }
      }
    }

    return null;
  }

  private extractSenderPhoneCandidates(message: any) {
    return [
      message?.key?.participant,
      message?.participant,
      message?.key?.remoteJid,
      message?.sender,
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  }

  private normalizeDeliveryPhoneCandidate(value: string) {
    if (value.includes('@lid')) {
      return '';
    }

    const normalized = this.normalizeBusinessPhone(value)?.replace(/^\+/, '') ?? '';
    if (!normalized) {
      return '';
    }

    if (normalized.startsWith('57') && normalized.length >= 12) {
      return normalized;
    }

    if (normalized.length === 10) {
      return `57${normalized}`;
    }

    return normalized.length >= 11 && normalized.length <= 15 ? normalized : '';
  }

  private buildClosingSummaryMessage(closure: Awaited<ReturnType<ReportsService['getDailyClosure']>>, groupLabel: string | null) {
    const currency = (value: number | string | null | undefined) =>
      new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 0,
      }).format(Number(value ?? 0));
    const formatDateTime = (value: string | null | undefined) =>
      value
        ? new Date(value).toLocaleString('es-CO', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        : 'Sin registro';

    const criticalNotes = [
      Number(closure.cash?.difference ?? 0) !== 0
        ? `La caja cerró con diferencia de ${currency(closure.cash?.difference)}.`
        : null,
      Number(closure.sales?.adjustments?.count ?? 0) > 0
        ? `Se registraron ${(closure.sales?.adjustments?.count ?? 0).toLocaleString('es-CO')} venta${Number(closure.sales?.adjustments?.count ?? 0) === 1 ? '' : 's'} con ajuste manual por ${currency(closure.sales?.adjustments?.total ?? 0)}.`
        : null,
      (closure.replenishment?.outOfStock?.length ?? 0) > 0
        ? `${(closure.replenishment?.outOfStock?.length ?? 0).toLocaleString('es-CO')} referencia${Number(closure.replenishment?.outOfStock?.length ?? 0) === 1 ? '' : 's'} quedó${Number(closure.replenishment?.outOfStock?.length ?? 0) === 1 ? '' : 'ron'} agotada${Number(closure.replenishment?.outOfStock?.length ?? 0) === 1 ? '' : 's'}.`
        : null,
      (closure.replenishment?.criticalStock?.length ?? 0) > 0
        ? `${(closure.replenishment?.criticalStock?.length ?? 0).toLocaleString('es-CO')} referencia${Number(closure.replenishment?.criticalStock?.length ?? 0) === 1 ? '' : 's'} quedó${Number(closure.replenishment?.criticalStock?.length ?? 0) === 1 ? '' : 'ron'} en nivel crítico.`
        : null,
    ].filter(Boolean) as string[];

    const lines = [
      `Cierre diario${groupLabel ? ` · ${groupLabel}` : ''}`,
      `Fecha: ${closure.period?.start ?? new Date().toISOString().slice(0, 10)}`,
      `Jornada: ${this.formatJourneyStatus(closure.journey.status)}`,
      `Responsable: ${closure.journey.responsibleUser ?? 'Sin responsable'}`,
      '',
      'Resumen ejecutivo',
      `Apertura: ${formatDateTime(closure.journey.openedAt)}`,
      `Cierre: ${formatDateTime(closure.journey.closedAt)}`,
      `Caja inicial: ${currency(closure.cash.openingAmount)}`,
      `Caja esperada: ${currency(closure.cash.expectedAmount)}`,
      `Caja real: ${currency(closure.cash.actualAmount)}`,
      `Diferencia final: ${currency(closure.cash.difference)}`,
      `Ventas: ${(closure.sales.count ?? 0).toLocaleString('es-CO')} · ${currency(closure.sales.total)}`,
      `Compras: ${(closure.purchases.count ?? 0).toLocaleString('es-CO')} · ${currency(closure.purchases.total)}`,
      `Gastos: ${(closure.expenses.count ?? 0).toLocaleString('es-CO')} · ${currency(closure.expenses.total)}`,
      `Utilidad neta estimada: ${currency(closure.metrics?.netProfit)}`,
    ];

    if (criticalNotes.length) {
      lines.push('', 'Notas críticas');
      criticalNotes.forEach((note, index) => {
        lines.push(`${index + 1}. ${note}`);
      });
    }

    if (closure.observations) {
      lines.push('', `Observaciones: ${closure.observations}`);
    }

    lines.push('', 'Se adjunta el PDF del cierre diario.');
    return lines.join('\n');
  }

  private readBusinessName(value: unknown) {
    if (value && typeof value === 'object' && 'name' in value && typeof value.name === 'string' && value.name.trim()) {
      return value.name.trim();
    }

    return '2x1 Burger Co';
  }

  private formatJourneyStatus(status: string) {
    switch (status) {
      case 'ABIERTA':
        return 'Abierta';
      case 'CERRADA':
        return 'Cerrada';
      default:
        return 'Pendiente de apertura';
    }
  }

  private timeoutAfter(ms: number) {
    return new Promise<never>((_, reject) => {
      setTimeout(() => reject(new ConflictException('WhatsApp no respondió a tiempo. Intenta nuevamente.')), ms);
    });
  }

  private extractStatusCode(error: unknown) {
    if (!error || typeof error !== 'object') {
      return null;
    }

    const output = (error as { output?: { statusCode?: number } }).output;
    if (typeof output?.statusCode === 'number') {
      return output.statusCode;
    }

    const data = (error as { data?: { output?: { statusCode?: number } } }).data;
    if (typeof data?.output?.statusCode === 'number') {
      return data.output.statusCode;
    }

    return null;
  }

  private getAuthDir() {
    const configured = this.configService.get<string>('WHATSAPP_AUTH_DIR') ?? '/app/data/whatsapp-auth';
    return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  }

  private isEnabled() {
    if (
      this.configService.get<string>('NODE_ENV') === 'test' ||
      Boolean(process.env.JEST_WORKER_ID) ||
      Boolean(process.env.TEST_DATABASE_URL)
    ) {
      return false;
    }

    return this.configService.get<boolean>('WHATSAPP_INTERNAL_ENABLED') ?? false;
  }

  private assertEnabled() {
    if (!this.isEnabled()) {
      throw new ConflictException('El envío interno por WhatsApp está deshabilitado en este entorno.');
    }
  }

  private setSnapshot(patch: Partial<WhatsappSessionSnapshot>) {
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      enabled: this.isEnabled(),
      updatedAt: new Date().toISOString(),
    };
  }

  private async readClosingSummarySettings() {
    const record = await this.prisma.setting.findUnique({
      where: { key: 'whatsapp.closing-summary' },
    });

    const value = (record?.value ?? {}) as ClosingSummarySettings;
    return {
      enabled: Boolean(value.enabled),
      groupInviteCode: this.normalizeInviteCode(value.groupInviteCode ?? null),
      groupJid: value.groupJid ?? null,
      groupLabel: value.groupLabel?.trim() || null,
    };
  }

  private async persistClosingGroupJid(groupJid: string, current: ClosingSummarySettings) {
    await this.prisma.setting.upsert({
      where: { key: 'whatsapp.closing-summary' },
      update: {
        category: 'whatsapp',
        description: 'Configuración del grupo que recibe el cierre diario',
        value: {
          enabled: Boolean(current.enabled),
          groupInviteCode: current.groupInviteCode ?? null,
          groupJid,
          groupLabel: current.groupLabel ?? null,
        },
      },
      create: {
        key: 'whatsapp.closing-summary',
        category: 'whatsapp',
        description: 'Configuración del grupo que recibe el cierre diario',
        value: {
          enabled: Boolean(current.enabled),
          groupInviteCode: current.groupInviteCode ?? null,
          groupJid,
          groupLabel: current.groupLabel ?? null,
        },
      },
    });
  }

  private async resolveClosingGroupJid(settings: {
    enabled: boolean;
    groupInviteCode: string | null;
    groupJid: string | null;
    groupLabel: string | null;
  }) {
    if (settings.groupJid) {
      return settings.groupJid;
    }

    const inviteCode = settings.groupInviteCode;
    if (!inviteCode) {
      return null;
    }

    try {
      const groupJid = await this.socket.groupAcceptInvite(inviteCode);
      if (groupJid) {
        await this.persistClosingGroupJid(groupJid, settings);
        return groupJid;
      }
    } catch (error) {
      this.logger.warn(`No fue posible unirse al grupo de cierre: ${String(error)}`);
    }

    try {
      const participating = await this.socket.groupFetchAllParticipating?.();
      if (participating) {
        const groupEntry = Object.values(participating).find((group: any) => {
          const subject = String(group?.subject ?? '').trim().toLowerCase();
          return settings.groupLabel ? subject === settings.groupLabel.trim().toLowerCase() : false;
        }) as any | undefined;

        if (groupEntry?.id) {
          await this.persistClosingGroupJid(String(groupEntry.id), settings);
          return String(groupEntry.id);
        }
      }
    } catch (error) {
      this.logger.warn(`No fue posible resolver el grupo de cierre por metadata: ${String(error)}`);
    }

    return null;
  }

  private normalizeInviteCode(value: string | null) {
    if (!value) {
      return null;
    }

    const match = value.trim().match(/chat\.whatsapp\.com\/([A-Za-z0-9]+)/i);
    if (match?.[1]) {
      return match[1];
    }

    return value.trim();
  }

  private describeClosingSendFailure(error: unknown, groupLabel: string | null) {
    const rawMessage = String(
      error && typeof error === 'object' && 'message' in error ? (error as { message?: string }).message : error,
    ).toLowerCase();
    const dataCode =
      error && typeof error === 'object' && 'data' in error ? Number((error as { data?: number }).data) : null;

    if (rawMessage.includes('forbidden') || dataCode === 403) {
      return groupLabel
        ? `WhatsApp está conectado, pero no tiene permiso para escribir en el grupo "${groupLabel}". Verifica que el número del negocio siga dentro del grupo y pueda enviar mensajes.`
        : 'WhatsApp está conectado, pero no tiene permiso para escribir en el grupo configurado. Verifica que el número del negocio siga dentro del grupo y pueda enviar mensajes.';
    }

    return error instanceof Error ? error.message : 'No pudimos enviar el cierre diario por WhatsApp.';
  }
}
