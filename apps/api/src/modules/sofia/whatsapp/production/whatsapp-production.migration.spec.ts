import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

describe('WhatsApp production additive migration', () => {
  const root = resolve(__dirname, '../../../../../../../prisma/migrations');
  const name = '20260807230000_sofia_whatsapp_production_core';
  const migration = readFileSync(resolve(root, name, 'migration.sql'), 'utf8');

  it('is the single migration after the 33-migration frontier', () => {
    const migrations = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(migrations).toHaveLength(34);
    expect(migrations.at(-1)).toBe(name);
  });

  it('is additive and does not backfill operational data', () => {
    expect(migration).not.toMatch(/DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM|UPDATE\s+"|ALTER\s+TYPE/i);
    expect(migration).toContain('CREATE TABLE "whatsapp_provider_accounts"');
    expect(migration).toContain('CREATE TABLE "whatsapp_message_status_events"');
    expect(migration).toContain('CREATE TABLE "whatsapp_handoff_events"');
    expect(migration).toContain('CREATE TABLE "whatsapp_media_envelopes"');
  });

  it('enforces deterministic provider event and handoff uniqueness', () => {
    expect(migration).toContain('whatsapp_inbound_events_account_id_provider_event_id_key');
    expect(migration).toContain('whatsapp_handoff_events_conversation_id_version_key');
    expect(migration).toContain('whatsapp_message_status_events_account_id_provider_status_event_id_key');
  });
});
