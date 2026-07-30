import { closeSync, constants, fstatSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const RELEASE_MANIFEST_FILE_NAME = 'release-manifest.json';
const MAX_RELEASE_MANIFEST_BYTES = 128 * 1024;

export const releaseManifestSchema = z.object({
  releaseManifestVersion: z.literal(1),
  application: z.string().min(1).max(80),
  releaseVersion: z.string().min(1).max(80),
  commitSha: z.union([z.string().regex(/^[a-f0-9]{40}$/), z.literal('unknown')]),
  gitCommit: z.union([z.string().regex(/^[a-f0-9]{40}$/), z.literal('unknown')]),
  gitCommitShort: z.union([z.string().regex(/^[a-f0-9]{7,12}$/), z.literal('unknown')]),
  buildTimestamp: z.string().datetime(),
  buildId: z.string().min(1).max(120),
  environment: z.enum(['development', 'test', 'staging', 'production']),
  artifactDigest: digestSchema.nullable(),
  apiVersion: z.string().min(1).max(40),
  schemaCompatibilityVersion: z.string().min(1).max(160).nullable(),
  schemaMigrationCount: z.number().int().positive().nullable().optional(),
  schemaFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  migrationCount: z.number().int().positive().nullable(),
  migrationDigest: sha256Schema.nullable(),
  schemaVersion: z.string().min(1).max(160).nullable(),
  migrationInventory: z.array(z.object({
    name: z.string().regex(/^\d{4,14}_[a-z0-9_]+$/),
    checksum: sha256Schema,
  })).max(512),
  contractSuiteVersion: z.string().min(1).max(80),
  frontendBuildId: z.string().min(1).max(120),
  backendBuildId: z.string().min(1).max(120),
  safetyFlags: z.object({
    realSendingEnabled: z.literal(false),
    autoReplyEnabled: z.literal(false),
    autoSafeEnabled: z.literal(false),
    productionEnabled: z.literal(false),
    whatsappCanMarkPaid: z.literal(false),
  }),
  generatedAt: z.string().datetime(),
  dirtyBuild: z.boolean(),
  sourceRepository: z.string().min(1).max(120),
}).superRefine((manifest, context) => {
  if (manifest.schemaMigrationCount !== null && manifest.schemaMigrationCount !== undefined) {
    if (manifest.migrationInventory.length !== manifest.schemaMigrationCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['migrationInventory'],
        message: 'Migration inventory must match schemaMigrationCount',
      });
    }
    if (manifest.schemaVersion !== manifest.migrationInventory.at(-1)?.name) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['schemaVersion'],
        message: 'Schema version must match the latest migration',
      });
    }
  }
  if (manifest.frontendBuildId !== manifest.buildId || manifest.backendBuildId !== manifest.buildId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['buildId'],
      message: 'Frontend and backend build identities must match the release buildId',
    });
  }
  if (
    manifest.commitSha !== manifest.gitCommit ||
    manifest.migrationCount !== (manifest.schemaMigrationCount ?? null) ||
    manifest.migrationDigest !== (manifest.schemaFingerprint ?? null) ||
    manifest.generatedAt !== manifest.buildTimestamp
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['releaseManifestVersion'],
      message: 'Release manifest aliases must describe one immutable identity',
    });
  }
});

export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

export function developmentReleaseManifest(): ReleaseManifest {
  return {
    releaseManifestVersion: 1,
    application: 'inventory-fastfood-system',
    releaseVersion: 'development',
    commitSha: 'unknown',
    gitCommit: 'unknown',
    gitCommitShort: 'unknown',
    buildTimestamp: new Date(0).toISOString(),
    buildId: 'development-untracked',
    environment: process.env.NODE_ENV === 'test' ? 'test' : 'development',
    artifactDigest: null,
    apiVersion: '0.0.1',
    schemaCompatibilityVersion: null,
    schemaMigrationCount: null,
    schemaFingerprint: null,
    migrationCount: null,
    migrationDigest: null,
    schemaVersion: null,
    migrationInventory: [],
    contractSuiteVersion: 'development',
    frontendBuildId: 'development-untracked',
    backendBuildId: 'development-untracked',
    safetyFlags: {
      realSendingEnabled: false,
      autoReplyEnabled: false,
      autoSafeEnabled: false,
      productionEnabled: false,
      whatsappCanMarkPaid: false,
    },
    generatedAt: new Date(0).toISOString(),
    dirtyBuild: true,
    sourceRepository: 'inventory-fastfood-system',
  };
}

export function resolveReleaseManifestPath(candidate: string): string {
  const trimmed = candidate.trim();
  if (!trimmed || trimmed.length > 4096 || trimmed.includes('\0')) {
    throw new Error('Release manifest path is invalid');
  }

  const resolved = path.resolve(trimmed);
  if (path.basename(resolved) !== RELEASE_MANIFEST_FILE_NAME) {
    throw new Error(`Release manifest must be named ${RELEASE_MANIFEST_FILE_NAME}`);
  }
  return resolved;
}

function readReleaseManifestFile(candidate: string): string {
  const manifestPath = resolveReleaseManifestPath(candidate);
  // The path is normalized and filename-restricted above; O_NOFOLLOW prevents symlink traversal.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const descriptor = openSync(manifestPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile() || stats.size > MAX_RELEASE_MANIFEST_BYTES) {
      throw new Error('Release manifest must be a bounded regular file');
    }
    // Reading by the already validated descriptor avoids reopening a mutable pathname.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return readFileSync(descriptor, 'utf8');
  } finally {
    closeSync(descriptor);
  }
}

export function loadReleaseManifest(manifestPath: string): ReleaseManifest {
  const parsed = releaseManifestSchema.parse(JSON.parse(readReleaseManifestFile(manifestPath)));
  const runtimeDigest = process.env.RELEASE_ARTIFACT_DIGEST;

  return {
    ...parsed,
    artifactDigest: runtimeDigest ? digestSchema.parse(runtimeDigest) : parsed.artifactDigest,
  };
}
