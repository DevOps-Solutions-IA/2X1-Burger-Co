import { GoneException, Injectable } from '@nestjs/common';

const LEGACY_TRANSPORT_RETIRED = 'WHATSAPP_LEGACY_TRANSPORT_RETIRED';

type LegacyWhatsappOperationResult = {
  success: boolean;
  skipped?: boolean;
  alreadySent?: boolean;
  phone?: string;
  receiptNumber?: string;
  orderNumber?: string;
  updated?: boolean;
  sentAt?: string;
  reason?: string;
  inviteCode?: string;
  groupJid?: string;
  groupLabel?: string | null;
  linkedAt?: string;
};

/**
 * Compatibility facade for old administrative routes and callers.
 *
 * Baileys session ownership and all future outbound execution belong to the
 * governed SOFIA QR gateway. This facade intentionally owns no socket and can
 * never send, reconnect, discover groups, or mutate session credentials.
 */
@Injectable()
export class WhatsappService {
  getSessionStatus() {
    return {
      enabled: false,
      connectionState: 'DISABLED' as const,
      qrDataUrl: null,
      businessPhone: null,
      linkedAt: null,
      updatedAt: new Date().toISOString(),
      lastError: LEGACY_TRANSPORT_RETIRED,
      authority: 'SOFIA_QR_GATEWAY',
      readOnly: true,
    };
  }

  refreshSession(): Promise<LegacyWhatsappOperationResult> {
    return this.retired();
  }

  listParticipatingGroups(): Promise<LegacyWhatsappOperationResult> {
    return this.retired();
  }

  disconnectSession(): Promise<LegacyWhatsappOperationResult> {
    return this.retired();
  }

  sendSaleReceipt(
    _saleId: string,
    _phone: string,
    _actorId: string,
  ): Promise<LegacyWhatsappOperationResult> {
    return this.retired();
  }

  sendDeliveryOrderSummary(
    _orderId: string,
    _actorId: string,
    _options?: { updated?: boolean; reason?: string; idempotencyKey?: string },
  ): Promise<LegacyWhatsappOperationResult> {
    return this.retired();
  }

  linkDailyCloseGroup(
    _inviteLink: string,
    _actorId: string,
  ): Promise<LegacyWhatsappOperationResult> {
    return this.retired();
  }

  selectDailyCloseGroup(
    _groupJid: string,
    _actorId: string,
    _preferredLabel?: string | null,
  ): Promise<LegacyWhatsappOperationResult> {
    return this.retired();
  }

  sendClosingSummary(
    _snapshotId: string,
    _actorId: string,
  ): Promise<LegacyWhatsappOperationResult> {
    return this.retired();
  }

  private retired(): Promise<never> {
    return Promise.reject(new GoneException(LEGACY_TRANSPORT_RETIRED));
  }
}
