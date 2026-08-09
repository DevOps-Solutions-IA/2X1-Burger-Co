import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Notifications architecture', () => {
  it('declares command and WhatsApp policy dependencies without a service locator', () => {
    const ports = readFileSync(resolve(__dirname, 'notification-dispatch.ports.ts'), 'utf8');
    const notificationsModule = readFileSync(resolve(__dirname, 'notifications.module.ts'), 'utf8');
    const sofiaModule = readFileSync(resolve(__dirname, '../sofia/sofia.module.ts'), 'utf8');

    expect(ports).not.toContain('ModuleRef');
    expect(ports).not.toContain('strict: false');
    expect(notificationsModule).toContain('imports: [SofiaModule, SecureCommandModule]');
    expect(sofiaModule).not.toContain('NotificationsModule');
    expect(sofiaModule).not.toContain('forwardRef');
  });
});
