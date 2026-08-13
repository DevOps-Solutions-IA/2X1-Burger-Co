import type { ConfigService } from '@nestjs/config';
import { resolveCrmHashSecrets } from './crm-hash-secrets';

function config(values: Record<string, unknown>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('resolveCrmHashSecrets', () => {
  const current = 'crm-current-hash-secret-generation-zero-0001';
  const previous = 'crm-previous-hash-secret-generation-one-0001';
  const retainedTwo = 'crm-retained-hash-secret-generation-two-0001';
  const retainedThree = 'crm-retained-hash-secret-generation-three-01';

  it('returns current, legacy previous and every retained generation in lookup order', () => {
    expect(resolveCrmHashSecrets(config({
      CRM_IDENTITY_HASH_SECRET: current,
      CRM_IDENTITY_HASH_SECRET_PREVIOUS: previous,
      CRM_IDENTITY_HASH_SECRET_PREVIOUS_KEYS: `${retainedTwo}, ${retainedThree}`,
    }))).toEqual([current, previous, retainedTwo, retainedThree]);
  });

  it.each([
    ['duplicate current', { CRM_IDENTITY_HASH_SECRET: current, CRM_IDENTITY_HASH_SECRET_PREVIOUS_KEYS: current }],
    ['duplicate retained', {
      CRM_IDENTITY_HASH_SECRET: current,
      CRM_IDENTITY_HASH_SECRET_PREVIOUS_KEYS: `${retainedTwo},${retainedTwo}`,
    }],
    ['short retained', { CRM_IDENTITY_HASH_SECRET: current, CRM_IDENTITY_HASH_SECRET_PREVIOUS_KEYS: 'short' }],
    ['empty retained', {
      CRM_IDENTITY_HASH_SECRET: current,
      CRM_IDENTITY_HASH_SECRET_PREVIOUS_KEYS: `${retainedTwo},,${retainedThree}`,
    }],
    ['non-string retained', { CRM_IDENTITY_HASH_SECRET: current, CRM_IDENTITY_HASH_SECRET_PREVIOUS_KEYS: [retainedTwo] }],
  ])('fails closed for an unsafe key ring: %s', (_case, values) => {
    expect(() => resolveCrmHashSecrets(config(values)))
      .toThrow('CRM identity hash rotation is not configured safely.');
  });
});
