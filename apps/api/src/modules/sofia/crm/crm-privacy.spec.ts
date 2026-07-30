import { maskPhone, sanitizeTimelineMetadata, sanitizeTimelineText } from './crm-privacy';

describe('Sofia CRM privacy', () => {
  it('masks Colombian phones without retaining the complete identity', () => {
    const raw = '+57 323 796 3047';
    const masked = maskPhone(raw);

    expect(masked).toBe('*** *** 3047');
    expect(masked).not.toContain('3237963047');
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
