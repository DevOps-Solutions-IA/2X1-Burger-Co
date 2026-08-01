import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');

test('runtime frontend contains no Sofia sandbox or mock payment route', () => {
  assert.equal(existsSync(path.join(root, 'apps/web/src/app/(app)/sofia/sandbox/page.tsx')), false);
  assert.equal(existsSync(path.join(root, 'apps/web/src/app/pagos/mock/[reference]/page.tsx')), false);
  const dashboard = readFileSync(path.join(root, 'apps/web/src/app/(app)/sofia/page.tsx'), 'utf8');
  const qr = readFileSync(path.join(root, 'apps/web/src/app/(app)/sofia/whatsapp-qr/page.tsx'), 'utf8');
  assert.doesNotMatch(dashboard, /\/sofia\/sandbox/u);
  assert.doesNotMatch(qr, /test-inbound|test-send/u);
});

test('production provider and delivery guards fail closed with sanitized codes', () => {
  const paymentFactory = readFileSync(
    path.join(root, 'apps/api/src/modules/sofia/payments/payment-provider.factory.ts'),
    'utf8',
  );
  const whatsappFactory = readFileSync(
    path.join(root, 'apps/api/src/modules/sofia/whatsapp/whatsapp-provider.factory.ts'),
    'utf8',
  );
  const sofiaService = readFileSync(path.join(root, 'apps/api/src/modules/sofia/sofia.service.ts'), 'utf8');
  assert.match(paymentFactory, /SOFIA_PROD_MOCK_PAYMENT_FORBIDDEN/u);
  assert.match(whatsappFactory, /SOFIA_PROD_MOCK_WHATSAPP_FORBIDDEN/u);
  assert.match(sofiaService, /SOFIA_PROD_DELIVERY_ORDER_CREATION_FORBIDDEN/u);
});
