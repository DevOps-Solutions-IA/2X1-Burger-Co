import { CommandRedactionService } from './command-redaction.service';
import { SecureCommandError } from './secure-command.errors';

describe('CommandRedactionService', () => {
  const service = new CommandRedactionService();

  it.each(['password', 'token', 'authorization', 'apiKey', 'cvv', 'cardNumber'])('rejects secret input key %s', (key) => {
    expect(() => service.payloadHash({ [key]: 'sensitive-value' })).toThrow(SecureCommandError);
  });

  it('canonicalizes object keys deterministically', () => {
    expect(service.payloadHash({ b: 2, a: 1 })).toBe(service.payloadHash({ a: 1, b: 2 }));
  });

  it('binds changed PII without retaining it', () => {
    expect(service.payloadHash({ phone: '3000000001' })).not.toBe(service.payloadHash({ phone: '3000000002' }));
  });

  it('redacts nested phone email address and payment secret result fields', () => {
    expect(service.sanitizeResult({
      phone: '3000000000',
      nested: { email: 'owner@example.invalid', address: 'private', paymentSecret: 'private' },
      ok: true,
    })).toEqual({
      phone: '[REDACTED]',
      nested: { email: '[REDACTED]', address: '[REDACTED]', paymentSecret: '[REDACTED]' },
      ok: true,
    });
  });
});
