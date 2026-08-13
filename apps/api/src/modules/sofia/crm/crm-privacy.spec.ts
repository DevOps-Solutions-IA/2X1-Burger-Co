import { createHash } from 'node:crypto';
import { maskPhone, opaqueCrmReference, sanitizeTimelineMetadata, sanitizeTimelineText } from './crm-privacy';

const REFERENCE_SECRET = 'crm-test-only-identity-hash-secret';

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

  it('redacts Basic auth, cookie sessions, explicit credential variants and known access keys', () => {
    const awsAccessKey = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
    const githubAccessKey = ['github', '_pat_', '11AAExampleCredentialValue999'].join('');
    const sanitized = sanitizeTimelineText([
      'Authorization: Basic dXNlcjpwYXNz',
      'Cookie: session_id=sess-secret; theme=dark',
      'client_secret="client-secret" access_token=>token-secret sessionKey=session-secret',
      `${awsAccessKey} ${githubAccessKey}`,
    ].join('\n'));

    expect(sanitized).toContain('[AUTHORIZATION_REDACTED]');
    expect(sanitized).toContain('[COOKIE_HEADER_REDACTED]');
    expect(sanitized).toContain('[SECRET_REDACTED]');
    expect(sanitized).toContain('[ACCESS_KEY_REDACTED]');
    expect(sanitized).not.toMatch(/dXNlcjpwYXNz|sess-secret|client-secret|token-secret/);
    expect(sanitized).not.toContain(awsAccessKey);
    expect(sanitized).not.toContain(githubAccessKey);
  });

  it('does not over-redact safe operational language', () => {
    expect(sanitizeTimelineText('Cliente pide acceso al local y una sesion de seguimiento comercial.')).toBe(
      'Cliente pide acceso al local y una sesion de seguimiento comercial.',
    );
  });

  it('converts technical source identities into stable opaque references', () => {
    const first = opaqueCrmReference(REFERENCE_SECRET, 'task:AUTHORIZED_OPERATOR', 'phone=+57 323 796 3047');
    const second = opaqueCrmReference(REFERENCE_SECRET, 'task:AUTHORIZED_OPERATOR', 'phone=+57 323 796 3047');

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain('3047');
  });

  it('uses keyed domain separation rather than an offline-enumerable plain digest', () => {
    const value = 'phone=+57 323 796 3047';
    const taskReference = opaqueCrmReference(REFERENCE_SECRET, 'task:AUTHORIZED_OPERATOR', value);
    const noteReference = opaqueCrmReference(REFERENCE_SECRET, 'note:AUTHORIZED_OPERATOR', value);
    const otherKeyReference = opaqueCrmReference('different-test-only-secret-value-32', 'task:AUTHORIZED_OPERATOR', value);
    const enumerableLegacyDigest = createHash('sha256')
      .update('task:AUTHORIZED_OPERATOR\0phone=+57 323 796 3047', 'utf8')
      .digest('hex');

    expect(taskReference).not.toBe(noteReference);
    expect(taskReference).not.toBe(otherKeyReference);
    expect(taskReference).not.toBe(enumerableLegacyDigest);
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
