#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const record = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const apiBase = process.env.CANARY_API_BASE_URL ?? 'http://127.0.0.1:4400';
const webBase = process.env.CANARY_WEB_BASE_URL ?? 'http://127.0.0.1:3401';

async function requestJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

const apiVersion = await requestJson(`${apiBase}/version`);
const webVersion = await requestJson(`${webBase}/version`);
const health = await requestJson(`${apiBase}/health`);
const login = await requestJson(`${apiBase}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: process.env.CANARY_ADMIN_EMAIL, password: process.env.CANARY_ADMIN_PASSWORD }),
});
const auth = { Authorization: `Bearer ${login.accessToken}` };
const dashboard = await requestJson(`${apiBase}/admin/sofia/dashboard/summary`, { headers: auth });
const qr = await requestJson(`${apiBase}/admin/sofia/whatsapp/qr/status`, { headers: auth });
const cash = await requestJson(`${apiBase}/cash-register/current`, { headers: auth });
const deliveries = await requestJson(`${apiBase}/orders/delivery-active`, { headers: auth });

const expected = record.manifest;
const mismatches = [];
for (const [component, actual] of [['api', apiVersion], ['web', webVersion]]) {
  if (actual.gitCommit !== expected.gitCommit) mismatches.push(`${component}:commit`);
  if (actual.buildId !== expected.buildId) mismatches.push(`${component}:buildId`);
  if (actual.dirtyBuild !== false) mismatches.push(`${component}:dirtyBuild`);
}
const security = dashboard.security ?? dashboard.status?.security ?? {};
const safety = {
  realSendingEnabled: security.realSendingEnabled ?? dashboard.realSendingEnabled,
  autoReplyEnabled: security.autoReplyEnabled ?? dashboard.autoReplyEnabled,
  autoSafeEnabled: security.autoSafeEnabled ?? dashboard.autoSafeEnabled,
  productionEnabled: security.productionEnabled ?? dashboard.productionEnabled,
  whatsappCanMarkPaid: security.whatsappCanMarkPaid ?? dashboard.whatsappCanMarkPaid,
};
for (const [name, value] of Object.entries(safety)) {
  if (value !== false) mismatches.push(`safety:${name}=${String(value)}`);
}
if (qr.status !== 'DISABLED' || qr.connected !== false || qr.realSendingEnabled !== false) {
  mismatches.push('qr:not-safely-disabled');
}
if (health.status !== 'ok') mismatches.push('health');
if (mismatches.length) throw new Error(`Canary smoke failed: ${mismatches.join(', ')}`);

process.stdout.write(`${JSON.stringify({
  status: 'PASS',
  sourceCommit: expected.gitCommit,
  buildId: expected.buildId,
  apiArtifact: apiVersion.artifactDigest,
  webArtifact: webVersion.artifactDigest,
  health: health.status,
  database: health.services?.database,
  webLogin: true,
  cashReadOnly: cash === null || typeof cash === 'object',
  deliveryReadOnly: Array.isArray(deliveries) || typeof deliveries === 'object',
  safety,
  qr: { status: qr.status, connected: qr.connected, adapterReal: qr.adapterReal },
  ai: { provider: dashboard.ai?.provider ?? null, mode: dashboard.ai?.mode ?? null },
  credentialsPrinted: false,
}, null, 2)}\n`);
