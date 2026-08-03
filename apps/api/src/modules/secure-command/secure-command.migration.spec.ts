import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('secure command additive migration', () => {
  const migration = readFileSync(
    resolve(__dirname, '../../../../../prisma/migrations/20260803230000_sofia_secure_command_core/migration.sql'),
    'utf8',
  );

  it('creates exactly the four bounded persistence tables', () => {
    expect([...migration.matchAll(/CREATE TABLE "([^"]+)"/g)].map((match) => match[1])).toEqual([
      'sofia_commands',
      'sofia_command_approvals',
      'sofia_command_attempts',
      'sofia_command_results',
    ]);
  });

  it('contains no destructive or data-backfill statement', () => {
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM|UPDATE\s+"|ALTER\s+TYPE|ON\s+DELETE\s+CASCADE/i);
  });

  it('scopes idempotency and leaves AuditLog unchanged', () => {
    expect(migration).toContain('("scope", "command_type", "idempotency_key")');
    expect(migration).not.toContain('audit_logs_idempotency');
  });
});
