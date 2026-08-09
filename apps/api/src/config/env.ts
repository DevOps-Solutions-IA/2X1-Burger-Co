import { z } from 'zod';

const envBoolean = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return value;
}, z.boolean());

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    TEST_DATABASE_URL: z.string().min(1).optional(),
    JEST_WORKER_ID: z.string().min(1).optional(),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1),
    CORS_ORIGIN: z.string().default('http://localhost:3001'),
    APP_URL: z.string().url().default('http://localhost:3001'),
    PUBLIC_PAYMENTS_BASE_URL: z.string().url().default('http://localhost:3301'),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
    COOKIE_DOMAIN: z.string().optional(),
    COOKIE_SECURE: envBoolean.default(false),
    COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    REFRESH_TOKEN_COOKIE_NAME: z.string().default('refresh_token'),
    MAX_ACTIVE_REFRESH_TOKENS_PER_USER: z.coerce.number().int().positive().default(5),
    ADMIN_EMAIL: z.string().email().default('admin@2x1burger.co'),
    ADMIN_PASSWORD: z.string().min(12),
    CASHIER_EMAIL: z.string().email().default('cashier@2x1burgerco.local'),
    CASHIER_PASSWORD: z.string().min(12).optional(),
    INVENTORY_EMAIL: z.string().email().default('inventory@2x1burgerco.local'),
    INVENTORY_PASSWORD: z.string().min(12).optional(),
    WHATSAPP_INTERNAL_ENABLED: envBoolean.default(false),
    WHATSAPP_AUTH_DIR: z.string().default('/app/data/whatsapp-auth'),
    WHATSAPP_SEND_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
    WHATSAPP_MODE: z.enum(['disabled', 'mock', 'receive_only', 'supervised', 'auto']).default('disabled'),
    WHATSAPP_PROVIDER: z.enum(['hermes', 'mock', 'qr_gateway', 'none']).default('none'),
    WHATSAPP_QR_ENABLED: envBoolean.default(false),
    WHATSAPP_QR_SESSION_NAME: z.string().default('sofia-main'),
    WHATSAPP_QR_SESSION_PATH: z.string().default('./storage/whatsapp-sessions'),
    WHATSAPP_QR_RECONNECT_ENABLED: envBoolean.default(true),
    WHATSAPP_QR_MAX_RECONNECT_ATTEMPTS: z.coerce.number().int().positive().default(5),
    WHATSAPP_QR_ALLOW_REAL_SEND: envBoolean.default(false),
    WHATSAPP_QR_ALLOW_RECEIVE: envBoolean.default(true),
    WHATSAPP_QR_SANDBOX_ONLY: envBoolean.default(true),
    SOFIA_QR_PILOT_ALLOWLIST_ENABLED: envBoolean.default(true),
    SOFIA_QR_PILOT_ALLOWED_PHONES: z.string().optional(),
    SOFIA_QR_PILOT_RECEIVE_ONLY: envBoolean.default(true),
    SOFIA_QR_PILOT_REAL_SEND: envBoolean.default(false),
    HERMES_BASE_URL: z.string().url().optional(),
    HERMES_API_TOKEN: z.string().optional(),
    HERMES_WEBHOOK_SECRET: z.string().optional(),
    HERMES_PHONE_NUMBER_ID: z.string().optional(),
    HERMES_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
    HERMES_MAX_RETRIES: z.coerce.number().int().positive().default(3),
    SOFIA_AUTO_REPLY_ENABLED: envBoolean.default(false),
    SOFIA_AUTO_SAFE_ENABLED: envBoolean.default(false),
    SOFIA_PRODUCTION_ENABLED: envBoolean.default(false),
    SOFIA_AUTO_REPLY_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.82),
    SOFIA_HUMAN_HANDOFF_ENABLED: envBoolean.default(true),
    SOFIA_REPLY_OUTSIDE_HOURS: envBoolean.default(false),
    SOFIA_WHATSAPP_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
    SOFIA_WHATSAPP_DEDUP_TTL_MINUTES: z.coerce.number().int().positive().default(1440),
    WHATSAPP_EXPECTED_ACCOUNT_ID: z.string().min(1).optional(),
    WHATSAPP_EXPECTED_BUSINESS_IDENTITY: z.string().min(1).optional(),
    WHATSAPP_EXPECTED_SESSION_OWNER: z.string().min(1).optional(),
    SOFIA_WHATSAPP_OUTBOUND_HANDLER_ENABLED: envBoolean.default(false),
    SOFIA_AI_PROVIDER: z.enum(['rules', 'deepseek', 'hybrid']).default('rules'),
    SOFIA_AI_MODE: z.enum(['disabled', 'dry_run', 'suggest', 'supervised', 'auto']).default('disabled'),
    DEEPSEEK_ENABLED: envBoolean.default(false),
    DEEPSEEK_API_KEY: z.string().optional(),
    DEEPSEEK_BASE_URL: z.string().url().optional(),
    DEEPSEEK_MODEL: z.string().default('deepseek-v4-flash'),
    DEEPSEEK_TIMEOUT_MS: z.coerce.number().int().positive().default(12000),
    DEEPSEEK_MAX_RETRIES: z.coerce.number().int().min(0).default(2),
    DEEPSEEK_MAX_TOKENS: z.coerce.number().int().positive().default(700),
    BOLD_API_KEY: z.string().optional(),
    BOLD_WEBHOOK_SECRET: z.string().optional(),
    BOLD_BASE_URL: z.string().url().default('https://integrations.api.bold.co'),
    BOLD_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
    BOLD_PAYMENT_LINK_TTL_MINUTES: z.coerce.number().int().positive().max(1440).default(20),
    BOLD_EXPECTED_ACCOUNT_ID: z.string().min(1).optional(),
    PHASE5_ORDER_CREATION_ENABLED: envBoolean.default(false),
    PHASE5_PAYMENT_ORCHESTRATION_ENABLED: envBoolean.default(false),
    PAYMENT_WEBHOOK_RECOVERY_WORKER_ENABLED: envBoolean.default(false),
    NOTIFICATION_OUTBOX_WORKER_ENABLED: envBoolean.default(false),
    PHASE5_KITCHEN_ENABLED: envBoolean.default(false),
    PHASE5_TEST_OPERATIONAL_ENABLED: envBoolean.default(false),
    CRM_IDENTITY_HASH_SECRET: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().min(32).optional(),
    ),
    SOFIA_AI_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.82),
    SOFIA_AI_LOG_PROMPTS: envBoolean.default(false),
    SOFIA_AI_REDACT_PERSONAL_DATA: envBoolean.default(true),
    DELIVERY_EXTERNAL_PROVIDERS_ENABLED: envBoolean.default(false),
    DELIVERY_WEATHER_PROVIDER: z.string().default('openmeteo'),
    DELIVERY_GEOCODING_PROVIDER: z.string().default('openrouteservice'),
    DELIVERY_GEOCODING_FALLBACK_PROVIDER: z.string().default('nominatim'),
    DELIVERY_ROUTING_PROVIDER: z.string().default('openrouteservice'),
    DELIVERY_ROUTING_FALLBACK_PROVIDER: z.string().default('osrm'),
    DELIVERY_EXTERNAL_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
    DELIVERY_CACHE_ENABLED: envBoolean.default(true),
    DELIVERY_ORIGIN_LAT: z.string().optional(),
    DELIVERY_ORIGIN_LNG: z.string().optional(),
    DELIVERY_ORIGIN_LABEL: z.string().default('2X1 Burger Co'),
    DELIVERY_ORIGIN_ADDRESS: z.string().optional(),
    DELIVERY_GEOCODING_USER_AGENT: z.string().default('2x1burger-delivery-context/1.0'),
    OPENROUTESERVICE_API_KEY: z.string().optional(),
    DELIVERY_OPENMETEO_DAILY_LIMIT: z.coerce.number().int().positive().optional(),
    DELIVERY_OPENROUTESERVICE_DIRECTIONS_DAILY_LIMIT: z.coerce.number().int().positive().optional(),
    DELIVERY_OPENROUTESERVICE_GEOCODING_DAILY_LIMIT: z.coerce.number().int().positive().optional(),
    DELIVERY_PROVIDER_QUOTA_SOFT_LIMIT_PERCENT: z.coerce.number().int().positive().default(85),
    DELIVERY_PROVIDER_QUOTA_HARD_LIMIT_PERCENT: z.coerce.number().int().positive().default(95),
    DELIVERY_CIRCUIT_BREAKER_ERROR_THRESHOLD: z.coerce.number().int().positive().default(5),
    DELIVERY_CIRCUIT_BREAKER_COOLDOWN_MINUTES: z.coerce.number().int().positive().default(10),
    DELIVERY_EXTERNAL_SMOKE_ENABLED: envBoolean.default(false),
    RECOVERY_STATUS_PATH: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.JWT_ACCESS_SECRET.startsWith('change-this-')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'JWT_ACCESS_SECRET contiene un placeholder. Genera uno real con: openssl rand -base64 48',
        path: ['JWT_ACCESS_SECRET'],
      });
    }
    if (data.JWT_REFRESH_SECRET.startsWith('change-this-')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'JWT_REFRESH_SECRET contiene un placeholder. Genera uno real con: openssl rand -base64 48',
        path: ['JWT_REFRESH_SECRET'],
      });
    }
    if (data.JWT_ACCESS_SECRET === data.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'JWT_ACCESS_SECRET y JWT_REFRESH_SECRET deben ser diferentes entre si',
        path: ['JWT_REFRESH_SECRET'],
      });
    }
    if (
      data.PHASE5_PAYMENT_ORCHESTRATION_ENABLED
      && !data.PAYMENT_WEBHOOK_RECOVERY_WORKER_ENABLED
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'PAYMENT_WEBHOOK_RECOVERY_REQUIRED',
        path: ['PAYMENT_WEBHOOK_RECOVERY_WORKER_ENABLED'],
      });
    }
    if (data.NODE_ENV === 'production') {
      const reject = (path: keyof typeof data, reasonCode: string) => {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: reasonCode, path: [path] });
      };
      if (data.TEST_DATABASE_URL) {
        reject('TEST_DATABASE_URL', 'PROD_TEST_DATABASE_URL_FORBIDDEN');
      }
      if (data.JEST_WORKER_ID) {
        reject('JEST_WORKER_ID', 'PROD_JEST_WORKER_ID_FORBIDDEN');
      }
      if (data.WHATSAPP_PROVIDER === 'mock') {
        reject('WHATSAPP_PROVIDER', 'SOFIA_PROD_MOCK_WHATSAPP_FORBIDDEN');
      }
      if (data.WHATSAPP_MODE === 'mock') {
        reject('WHATSAPP_MODE', 'SOFIA_PROD_MOCK_WHATSAPP_FORBIDDEN');
      }
      if (data.WHATSAPP_MODE === 'auto' || data.SOFIA_AUTO_REPLY_ENABLED) {
        reject('SOFIA_AUTO_REPLY_ENABLED', 'SOFIA_PROD_AUTOMATIC_REPLY_FORBIDDEN');
      }
      if (data.SOFIA_AUTO_SAFE_ENABLED) {
        reject('SOFIA_AUTO_SAFE_ENABLED', 'SOFIA_PROD_AUTO_SAFE_FORBIDDEN');
      }
      if (data.WHATSAPP_QR_ALLOW_REAL_SEND || data.SOFIA_QR_PILOT_REAL_SEND) {
        reject('WHATSAPP_QR_ALLOW_REAL_SEND', 'SOFIA_PROD_REAL_SEND_FORBIDDEN');
      }
      if (data.SOFIA_PRODUCTION_ENABLED) {
        reject('SOFIA_PRODUCTION_ENABLED', 'SOFIA_PROD_ACTIVATION_FORBIDDEN');
      }
      if (data.SOFIA_WHATSAPP_OUTBOUND_HANDLER_ENABLED) {
        reject('SOFIA_WHATSAPP_OUTBOUND_HANDLER_ENABLED', 'SOFIA_PROD_WHATSAPP_HANDLER_FORBIDDEN');
      }
      if (data.PHASE5_ORDER_CREATION_ENABLED) {
        reject('PHASE5_ORDER_CREATION_ENABLED', 'PHASE5_PROD_ORDER_CREATION_FORBIDDEN');
      }
      if (data.PHASE5_PAYMENT_ORCHESTRATION_ENABLED) {
        reject('PHASE5_PAYMENT_ORCHESTRATION_ENABLED', 'PHASE5_PROD_PAYMENT_MUTATION_FORBIDDEN');
      }
      if (data.PHASE5_KITCHEN_ENABLED) {
        reject('PHASE5_KITCHEN_ENABLED', 'PHASE5_PROD_KITCHEN_MUTATION_FORBIDDEN');
      }
      if (data.PHASE5_TEST_OPERATIONAL_ENABLED) {
        reject('PHASE5_TEST_OPERATIONAL_ENABLED', 'PHASE5_PROD_TEST_GATE_FORBIDDEN');
      }
      if (!data.SOFIA_AI_REDACT_PERSONAL_DATA) {
        reject('SOFIA_AI_REDACT_PERSONAL_DATA', 'SOFIA_PROD_AI_REDACTION_REQUIRED');
      }
      if (!data.COOKIE_SECURE) {
        reject('COOKIE_SECURE', 'PROD_SECURE_COOKIE_REQUIRED');
      }
      const publicUrls = [
        ['APP_URL', new URL(data.APP_URL)],
        ['PUBLIC_PAYMENTS_BASE_URL', new URL(data.PUBLIC_PAYMENTS_BASE_URL)],
      ] as const;
      for (const [path, url] of publicUrls) {
        if (
          url.protocol !== 'https:' ||
          url.username ||
          url.password ||
          ['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase())
        ) {
          reject(path, 'PROD_PUBLIC_URL_HTTPS_REQUIRED');
        }
      }
      for (const originValue of data.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)) {
        let origin: URL;
        try {
          origin = new URL(originValue);
        } catch {
          reject('CORS_ORIGIN', 'PROD_CORS_ORIGIN_INVALID');
          continue;
        }
        if (
          origin.protocol !== 'https:' ||
          origin.username ||
          origin.password ||
          origin.pathname !== '/' ||
          origin.search ||
          origin.hash ||
          ['localhost', '127.0.0.1', '::1'].includes(origin.hostname.toLowerCase())
        ) {
          reject('CORS_ORIGIN', 'PROD_CORS_ORIGIN_HTTPS_REQUIRED');
        }
      }
      const boldBaseUrl = new URL(data.BOLD_BASE_URL);
      if (
        boldBaseUrl.protocol !== 'https:' ||
        boldBaseUrl.hostname !== 'integrations.api.bold.co' ||
        boldBaseUrl.username ||
        boldBaseUrl.password ||
        boldBaseUrl.port
      ) {
        reject('BOLD_BASE_URL', 'PHASE5_PROD_BOLD_ENDPOINT_FORBIDDEN');
      }
      if (data.DEEPSEEK_BASE_URL) {
        const deepseekBaseUrl = new URL(data.DEEPSEEK_BASE_URL);
        if (
          deepseekBaseUrl.protocol !== 'https:'
          || deepseekBaseUrl.hostname !== 'api.deepseek.com'
          || deepseekBaseUrl.username
          || deepseekBaseUrl.password
          || deepseekBaseUrl.port
          || !['', '/'].includes(deepseekBaseUrl.pathname)
          || deepseekBaseUrl.search
          || deepseekBaseUrl.hash
        ) {
          reject('DEEPSEEK_BASE_URL', 'SOFIA_PROD_DEEPSEEK_ENDPOINT_FORBIDDEN');
        }
      }
      if (data.WHATSAPP_QR_ENABLED && data.WHATSAPP_PROVIDER === 'qr_gateway') {
        if (!data.WHATSAPP_EXPECTED_ACCOUNT_ID || !data.WHATSAPP_EXPECTED_BUSINESS_IDENTITY || !data.WHATSAPP_EXPECTED_SESSION_OWNER) {
          reject('WHATSAPP_EXPECTED_ACCOUNT_ID', 'SOFIA_PROD_WHATSAPP_ACCOUNT_BINDING_REQUIRED');
        }
      }
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): AppEnv {
  return envSchema.parse(config);
}
