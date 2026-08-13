import type { Prisma } from '@prisma/client';
import { acquireCrmHashWriteFence } from './crm-advisory-lock';

function harness() {
  let value: Prisma.JsonValue | null = null;
  const executeRaw = jest.fn().mockResolvedValue(1);
  const client = {
    $executeRaw: executeRaw,
    setting: {
      findUnique: jest.fn(() => Promise.resolve(value == null ? null : { value })),
      upsert: jest.fn(({ create, update }) => {
        value = (value == null ? create.value : update.value) as Prisma.JsonValue;
        return Promise.resolve({ id: 'fence', value });
      }),
    },
  } as unknown as Prisma.TransactionClient;
  return { client, executeRaw, stored: () => value };
}

describe('CRM hash generation fence', () => {
  const oldSecret = 'crm-old-generation-secret-at-least-32-0001';
  const currentSecret = 'crm-current-generation-secret-at-least-32-1';

  it('advances old to current and then rejects an old-only sequential writer', async () => {
    const state = harness();
    await acquireCrmHashWriteFence(state.client, [oldSecret], 'customer-phone', ['573000000001']);
    await acquireCrmHashWriteFence(
      state.client, [currentSecret, oldSecret], 'customer-phone', ['573000000001'],
    );

    await expect(acquireCrmHashWriteFence(
      state.client, [oldSecret], 'customer-phone', ['573000000001'],
    )).rejects.toThrow('CRM_HASH_GENERATION_STALE_WRITER');
    expect(JSON.stringify(state.stored())).not.toContain(oldSecret);
    expect(JSON.stringify(state.stored())).not.toContain(currentSecret);
  });

  it('rejects old-only after current wins first and sends only bounded digests to PostgreSQL', async () => {
    const state = harness();
    await acquireCrmHashWriteFence(
      state.client, [currentSecret, oldSecret], 'lead-source-reference', ['AUTHORIZED_OPERATOR', 'raw-reference'],
    );
    await expect(acquireCrmHashWriteFence(
      state.client, [oldSecret], 'lead-source-reference', ['AUTHORIZED_OPERATOR', 'raw-reference'],
    )).rejects.toThrow('CRM_HASH_GENERATION_STALE_WRITER');

    const interpolationValues = state.executeRaw.mock.calls.flatMap((call) => call.slice(1));
    expect(interpolationValues).toEqual(expect.arrayContaining([expect.stringMatching(/^[a-f0-9]{64}$/)]));
    expect(JSON.stringify(interpolationValues)).not.toContain('raw-reference');
    expect(JSON.stringify(interpolationValues)).not.toContain(oldSecret);
    expect(JSON.stringify(interpolationValues)).not.toContain(currentSecret);
  });
});
