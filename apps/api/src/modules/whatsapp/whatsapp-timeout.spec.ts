import { readFileSync } from 'node:fs';
import path from 'node:path';
import { WhatsappService } from './whatsapp.service';

describe('legacy WhatsApp transport retirement', () => {
  it('contains no Baileys socket, send, reconnect, or timeout authority', () => {
    const source = readFileSync(path.join(__dirname, 'whatsapp.service.ts'), 'utf8');

    expect(source).not.toMatch(/@whiskeysockets\/baileys|makeWASocket|sendMessage\s*\(/);
    expect(source).not.toMatch(/Promise\.race|setTimeout|bootstrapSocket|ensureSocket/);
  });

  it('exposes only a safe read-only status and retires every mutation', async () => {
    const service = new WhatsappService();

    expect(service.getSessionStatus()).toEqual(
      expect.objectContaining({
        enabled: false,
        connectionState: 'DISABLED',
        authority: 'SOFIA_QR_GATEWAY',
        readOnly: true,
      }),
    );
    await expect(service.refreshSession()).rejects.toThrow('WHATSAPP_LEGACY_TRANSPORT_RETIRED');
    await expect(service.sendClosingSummary('snapshot', 'actor')).rejects.toThrow(
      'WHATSAPP_LEGACY_TRANSPORT_RETIRED',
    );
  });
});
