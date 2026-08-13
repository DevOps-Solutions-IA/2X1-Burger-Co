import assert from 'node:assert/strict';
import test from 'node:test';
import { sofiaCrmCustomersSchema } from '@/features/sofia/contracts';
import { customerOperationalRelations } from './model';

test('accepts the backend masked phone contract without accepting a full identity', () => {
  const parsed = sofiaCrmCustomersSchema.safeParse({
    data: [{
      id: 'customer-1',
      displayName: 'Cliente protegido',
      status: 'ACTIVE',
      identities: [{
        id: 'identity-1',
        type: 'PHONE',
        valueMasked: '+57 *** *** 2399',
        isPrimary: true,
        verifiedAt: null,
      }],
      tags: [],
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
    }],
    pagination: { page: 1, limit: 25, total: 1, pages: 1 },
  });

  assert.equal(parsed.success, true);
  assert.equal(sofiaCrmCustomersSchema.safeParse({
    data: [{
      id: 'customer-1',
      displayName: 'Cliente protegido',
      status: 'ACTIVE',
      identities: [{
        id: 'identity-1',
        type: 'PHONE',
        valueMasked: '+57 300 123 2399',
        isPrimary: true,
        verifiedAt: null,
      }],
      tags: [],
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
    }],
    pagination: { page: 1, limit: 25, total: 1, pages: 1 },
  }).success, false);
});

test('maps canonical customer events without converting uncertain payment into success', () => {
  const relations = customerOperationalRelations([
    {
      id: 'payment-1',
      type: 'PAYMENT_INTENT',
      occurredAt: '2026-08-13T00:00:00.000Z',
      facts: { status: 'UNKNOWN_RESULT', amount: '30000', currency: 'COP', provider: 'BOLD' },
    },
    {
      id: 'conversation-1',
      type: 'CONVERSATION',
      occurredAt: '2026-08-13T00:01:00.000Z',
      facts: { status: 'ACTIVE', handoffState: 'HUMAN_TAKEN' },
    },
  ]);

  assert.equal(relations[0]?.financialSuccess, false);
  assert.equal(relations[0]?.href, '/payments?intent=payment-1');
  assert.equal(relations[1]?.href, '/conversations/conversation-1');
});

test('links checkout evidence to its canonical order and suppresses inaccessible privileged routes', () => {
  const relations = customerOperationalRelations([
    {
      id: 'checkout-1',
      type: 'ORDER_CHECKOUT',
      occurredAt: '2026-08-13T00:00:00.000Z',
      facts: { status: 'ORDER_CREATED', orderTicketId: 'ticket-1' },
    },
    {
      id: 'payment-1',
      type: 'PAYMENT_INTENT',
      occurredAt: '2026-08-13T00:01:00.000Z',
      facts: { status: 'UNKNOWN_RESULT' },
    },
    {
      id: 'case-1',
      type: 'SERVICE_CASE',
      occurredAt: '2026-08-13T00:02:00.000Z',
      facts: { status: 'OPEN' },
    },
  ], { payments: false, serviceCases: false });

  assert.equal(relations[0]?.href, '/orders/ticket-1');
  assert.equal(relations[1]?.href, null);
  assert.equal(relations[2]?.href, null);
});
