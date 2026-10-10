import { validateEnv } from './env';

const requiredEnv = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/inventory_fastfood_system_test',
  JWT_ACCESS_SECRET: 'test-access-secret-with-more-than-thirty-two-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-with-more-than-thirty-two-characters',
  ADMIN_PASSWORD: 'AdminPassword123!',
};

const productionEnv = {
  ...requiredEnv,
  NODE_ENV: 'production',
  CRM_IDENTITY_HASH_SECRET: 'production-crm-identity-hash-secret-test-value',
  COOKIE_SECURE: 'true',
  APP_URL: 'https://app.2x1burger.example',
  PUBLIC_PAYMENTS_BASE_URL: 'https://pay.2x1burger.example',
  CORS_ORIGIN: 'https://app.2x1burger.example',
};

describe('environment boolean parsing', () => {
  it('accepts one previous CRM hash key only with a distinct current key', () => {
    const current = 'crm-current-hash-secret-at-least-32-characters';
    const previous = 'crm-previous-hash-secret-at-least-32-characters';

    expect(validateEnv({
      ...requiredEnv,
      CRM_IDENTITY_HASH_SECRET: current,
      CRM_IDENTITY_HASH_SECRET_PREVIOUS: previous,
    })).toMatchObject({
      CRM_IDENTITY_HASH_SECRET: current,
      CRM_IDENTITY_HASH_SECRET_PREVIOUS: previous,
    });
    expect(() => validateEnv({
      ...requiredEnv,
      CRM_IDENTITY_HASH_SECRET_PREVIOUS: previous,
    })).toThrow('CRM_IDENTITY_HASH_CURRENT_REQUIRED_FOR_ROTATION');
    expect(() => validateEnv({
      ...requiredEnv,
      CRM_IDENTITY_HASH_SECRET: current,
      CRM_IDENTITY_HASH_SECRET_PREVIOUS: current,
    })).toThrow('CRM_IDENTITY_HASH_ROTATION_KEYS_MUST_DIFFER');
  });

  it('accepts an ordered multi-generation CRM hash key ring', () => {
    const current = 'crm-current-hash-secret-at-least-32-characters';
    const previous = 'crm-previous-hash-secret-at-least-32-characters';
    const retained = [
      'crm-retained-hash-secret-generation-two-0001',
      'crm-retained-hash-secret-generation-three-01',
    ].join(',');

    expect(validateEnv({
      ...requiredEnv,
      CRM_IDENTITY_HASH_SECRET: current,
      CRM_IDENTITY_HASH_SECRET_PREVIOUS: previous,
      CRM_IDENTITY_HASH_SECRET_PREVIOUS_KEYS: retained,
    })).toMatchObject({
      CRM_IDENTITY_HASH_SECRET: current,
      CRM_IDENTITY_HASH_SECRET_PREVIOUS: previous,
      CRM_IDENTITY_HASH_SECRET_PREVIOUS_KEYS: retained,
    });
  });

  it.each([
    ['short retained key', 'short'],
    ['empty retained key', 'crm-retained-hash-secret-generation-one-0001,,crm-retained-hash-secret-generation-two-0002'],
  ])('rejects an invalid CRM hash ring member: %s', (_case, retained) => {
    expect(() => validateEnv({
      ...requiredEnv,
      CRM_IDENTITY_HASH_SECRET: 'crm-current-hash-secret-at-least-32-characters',
      CRM_IDENTITY_HASH_SECRET_PREVIOUS_KEYS: retained,
    })).toThrow('CRM_IDENTITY_HASH_ROTATION_KEY_INVALID');
  });

  it('rejects duplicate CRM hash keys across every retained generation', () => {
    const current = 'crm-current-hash-secret-at-least-32-characters';
    const retained = 'crm-retained-hash-secret-generation-one-0001';

    expect(() => validateEnv({
      ...requiredEnv,
      CRM_IDENTITY_HASH_SECRET: current,
      CRM_IDENTITY_HASH_SECRET_PREVIOUS_KEYS: `${retained},${retained}`,
    })).toThrow('CRM_IDENTITY_HASH_ROTATION_KEYS_MUST_DIFFER');
    expect(() => validateEnv({
      ...requiredEnv,
      CRM_IDENTITY_HASH_SECRET: current,
      CRM_IDENTITY_HASH_SECRET_PREVIOUS_KEYS: current,
    })).toThrow('CRM_IDENTITY_HASH_ROTATION_KEYS_MUST_DIFFER');
  });

  it('requires a current CRM hash key when retained generations are configured', () => {
    expect(() => validateEnv({
      ...requiredEnv,
      CRM_IDENTITY_HASH_SECRET_PREVIOUS_KEYS: 'crm-retained-hash-secret-generation-one-0001',
    })).toThrow('CRM_IDENTITY_HASH_CURRENT_REQUIRED_FOR_ROTATION');
  });

  it('preserves explicit false values for operational safety flags', () => {
    const env = validateEnv({
      ...requiredEnv,
      WHATSAPP_QR_ALLOW_REAL_SEND: 'false',
      SOFIA_AUTO_REPLY_ENABLED: 'false',
      SOFIA_AUTO_SAFE_ENABLED: '0',
      SOFIA_PRODUCTION_ENABLED: 'FALSE',
      DEEPSEEK_ENABLED: 'false',
      DELIVERY_EXTERNAL_PROVIDERS_ENABLED: '0',
      PHASE5_ORDER_CREATION_ENABLED: 'false',
      PHASE5_PAYMENT_ORCHESTRATION_ENABLED: 'false',
      PAYMENT_WEBHOOK_RECOVERY_WORKER_ENABLED: 'false',
      PHASE5_KITCHEN_ENABLED: 'false',
    });

    expect(env.WHATSAPP_QR_ALLOW_REAL_SEND).toBe(false);
    expect(env.SOFIA_AUTO_REPLY_ENABLED).toBe(false);
    expect(env.SOFIA_AUTO_SAFE_ENABLED).toBe(false);
    expect(env.SOFIA_PRODUCTION_ENABLED).toBe(false);
    expect(env.DEEPSEEK_ENABLED).toBe(false);
    expect(env.DELIVERY_EXTERNAL_PROVIDERS_ENABLED).toBe(false);
    expect(env.PHASE5_ORDER_CREATION_ENABLED).toBe(false);
    expect(env.PHASE5_PAYMENT_ORCHESTRATION_ENABLED).toBe(false);
    expect(env.PAYMENT_WEBHOOK_RECOVERY_WORKER_ENABLED).toBe(false);
    expect(env.PHASE5_KITCHEN_ENABLED).toBe(false);
  });

  it('accepts explicit true values and rejects ambiguous strings', () => {
    const env = validateEnv({
      ...requiredEnv,
      WHATSAPP_QR_ALLOW_RECEIVE: 'true',
      SOFIA_HUMAN_HANDOFF_ENABLED: '1',
    });

    expect(env.WHATSAPP_QR_ALLOW_RECEIVE).toBe(true);
    expect(env.SOFIA_HUMAN_HANDOFF_ENABLED).toBe(true);
    expect(() => validateEnv({ ...requiredEnv, SOFIA_AUTO_REPLY_ENABLED: 'yes' })).toThrow();
  });

  it('rejects payment orchestration without durable webhook recovery', () => {
    expect(() => validateEnv({
      ...requiredEnv,
      PHASE5_PAYMENT_ORCHESTRATION_ENABLED: 'true',
      PAYMENT_WEBHOOK_RECOVERY_WORKER_ENABLED: 'false',
    })).toThrow('PAYMENT_WEBHOOK_RECOVERY_REQUIRED');
    expect(validateEnv({
      ...requiredEnv,
      PHASE5_PAYMENT_ORCHESTRATION_ENABLED: 'true',
      PAYMENT_WEBHOOK_RECOVERY_WORKER_ENABLED: 'true',
    }).PAYMENT_WEBHOOK_RECOVERY_WORKER_ENABLED).toBe(true);
  });

  it('normalizes case, defaults undefined and rejects empty critical flags', () => {
    const env = validateEnv({
      ...requiredEnv,
      SOFIA_AUTO_SAFE_ENABLED: 'FALSE',
      SOFIA_AUTO_REPLY_ENABLED: 'TRUE',
      WHATSAPP_QR_ALLOW_REAL_SEND: undefined,
    });

    expect(env.SOFIA_AUTO_SAFE_ENABLED).toBe(false);
    expect(env.SOFIA_AUTO_REPLY_ENABLED).toBe(true);
    expect(env.WHATSAPP_QR_ALLOW_REAL_SEND).toBe(false);
    expect(() => validateEnv({ ...requiredEnv, SOFIA_AUTO_SAFE_ENABLED: '' })).toThrow();
  });
});

describe('production Sofia safety validation', () => {
  it('fails closed when production CRM hashing is not configured', () => {
    const { CRM_IDENTITY_HASH_SECRET: _omitted, ...withoutCrmSecret } = productionEnv;
    expect(() => validateEnv(withoutCrmSecret)).toThrow('CRM_IDENTITY_HASH_SECRET_REQUIRED');
  });

  it('accepts production startup when test-only harness variables are absent', () => {
    const env = validateEnv(productionEnv);

    expect(env.NODE_ENV).toBe('production');
    expect(env.TEST_DATABASE_URL).toBeUndefined();
    expect(env.JEST_WORKER_ID).toBeUndefined();
  });

  it.each([
    ['TEST_DATABASE_URL', 'postgresql://test-user:test-password@localhost/test', 'PROD_TEST_DATABASE_URL_FORBIDDEN'],
    ['JEST_WORKER_ID', '1', 'PROD_JEST_WORKER_ID_FORBIDDEN'],
  ])('rejects accidental production %s without exposing its value', (key, value, reasonCode) => {
    expect(() => validateEnv({ ...productionEnv, [key]: value })).toThrow(reasonCode);

    try {
      validateEnv({ ...productionEnv, [key]: value });
    } catch (error) {
      expect(String(error)).not.toContain(value);
    }
  });

  it.each([
    ['WHATSAPP_PROVIDER', 'mock', 'SOFIA_PROD_MOCK_WHATSAPP_FORBIDDEN'],
    ['WHATSAPP_MODE', 'mock', 'SOFIA_PROD_MOCK_WHATSAPP_FORBIDDEN'],
    ['WHATSAPP_MODE', 'auto', 'SOFIA_PROD_AUTOMATIC_REPLY_FORBIDDEN'],
    ['SOFIA_AUTO_REPLY_ENABLED', 'true', 'SOFIA_PROD_AUTOMATIC_REPLY_FORBIDDEN'],
    ['SOFIA_AUTO_SAFE_ENABLED', 'true', 'SOFIA_PROD_AUTO_SAFE_FORBIDDEN'],
    ['WHATSAPP_QR_ALLOW_REAL_SEND', 'true', 'SOFIA_PROD_REAL_SEND_FORBIDDEN'],
    ['SOFIA_QR_PILOT_REAL_SEND', 'true', 'SOFIA_PROD_REAL_SEND_FORBIDDEN'],
    ['WHATSAPP_QR_DISCOVERY_MODE', 'true', 'SOFIA_PROD_QR_DISCOVERY_FORBIDDEN'],
    ['SOFIA_PRODUCTION_ENABLED', 'true', 'SOFIA_PROD_ACTIVATION_FORBIDDEN'],
    ['SOFIA_WHATSAPP_OUTBOUND_HANDLER_ENABLED', 'true', 'SOFIA_PROD_WHATSAPP_HANDLER_FORBIDDEN'],
    ['PHASE5_ORDER_CREATION_ENABLED', 'true', 'PHASE5_PROD_ORDER_CREATION_FORBIDDEN'],
    ['PHASE5_PAYMENT_ORCHESTRATION_ENABLED', 'true', 'PHASE5_PROD_PAYMENT_MUTATION_FORBIDDEN'],
    ['PHASE5_KITCHEN_ENABLED', 'true', 'PHASE5_PROD_KITCHEN_MUTATION_FORBIDDEN'],
    ['PHASE5_TEST_OPERATIONAL_ENABLED', 'true', 'PHASE5_PROD_TEST_GATE_FORBIDDEN'],
    ['SOFIA_AI_REDACT_PERSONAL_DATA', 'false', 'SOFIA_PROD_AI_REDACTION_REQUIRED'],
  ])('rejects %s=%s with a sanitized reason code', (key, value, reasonCode) => {
    const sensitiveMarker = 'must-not-appear-in-validation-errors';
    expect(() =>
      validateEnv({
        ...productionEnv,
        BOLD_API_KEY: sensitiveMarker,
        [key]: value,
      }),
    ).toThrow(reasonCode);
    try {
      validateEnv({ ...productionEnv, BOLD_API_KEY: sensitiveMarker, [key]: value });
    } catch (error) {
      expect(String(error)).not.toContain(sensitiveMarker);
    }
  });

  it('requires immutable QR account binding in production', () => {
    expect(() => validateEnv({
      ...productionEnv,
      WHATSAPP_PROVIDER: 'qr_gateway',
      WHATSAPP_QR_ENABLED: 'true',
    })).toThrow('SOFIA_PROD_WHATSAPP_ACCOUNT_BINDING_REQUIRED');

    expect(validateEnv({
      ...productionEnv,
      WHATSAPP_PROVIDER: 'qr_gateway',
      WHATSAPP_QR_ENABLED: 'true',
      WHATSAPP_EXPECTED_ACCOUNT_ID: 'account-1',
      WHATSAPP_EXPECTED_BUSINESS_IDENTITY: 'business-1',
      WHATSAPP_EXPECTED_SESSION_OWNER: 'session-1',
    }).SOFIA_WHATSAPP_OUTBOUND_HANDLER_ENABLED).toBe(false);
  });

  it('allows only the official Bold endpoint in production', () => {
    expect(() => validateEnv({
      ...productionEnv,
      BOLD_BASE_URL: 'https://sandbox.example.test',
    })).toThrow('PHASE5_PROD_BOLD_ENDPOINT_FORBIDDEN');

    expect(() => validateEnv({
      ...productionEnv,
      BOLD_BASE_URL: 'https://user:password@integrations.api.bold.co',
    })).toThrow('PHASE5_PROD_BOLD_ENDPOINT_FORBIDDEN');

    expect(validateEnv({
      ...productionEnv,
      BOLD_BASE_URL: 'https://integrations.api.bold.co',
    }).BOLD_BASE_URL).toBe('https://integrations.api.bold.co');
  });

  it('allows only the credential-free official DeepSeek endpoint in production', () => {
    for (const endpoint of [
      'http://api.deepseek.com',
      'https://user:password@api.deepseek.com',
      'https://127.0.0.1',
      'https://deepseek.internal',
      'https://api.deepseek.com:8443',
      'https://api.deepseek.com/private',
    ]) {
      expect(() => validateEnv({ ...productionEnv, DEEPSEEK_BASE_URL: endpoint }))
        .toThrow('SOFIA_PROD_DEEPSEEK_ENDPOINT_FORBIDDEN');
    }

    expect(validateEnv({
      ...productionEnv,
      DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
    }).DEEPSEEK_BASE_URL).toBe('https://api.deepseek.com');
  });

  it.each([
    [{ COOKIE_SECURE: 'false' }, 'PROD_SECURE_COOKIE_REQUIRED'],
    [{ APP_URL: 'http://app.2x1burger.example' }, 'PROD_PUBLIC_URL_HTTPS_REQUIRED'],
    [{ PUBLIC_PAYMENTS_BASE_URL: 'https://localhost:3301' }, 'PROD_PUBLIC_URL_HTTPS_REQUIRED'],
    [{ CORS_ORIGIN: 'https://app.2x1burger.example/path' }, 'PROD_CORS_ORIGIN_HTTPS_REQUIRED'],
    [{ CORS_ORIGIN: 'http://app.2x1burger.example' }, 'PROD_CORS_ORIGIN_HTTPS_REQUIRED'],
  ])('rejects insecure production transport configuration', (override, reason) => {
    expect(() => validateEnv({ ...productionEnv, ...override })).toThrow(reason);
  });
});
