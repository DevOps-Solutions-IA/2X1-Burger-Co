import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const orchestration = [
  'commercial/commercial-checkout.service.ts',
  'commercial/commercial-intent.engine.ts',
  'commercial/commercial-policy.service.ts',
].map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');

describe('commercial checkout architecture', () => {
  it('keeps Prisma confined to the persistence adapter', () => {
    expect(orchestration).not.toMatch(/PrismaService|@prisma\/client|this\.prisma/);
  });

  it('does not import operational mutation authorities or providers', () => {
    expect(orchestration).not.toMatch(/OrdersService|CashRegisterService|SalesService|BoldPaymentProvider|WhatsappProvider|InventoryService/);
  });

  it('routes Sofia agent commercial turns through the governed checkout service', () => {
    const agent = fs.readFileSync(path.join(root, 'sofia-agent.service.ts'), 'utf8');
    expect(agent).toContain('CommercialCheckoutService');
    expect(agent).toContain('this.commercialCheckout.process');
  });

  it('keeps production actions disabled in configuration', () => {
    const env = fs.readFileSync(path.resolve(root, '../../../../../.env.example'), 'utf8');
    expect(env).not.toMatch(/^(SOFIA_AUTO_REPLY_ENABLED|SOFIA_PRODUCTION_ENABLED|WHATSAPP_QR_ALLOW_REAL_SEND)=true$/m);
  });

  it('adds exactly one migration after the Phase 3 frontier', () => {
    const migrations = fs.readdirSync(path.resolve(root, '../../../../../prisma/migrations')).filter((name) => name.includes('sofia_commercial_checkout_core'));
    expect(migrations).toEqual(['20260808040000_sofia_commercial_checkout_core']);
  });
});
