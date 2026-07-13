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
      DEEPSEEK_ENABLED: 'false',
      DELIVERY_EXTERNAL_PROVIDERS_ENABLED: '0',
    });

    expect(env.WHATSAPP_QR_ALLOW_REAL_SEND).toBe(false);
    expect(env.SOFIA_AUTO_REPLY_ENABLED).toBe(false);
    expect(env.SOFIA_AUTO_SAFE_ENABLED).toBe(false);
    expect(env.DEEPSEEK_ENABLED).toBe(false);
    expect(env.DELIVERY_EXTERNAL_PROVIDERS_ENABLED).toBe(false);
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
