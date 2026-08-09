import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('WhatsApp Baileys authority architecture', () => {
  const apiRoot = path.resolve(__dirname, '../../../..');
  const legacy = readFileSync(
    path.join(apiRoot, 'modules/whatsapp/whatsapp.service.ts'),
    'utf8',
  );
  const canonical = readFileSync(
    path.join(__dirname, 'sofia-whatsapp-qr-gateway.service.ts'),
    'utf8',
  );

  it('keeps Baileys socket ownership exclusively in the canonical QR gateway', () => {
    expect(legacy).not.toContain('@whiskeysockets/baileys');
    expect(legacy).not.toMatch(/sendMessage\s*\(|bootstrapSocket|ensureSocket|Promise\.race/);
    expect(canonical).toContain("import('@whiskeysockets/baileys')");
    expect(canonical).toContain('QrSessionOwnershipCoordinator');
  });

  it('keeps real outbound disabled at the canonical adapter boundary', () => {
    const provider = readFileSync(
      path.join(__dirname, 'sofia-whatsapp-qr-gateway.provider.ts'),
      'utf8',
    );
    expect(provider).not.toMatch(/\.sendMessage\s*\(/);
    expect(provider).toContain('BLOCKED_REAL_SEND_DISABLED');
    expect(canonical).not.toContain('qrProvider.sendTextMessage');
  });

  it('never persists raw Baileys payloads for ignored outbound echoes', () => {
    expect(canonical).not.toContain('rawPayload: parsed.rawPayload');
    expect(canonical).toContain("source: 'qr_gateway'");
    expect(canonical).toContain('fromMe: true');
  });
});
