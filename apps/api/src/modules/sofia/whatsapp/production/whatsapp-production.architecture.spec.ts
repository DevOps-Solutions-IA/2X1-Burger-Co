import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

function files(root: string): string[] {
  // Test root is compile-time controlled.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe('WhatsApp production architecture boundaries', () => {
  const productionRoot = resolve(__dirname);
  const sofiaRoot = resolve(__dirname, '../..');

  it('allows Prisma only in the dedicated WhatsApp persistence adapter', () => {
    const violations = [
      ...files(productionRoot),
      resolve(sofiaRoot, 'sofia-whatsapp.service.ts'),
    ]
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      .filter((file) => /PrismaService|this\.prisma\b/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(sofiaRoot, file))
      .filter((file) => ![
        'whatsapp/production/persistence/prisma-whatsapp-production.repository.ts',
        'whatsapp/production/persistence/prisma-whatsapp-conversation.repository.ts',
        'whatsapp/production/whatsapp-production.repository.ts',
        'whatsapp/production/whatsapp-inbound-deduplicator.ts',
        'whatsapp/production/whatsapp-delivery-status.service.ts',
      ].includes(file));
    expect(violations).toEqual([]);
  });

  it('prevents direct provider sends from Sofia orchestration', () => {
    const allowed = new Set([
      'whatsapp/production/whatsapp-outbound.gateway.ts',
      'whatsapp/hermes-whatsapp.provider.ts',
      'whatsapp/mock-whatsapp.provider.ts',
      'whatsapp/null-whatsapp.provider.ts',
      'whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.provider.ts',
      'whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.service.ts',
    ]);
    const violations = files(sofiaRoot)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      .filter((file) => /\.send(?:Text|Media)Message\(/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(sofiaRoot, file))
      .filter((file) => !allowed.has(file));
    expect(violations).toEqual([]);
  });

  it('keeps Baileys ownership inside the QR gateway adapter', () => {
    const violations = files(sofiaRoot)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      .filter((file) => /@whiskeysockets\/baileys/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(sofiaRoot, file))
      .filter((file) => file !== 'whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.service.ts');
    expect(violations).toEqual([]);
  });

  it('keeps production send and automatic operation flags disabled by default', () => {
    const example = readFileSync(resolve(productionRoot, '../../../../../../../.env.example'), 'utf8');
    expect(example).toContain('SOFIA_WHATSAPP_OUTBOUND_HANDLER_ENABLED=false');
    expect(example).toContain('WHATSAPP_QR_ALLOW_REAL_SEND=false');
    expect(example).toContain('SOFIA_AUTO_REPLY_ENABLED=false');
    expect(example).toContain('SOFIA_PRODUCTION_ENABLED=false');
  });
});
