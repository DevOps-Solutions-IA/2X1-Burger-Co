import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

function files(root: string): string[] {
  // The root is the compile-time test directory, never request-controlled input.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe('secure command architecture boundaries', () => {
  const root = resolve(__dirname);
  const sources = files(root).filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'));

  it('allows Prisma only in the explicit persistence adapter', () => {
    const violations = sources
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      .filter((file) => /PrismaService|@prisma\/client/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(root, file))
      .filter((file) => file !== 'persistence/prisma-command.repository.ts');
    expect(violations).toEqual([]);
  });

  it('contains no provider or orchestration imports', () => {
    const violations = sources.filter((file) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      return /WhatsappProvider|PaymentProvider|AIProvider|SofiaAgentService/.test(readFileSync(file, 'utf8'));
    });
    expect(violations.map((file) => relative(root, file))).toEqual([]);
  });

  it('keeps operational handlers in the explicit blocked set', () => {
    const registry = readFileSync(join(root, 'command-handler.registry.ts'), 'utf8');
    for (const type of ['SOFIA_CREATE_ORDER', 'SOFIA_SEND_WHATSAPP', 'SOFIA_MARK_PAYMENT', 'SOFIA_DEDUCT_STOCK', 'SOFIA_MUTATE_CASH', 'SOFIA_CREATE_SALE']) {
      expect(registry).toContain(`'${type}'`);
    }
    expect(registry).toContain('enabled: false');
  });

  it('does not make AuditLog idempotency globally unique', () => {
    const schema = readFileSync(resolve(root, '../../../../../prisma/schema.prisma'), 'utf8');
    const auditModel = schema.split('model AuditLog {')[1]?.split('\n}')[0] ?? '';
    expect(auditModel).toContain('idempotencyKey String?');
    expect(auditModel).not.toMatch(/idempotencyKey[^\n]*@unique/);
  });
});
