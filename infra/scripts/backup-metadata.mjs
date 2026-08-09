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

const digestPattern = /^[a-f0-9]{64}$/u;
const taggedDigestPattern = /^sha256:[a-f0-9]{64}$/u;
const sourceShaPattern = /^[a-f0-9]{40}$/u;
const fingerprintPattern = /^[A-F0-9]{40}$/u;
const environmentPattern = /^[a-z][a-z0-9_-]{1,31}$/u;

function readMigrationNames(migrationListPath) {
  return readFileSync(migrationListPath, 'utf8')
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();
}

function commonMetadata({ backupPath, migrationListPath, createdAt }) {
  const migrationNames = readMigrationNames(migrationListPath);
  return {
    createdAt,
    encryptedFile: path.basename(backupPath),
    encryptedSizeBytes: readFileSync(backupPath).byteLength,
    encryptedSha256: fileSha256(backupPath),
    migrationCount: migrationNames.length,
    migrationDigest: sha256(`${migrationNames.join('\n')}\n`),
  };
}

export function createBackupMetadata({
  backupPath,
  migrationListPath,
  databaseName,
  databaseIdentityPath,
  createdAt,
  sourceSha,
  recipientFingerprint,
  environment,
  formatVersion = 2,
}) {
  const common = commonMetadata({ backupPath, migrationListPath, createdAt });
  let metadata;
  if (formatVersion === 1) {
    if (!databaseName) {
      throw new Error('Database name is required for backup metadata v1.');
    }
    metadata = {
      formatVersion: 1,
      ...common,
      databaseIdentifier: `sha256:${sha256(databaseName)}`,
    };
  } else if (formatVersion === 2) {
    if (
      !sourceShaPattern.test(sourceSha ?? '')
      || !fingerprintPattern.test(recipientFingerprint ?? '')
      || !environmentPattern.test(environment ?? '')
      || !databaseIdentityPath
    ) {
      throw new Error('Backup metadata v2 identity inputs are invalid.');
    }
    const databaseIdentity = readFileSync(databaseIdentityPath);
    if (databaseIdentity.byteLength === 0) {
      throw new Error('Backup metadata v2 database identity is empty.');
    }
    metadata = {
      formatVersion: 2,
      ...common,
      sourceSha,
      recipientFingerprint,
      environment,
      databaseIdentityHash: `sha256:${sha256(databaseIdentity)}`,
    };
  } else {
    throw new Error('Unsupported backup metadata format version.');
  }
  const metadataPath = `${backupPath}.metadata.json`;
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return { metadata, metadataPath };
}

export function readAndVerifyBackupMetadata({
  backupPath,
  metadataPath = `${backupPath}.metadata.json`,
  expectedSourceSha,
  expectedRecipientFingerprint,
  expectedEnvironment,
  expectedDatabaseIdentityHash,
  requireFormatVersion,
}) {
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  const commonInvalid = metadata.encryptedFile !== path.basename(backupPath)
    || metadata.encryptedSizeBytes !== readFileSync(backupPath).byteLength
    || metadata.encryptedSha256 !== fileSha256(backupPath)
    || !Number.isSafeInteger(metadata.migrationCount)
    || metadata.migrationCount < 0
    || !digestPattern.test(metadata.migrationDigest);
  if (commonInvalid) {
    throw new Error('Backup metadata verification failed.');
  }

  if (requireFormatVersion !== undefined && metadata.formatVersion !== requireFormatVersion) {
    throw new Error('Backup metadata format version does not match the required release contract.');
  }

  if (metadata.formatVersion === 1) {
    if (!taggedDigestPattern.test(metadata.databaseIdentifier ?? '')) {
      throw new Error('Backup metadata verification failed.');
    }
    if (expectedSourceSha || expectedRecipientFingerprint || expectedEnvironment || expectedDatabaseIdentityHash) {
      throw new Error('Backup metadata v1 cannot satisfy release identity expectations.');
    }
  } else if (metadata.formatVersion === 2) {
    if (
      !sourceShaPattern.test(metadata.sourceSha ?? '')
      || !fingerprintPattern.test(metadata.recipientFingerprint ?? '')
      || !environmentPattern.test(metadata.environment ?? '')
      || !taggedDigestPattern.test(metadata.databaseIdentityHash ?? '')
      || (expectedSourceSha && metadata.sourceSha !== expectedSourceSha)
      || (expectedRecipientFingerprint && metadata.recipientFingerprint !== expectedRecipientFingerprint)
      || (expectedEnvironment && metadata.environment !== expectedEnvironment)
      || (expectedDatabaseIdentityHash && metadata.databaseIdentityHash !== expectedDatabaseIdentityHash)
    ) {
      throw new Error('Backup metadata v2 identity verification failed.');
    }
  } else {
    throw new Error('Unsupported backup metadata format version.');
  }
  return metadata;
}

const [command, backupPath, ...argumentsList] = process.argv.slice(2);
if (command === 'create') {
  const [migrationListPath, databaseIdentityPath, createdAt, sourceSha, recipientFingerprint, environment] = argumentsList;
  const { metadataPath } = createBackupMetadata({
    backupPath,
    migrationListPath,
    databaseIdentityPath,
    createdAt,
    sourceSha,
    recipientFingerprint,
    environment,
  });
  process.stdout.write(`${metadataPath}\n`);
} else if (command === 'verify') {
  const [metadataPath, expectedSourceSha, expectedRecipientFingerprint, expectedEnvironment, expectedDatabaseIdentityHash, requiredVersion] = argumentsList;
  const metadata = readAndVerifyBackupMetadata({
    backupPath,
    metadataPath,
    expectedSourceSha: expectedSourceSha || undefined,
    expectedRecipientFingerprint: expectedRecipientFingerprint || undefined,
    expectedEnvironment: expectedEnvironment || undefined,
    expectedDatabaseIdentityHash: expectedDatabaseIdentityHash || undefined,
    requireFormatVersion: requiredVersion ? Number(requiredVersion) : undefined,
  });
  process.stdout.write(`${metadata.migrationCount}\t${metadata.migrationDigest}\t${metadata.formatVersion}\t${metadata.sourceSha ?? ''}\t${metadata.recipientFingerprint ?? ''}\t${metadata.environment ?? ''}\t${metadata.databaseIdentityHash ?? metadata.databaseIdentifier}\n`);
} else if (import.meta.url === `file://${process.argv[1]}`) {
  process.stderr.write('Usage: backup-metadata.mjs create|verify ...\n');
  process.exitCode = 1;
}
