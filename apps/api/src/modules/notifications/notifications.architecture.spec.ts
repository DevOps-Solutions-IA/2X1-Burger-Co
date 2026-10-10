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
        // SecureCommandService instance -- any identifier ENDING in `commands`/`Commands`
        // (`commands`, `secureCommands`, ...), not just the exact literal `commands` -- while
        // excluding the unrelated `handlers.execute(command)` / `this.execution.execute(...)`
        // call sites (CommandHandlerRegistry and the NotificationCommandExecutionPort
        // abstraction) that legitimately also exist in this module. A prior version of this
        // regex matched only the exact identifier `commands`, so a future call site spelled
        // e.g. `this.secureCommands.execute(...)` -- the very identifier name this test file's
        // own fixtures use for the dependency -- would have silently evaded detection.
        const matches = source.match(/\b\w*[Cc]ommands\.execute\(/g);
        if (matches) callSites.push(...matches.map(() => entryPath));
      }
    };
    walk(moduleDir);

    expect(callSites).toHaveLength(1);
    expect(callSites[0]).toBe(resolve(moduleDir, 'notification-dispatch.ports.ts'));
  });
});
