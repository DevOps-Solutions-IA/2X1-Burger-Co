#!/usr/bin/env node

const apiBase = process.env.CANARY_API_BASE_URL ?? 'http://127.0.0.1:4400';
const phones = (process.env.CANARY_SAFETY_ALLOWED_PHONES ?? '').split(',').filter(Boolean);
if (phones.length < 3) throw new Error('Three synthetic canary allowlist identities are required.');

async function request(path, options = {}, expected = [200, 201]) {
  const response = await fetch(`${apiBase}${path}`, options);
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!expected.includes(response.status)) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
  return { status: response.status, body };
}

function inbound(phone, id, text) {
  return {
    provider: 'qr_gateway',
    externalMessageId: id,
    providerEventId: `${id}-event`,
    phone,
    text,
    messageType: 'TEXT',
    timestamp: new Date().toISOString(),
    source: 'phase-2-2-canary',
  };
}

const login = await request('/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: process.env.CANARY_ADMIN_EMAIL, password: process.env.CANARY_ADMIN_PASSWORD }),
});
const auth = {
  Authorization: `Bearer ${login.body.accessToken}`,
  'Content-Type': 'application/json',
};
const eventPrefix = `p22-${Date.now()}`;
const postInbound = (payload) =>
  request('/integrations/whatsapp/qr_gateway/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

const initial = await request('/admin/sofia/runtime-safety', { headers: auth });

await request('/admin/sofia/governance/pause', {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ reason: 'Phase 2.2 isolated canary validation' }),
});
const pausedInbound = await postInbound(inbound(phones[0], `${eventPrefix}-paused`, 'Hola'));
const pausedStatus = await request('/admin/sofia/runtime-safety', { headers: auth });
await request('/admin/sofia/governance/resume', { method: 'POST', headers: auth, body: '{}' });

await request('/admin/sofia/control/kill-switch/activate', {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ reason: 'Phase 2.2 isolated canary validation' }),
});
const killedInbound = await postInbound(inbound(phones[1], `${eventPrefix}-killed`, 'Hola'));
const killedStatus = await request('/admin/sofia/runtime-safety', { headers: auth });
await request('/admin/sofia/control/kill-switch/deactivate', { method: 'POST', headers: auth, body: '{}' });

const denied = await postInbound(inbound('573000000099', `${eventPrefix}-denied`, 'Hola'));
const maxiPayload = inbound(phones[0], `${eventPrefix}-maxi`, 'Qué trae el Maxi Family');
const maxi = await postInbound(maxiPayload);
const duplicate = await postInbound(maxiPayload);
const payment = await postInbound(inbound(phones[1], `${eventPrefix}-payment`, 'Ya pagué por Nequi'));
const unknown = await postInbound(inbound(phones[2], `${eventPrefix}-unknown`, 'Quiero sushi'));

const sendBlocked = await request(
  `/admin/sofia/outbound/${maxi.body.outbound.id}/approve-send`,
  { method: 'POST', headers: auth, body: '{}' },
  [403],
);
const testSend = await request('/admin/sofia/whatsapp/qr/test-send', {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ phone: phones[0], text: 'Blocked canary probe' }),
});

const finalSafety = await request('/admin/sofia/runtime-safety', { headers: auth });
const dashboard = await request('/admin/sofia/dashboard/summary', { headers: auth });
const inbox = await request('/admin/sofia/conversations/inbox', { headers: auth });
const qr = await request('/admin/sofia/whatsapp/qr/status', { headers: auth });
const enterprise = await request('/admin/sofia/enterprise-status', { headers: auth });

const checks = {
  effectiveFlagsFalse: Object.values(finalSafety.body.state.effective).every((value) => value === false),
  pauseBlocked: pausedInbound.body.processingStatus === 'GLOBAL_PAUSED' && pausedStatus.body.state.globalPaused === true,
  killBlocked: killedInbound.body.processingStatus === 'KILL_SWITCH_ACTIVE' && killedStatus.body.state.killSwitchActive === true,
  allowlistDenied: denied.body.processingStatus === 'ALLOWLIST_REQUIRED',
  allowedSuggested: maxi.body.processingStatus === 'SUGGESTED' && maxi.body.outbound?.status === 'SUGGESTED',
  duplicateSuppressed: duplicate.body.processingStatus === 'DUPLICATE_IGNORED',
  paymentBlocked:
    JSON.stringify(payment.body).includes('PAYMENT_SENSITIVE') && !JSON.stringify(payment.body).includes('"status":"SENT"'),
  unknownBlocked:
    JSON.stringify(unknown.body).includes('UNKNOWN_PRODUCT') && !JSON.stringify(unknown.body).includes('"status":"SENT"'),
  approvalBlocked:
    sendBlocked.status === 403 && sendBlocked.body?.reason === 'PRODUCTION_DISABLED' && sendBlocked.body?.sent === false,
  adapterSendBlocked: testSend.body.sent === false && testSend.body.status === 'BLOCKED_REAL_SEND_DISABLED',
  dashboardTruthful:
    dashboard.body.general.realSendingEnabled === false &&
    dashboard.body.general.autoReplyEnabled === false &&
    dashboard.body.general.autoSafeEnabled === false &&
    dashboard.body.general.productionEnabled === false &&
    dashboard.body.general.receiveOnly === true,
  inboxSeparated:
    inbox.body.scope.realOperationEnabled === false &&
    inbox.body.scope.receiveOnly === true &&
    inbox.body.sandbox.hiddenByDefault === true,
  qrTruthful:
    qr.body.status === 'DISABLED' &&
    qr.body.connected === false &&
    qr.body.adapterReal === false &&
    qr.body.qrAvailable === false &&
    qr.body.realSendingEnabled === false,
  paidForbidden: enterprise.body.payments.whatsappCanMarkPaid === false,
  dryRunTruthful:
    dashboard.body.ai.aiProvider === 'deepseek' &&
    dashboard.body.ai.aiMode === 'dry_run' &&
    dashboard.body.ai.externalProviderEnabled === false,
};

const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) throw new Error(`Runtime safety smoke failed: ${failed.join(', ')}`);

process.stdout.write(`${JSON.stringify({
  status: 'PASS',
  checks,
  counters: finalSafety.body.counters,
  effective: finalSafety.body.state.effective,
  finalControlState: {
    globalPaused: finalSafety.body.state.globalPaused,
    killSwitchActive: finalSafety.body.state.killSwitchActive,
  },
  qr: {
    status: qr.body.status,
    connected: qr.body.connected,
    adapterReal: qr.body.adapterReal,
    qrAvailable: qr.body.qrAvailable,
  },
  externalNetworkUsed: false,
  realPhonesUsed: false,
  phoneValuesPrinted: false,
  secretsPrinted: false,
}, null, 2)}\n`);
