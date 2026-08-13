import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

const TEST_HASH_SECRET = 'crm-test-only-identity-hash-secret';

function optionalSecret(configService: ConfigService, key: string): string | undefined {
  const value = configService.get<unknown>(key);
  return typeof value === 'string' ? value.trim() || undefined : undefined;
}

function retainedSecrets(configService: ConfigService): string[] {
  const configured = configService.get<unknown>('CRM_IDENTITY_HASH_SECRET_PREVIOUS_KEYS');
  if (configured === undefined) return [];
  if (typeof configured !== 'string') {
    throw new ServiceUnavailableException('CRM identity hash rotation is not configured safely.');
  }
  return configured.split(',').map((secret) => secret.trim());
}

export function resolveCrmHashSecrets(configService: ConfigService): readonly [string, ...string[]] {
  const configuredCurrent = optionalSecret(configService, 'CRM_IDENTITY_HASH_SECRET');
  const current = configuredCurrent
    || (process.env.NODE_ENV === 'test' ? TEST_HASH_SECRET : undefined);
  const previous = optionalSecret(configService, 'CRM_IDENTITY_HASH_SECRET_PREVIOUS');
  const ring = [current, ...(previous ? [previous] : []), ...retainedSecrets(configService)];

  if (!current || current.length < 32) {
    throw new ServiceUnavailableException('CRM identity hashing is not configured.');
  }
  if (ring.some((secret) => !secret || secret.length < 32)
    || new Set(ring).size !== ring.length) {
    throw new ServiceUnavailableException('CRM identity hash rotation is not configured safely.');
  }

  return ring as [string, ...string[]];
}
