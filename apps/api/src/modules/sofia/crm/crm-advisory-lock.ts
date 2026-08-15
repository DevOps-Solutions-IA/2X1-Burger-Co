import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { ServiceUnavailableException } from '@nestjs/common';

type AdvisoryLockClient = Pick<Prisma.TransactionClient, '$executeRaw' | 'setting'>;

const GENERATION_FENCE_KEY = 'SOFIA_CRM_HASH_GENERATION_FENCE';

function framedDigest(namespace: string, values: readonly string[]): string {
  const hash = createHash('sha256');
  hash.update('sofia-crm-advisory-lock:v1');
  for (const value of [namespace, ...values]) {
    const bytes = Buffer.from(value, 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(bytes.length);
    hash.update(length);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

export async function acquireCrmLogicalIdentityLock(
  client: AdvisoryLockClient,
  namespace: string,
  values: readonly string[],
): Promise<void> {
  const digest = framedDigest(namespace, values);
  await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${digest}, 0))`;
}

function generationFingerprint(secret: string): string {
  return createHash('sha256')
    .update('sofia-crm-hash-generation:v1\0', 'utf8')
    .update(secret, 'utf8')
    .digest('hex');
}

export async function acquireCrmHashWriteFence(
  client: AdvisoryLockClient,
  secrets: readonly [string, ...string[]],
  namespace: string,
  values: readonly string[],
): Promise<void> {
  await acquireCrmLogicalIdentityLock(client, 'hash-generation-fence', [GENERATION_FENCE_KEY]);
  const fingerprints = secrets.map(generationFingerprint);
  const currentFingerprint = fingerprints[0]!;
  const stored = await client.setting.findUnique({
    where: { key: GENERATION_FENCE_KEY },
    select: { value: true },
  });
  const value = stored?.value;
  const activeFingerprint = value && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).activeFingerprint === 'string'
    ? (value as Record<string, string>).activeFingerprint
    : null;
  const retiredFingerprints = value && typeof value === 'object' && !Array.isArray(value)
    && Array.isArray((value as Record<string, unknown>).retiredFingerprints)
    ? (value as { retiredFingerprints: unknown[] }).retiredFingerprints
    : [];

  if (stored && (!activeFingerprint || !/^[a-f0-9]{64}$/.test(activeFingerprint)
    || retiredFingerprints.length > 32
    || retiredFingerprints.some((entry) => typeof entry !== 'string' || !/^[a-f0-9]{64}$/.test(entry)))) {
    throw new ServiceUnavailableException('CRM_HASH_GENERATION_FENCE_INVALID');
  }
  if (retiredFingerprints.includes(currentFingerprint) && activeFingerprint !== currentFingerprint) {
    throw new ServiceUnavailableException('CRM_HASH_GENERATION_STALE_WRITER');
  }
  if (activeFingerprint && !fingerprints.includes(activeFingerprint)) {
    throw new ServiceUnavailableException('CRM_HASH_GENERATION_STALE_WRITER');
  }
  if (activeFingerprint !== currentFingerprint) {
    const nextRetired = [...new Set([
      ...retiredFingerprints.filter((entry): entry is string => typeof entry === 'string'),
      ...(activeFingerprint ? [activeFingerprint] : []),
      ...fingerprints.slice(1),
    ])].filter((entry) => entry !== currentFingerprint);
    await client.setting.upsert({
      where: { key: GENERATION_FENCE_KEY },
      create: {
        key: GENERATION_FENCE_KEY,
        value: { version: 1, activeFingerprint: currentFingerprint, retiredFingerprints: nextRetired },
        category: 'sofia_crm_security',
        description: 'Non-secret active CRM hash generation fingerprint',
      },
      update: { value: { version: 1, activeFingerprint: currentFingerprint, retiredFingerprints: nextRetired } },
    });
  }
  await acquireCrmLogicalIdentityLock(client, namespace, values);
}
