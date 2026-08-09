import { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA, MODULE_METADATA } from '@nestjs/common/constants';
import type { ConfigService } from '@nestjs/config';
import type { BoldPaymentProvider } from './payments/bold-payment.provider';
import { MockPaymentProvider } from './payments/mock-payment.provider';
import type { NullPaymentProvider } from './payments/null-payment.provider';
import { PaymentProviderFactory } from './payments/payment-provider.factory';
import { SofiaTestOnlyGuard } from './runtime-safety/sofia-test-only.guard';
import { SofiaAgentService } from './sofia-agent.service';
import { SofiaController } from './sofia.controller';
import { SofiaPaymentLinkService } from './sofia-payment-link.service';
import { SofiaDevPaymentsController } from './sofia-payment-webhooks.controller';
import { SofiaService } from './sofia.service';
import { SofiaWhatsappQrGatewayController } from './whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.controller';

function expectReasonCode(action: () => unknown, code: string) {
  try {
    action();
    throw new Error('Expected action to throw.');
  } catch (error) {
    expect((error as { getResponse?: () => unknown }).getResponse?.()).toEqual({ code });
  }
}

async function expectAsyncReasonCode(action: () => Promise<unknown>, code: string) {
  try {
    await action();
    throw new Error('Expected action to reject.');
  } catch (error) {
    expect((error as { getResponse?: () => unknown }).getResponse?.()).toEqual({ code });
  }
}

describe('Sofia production mock isolation', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('rejects MockPaymentProvider and direct MOCK factory selection outside tests', async () => {
    process.env.NODE_ENV = 'production';
    const mock = new MockPaymentProvider();
    const factory = new PaymentProviderFactory(
      mock,
      { provider: 'BOLD' } as BoldPaymentProvider,
      { provider: 'NONE' } as NullPaymentProvider,
    );

    expectReasonCode(() => factory.resolve('MOCK'), 'SOFIA_PROD_MOCK_PAYMENT_FORBIDDEN');
    await expectAsyncReasonCode(() => mock.getPaymentStatus(), 'SOFIA_PROD_MOCK_PAYMENT_FORBIDDEN');
    expect(factory.resolve('BOLD').provider).toBe('BOLD');
  });

  it('omits test providers and the dev payment controller from the production Nest graph', async () => {
    process.env.NODE_ENV = 'production';
    jest.resetModules();
    const isolated = await import('./sofia.module');
    const providers = (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, isolated.SofiaModule) ?? []) as Array<unknown>;
    const controllers = (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, isolated.SofiaModule) ?? []) as Array<unknown>;
    const names = (values: Array<unknown>) => values.map((value) => (value as { name?: string }).name ?? '');

    expect(names(providers)).not.toEqual(expect.arrayContaining([
      'MockPaymentProvider',
      'MockWhatsappProvider',
      'BoldPaymentProvider',
      'NullPaymentProvider',
      'PaymentProviderFactory',
    ]));
    expect(names(controllers)).not.toEqual(expect.arrayContaining([
      'SofiaDevPaymentsController',
      'SofiaPublicPaymentsController',
    ]));
  });

  it('retains mock payment only in the explicit test runtime', () => {
    process.env.NODE_ENV = 'test';
    const mock = new MockPaymentProvider();
    const factory = new PaymentProviderFactory(
      mock,
      { provider: 'BOLD' } as BoldPaymentProvider,
      { provider: 'NONE' } as NullPaymentProvider,
    );
    expect(factory.resolve('MOCK')).toBe(mock);
  });

  it('returns a sanitized not-found result for test-only routes outside tests', () => {
    const config = { get: jest.fn().mockReturnValue('production') } as unknown as ConfigService;
    const guard = new SofiaTestOnlyGuard(config);
    expectReasonCode(() => guard.canActivate({} as ExecutionContext), 'SOFIA_TEST_ONLY_ROUTE_UNAVAILABLE');
    expect(config.get).toHaveBeenCalledWith('NODE_ENV');
  });

  it('wires the test-only guard to every retained sandbox mutation route', () => {
    const guardedMethods = [
      SofiaController.prototype.processCommercialSandbox,
      SofiaController.prototype.evaluateAutoSafe,
      SofiaController.prototype.testAiProvider,
      SofiaController.prototype.processAgentMessage,
      SofiaController.prototype.mockInbound,
      SofiaController.prototype.mockOutbound,
      SofiaWhatsappQrGatewayController.prototype.testInbound,
      SofiaWhatsappQrGatewayController.prototype.testSend,
    ];
    for (const method of guardedMethods) {
      expect(Reflect.getMetadata(GUARDS_METADATA, method)).toContain(SofiaTestOnlyGuard);
    }
    expect(Reflect.getMetadata(GUARDS_METADATA, SofiaDevPaymentsController)).toContain(SofiaTestOnlyGuard);
  });

  it('blocks mock webhook processing before any dependency can mutate state', async () => {
    process.env.NODE_ENV = 'production';
    const service = Object.create(SofiaPaymentLinkService.prototype) as SofiaPaymentLinkService;
    await expectAsyncReasonCode(
      () => service.simulateMockWebhook({ status: 'PAID' }),
      'SOFIA_PROD_MOCK_PAYMENT_FORBIDDEN',
    );
  });

  it('blocks sandbox processing and delivery-order conversion before persistence', async () => {
    process.env.NODE_ENV = 'production';
    const agent = Object.create(SofiaAgentService.prototype) as SofiaAgentService;
    const sofia = Object.create(SofiaService.prototype) as SofiaService;

    await expectAsyncReasonCode(
      () => agent.processSandboxMessage({ message: 'synthetic' }, 'actor'),
      'SOFIA_TEST_ONLY_ROUTE_UNAVAILABLE',
    );
    await expectAsyncReasonCode(
      () => sofia.createDeliveryOrderFromDraft('mock-admin-draft', 'actor'),
      'SOFIA_PROD_DELIVERY_ORDER_CREATION_FORBIDDEN',
    );
  });
});
