import { readdirSync, readFileSync } from 'node:fs';
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

  it('BAJO: SecureCommandService.execute() has exactly one call site in the notifications module (SecureCommandExecutionAdapter)', () => {
    const moduleDir = __dirname;
    const callSites: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const entryPath = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          walk(entryPath);
          continue;
        }
        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) continue;
        const source = readFileSync(entryPath, 'utf8');
        // Matches `<identifier>.execute(` calls on anything that could plausibly be the
        // SecureCommandService instance (`commands`/`secureCommands`), while excluding the
        // unrelated `handlers.execute(command)` / `this.execution.execute(...)` call sites
        // (CommandHandlerRegistry and the NotificationCommandExecutionPort abstraction) that
        // legitimately also exist in this module.
        const matches = source.match(/\bcommands\.execute\(/g);
        if (matches) callSites.push(...matches.map(() => entryPath));
      }
    };
    walk(moduleDir);

    expect(callSites).toHaveLength(1);
    expect(callSites[0]).toBe(resolve(moduleDir, 'notification-dispatch.ports.ts'));
  });
});
