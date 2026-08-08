import fs from 'node:fs';
import path from 'node:path';

const root = __dirname;
const source = (file: string) => {
  // Closed, test-owned file allowlist.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return fs.readFileSync(path.join(root, file), 'utf8');
};

describe('Phase 5 architecture boundaries', () => {
  it('keeps canonical persistence in the explicit adapter', () => {
    const orchestration = [
      'order-checkout.service.ts',
      'payment-orchestration.service.ts',
      'canonical-payment-webhook.service.ts',
      'kitchen-eligibility.service.ts',
      'phase5-runtime-gate.service.ts',
    ].map(source).join('\n');
    expect(orchestration).not.toMatch(/PrismaService|this\.prisma|\$transaction/);
  });

  it('exposes only the bounded public payment controller and does not import Sofia orchestration', () => {
    const moduleSource = source('order-checkout.module.ts');
    expect(moduleSource).toContain('controllers: [CanonicalPublicPaymentsController, CanonicalPaymentWebhooksController]');
    expect(moduleSource).not.toMatch(/SofiaAgentService|SofiaService|CommercialCheckoutService/);
    const controller = source('canonical-public-payments.controller.ts');
    expect(controller).toContain("@Controller('public/payments')");
    expect(controller).not.toMatch(/OrderCheckoutService|OrdersService|PrismaService|BoldPaymentProvider/);
  });

  it('keeps all production gates false and creates exactly migration 36', () => {
    const env = fs.readFileSync(path.resolve(root, '../../../../../.env.example'), 'utf8');
    expect(env).toContain('PHASE5_ORDER_CREATION_ENABLED=false');
    expect(env).toContain('PHASE5_PAYMENT_ORCHESTRATION_ENABLED=false');
    expect(env).toContain('PHASE5_KITCHEN_ENABLED=false');
    expect(env).toContain('PHASE5_TEST_OPERATIONAL_ENABLED=false');
    const migrations = fs.readdirSync(path.resolve(root, '../../../../../prisma/migrations')).filter((entry) => entry.includes('sofia_order_payment_kitchen_core'));
    expect(migrations).toEqual(['20260808180000_sofia_order_payment_kitchen_core']);
  });

  it('contains no production mock or sandbox fallback', () => {
    const moduleSource = source('order-checkout.module.ts');
    const orchestration = source('payment-orchestration.service.ts');
    expect(`${moduleSource}\n${orchestration}`).not.toMatch(/MockPaymentProvider|sandbox|provider\s*=\s*['"]MOCK/i);
  });

  it('keeps Phase 2 operational command handlers blocked', () => {
    const registry = fs.readFileSync(path.resolve(root, '../secure-command/command-handler.registry.ts'), 'utf8');
    expect(registry).toContain("'SOFIA_CREATE_ORDER'");
    expect(registry).toContain("'SOFIA_MARK_PAYMENT'");
    expect(registry).toContain('enabled: false');
  });
});
