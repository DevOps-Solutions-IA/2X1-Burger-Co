#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATION_NAME = /^\d{4,14}_[a-z0-9_]+$/;

export function resolveMigrationExpectation(migrationsRoot = path.resolve('prisma/migrations')) {
  if (!existsSync(migrationsRoot)) {
    throw new Error(`Migration directory does not exist: ${migrationsRoot}`);
  }

  const migrations = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (migrations.length === 0) throw new Error('No Prisma migrations found');

  const digest = createHash('sha256');
  const inventory = [];
  for (const migration of migrations) {
    if (!MIGRATION_NAME.test(migration)) throw new Error(`Invalid migration directory name: ${migration}`);
    const migrationFile = path.join(migrationsRoot, migration, 'migration.sql');
    if (!existsSync(migrationFile)) throw new Error(`Missing migration.sql for ${migration}`);
    const contents = readFileSync(migrationFile);
    const checksum = createHash('sha256').update(contents).digest('hex');
    inventory.push(Object.freeze({ name: migration, checksum }));
    digest.update(migration);
    digest.update('\0');
    digest.update(contents);
    digest.update('\0');
  }

  return Object.freeze({
    count: migrations.length,
    latest: migrations.at(-1),
    fingerprint: digest.digest('hex'),
    migrations: Object.freeze(migrations),
    inventory: Object.freeze(inventory),
  });
}

export function evaluateAppliedMigrations(expectation, appliedRows) {
  const successful = new Map();
  const failed = [];
  for (const row of appliedRows) {
    if (!row || typeof row.migrationName !== 'string') {
      throw new Error('Applied migration rows require migrationName');
    }
    if (row.finished === true && row.rolledBack !== true) successful.set(row.migrationName, row.checksum ?? null);
    else if (row.rolledBack !== true) failed.push(row.migrationName);
  }

  const missing = expectation.migrations.filter((name) => !successful.has(name));
  const unexpected = [...successful.keys()].filter((name) => !expectation.migrations.includes(name)).sort();
  const checksumMismatch = expectation.inventory
    .filter(({ name, checksum }) => successful.has(name) && successful.get(name) !== null && successful.get(name) !== checksum)
    .map(({ name }) => name);
  return Object.freeze({
    compatible: missing.length === 0 && unexpected.length === 0 && failed.length === 0 && checksumMismatch.length === 0,
    expectedCount: expectation.count,
    appliedCount: successful.size,
    missing,
    unexpected,
    failed: failed.sort(),
    checksumMismatch,
  });
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function runCli() {
  const root = path.resolve(argument('--root', 'prisma/migrations'));
  const field = argument('--field', null);
  const expectation = resolveMigrationExpectation(root);
  if (field) {
    if (!['count', 'latest', 'fingerprint'].includes(field)) throw new Error(`Unsupported field: ${field}`);
    process.stdout.write(`${expectation[field]}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(expectation)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();
