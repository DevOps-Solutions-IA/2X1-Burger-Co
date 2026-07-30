import { lastValueFrom, of } from 'rxjs';
import { sanitizeJson } from './sofia-pii-redaction';
import { SofiaAdminResponseSanitizerInterceptor } from './sofia-admin-response-sanitizer.interceptor';

describe('SofiaAdminResponseSanitizerInterceptor', () => {
  const interceptor = new SofiaAdminResponseSanitizerInterceptor();

  it('masks phone-shaped fields recursively and removes sensitive payload fields', async () => {
    const result = await lastValueFrom(
      interceptor.intercept({} as never, {
        handle: () =>
          of({
            phone: '+57 300 123 4567',
            customerPhoneSnapshot: '573001234567',
            phoneMasked: '********4567',
            rawPayload: { token: 'must-not-leave' },
            publicPaymentToken: 'must-not-leave',
            nested: [{ providerCheckoutUrl: 'private-provider-url', value: 'safe' }],
          }),
      }),
    );

    expect(result).toEqual({
      phone: '********4567',
      customerPhoneSnapshot: '********4567',
      phoneMasked: '********4567',
      nested: [{ value: 'safe' }],
    });
  });

  it('preserves non-sensitive operational values', async () => {
    const result = await lastValueFrom(
      interceptor.intercept({} as never, {
        handle: () => of({ status: 'BLOCKED', sent: false, total: 0 }),
      }),
    );

    expect(result).toEqual({ status: 'BLOCKED', sent: false, total: 0 });
  });

  it('redacts sensitive mock and webhook payload values before persistence', () => {
    const result = sanitizeJson({
      phone: '+57 300 123 4567',
      token: 'must-not-persist',
      nested: {
        address: 'Cra. 1 #2-3',
        status: 'BLOCKED',
      },
    });

    expect(JSON.stringify(result)).not.toContain('must-not-persist');
    expect(JSON.stringify(result)).not.toContain('3001234567');
    expect(result).toMatchObject({
      token: '[secreto-redactado]',
      nested: {
        address: '[direccion-redactada]',
        status: 'BLOCKED',
      },
    });
  });
});
