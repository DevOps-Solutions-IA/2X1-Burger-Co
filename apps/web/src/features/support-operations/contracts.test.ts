import assert from 'node:assert/strict';
import test from 'node:test';
import { serviceCaseSchema } from './contracts';

test('accepts an assigned actor with a nullable access name', () => {
  const parsed = serviceCaseSchema.safeParse({
    id: 'case-1',
    category: 'DELIVERY_PROBLEM',
    status: 'HUMAN_TAKEN',
    source: 'DELIVERY_WORKFLOW',
    sanitizedSummary: 'Caso operativo sanitizado',
    customerId: null,
    conversationId: null,
    orderCheckoutId: null,
    orderTicketId: 'ticket-1',
    paymentIntentId: null,
    deliveryIssueId: null,
    assignedActorId: 'actor-1',
    resolutionActorId: null,
    resolutionCode: null,
    version: 2,
    createdAt: '2026-08-13T12:00:00.000Z',
    updatedAt: '2026-08-13T12:05:00.000Z',
    resolvedAt: null,
    closedAt: null,
    customer: null,
    assignedActor: {
      id: 'actor-1',
      fullName: 'Operador sin alias',
      accessName: null,
    },
  });

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.assignedActor?.accessName, null);
  }
});
