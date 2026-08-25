import { ConflictException, Injectable } from '@nestjs/common';
import { OrderTicketType, Prisma, SofiaOrderDraftStatus, SofiaPaymentPreference } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { commercialDraftHash } from '../commercial-draft-hash';
import { DraftAlreadyConfirmedError, type CommercialConfirmedDraftRecord, type CommercialRepository } from '../commercial.repository';
import type { CommercialConversationState, CommercialItem } from '../commercial.types';

@Injectable()
export class PrismaCommercialRepository implements CommercialRepository {
  constructor(private readonly prisma: PrismaService) {}

  async loadState(conversationId: string) {
    const memory = await this.prisma.sofiaConversationMemory.findUnique({ where: { conversationId } });
    const value = memory?.currentOrderIntentJson;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const candidate = value as Record<string, unknown>;
    return candidate.schemaVersion === 4 ? candidate as unknown as CommercialConversationState : null;
  }

  /**
   * SOFIA Round 5 / A26 CLOSURE (root cause #1, HIGH) — `sofiaConversationMemory` was previously a
   * bare `upsert` keyed only on `conversationId`, with NO optimistic-concurrency/version check at
   * all. Two genuinely concurrent `CommercialCheckoutService.process()` calls for the SAME
   * conversation (e.g. two distinct WhatsApp messages arriving moments apart, or a fast worker racing
   * a slower one) could interleave so that a turn which read a STALE, pre-confirmation snapshot wrote
   * back that stale belief AFTER a genuine confirming turn's write had already landed — silently
   * erasing the only durable record that a draft was ever confirmed (see the A25 finding; this is a
   * classic lost update / TOCTOU, independent of `saveDraft()`'s own CAS on `SofiaOrderDraft`, which
   * remains correctly protected).
   *
   * This is conversational narration state, not the financial authority itself (`SofiaOrderDraft`
   * stays separately, unconditionally CAS-protected regardless of what happens here), so a hard
   * CAS-reject-and-bubble-a-ConflictException-to-the-customer is the wrong UX for a lost race on a
   * routine follow-up message. Instead: serialize concurrent writers for this `conversationId` with a
   * real row lock (`SELECT ... FOR UPDATE` inside a transaction — the second writer's SELECT blocks
   * until the first COMMITs, then observes the first writer's committed truth) and apply a single,
   * narrow invariant on top: NEVER let a write regress an already-persisted CONFIRMED marker for the
   * SAME `draftId` back to a non-CONFIRMED value. A write that targets a genuinely DIFFERENT
   * `draftId` (the legitimate "start a new order after a prior confirmed one" flow) is never blocked
   * by this — only a write that is unaware its own tracked draft was already confirmed gets its stale
   * belief dropped in favor of the durable truth, which any subsequent `loadState()` (including the
   * losing writer's own next turn) will now correctly observe.
   */
  async saveState(state: CommercialConversationState) {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ current_order_intent_json: unknown }>>(
        Prisma.sql`SELECT "current_order_intent_json" FROM "sofia_conversation_memories" WHERE "conversation_id" = ${state.conversationId} FOR UPDATE`,
      );
      const existingRaw = rows[0]?.current_order_intent_json;
      const existing = existingRaw && typeof existingRaw === 'object' && !Array.isArray(existingRaw) && (existingRaw as Record<string, unknown>).schemaVersion === 4
        ? (existingRaw as unknown as CommercialConversationState)
        : null;

      const wouldRegressConfirmedMarker = Boolean(
        existing
        && existing.confirmationState === 'CONFIRMED'
        && existing.draftId !== null
        && existing.draftId === state.draftId
        && state.confirmationState !== 'CONFIRMED',
      );
      const toPersist = wouldRegressConfirmedMarker ? existing! : state;

      await tx.sofiaConversationMemory.upsert({
        where: { conversationId: toPersist.conversationId },
        create: { conversationId: toPersist.conversationId, currentIntent: toPersist.intent, currentOrderIntentJson: toPersist as unknown as Prisma.InputJsonValue, missingFieldsJson: toPersist.missingFields, expiresAt: toPersist.expiresAt ? new Date(toPersist.expiresAt) : null },
        update: { currentIntent: toPersist.intent, currentOrderIntentJson: toPersist as unknown as Prisma.InputJsonValue, missingFieldsJson: toPersist.missingFields, expiresAt: toPersist.expiresAt ? new Date(toPersist.expiresAt) : null },
      });
    });
  }

  /**
   * SOFIA Round 5 / A30 CLOSURE (A29 finding, HIGH) — `sofiaConversationMemory.currentOrderIntentJson`
   * has a SECOND real writer besides `saveState()`: the legacy `SofiaConversationMemoryService.
   * updateContext()`, used by `SofiaAgentService.processMessage()`'s pre-canonical-engagement fallback
   * branch. That writer used to run a bare, unlocked `prisma.sofiaConversationMemory.update()` with
   * NO row lock and NO awareness whatsoever of the canonical, CAS-protected shape written by
   * `saveState()` (A26) -- so a legacy write racing (or merely landing after) a canonical CONFIRMED
   * write could silently and irrecoverably destroy the only durable evidence a conversation had a
   * confirmed commercial record, even though the underlying `SofiaOrderDraft` row was still CONFIRMED.
   *
   * This method is the SAME row-locked primitive `saveState()` uses (`SELECT ... FOR UPDATE` inside a
   * transaction), reused rather than re-invented, extended with the correct guarantee for the LEGACY
   * writer specifically: unlike `saveState()` (which only refuses to regress a CONFIRMED marker for
   * the SAME `draftId`, because a genuinely different `draftId` there can legitimately mean "start a
   * new order after a prior confirmed one"), the legacy writer has NO `draftId` concept at all and NO
   * legitimate business reason to ever know about or intentionally supersede ANY canonical commercial
   * record.
   *
   * SOFIA Round 5 / A32 CLOSURE (A31 finding, HIGH, part 1) — the guard above was originally
   * `schemaVersion === 4 && confirmationState === 'CONFIRMED'` only. That left every canonical record
   * ONE STEP EARLIER in its lifecycle (`confirmationState === 'PENDING'`, i.e. already quote-bound,
   * address-confirmed and GPS-validated by `CommercialCheckoutService.process()`, just not yet
   * "confirmo"-ed) with NO protection at all -- a legacy write landing after it silently destroyed
   * real, hard-won destination/quote evidence even though nothing was stale or superseded. The
   * correct principle is broader than "never regress CONFIRMED": the legacy writer must never clobber
   * ANY canonical conversational record, regardless of `confirmationState` -- `schemaVersion === 4` by
   * itself is sufficient to mean "this row is owned by the canonical commercial authority, not by
   * this legacy writer", so the guard now checks ONLY `schemaVersion === 4`.
   *
   * SOFIA Round 5 / A34 CLOSURE (A33 blind red-team finding, LOW) — A32's docstring (this comment,
   * previous revision) explicitly and deliberately scoped the protection to `currentOrderIntentJson`
   * ONLY, reasoning that `currentIntent`, `missingFieldsJson` and `lastProductDiscussed` were "not
   * part of the canonical-evidence invariant this closes". That was correct about the FINANCIAL/
   * evidence authority (they aren't) but wrong about the ROW-LEVEL invariant: once this row carries a
   * canonical (`schemaVersion === 4`) record, `currentIntent` and `missingFieldsJson` are NOT
   * legacy-owned narration -- `saveState()` (A26, above) itself writes both of those exact columns
   * from the canonical state on every canonical save (see its `upsert` `data`). Letting the legacy
   * writer keep overwriting them after a canonical record exists made the row internally
   * self-contradictory: `currentOrderIntentJson.intent`/`.missingFields` (protected, correct) could
   * read e.g. `PURCHASE` / `[]` while the sibling `currentIntent`/`missingFieldsJson` columns on the
   * SAME row simultaneously read `GREETING` / `['deliveryAddress']` from an unrelated legacy turn --
   * directly observable via `SofiaConversationMemoryService.sanitize()`, which
   * `SofiaAgentService.processMessage()` returns as `memory.conversation` to sandbox/admin/debug
   * callers. `lastProductDiscussed` has no canonical-writer equivalent at all (`saveState()` never
   * touches it), so once a canonical record exists there is no legacy-supplied value that could ever
   * be correct for it either -- it must simply stop being legacy-writable at that point, same as the
   * other two. The fix extends the EXACT SAME `existingIsCanonical ? undefined : ...` pattern already
   * used for `currentOrderIntentJson` to these three columns: once the row is canonical, the legacy
   * writer leaves them untouched (whatever the canonical writer itself last set, or unset), instead of
   * writing its own unrelated legacy-turn values over them. `memorySummary` and `customerMemoryId`
   * remain legacy-owned free-text/linkage fields with no canonical-writer equivalent and no
   * cross-column contradiction risk, so they are intentionally left updating normally, matching A33's
   * confirmed scope.
   */
  async saveLegacyConversationContext(input: {
    conversationId: string;
    customerMemoryId?: string | null;
    currentIntent?: string | null;
    currentOrderIntent?: Prisma.InputJsonValue;
    missingFields?: string[];
    lastProductDiscussed?: string | null;
    memorySummary?: string | null;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ current_order_intent_json: unknown }>>(
        Prisma.sql`SELECT "current_order_intent_json" FROM "sofia_conversation_memories" WHERE "conversation_id" = ${input.conversationId} FOR UPDATE`,
      );
      const existingRaw = rows[0]?.current_order_intent_json;
      const existingIsCanonical = Boolean(
        existingRaw
        && typeof existingRaw === 'object'
        && !Array.isArray(existingRaw)
        && (existingRaw as Record<string, unknown>).schemaVersion === 4,
      );

      return tx.sofiaConversationMemory.upsert({
        where: { conversationId: input.conversationId },
        create: {
          conversationId: input.conversationId,
          customerMemoryId: input.customerMemoryId ?? null,
          currentIntent: input.currentIntent ?? undefined,
          currentOrderIntentJson: input.currentOrderIntent ?? undefined,
          missingFieldsJson: input.missingFields ?? undefined,
          lastProductDiscussed: input.lastProductDiscussed ?? undefined,
          memorySummary: input.memorySummary ?? undefined,
        },
        update: {
          customerMemoryId: input.customerMemoryId ?? undefined,
          // A32 (currentOrderIntentJson) + A34 (currentIntent, missingFieldsJson,
          // lastProductDiscussed): never let the legacy writer clobber an already-persisted canonical
          // (`schemaVersion === 4`) record's columns, REGARDLESS of `confirmationState` -- omitting a
          // field from the update payload leaves the existing column value untouched (Prisma treats
          // `undefined` as "do not update this field"). This keeps the row internally consistent: once
          // canonical evidence exists, ONLY the canonical writer (`saveState()`) may change the
          // narration columns it itself owns (`currentIntent`, `missingFieldsJson`) or leave
          // `lastProductDiscussed` alone (it has no canonical equivalent at all).
          currentIntent: existingIsCanonical ? undefined : (input.currentIntent ?? undefined),
          currentOrderIntentJson: existingIsCanonical ? undefined : (input.currentOrderIntent ?? undefined),
          missingFieldsJson: existingIsCanonical ? undefined : (input.missingFields ?? undefined),
          lastProductDiscussed: existingIsCanonical ? undefined : (input.lastProductDiscussed ?? undefined),
          memorySummary: input.memorySummary ?? undefined,
        },
      });
    });
  }

  async saveDraft(input: Record<string, unknown> & { conversationId: string; version?: number; draftId?: string; allowNewDraftAfterConfirm?: boolean }) {
    const version = input.version ?? 1;
    const draftHash = commercialDraftHash({ ...input, draftId: undefined, version });
    const expiresAt = new Date(Date.now() + 30 * 60_000);
    const data = {
      customerId: input.customerId as string | null,
      fulfillment: input.fulfillment as OrderTicketType,
      paymentPreference: input.paymentPreference as SofiaPaymentPreference,
      version,
      draftHash,
      expiresAt,
      deliveryAddress: input.address as string | null,
      addressConfirmedAt: input.addressConfirmed === true ? new Date() : null,
      itemsSnapshot: input.items as Prisma.InputJsonValue,
      subtotal: input.subtotal as number,
      deliveryFee: input.deliveryFee as number,
      total: input.total as number,
      deliveryQuoteAuditId: input.deliveryQuoteAuditId as string | null,
      deliveryQuoteVersion: input.deliveryQuoteVersion as number | null,
      deliveryQuoteExpiresAt: input.deliveryQuoteExpiresAt as Date | null,
      availabilitySnapshot: input.availabilitySnapshot as Prisma.InputJsonValue,
      availabilityCheckedAt: new Date(),
      missingFields: Prisma.JsonNull,
      status: SofiaOrderDraftStatus.READY_TO_CONFIRM,
    };
    if (!input.draftId) {
      const created = await this.prisma.sofiaOrderDraft.create({ data: { conversationId: input.conversationId, ...data } });
      return { id: created.id, version: created.version, draftHash: created.draftHash!, expiresAt: created.expiresAt! };
    }
    const updated = await this.prisma.sofiaOrderDraft.updateMany({ where: { id: input.draftId, version: version - 1, status: { in: [SofiaOrderDraftStatus.DRAFT, SofiaOrderDraftStatus.NEEDS_INFO, SofiaOrderDraftStatus.READY_TO_CONFIRM] } }, data });
    if (updated.count !== 1) {
      const prior = await this.prisma.sofiaOrderDraft.findUnique({ where: { id: input.draftId }, select: { status: true, version: true } });
      const priorConfirmedAtExpectedVersion = prior?.status === SofiaOrderDraftStatus.CONFIRMED && prior.version === version - 1;
      if (!priorConfirmedAtExpectedVersion) {
        throw new ConflictException({ code: 'STALE_DRAFT_VERSION' });
      }
      // SOFIA Round 5 / A26 CLOSURE (root cause #2, HIGH) — the tracked draft is legitimately
      // CONFIRMED at the exact version the caller expected. This IS the "start a new order after a
      // prior confirmed one" case -- but ONLY when the caller has explicitly asserted it via
      // `allowNewDraftAfterConfirm: true`, which `CommercialCheckoutService` only sets when its OWN,
      // non-stale `previous` read (captured at the top of `process()`, before any in-turn mutation)
      // already, truthfully knew this draft was confirmed. Without that explicit signal, silently
      // creating a new draft here is exactly the A25 lost-update bug: a caller that read a STALE
      // pre-confirmation snapshot has no idea its tracked draft was already confirmed, and spinning
      // off an independently-confirmable shadow draft would let a later honest "confirmo" produce a
      // SECOND confirmed commercial record for one continuous customer interaction. Fail closed:
      // surface this distinctly so the caller can recover (reload authoritative state, tell the
      // customer their order is already confirmed) instead of silently corrupting durable narration.
      if (input.allowNewDraftAfterConfirm !== true) {
        throw new DraftAlreadyConfirmedError(input.draftId!);
      }
      const created = await this.prisma.sofiaOrderDraft.create({ data: { conversationId: input.conversationId, ...data } });
      return { id: created.id, version: created.version, draftHash: created.draftHash!, expiresAt: created.expiresAt! };
    }
    return { id: input.draftId, version, draftHash, expiresAt };
  }

  async confirmDraft(input: { draftId: string; expectedVersion: number; expectedHash: string; confirmationHash: string }) {
    const updated = await this.prisma.sofiaOrderDraft.updateMany({
      where: { id: input.draftId, version: input.expectedVersion, draftHash: input.expectedHash, status: SofiaOrderDraftStatus.READY_TO_CONFIRM, expiresAt: { gt: new Date() } },
      data: { status: SofiaOrderDraftStatus.CONFIRMED, confirmedAt: new Date(), confirmationHash: input.confirmationHash },
    });
    if (updated.count !== 1) throw new ConflictException({ code: 'SOFIA_STALE_CONFIRMATION' });
    return { id: input.draftId, version: input.expectedVersion, status: 'CONFIRMED' };
  }

  // SOFIA Round 5 / A36 CLOSURE (A35 blind red-team finding, MEDIUM) — see interface docstring
  // (`commercial.repository.ts`). Deliberately the SAME direct, unlocked `findUnique` shape already
  // used internally by `saveDraft()`'s own CAS-conflict diagnosis (`prior` above) -- reused, not
  // reinvented.
  async loadDraftVersion(draftId: string) {
    const draft = await this.prisma.sofiaOrderDraft.findUnique({ where: { id: draftId }, select: { version: true, status: true } });
    return draft ? { version: draft.version, status: draft.status as string } : null;
  }

  /**
   * SOFIA Round 5 / A44 CLOSURE (A43 blind red-team finding, HIGH) — see interface docstring
   * (`commercial.repository.ts`). Same direct, unlocked `findUnique` discipline `loadDraftVersion()`
   * already uses — the caller (`respondDraftAlreadyConfirmed()`) only ever calls this once it already
   * independently knows (via `loadDraftVersion()`/`saveDraft()`'s own CAS) that this exact draft is
   * CONFIRMED, so there is no lost-update hazard in reading it directly here.
   */
  async loadConfirmedDraftRecord(draftId: string): Promise<CommercialConfirmedDraftRecord | null> {
    const draft = await this.prisma.sofiaOrderDraft.findUnique({ where: { id: draftId } });
    if (!draft) return null;
    return {
      id: draft.id,
      conversationId: draft.conversationId,
      version: draft.version,
      status: draft.status as string,
      draftHash: draft.draftHash,
      customerId: draft.customerId,
      fulfillment: draft.fulfillment as CommercialConfirmedDraftRecord['fulfillment'],
      paymentPreference: draft.paymentPreference as CommercialConfirmedDraftRecord['paymentPreference'],
      items: (draft.itemsSnapshot ?? []) as unknown as CommercialItem[],
      address: draft.deliveryAddress,
      addressConfirmed: draft.addressConfirmedAt !== null,
      subtotal: Number(draft.subtotal),
      deliveryFee: Number(draft.deliveryFee),
      total: Number(draft.total),
      deliveryQuoteAuditId: draft.deliveryQuoteAuditId,
      deliveryQuoteVersion: draft.deliveryQuoteVersion,
      deliveryQuoteExpiresAt: draft.deliveryQuoteExpiresAt ? draft.deliveryQuoteExpiresAt.toISOString() : null,
      availabilitySnapshot: (draft.availabilitySnapshot ?? []) as unknown as CommercialConfirmedDraftRecord['availabilitySnapshot'],
      expiresAt: draft.expiresAt ? draft.expiresAt.toISOString() : null,
    };
  }
}
