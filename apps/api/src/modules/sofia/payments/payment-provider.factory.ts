import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { SofiaPaymentSettings } from '@prisma/client';
import { BoldPaymentProvider } from './bold-payment.provider';
import { MockPaymentProvider } from './mock-payment.provider';
import { NullPaymentProvider } from './null-payment.provider';
import { OnlinePaymentProvider, PaymentProviderAdapter } from './payment-provider.adapter';

@Injectable()
export class PaymentProviderFactory {
  constructor(
    @Optional() private readonly mockPaymentProvider: MockPaymentProvider | null,
    private readonly boldPaymentProvider: BoldPaymentProvider,
    private readonly nullPaymentProvider: NullPaymentProvider,
  ) {}

  resolve(provider: string | null | undefined): PaymentProviderAdapter {
    const normalized = String(provider ?? 'NONE').toUpperCase() as OnlinePaymentProvider;
    if (normalized === 'MOCK') {
      this.assertMockAllowed();
      if (!this.mockPaymentProvider) this.rejectUnavailableMock();
      return this.mockPaymentProvider;
    }
    if (normalized === 'BOLD') return this.boldPaymentProvider;
    return this.nullPaymentProvider;
  }

  resolveFromSettings(settings: SofiaPaymentSettings): PaymentProviderAdapter {
    if (!settings.onlinePaymentsEnabled) return this.nullPaymentProvider;
    if (settings.onlinePaymentProvider === 'MOCK' && settings.mockOnlinePaymentsEnabled && process.env.NODE_ENV !== 'production') {
      if (!this.mockPaymentProvider) this.rejectUnavailableMock();
      return this.mockPaymentProvider;
    }
    if (settings.onlinePaymentProvider === 'BOLD' && settings.boldEnabled) {
      return this.boldPaymentProvider;
    }
    return this.nullPaymentProvider;
  }

  private assertMockAllowed() {
    if (process.env.NODE_ENV !== 'test') {
      throw new BadRequestException({ code: 'SOFIA_PROD_MOCK_PAYMENT_FORBIDDEN' });
    }
  }

  private rejectUnavailableMock(): never {
    throw new BadRequestException({ code: 'SOFIA_TEST_MOCK_PAYMENT_NOT_REGISTERED' });
  }
}
