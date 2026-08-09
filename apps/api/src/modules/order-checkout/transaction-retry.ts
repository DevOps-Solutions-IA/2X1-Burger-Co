import { Prisma } from '@prisma/client';

const RETRYABLE_DATABASE_CODES = new Set(['40001', '40P01']);

export function isRetryableTransactionError(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2002' || error.code === 'P2034') return true;
  if (error.code !== 'P2010') return false;

  const metadata = error.meta as { code?: unknown; message?: unknown } | undefined;
  const databaseCode = String(metadata?.code ?? '');
  const message = String(metadata?.message ?? error.message);
  return RETRYABLE_DATABASE_CODES.has(databaseCode) || /serialization|deadlock|40001|40P01/i.test(message);
}

export async function withBoundedTransactionRetry<T>(operation: () => Promise<T>, maxAttempts = 3): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxAttempts || !isRetryableTransactionError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 20));
    }
  }
  throw new Error('Unreachable transaction retry state.');
}
