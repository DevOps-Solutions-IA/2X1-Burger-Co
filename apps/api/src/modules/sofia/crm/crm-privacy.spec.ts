import { maskPhone, opaqueCrmReference, sanitizeTimelineMetadata, sanitizeTimelineText } from './crm-privacy';

describe('Sofia CRM privacy', () => {
  it('masks Colombian phones without retaining the complete identity', () => {
    const raw = '+57 323 796 3047';
    const masked = maskPhone(raw);

    expect(masked).toBe('*** *** 3047');
    expect(masked).not.toContain('3237963047');
  });

  it('redacts credentials, bearer tokens, cards and international phones', () => {
    const sanitized = sanitizeTimelineText(
      'Bearer abc.def password=hunter2 tarjeta 4111 1111 1111 1111 contacto +1 (202) 555-0143',
    );

    expect(sanitized).toContain('[TOKEN_REDACTED]');
    expect(sanitized).toContain('[SECRET_REDACTED]');
    expect(sanitized).toContain('[PAYMENT_DATA_REDACTED]');
    expect(sanitized).not.toContain('abc.def');
    expect(sanitized).not.toContain('hunter2');
    expect(sanitized).not.toContain('4111');
    expect(sanitized).not.toContain('202');
  });

  it('converts technical source identities into stable opaque references', () => {
    const first = opaqueCrmReference('task:AUTHORIZED_OPERATOR', 'phone=+57 323 796 3047');
    const second = opaqueCrmReference('task:AUTHORIZED_OPERATOR', 'phone=+57 323 796 3047');

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain('3047');
  });

  it('sanitizes phone and email values in timeline content and metadata', () => {
    expect(sanitizeTimelineText('Contacto 3237963047 o client@example.com')).toBe(
      'Contacto *** *** 3047 o ***@example.com',
    );
    expect(
      sanitizeTimelineMetadata({ phone: '3237963047', note: 'Llamar al 323 796 3047' }),
    ).toEqual({ phone: '[REDACTED]', note: 'Llamar al *** *** 3047' });
  });
});
