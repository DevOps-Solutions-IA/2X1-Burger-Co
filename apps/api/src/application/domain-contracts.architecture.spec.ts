import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (path: string) => {
  // The test controls every relative path; dynamic input never reaches this helper.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return readFileSync(join(process.cwd(), 'src', path), 'utf8');
};

describe('Phase 1 SOFIA architecture boundary', () => {
  it('keeps Prisma out of agent orchestration and controllers', () => {
    for (const path of ['modules/sofia/sofia-agent.service.ts', 'modules/sofia/sofia.controller.ts']) {
      const text = source(path);
      expect(text).not.toContain('PrismaService');
      expect(text).not.toContain('this.prisma');
    }
  });

  it('does not create operational records from SOFIA orchestration', () => {
    for (const path of ['modules/sofia/sofia-agent.service.ts', 'modules/sofia/sofia.service.ts']) {
      const text = source(path);
      expect(text).not.toMatch(/(?:this\.prisma|tx)\.orderTicket\.create/);
      expect(text).not.toMatch(/(?:this\.prisma|tx)\.whatsappDeliveryOrder\.create/);
      expect(text).not.toMatch(/(?:this\.prisma|tx)\.(?:cashMovement|inventoryMovement|sale)\.create/);
    }
  });

  it('retains the explicit blocked order creation result', () => {
    const adapter = source('modules/sofia/contracts/sofia-contract.adapters.ts');
    expect(adapter).toContain('SOFIA_ORDER_CREATION_BLOCKED');
    expect(adapter).not.toContain('OrdersService');
  });

  it('keeps production mock provider rejection controls', () => {
    expect(source('modules/sofia/whatsapp/whatsapp-provider.factory.ts')).toContain('SOFIA_PROD_MOCK_WHATSAPP_FORBIDDEN');
    expect(source('modules/sofia/payments/payment-provider.factory.ts')).toContain('SOFIA_PROD_MOCK_PAYMENT_FORBIDDEN');
  });
});
