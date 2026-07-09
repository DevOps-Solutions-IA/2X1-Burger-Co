import { Injectable } from '@nestjs/common';
import { SofiaPaymentSettings } from '@prisma/client';
import { BoldPaymentProvider } from './bold-payment.provider';
import { MockPaymentProvider } from './mock-payment.provider';
import { NullPaymentProvider } from './null-payment.provider';
import { OnlinePaymentProvider, PaymentProviderAdapter } from './payment-provider.adapter';

@Injectable()
export class PaymentProviderFactory {
  constructor(
    private readonly mockPaymentProvider: MockPaymentProvider,
    private readonly boldPaymentProvider: BoldPaymentProvider,
    private readonly nullPaymentProvider: NullPaymentProvider,
  ) {}

  resolve(provider: string | null | undefined): PaymentProviderAdapter {
    const normalized = String(provider ?? 'NONE').toUpperCase() as OnlinePaymentProvider;
    if (normalized === 'MOCK') return this.mockPaymentProvider;
    if (normalized === 'BOLD') return this.boldPaymentProvider;
    return this.nullPaymentProvider;
  }

  resolveFromSettings(settings: SofiaPaymentSettings): PaymentProviderAdapter {
    if (!settings.onlinePaymentsEnabled) return this.nullPaymentProvider;
    if (settings.onlinePaymentProvider === 'MOCK' && settings.mockOnlinePaymentsEnabled && process.env.NODE_ENV !== 'production') {
      return this.mockPaymentProvider;
    }
    if (settings.onlinePaymentProvider === 'BOLD' && settings.boldEnabled) {
      return this.boldPaymentProvider;
    }
    return this.nullPaymentProvider;
  }
}
