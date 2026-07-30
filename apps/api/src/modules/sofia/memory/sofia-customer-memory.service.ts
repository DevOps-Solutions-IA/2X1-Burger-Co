import { Injectable } from '@nestjs/common';
import { Prisma, SofiaMemoryConsentState } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SofiaMemorySnapshot, SofiaMemoryUpdateInput } from './sofia-memory.types';

@Injectable()
export class SofiaCustomerMemoryService {
  constructor(private readonly prisma: PrismaService) {}

  normalizePhone(phone: string) {
    return phone.replace(/[^\d+]/g, '').replace(/^\+/, '');
  }

  async resolveOrCreateMemory(phone: string, displayName?: string | null) {
    const phoneNormalized = this.normalizePhone(phone);
    const safeName = this.safeText(displayName);
    return this.prisma.sofiaCustomerMemory.upsert({
      where: { phoneNormalized },
      create: {
        phoneNormalized,
        displayName: safeName,
        consentState: SofiaMemoryConsentState.IMPLIED_BY_CONVERSATION,
        memorySummary: safeName ? `Cliente identificado como ${safeName}.` : null,
        lastInteractionAt: new Date(),
      },
      update: {
        displayName: safeName ?? undefined,
        lastInteractionAt: new Date(),
      },
    });
  }

  async getMemoryByPhone(phone: string): Promise<SofiaMemorySnapshot | null> {
    const memory = await this.prisma.sofiaCustomerMemory.findUnique({
      where: { phoneNormalized: this.normalizePhone(phone) },
    });
    return memory ? this.toSnapshot(memory) : null;
  }

  async updateFromInteraction(input: SofiaMemoryUpdateInput) {
    if (!input.phone) return null;
    const memory = await this.resolveOrCreateMemory(input.phone, input.displayName);
    const safeName = this.safeText(input.displayName);
    const safeAddress = this.safeText(input.address);
    const safePayment = this.safePaymentMethod(input.preferredPaymentMethod);
    const product = this.safeText(input.lastProductDiscussed);

    const preferences: Prisma.InputJsonValue | undefined = product
      ? {
          lastProductDiscussed: product,
          updatedAt: new Date().toISOString(),
        }
      : undefined;

    const updated = await this.prisma.sofiaCustomerMemory.update({
      where: { id: memory.id },
      data: {
        displayName: safeName ?? undefined,
        lastKnownAddress: safeAddress ?? undefined,
        preferredPaymentMethod: safePayment ?? undefined,
        preferencesJson: preferences,
        memorySummary: this.buildSummary({
          name: safeName ?? memory.displayName,
          address: safeAddress ?? memory.lastKnownAddress,
          payment: safePayment ?? memory.preferredPaymentMethod,
          product: product ?? this.productFromPreferences(memory.preferencesJson),
        }),
        lastInteractionAt: new Date(),
      },
    });

    return this.toSnapshot(updated);
  }

  async saveLastOrder(input: {
    phone?: string | null;
    orderSummary: Prisma.InputJsonValue;
    displayName?: string | null;
    address?: string | null;
    preferredPaymentMethod?: string | null;
  }) {
    if (!input.phone) return null;
    const memory = await this.resolveOrCreateMemory(input.phone, input.displayName);
    const updated = await this.prisma.sofiaCustomerMemory.update({
      where: { id: memory.id },
      data: {
        displayName: this.safeText(input.displayName) ?? undefined,
        lastKnownAddress: this.safeText(input.address) ?? undefined,
        preferredPaymentMethod: this.safePaymentMethod(input.preferredPaymentMethod) ?? undefined,
        lastOrderSummaryJson: this.sanitizeJson(input.orderSummary),
        memorySummary: this.buildSummary({
          name: this.safeText(input.displayName) ?? memory.displayName,
          address: this.safeText(input.address) ?? memory.lastKnownAddress,
          payment: this.safePaymentMethod(input.preferredPaymentMethod) ?? memory.preferredPaymentMethod,
          product: this.firstItemName(input.orderSummary),
        }),
        lastInteractionAt: new Date(),
      },
    });
    return this.toSnapshot(updated);
  }

  async repeatLastOrderSuggestion(phone?: string | null) {
    if (!phone) return null;
    const memory = await this.getMemoryByPhone(phone);
    if (!memory?.lastOrderSummary) {
      return {
        canRepeat: false,
        responseText: 'Todavía no tengo un pedido anterior confirmado para repetir. Si quieres, te ayudo a armarlo ahora.',
        memory,
      };
    }
    const lastName = this.firstItemName(memory.lastOrderSummary) ?? 'tu último pedido';
    return {
      canRepeat: true,
      responseText: `Tengo registrado que tu último pedido fue ${lastName}. ¿Quieres repetirlo igual o le agregamos papitas adicionales?`,
      memory,
    };
  }

  async recordCommercialRuleEvent(input: {
    conversationId?: string | null;
    customerMemoryId?: string | null;
    ruleCode: string;
    severity: string;
    actionTaken: string;
    details?: Prisma.InputJsonValue;
  }) {
    return this.prisma.sofiaCommercialRuleEvent.create({
      data: {
        conversationId: input.conversationId ?? null,
        customerMemoryId: input.customerMemoryId ?? null,
        ruleCode: input.ruleCode,
        severity: input.severity,
        actionTaken: input.actionTaken,
        detailsJson: input.details ?? Prisma.JsonNull,
      },
    });
  }

  toSnapshot(memory: {
    id: string;
    phoneNormalized: string;
    displayName: string | null;
    lastKnownAddress: string | null;
    preferredPaymentMethod: string | null;
    lastOrderSummaryJson: Prisma.JsonValue | null;
    preferencesJson: Prisma.JsonValue | null;
    memorySummary: string | null;
    consentState: SofiaMemoryConsentState;
    lastInteractionAt: Date | null;
  }): SofiaMemorySnapshot {
    return {
      id: memory.id,
      phoneMasked: this.maskPhone(memory.phoneNormalized),
      displayName: memory.displayName,
      lastKnownAddress: memory.lastKnownAddress,
      preferredPaymentMethod: memory.preferredPaymentMethod,
      lastOrderSummary: memory.lastOrderSummaryJson,
      preferences: memory.preferencesJson,
      memorySummary: memory.memorySummary,
      consentState: memory.consentState,
      lastInteractionAt: memory.lastInteractionAt?.toISOString() ?? null,
    };
  }

  private sanitizeJson(value: Prisma.InputJsonValue): Prisma.InputJsonValue {
    const text = JSON.stringify(value);
    if (this.looksSensitive(text)) return { blocked: true, reason: 'sensitive_payload_rejected' };
    return value;
  }

  private maskPhone(value: string) {
    const digits = value.replace(/\D/g, '');
    if (!digits) return 'No disponible';
    return `${'*'.repeat(Math.max(3, digits.length - 4))}${digits.slice(-4)}`;
  }

  private safeText(value?: string | null) {
    if (!value) return null;
    const trimmed = value.trim().slice(0, 180);
    if (!trimmed || this.looksSensitive(trimmed)) return null;
    return trimmed;
  }

  private safePaymentMethod(value?: string | null) {
    const normalized = this.safeText(value)?.toUpperCase();
    if (!normalized) return null;
    if (['CASH', 'NEQUI_MANUAL', 'ONLINE', 'EFECTIVO', 'NEQUI'].includes(normalized)) return normalized;
    return null;
  }

  private looksSensitive(value: string) {
    return /(API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE KEY|sk-[a-z0-9]|eyJ[a-z0-9_-]{12,})/i.test(value);
  }

  private buildSummary(input: { name?: string | null; address?: string | null; payment?: string | null; product?: string | null }) {
    const parts = [
      input.name ? `Cliente: ${input.name}` : null,
      input.address ? `Dirección conocida registrada.` : null,
      input.payment ? `Pago preferido: ${input.payment}` : null,
      input.product ? `Último interés/pedido: ${input.product}` : null,
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
  }

  private productFromPreferences(value: Prisma.JsonValue | null) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const product = (value as Record<string, unknown>).lastProductDiscussed;
    return typeof product === 'string' ? product : null;
  }

  private firstItemName(value: Prisma.JsonValue | Prisma.InputJsonValue | null) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const items = record.items;
    if (!Array.isArray(items)) return typeof record.name === 'string' ? record.name : null;
    const first = items[0];
    if (!first || typeof first !== 'object' || Array.isArray(first)) return null;
    const name = (first as Record<string, unknown>).name;
    return typeof name === 'string' ? name : null;
  }
}
