import { validateEnv } from './env';

const requiredEnv = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/inventory_fastfood_system_test',
  JWT_ACCESS_SECRET: 'test-access-secret-with-more-than-thirty-two-characters',
  JWT_REFRESH_SECRET: 'test-refresh-secret-with-more-than-thirty-two-characters',
  ADMIN_PASSWORD: 'AdminPassword123!',
};

describe('environment boolean parsing', () => {
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
  it.each([
    ['WHATSAPP_PROVIDER', 'mock', 'SOFIA_PROD_MOCK_WHATSAPP_FORBIDDEN'],
    ['WHATSAPP_MODE', 'mock', 'SOFIA_PROD_MOCK_WHATSAPP_FORBIDDEN'],
    ['WHATSAPP_MODE', 'auto', 'SOFIA_PROD_AUTOMATIC_REPLY_FORBIDDEN'],
    ['SOFIA_AUTO_REPLY_ENABLED', 'true', 'SOFIA_PROD_AUTOMATIC_REPLY_FORBIDDEN'],
    ['SOFIA_AUTO_SAFE_ENABLED', 'true', 'SOFIA_PROD_AUTO_SAFE_FORBIDDEN'],
    ['WHATSAPP_QR_ALLOW_REAL_SEND', 'true', 'SOFIA_PROD_REAL_SEND_FORBIDDEN'],
    ['SOFIA_QR_PILOT_REAL_SEND', 'true', 'SOFIA_PROD_REAL_SEND_FORBIDDEN'],
    ['SOFIA_PRODUCTION_ENABLED', 'true', 'SOFIA_PROD_ACTIVATION_FORBIDDEN'],
    ['SOFIA_WHATSAPP_OUTBOUND_HANDLER_ENABLED', 'true', 'SOFIA_PROD_WHATSAPP_HANDLER_FORBIDDEN'],
    ['PHASE5_ORDER_CREATION_ENABLED', 'true', 'PHASE5_PROD_ORDER_CREATION_FORBIDDEN'],
    ['PHASE5_PAYMENT_ORCHESTRATION_ENABLED', 'true', 'PHASE5_PROD_PAYMENT_MUTATION_FORBIDDEN'],
    ['PHASE5_KITCHEN_ENABLED', 'true', 'PHASE5_PROD_KITCHEN_MUTATION_FORBIDDEN'],
    ['PHASE5_TEST_OPERATIONAL_ENABLED', 'true', 'PHASE5_PROD_TEST_GATE_FORBIDDEN'],
  ])('rejects %s=%s with a sanitized reason code', (key, value, reasonCode) => {
    const sensitiveMarker = 'must-not-appear-in-validation-errors';
    expect(() =>
      validateEnv({
        ...requiredEnv,
        NODE_ENV: 'production',
        BOLD_API_KEY: sensitiveMarker,
        [key]: value,
      }),
    ).toThrow(reasonCode);
    try {
      validateEnv({ ...requiredEnv, NODE_ENV: 'production', BOLD_API_KEY: sensitiveMarker, [key]: value });
    } catch (error) {
      expect(String(error)).not.toContain(sensitiveMarker);
    }
  });

  it('requires immutable QR account binding in production', () => {
    expect(() => validateEnv({
      ...requiredEnv,
      NODE_ENV: 'production',
      WHATSAPP_PROVIDER: 'qr_gateway',
      WHATSAPP_QR_ENABLED: 'true',
    })).toThrow('SOFIA_PROD_WHATSAPP_ACCOUNT_BINDING_REQUIRED');

    expect(validateEnv({
      ...requiredEnv,
      NODE_ENV: 'production',
      WHATSAPP_PROVIDER: 'qr_gateway',
      WHATSAPP_QR_ENABLED: 'true',
      WHATSAPP_EXPECTED_ACCOUNT_ID: 'account-1',
      WHATSAPP_EXPECTED_BUSINESS_IDENTITY: 'business-1',
      WHATSAPP_EXPECTED_SESSION_OWNER: 'session-1',
    }).SOFIA_WHATSAPP_OUTBOUND_HANDLER_ENABLED).toBe(false);
  });

  it('allows only the official Bold endpoint in production', () => {
    expect(() => validateEnv({
      ...requiredEnv,
      NODE_ENV: 'production',
      BOLD_BASE_URL: 'https://sandbox.example.test',
    })).toThrow('PHASE5_PROD_BOLD_ENDPOINT_FORBIDDEN');

    expect(() => validateEnv({
      ...requiredEnv,
      NODE_ENV: 'production',
      BOLD_BASE_URL: 'https://user:password@integrations.api.bold.co',
    })).toThrow('PHASE5_PROD_BOLD_ENDPOINT_FORBIDDEN');

    expect(validateEnv({
      ...requiredEnv,
      NODE_ENV: 'production',
      BOLD_BASE_URL: 'https://integrations.api.bold.co',
    }).BOLD_BASE_URL).toBe('https://integrations.api.bold.co');
  });
});
