import { BadRequestException, GoneException, Injectable } from '@nestjs/common';

type PublicPaymentMethod = 'ONLINE' | 'NEQUI_MANUAL' | 'CASH';
type OperatorPaymentStatus = 'FAILED' | 'MANUAL_REVIEW' | 'CANCELLED';

type LegacyPaymentSettingsUpdate = {
  cashEnabled?: boolean;
  nequiManualEnabled?: boolean;
  nequiManualPhone?: string | null;
  nequiManualHolderName?: string | null;
  prepareCashOrdersImmediately?: boolean;
  prepareManualTransferBeforeVerification?: boolean;
  manualPaymentRequiresOperator?: boolean;
  paymentInstructionsText?: string | null;
  onlinePaymentsEnabled?: boolean;
  onlinePaymentProvider?: 'MOCK' | 'BOLD' | 'NONE';
  mockOnlinePaymentsEnabled?: boolean;
  boldEnabled?: boolean;
  paymentLinkTtlMinutes?: number;
  onlinePaymentExpiresMinutes?: number;
  prepareOnlineOrdersBeforePaid?: boolean;
};

const LEGACY_PAYMENT_RETIRED_RESPONSE = Object.freeze({
  code: 'SOFIA_LEGACY_PAYMENT_FLOW_RETIRED',
  canonicalAuthority: 'ORDER_CHECKOUT_PAYMENT_ORCHESTRATION',
});

/**
 * Fail-closed facade retained only for old compile-time contracts.
 *
 * Canonical payment reads, links, provider calls and financial transitions
 * belong to OrderCheckout/PaymentOrchestration. This facade exposes no data or
 * mutation path so legacy records cannot become a second payment authority.
 */
@Injectable()
export class SofiaPaymentLinkService {
  private retired(): never {
    throw new GoneException(LEGACY_PAYMENT_RETIRED_RESPONSE);
  }

  getOperationalLink(_orderTicketId: string): never {
    return this.retired();
  }

  getPaymentSettings(): never {
    return this.retired();
  }

  updatePaymentSettings(_input: LegacyPaymentSettingsUpdate, _actorId: string): never {
    return this.retired();
  }

  generateOperationalLink(_orderTicketId: string, _actorId: string): never {
    return this.retired();
  }

  getPublicPayment(_token: string): never {
    return this.retired();
  }

  selectPublicPaymentMethod(_token: string, _method: PublicPaymentMethod): never {
    return this.retired();
  }

  updateManualPaymentStatus(
    _orderTicketId: string,
    _input: { status: OperatorPaymentStatus; paymentMethod?: PublicPaymentMethod; message?: string },
    _actorId: string,
  ): never {
    return this.retired();
  }

  processPaymentWebhook(
    _providerName: string,
    _rawPayload: unknown,
    _headers: Record<string, string | string[] | undefined>,
    _rawBody?: Buffer,
  ): never {
    return this.retired();
  }

  simulateMockWebhook(_input: {
    orderReference?: string;
    providerReference?: string;
    providerPaymentId?: string;
    status: 'PAID' | 'FAILED' | 'REVIEW';
    amount?: number;
    currency?: string;
    eventId?: string;
  }): never {
    if (process.env.NODE_ENV !== 'test') {
      throw new BadRequestException({ code: 'SOFIA_PROD_MOCK_PAYMENT_FORBIDDEN' });
    }
    return this.retired();
  }

}
