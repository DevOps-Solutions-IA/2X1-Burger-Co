import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

const TEST_HASH_SECRET = 'crm-test-only-identity-hash-secret';

export function resolveCrmHashSecrets(configService: ConfigService): readonly [string, ...string[]] {
  const configuredCurrent = configService.get<string>('CRM_IDENTITY_HASH_SECRET')?.trim();
  const current = configuredCurrent
    || (process.env.NODE_ENV === 'test' ? TEST_HASH_SECRET : undefined);
  const previous = configService.get<string>('CRM_IDENTITY_HASH_SECRET_PREVIOUS')?.trim();

  if (!current || current.length < 32) {
    throw new ServiceUnavailableException('CRM identity hashing is not configured.');
  }
  if (previous && (previous.length < 32 || previous === current)) {
    throw new ServiceUnavailableException('CRM identity hash rotation is not configured safely.');
  }

  return previous ? [current, previous] : [current];
}
