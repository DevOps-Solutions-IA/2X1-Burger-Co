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

  it('redacts phone/email embedded in free-text fields not named "phone"', async () => {
    const result = await lastValueFrom(
      interceptor.intercept({} as never, {
        handle: () =>
          of({
            notes: 'Contactar al cliente al 3001234567 o por correo cliente@example.com',
            lastCustomerMessage: 'Mi dirección es Cra. 10 #20-30, llámenme al 3009876543',
            status: 'BLOCKED',
          }),
      }),
    );

    expect(result).toEqual({
      notes: 'Contactar al cliente al [telefono-redactado] o por correo [correo-redactado]',
      lastCustomerMessage: 'Mi dirección es [direccion-redactada], llámenme al [telefono-redactado]',
      status: 'BLOCKED',
    });
  });

  it('converts toJSON-bearing values (e.g. Prisma Decimal) instead of returning them untouched', async () => {
    const decimalLike = { toJSON: () => '15000.50' };
    const result = await lastValueFrom(
      interceptor.intercept({} as never, {
        handle: () => of({ price: decimalLike }),
      }),
    );

    expect(result).toEqual({ price: '15000.50' });
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
