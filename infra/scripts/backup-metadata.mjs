#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fileSha256(filePath) {
  return sha256(readFileSync(filePath));
}

export function createBackupMetadata({ backupPath, migrationListPath, databaseName, createdAt }) {
  const migrationNames = readFileSync(migrationListPath, 'utf8')
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();
  const metadata = {
    formatVersion: 1,
    createdAt,
    encryptedFile: path.basename(backupPath),
    encryptedSizeBytes: readFileSync(backupPath).byteLength,
    encryptedSha256: fileSha256(backupPath),
    migrationCount: migrationNames.length,
    migrationDigest: sha256(`${migrationNames.join('\n')}\n`),
    databaseIdentifier: `sha256:${sha256(databaseName)}`,
  };
  const metadataPath = `${backupPath}.metadata.json`;
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return { metadata, metadataPath };
}

export function readAndVerifyBackupMetadata({ backupPath, metadataPath = `${backupPath}.metadata.json` }) {
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  const validDigest = /^[a-f0-9]{64}$/u;
  if (
    metadata.formatVersion !== 1
    || metadata.encryptedFile !== path.basename(backupPath)
    || metadata.encryptedSizeBytes !== readFileSync(backupPath).byteLength
    || metadata.encryptedSha256 !== fileSha256(backupPath)
    || !Number.isSafeInteger(metadata.migrationCount)
    || metadata.migrationCount < 0
    || !validDigest.test(metadata.migrationDigest)
    || !/^sha256:[a-f0-9]{64}$/u.test(metadata.databaseIdentifier)
  ) {
    throw new Error('Backup metadata verification failed.');
  }
  return metadata;
}

const [command, backupPath, argumentA, argumentB, argumentC] = process.argv.slice(2);
if (command === 'create') {
  const { metadataPath } = createBackupMetadata({
    backupPath,
    migrationListPath: argumentA,
    databaseName: argumentB,
    createdAt: argumentC,
  });
  process.stdout.write(`${metadataPath}\n`);
} else if (command === 'verify') {
  const metadata = readAndVerifyBackupMetadata({ backupPath, metadataPath: argumentA });
  process.stdout.write(`${metadata.migrationCount}\t${metadata.migrationDigest}\n`);
} else if (import.meta.url === `file://${process.argv[1]}`) {
  process.stderr.write('Usage: backup-metadata.mjs create|verify ...\n');
  process.exitCode = 1;
}
