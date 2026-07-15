import { existsSync, readFileSync } from 'node:fs';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

type SafeReleaseManifest = {
  application: string;
  releaseVersion: string;
  gitCommit: string;
  gitCommitShort: string;
  buildTimestamp: string;
  buildId: string;
  environment: string;
  artifactDigest: string | null;
  apiVersion: string;
  schemaCompatibilityVersion: string | null;
  schemaMigrationCount?: number | null;
  schemaFingerprint?: string | null;
  dirtyBuild: boolean;
  sourceRepository: string;
};

const manifestSchema = z.object({
  application: z.string().min(1).max(80),
  releaseVersion: z.string().min(1).max(80),
  gitCommit: z.union([z.string().regex(/^[a-f0-9]{40}$/), z.literal('unknown')]),
  gitCommitShort: z.union([z.string().regex(/^[a-f0-9]{7,12}$/), z.literal('unknown')]),
  buildTimestamp: z.string().datetime(),
  buildId: z.string().min(1).max(120),
  environment: z.enum(['development', 'test', 'staging', 'production']),
  artifactDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  apiVersion: z.string().min(1).max(40),
  schemaCompatibilityVersion: z.string().min(1).max(160).nullable(),
  schemaMigrationCount: z.number().int().positive().nullable().optional(),
  schemaFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  dirtyBuild: z.boolean(),
  sourceRepository: z.string().min(1).max(120),
});

function readManifest(): SafeReleaseManifest {
  if (!existsSync('/app/release-manifest.json')) {
    return {
      application: 'inventory-fastfood-system',
      releaseVersion: 'development',
      gitCommit: 'unknown',
      gitCommitShort: 'unknown',
      buildTimestamp: new Date(0).toISOString(),
      buildId: 'development-untracked',
      environment: process.env.NODE_ENV ?? 'development',
      artifactDigest: null,
      apiVersion: '0.0.1',
      schemaCompatibilityVersion: null,
      schemaMigrationCount: null,
      schemaFingerprint: null,
      dirtyBuild: true,
      sourceRepository: 'inventory-fastfood-system',
    };
  }

  const safe: SafeReleaseManifest = manifestSchema.parse(
    JSON.parse(readFileSync('/app/release-manifest.json', 'utf8')),
  );
  const runtimeDigest = process.env.RELEASE_ARTIFACT_DIGEST;
  if (runtimeDigest) {
    if (!/^sha256:[a-f0-9]{64}$/.test(runtimeDigest)) throw new Error('Invalid release artifact digest');
    safe.artifactDigest = runtimeDigest;
  }
  return safe;
}

export function GET() {
  return NextResponse.json(
    { component: 'web', ...readManifest() },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
