import { SofiaPrivacyService } from './sofia-privacy.service';

describe('SofiaPrivacyService status', () => {
  it('reports executable evidence for every configured privacy control', () => {
    const service = new SofiaPrivacyService();

    expect(service.status()).toEqual({
      status: 'CONTROLS_VERIFIED',
      evidenceSource: 'EXECUTABLE_RUNTIME_PROBE',
      controls: {
        phoneRedaction: true,
        textRedaction: true,
        structuredRedaction: true,
        stablePseudonymousPreview: true,
      },
      piiRedactionEnabled: true,
      phonePolicy: 'hash_or_last4_only',
      messagePolicy: 'previews_sanitized_by_default',
      qrSessionPolicy: 'no_absolute_session_path',
      secretsPolicy: 'redacted',
    });
  });

  it('fails the status when an executable control does not redact', () => {
    const service = new SofiaPrivacyService();
    jest.spyOn(service, 'redactPhone').mockReturnValue('+57 300 123 4567');

    expect(service.status()).toMatchObject({
      status: 'CONTROL_FAILURE',
      piiRedactionEnabled: false,
      controls: { phoneRedaction: false },
    });
  });
});
