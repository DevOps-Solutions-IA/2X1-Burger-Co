#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

const BLOCKED_PORTS = new Set(['5432', '55432', '55433']);
const SAFE_HOSTS = new Set(['127.0.0.1', 'localhost', 'ephemeral-postgres']);

export function sanitizeDatabaseUrl(value) {
  const parsed = new URL(value);
  const port = parsed.port || '5432';
  return `${parsed.protocol}//${parsed.username ? '[user]@' : ''}${parsed.hostname}:${port}${parsed.pathname}?schema=test`;
}

export function validateEphemeralDatabaseConfig(input) {
  const {
    databaseUrl,
    runId,
    expectedPort,
    explicitMode,
    composeProject,
  } = input;

  if (explicitMode !== 'true') throw new Error('EPHEMERAL_TEST_MODE must be explicitly true.');
  if (!runId || !/^[a-z0-9-]{8,64}$/.test(runId)) throw new Error('Invalid ephemeral run id.');
  if (!composeProject?.startsWith('inventory-e2e-')) throw new Error('Invalid ephemeral compose project.');
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');

  const parsed = new URL(databaseUrl);
  const database = parsed.pathname.replace(/^\//, '');
  const port = parsed.port || '5432';
  const marker = runId.replace(/-/g, '_').slice(-24);

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new Error('Only PostgreSQL is supported.');
  }
  if (!SAFE_HOSTS.has(parsed.hostname)) throw new Error('Database host is not ephemeral-safe.');
  if (!database.endsWith('_test')) throw new Error('Database name must end in _test.');
  if (!database.includes(marker)) throw new Error('Database name does not contain the run marker.');
  if (parsed.hostname !== 'ephemeral-postgres') {
    if (!expectedPort || port !== String(expectedPort)) throw new Error('Database port does not match this run.');
    if (BLOCKED_PORTS.has(port)) throw new Error('Known operational/canary database port is forbidden.');
  }
  if (!parsed.username.startsWith('e2e_')) throw new Error('Database user is not ephemeral-scoped.');

  return {
    database,
    host: parsed.hostname,
    port,
    sanitizedUrl: sanitizeDatabaseUrl(databaseUrl),
  };
}

function cli() {
  const result = validateEphemeralDatabaseConfig({
    databaseUrl: process.env.DATABASE_URL,
    runId: process.env.EPHEMERAL_TEST_RUN_ID,
    expectedPort: process.env.EPHEMERAL_DB_PORT,
    explicitMode: process.env.EPHEMERAL_TEST_MODE,
    composeProject: process.env.COMPOSE_PROJECT_NAME,
  });
  process.stdout.write(`${JSON.stringify({ status: 'PASS', ...result }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) cli();
