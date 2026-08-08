import type { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../../config/env';
import { PaymentPublicReferenceService } from './payment-public-reference.service';

describe('PaymentPublicReferenceService', () => {
  const config = {
    get: jest.fn().mockReturnValue('phase5-public-reference-test-secret-that-is-long-enough'),
  } as unknown as ConfigService<AppEnv, true>;
  const service = new PaymentPublicReferenceService(config);
  const input = { linkId: 'cm0phase5paymentlink000001', expiresAt: new Date('2026-08-08T22:00:00.000Z') };

  it('issues a deterministic signed reference bound to link and expiry', () => {
    const first = service.issue(input);
    expect(service.issue(input)).toBe(first);
    expect(service.verify(first)).toEqual(input);
    expect(first).not.toContain(input.linkId);
  });

  it('rejects tampering, malformed references and a bare database id', () => {
    const reference = service.issue(input);
    const tampered = `${reference.slice(0, -1)}${reference.endsWith('a') ? 'b' : 'a'}`;
    expect(service.verify(tampered)).toBeNull();
    expect(service.verify(input.linkId)).toBeNull();
    expect(service.verify('not.a.valid.reference')).toBeNull();
  });

  it('binds the signature to the exact expiration', () => {
    const reference = service.issue(input);
    const other = service.issue({ ...input, expiresAt: new Date(input.expiresAt.getTime() + 1) });
    expect(other).not.toBe(reference);
    expect(service.verify(reference)?.expiresAt).toEqual(input.expiresAt);
  });
});
