#!/usr/bin/env node

import { PrismaClient } from '@prisma/client';

const apiBase = process.env.PRODUCTION_ISOLATION_API_BASE_URL;
const email = process.env.PRODUCTION_ISOLATION_ADMIN_EMAIL;
const password = process.env.PRODUCTION_ISOLATION_ADMIN_PASSWORD;

if (!apiBase || !email || !password) {
  throw new Error('Production isolation smoke requires its synthetic runtime inputs.');
}

const prisma = new PrismaClient();

async function irreversibleState() {
  const [checkouts, intents, links, transitions, webhooks, sales, salePayments, cashMovements] =
    await Promise.all([
      prisma.orderCheckout.count(),
      prisma.paymentIntent.count(),
      prisma.paymentLink.count(),
      prisma.paymentTransition.count(),
      prisma.paymentWebhookEvent.count(),
      prisma.sale.count(),
      prisma.salePayment.count(),
      prisma.cashMovement.count(),
    ]);
  return { checkouts, intents, links, transitions, webhooks, sales, salePayments, cashMovements };
}

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, options);
  let body = null;
  try {
    body = await response.json();
  } catch {
    // A route that does not exist may have an empty response body.
  }
  return { status: response.status, body };
}

try {
  const login = await request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (login.status !== 201 || typeof login.body?.accessToken !== 'string') {
    throw new Error(`Production isolation login returned HTTP ${login.status}.`);
  }

  const authorization = {
    Authorization: `Bearer ${login.body.accessToken}`,
    'Content-Type': 'application/json',
  };
  const before = await irreversibleState();
  const probes = await Promise.all([
    request('/admin/sofia/sandbox/commercial-message', {
      method: 'POST',
      headers: authorization,
      body: JSON.stringify({ phone: 'synthetic-redacted', message: 'production isolation probe' }),
    }),
    request('/admin/sofia/payments/mock-webhook', {
      method: 'POST',
      headers: authorization,
      body: JSON.stringify({ status: 'PAID' }),
    }),
    request('/admin/sofia/whatsapp/qr/test-inbound', {
      method: 'POST',
      headers: authorization,
      body: JSON.stringify({ phone: 'synthetic-redacted', text: 'production isolation probe' }),
    }),
    request('/admin/sofia/whatsapp/qr/test-send', {
      method: 'POST',
      headers: authorization,
      body: JSON.stringify({ phone: 'synthetic-redacted', text: 'production isolation probe' }),
    }),
    request('/integrations/payments/webhook/mock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: 'production-isolation-probe', status: 'PAID' }),
    }),
  ]);
  const after = await irreversibleState();

  const statuses = probes.map(({ status }) => status);
  if (statuses.some((status) => status !== 404)) {
    throw new Error(`Production-only route isolation failed with statuses ${statuses.join(',')}.`);
  }
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    throw new Error('Production isolation probes changed irreversible state.');
  }

  process.stdout.write(`${JSON.stringify({
    status: 'PASS',
    nodeEnv: 'production',
    authenticatedTestRoutes: 'NOT_FOUND',
    removedPublicMockWebhook: 'NOT_FOUND',
    irreversibleStateChanged: false,
    secretsPrinted: false,
  })}\n`);
} finally {
  await prisma.$disconnect();
}
