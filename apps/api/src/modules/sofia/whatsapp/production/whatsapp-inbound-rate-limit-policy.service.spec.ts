import { WhatsappInboundRateLimitPolicyService } from './whatsapp-inbound-rate-limit-policy.service';

describe('WhatsappInboundRateLimitPolicyService', () => {
  const start = new Date('2026-08-08T12:00:00.000Z');

  it('isolates sender limits within an account and resets on the next window', () => {
    const policy = new WhatsappInboundRateLimitPolicyService({
      windowMs: 1_000,
      accountLimit: 10,
      senderLimit: 2,
      maxTrackedAccounts: 10,
      maxTrackedSenders: 10,
    });
    const request = { accountId: 'account-1', senderIdentityHash: 'sender-a', now: start };

    expect(policy.evaluate(request)).toMatchObject({ allowed: true, senderRemaining: 1 });
    expect(policy.evaluate(request)).toMatchObject({ allowed: true, senderRemaining: 0 });
    expect(policy.evaluate(request)).toMatchObject({
      allowed: false,
      reasonCode: 'WHATSAPP_SENDER_RATE_LIMITED',
      retryAfterMs: 1_000,
    });
    expect(policy.evaluate({ ...request, senderIdentityHash: 'sender-b' })).toMatchObject({ allowed: true });
    expect(policy.evaluate({ ...request, now: new Date(start.getTime() + 1_000) })).toMatchObject({ allowed: true });
  });

  it('applies an account-wide ceiling across distinct senders', () => {
    const policy = new WhatsappInboundRateLimitPolicyService({
      windowMs: 60_000,
      accountLimit: 2,
      senderLimit: 2,
      maxTrackedAccounts: 10,
      maxTrackedSenders: 10,
    });

    expect(policy.evaluate({ accountId: 'account-1', senderIdentityHash: 'sender-a', now: start }).allowed).toBe(true);
    expect(policy.evaluate({ accountId: 'account-1', senderIdentityHash: 'sender-b', now: start }).allowed).toBe(true);
    expect(policy.evaluate({ accountId: 'account-1', senderIdentityHash: 'sender-c', now: start })).toMatchObject({
      allowed: false,
      reasonCode: 'WHATSAPP_ACCOUNT_RATE_LIMITED',
      accountRemaining: 0,
    });
    expect(policy.evaluate({ accountId: 'account-2', senderIdentityHash: 'sender-c', now: start }).allowed).toBe(true);
  });

  it('bounds sender-cardinality memory and fails closed until stale counters can be pruned', () => {
    const policy = new WhatsappInboundRateLimitPolicyService({
      windowMs: 1_000,
      accountLimit: 100,
      senderLimit: 10,
      maxTrackedAccounts: 10,
      maxTrackedSenders: 2,
    });

    policy.evaluate({ accountId: 'account-1', senderIdentityHash: 'sender-a', now: start });
    policy.evaluate({ accountId: 'account-1', senderIdentityHash: 'sender-b', now: start });
    expect(policy.evaluate({ accountId: 'account-1', senderIdentityHash: 'sender-c', now: start })).toMatchObject({
      allowed: false,
      reasonCode: 'WHATSAPP_SENDER_RATE_LIMITED',
    });
    expect(policy.evaluate({
      accountId: 'account-1', senderIdentityHash: 'sender-c', now: new Date(start.getTime() + 1_000),
    })).toMatchObject({ allowed: true });
  });

  it('counts status events against the account without creating sender state', () => {
    const policy = new WhatsappInboundRateLimitPolicyService({
      windowMs: 60_000,
      accountLimit: 1,
      senderLimit: 1,
      maxTrackedAccounts: 1,
      maxTrackedSenders: 1,
    });

    expect(policy.evaluate({ accountId: 'account-1', now: start })).toMatchObject({
      allowed: true,
      senderRemaining: null,
    });
    expect(policy.evaluate({ accountId: 'account-1', now: start })).toMatchObject({
      allowed: false,
      reasonCode: 'WHATSAPP_ACCOUNT_RATE_LIMITED',
    });
  });
});
