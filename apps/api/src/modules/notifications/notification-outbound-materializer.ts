import { Injectable } from '@nestjs/common';
import type { NotificationIntent, Prisma, WhatsappOutboundMessage } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { deterministicNotificationHash } from './domain';
import type { NotificationCommandBinding } from './notification-dispatch.ports';

const HASH = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const MAX_BODY_LENGTH = 2_000;
const OUTBOUND_STATUS = 'APPROVAL_PENDING';

export type MaterializedNotificationOutbound = Readonly<{
  outbound: WhatsappOutboundMessage;
  binding: NotificationCommandBinding;
  replayed: boolean;
}>;

export abstract class NotificationOutboundMaterializer {
  abstract materialize(intent: NotificationIntent): Promise<MaterializedNotificationOutbound>;
}

@Injectable()
export class PrismaNotificationOutboundMaterializer extends NotificationOutboundMaterializer {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async materialize(intent: NotificationIntent): Promise<MaterializedNotificationOutbound> {
    const facts = this.factObject(intent.factEnvelope);
    if (deterministicNotificationHash(facts) !== intent.factHash) {
      throw new Error('NOTIFICATION_FACT_HASH_MISMATCH');
    }
    const conversationId = this.safeId(facts.conversationId);
    const accountId = this.safeId(facts.accountId);
    const recipientIdentityHash = this.hash(facts.recipientIdentityHash);
    const body = this.body(facts.body);
    const expectedConversationVersion = facts.expectedConversationVersion;
    if (
      !conversationId
      || conversationId !== intent.conversationId
      || !accountId
      || !recipientIdentityHash
      || !Number.isInteger(expectedConversationVersion)
      || Number(expectedConversationVersion) < 0
    ) {
      throw new Error('NOTIFICATION_COMMAND_BINDING_INVALID');
    }

    const idempotencyKey = `notification:${intent.id}`;
    const localMessageId = `notification-${this.sha256(idempotencyKey).slice(0, 32)}`;
    const bodyHash = this.sha256(body);
    const suppliedBodyHash = facts.bodyHash;
    if (suppliedBodyHash !== undefined && suppliedBodyHash !== bodyHash) {
      throw new Error('NOTIFICATION_FACT_HASH_MISMATCH');
    }

    return this.prisma.$transaction(async (tx) => {
      const conversation = await tx.whatsappConversation.findUnique({
        where: { id: conversationId },
        select: { id: true, provider: true, handoffVersion: true },
      });
      const account = await tx.whatsappProviderAccount.findUnique({
        where: { id: accountId },
        select: { id: true, provider: true, status: true },
      });
      if (!conversation || !account) throw new Error('NOTIFICATION_OUTBOUND_AUTHORITY_NOT_FOUND');
      if (
        conversation.handoffVersion !== Number(expectedConversationVersion)
        || conversation.provider !== account.provider
        || account.status !== 'VERIFIED_RECEIVE_ONLY'
      ) {
        throw new Error('NOTIFICATION_OUTBOUND_AUTHORITY_MISMATCH');
      }

      const existing = await tx.whatsappOutboundMessage.findUnique({ where: { idempotencyKey } });
      const replayed = existing !== null;
      const outbound = existing ?? await tx.whatsappOutboundMessage.upsert({
        where: { idempotencyKey },
        create: {
          conversationId,
          provider: account.provider,
          localMessageId,
          body,
          mediaUrl: null,
          status: OUTBOUND_STATUS,
          idempotencyKey,
          accountId,
          recipientIdentityHash,
          purpose: intent.purpose,
        },
        update: {},
      });
      if (!outbound || !this.sameBinding(outbound, {
        conversationId,
        provider: account.provider,
        localMessageId,
        body,
        accountId,
        recipientIdentityHash,
        purpose: intent.purpose,
      })) {
        throw new Error('NOTIFICATION_OUTBOUND_IDEMPOTENCY_CONFLICT');
      }

      return Object.freeze({
        outbound,
        replayed,
        binding: Object.freeze({
          outboundMessageId: outbound.id,
          conversationId,
          recipientIdentityHash,
          purpose: intent.purpose,
          bodyHash,
          accountId,
          expectedConversationVersion: Number(expectedConversationVersion),
        }),
      });
    });
  }

  private sameBinding(
    outbound: WhatsappOutboundMessage,
    expected: Readonly<{
      conversationId: string;
      provider: string;
      localMessageId: string;
      body: string;
      accountId: string;
      recipientIdentityHash: string;
      purpose: string;
    }>,
  ) {
    return outbound.conversationId === expected.conversationId
      && outbound.provider === expected.provider
      && outbound.localMessageId === expected.localMessageId
      && outbound.body === expected.body
      && outbound.mediaUrl === null
      && outbound.accountId === expected.accountId
      && outbound.recipientIdentityHash === expected.recipientIdentityHash
      && outbound.purpose === expected.purpose;
  }

  private factObject(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('NOTIFICATION_COMMAND_BINDING_INVALID');
    }
    return value as Record<string, Prisma.JsonValue>;
  }

  private safeId(value: Prisma.JsonValue | undefined): string | null {
    return typeof value === 'string' && SAFE_ID.test(value) ? value : null;
  }

  private hash(value: Prisma.JsonValue | undefined): string | null {
    return typeof value === 'string' && HASH.test(value) ? value : null;
  }

  private body(value: Prisma.JsonValue | undefined): string {
    if (typeof value !== 'string') throw new Error('NOTIFICATION_OUTBOUND_BODY_INVALID');
    const normalized = value.normalize('NFKC').trim();
    if (!normalized || normalized.length > MAX_BODY_LENGTH || this.hasUnsafeControl(normalized)) {
      throw new Error('NOTIFICATION_OUTBOUND_BODY_INVALID');
    }
    return normalized;
  }

  private hasUnsafeControl(value: string): boolean {
    return Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (codePoint < 32 && codePoint !== 9 && codePoint !== 10 && codePoint !== 13) || codePoint === 127;
    });
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
