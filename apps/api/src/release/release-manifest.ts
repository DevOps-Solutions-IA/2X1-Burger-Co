import { readFileSync } from 'node:fs';
import { z } from 'zod';

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const releaseManifestSchema = z.object({
  application: z.string().min(1).max(80),
  releaseVersion: z.string().min(1).max(80),
  gitCommit: z.union([z.string().regex(/^[a-f0-9]{40}$/), z.literal('unknown')]),
  gitCommitShort: z.union([z.string().regex(/^[a-f0-9]{7,12}$/), z.literal('unknown')]),
  buildTimestamp: z.string().datetime(),
  buildId: z.string().min(1).max(120),
  environment: z.enum(['development', 'test', 'staging', 'production']),
  artifactDigest: digestSchema.nullable(),
  apiVersion: z.string().min(1).max(40),
  schemaCompatibilityVersion: z.string().min(1).max(160).nullable(),
  dirtyBuild: z.boolean(),
  sourceRepository: z.string().min(1).max(120),
});

export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

export function developmentReleaseManifest(): ReleaseManifest {
  return {
    application: 'inventory-fastfood-system',
    releaseVersion: 'development',
    gitCommit: 'unknown',
    gitCommitShort: 'unknown',
    buildTimestamp: new Date(0).toISOString(),
    buildId: 'development-untracked',
    environment: process.env.NODE_ENV === 'test' ? 'test' : 'development',
    artifactDigest: null,
    apiVersion: '0.0.1',
    schemaCompatibilityVersion: null,
    dirtyBuild: true,
    sourceRepository: 'inventory-fastfood-system',
  };
}

export function loadReleaseManifest(path: string): ReleaseManifest {
  const parsed = releaseManifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  const runtimeDigest = process.env.RELEASE_ARTIFACT_DIGEST;

  return {
    ...parsed,
    artifactDigest: runtimeDigest ? digestSchema.parse(runtimeDigest) : parsed.artifactDigest,
  };
}
