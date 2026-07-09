import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  SOFIA_AUTO_SAFE_COMPLAINT_TERMS,
  SOFIA_AUTO_SAFE_FORBIDDEN_MAXI_CLAIMS,
  SOFIA_AUTO_SAFE_REQUIRED_MAXI_COPY,
  SOFIA_AUTO_SAFE_SENSITIVE_PAYMENT_TERMS,
} from './sofia-auto-safe.constants';
import { SOFIA_AUTO_SAFE_POLICY } from './sofia-auto-safe-policy';
import {
  SofiaAutoSafeDecision,
  SofiaAutoSafeDecisionStatus,
  SofiaAutoSafeInput,
  SofiaAutoSafeReasonCode,
  SofiaAutoSafeRiskLevel,
} from './sofia-auto-safe.types';

type RuleHit = {
  code: SofiaAutoSafeReasonCode;
  status: SofiaAutoSafeDecisionStatus;
  risk: SofiaAutoSafeRiskLevel;
  message: string;
};

@Injectable()
export class SofiaAutoSafeEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  policyMatrix() {
    return SOFIA_AUTO_SAFE_POLICY;
  }

  async evaluate(input: SofiaAutoSafeInput): Promise<SofiaAutoSafeDecision> {
    const hits = this.evaluateRules(input);
    const finalHit = this.resolveFinalHit(hits);
    const approved = finalHit.status === 'AUTO_SAFE_APPROVED';
    const shouldSend = approved && !input.isSandbox && input.channelMode === 'auto_safe';
    const decision: SofiaAutoSafeDecision = {
      status: finalHit.status,
      riskLevel: finalHit.risk,
      approved,
      shouldSend,
      shouldCreateOutbox: shouldSend,
      shouldRequireHuman: finalHit.status === 'HUMAN_REQUIRED',
      reasonCodes: this.unique(hits.map((hit) => hit.code)),
      blockingReasons: hits.filter((hit) => hit.status === 'BLOCKED' || hit.status === 'HUMAN_REQUIRED').map((hit) => hit.message),
      warnings: [
        ...(input.isSandbox ? ['SANDBOX_ONLY: no WhatsApp real enviado.'] : []),
        ...hits.filter((hit) => hit.status === 'DRAFT_ONLY').map((hit) => hit.message),
      ],
      correctedReply: null,
      finalReply: finalHit.status === 'BLOCKED' ? null : input.candidateReply,
      requiredHumanAction: finalHit.status === 'HUMAN_REQUIRED' ? 'Revisar conversación antes de responder.' : null,
      auditJson: this.buildAuditJson(input, hits, finalHit),
      createdAt: new Date().toISOString(),
    };

    const event = await this.persistDecision(input, decision);
    return { ...decision, eventId: event.id };
  }

  buildInputFromCandidate(input: Omit<SofiaAutoSafeInput, 'autoSafeEnabled' | 'secretRotationPending' | 'qrReady' | 'deepSeekReady'> & {
    autoSafeEnabled?: boolean;
    secretRotationPending?: boolean;
    qrReady?: boolean;
    deepSeekReady?: boolean;
  }): SofiaAutoSafeInput {
    return {
      ...input,
      autoSafeEnabled: input.autoSafeEnabled ?? this.configService.get<boolean>('SOFIA_AUTO_SAFE_ENABLED') === true,
      secretRotationPending: input.secretRotationPending ?? false,
      qrReady: input.qrReady ?? false,
      deepSeekReady: input.deepSeekReady ?? false,
    };
  }

  private evaluateRules(input: SofiaAutoSafeInput): RuleHit[] {
    const hits: RuleHit[] = [];
    const message = this.normalize(input.messageText);
    const reply = this.normalize(input.candidateReply);
    const minConfidence = input.minConfidence ?? this.configService.get<number>('SOFIA_AI_MIN_CONFIDENCE') ?? 0.82;
    const orderLike = this.isOrderLike(input.intent, message);
    const hasKnownProduct = input.productsMentioned.some((product) => product.known !== false) || input.catalogItems.length > 0;

    if (!input.autoSafeEnabled) {
      hits.push(this.hit('AUTO_SAFE_DISABLED', 'DRAFT_ONLY', 'MEDIUM', 'Auto Safe está deshabilitado para envío real.'));
    }
    if (input.secretRotationPending && !input.isSandbox) {
      hits.push(this.hit('SECRET_ROTATION_PENDING', 'BLOCKED', 'CRITICAL', 'Rotación externa de secretos pendiente.'));
    }
    if (!input.isSandbox && !input.qrReady) {
      hits.push(this.hit('QR_NOT_READY', 'BLOCKED', 'CRITICAL', 'QR Gateway no está listo.'));
    }
    if (!input.isSandbox && !input.deepSeekReady && input.channelMode === 'auto_safe') {
      hits.push(this.hit('DEEPSEEK_NOT_READY', 'HUMAN_REQUIRED', 'HIGH', 'DeepSeek real no está listo para operación automática.'));
    }
    if (input.isHumanTaken || input.conversationState === 'HUMAN_TAKEN') {
      hits.push(this.hit('HUMAN_TAKEN', 'HUMAN_REQUIRED', 'HIGH', 'Conversación tomada por humano.'));
    }
    if (input.isSofiaPaused || input.conversationState === 'SOFIA_PAUSED') {
      hits.push(this.hit('SOFIA_PAUSED', 'HUMAN_REQUIRED', 'HIGH', 'Sofía está pausada.'));
    }
    if (input.intent === 'ASK_HUMAN' || /\b(humano|asesor|persona|alguien)\b/.test(message)) {
      hits.push(this.hit('HUMAN_REQUESTED', 'HUMAN_REQUIRED', 'HIGH', 'Cliente pidió humano.'));
    }
    if (input.safetyGuardResult.blocked || input.safetyGuardResult.safetyFlags?.some((flag) => flag.startsWith('AI_SAFETY_BLOCKED'))) {
      hits.push(this.hit('SAFETY_GUARD_BLOCKED', 'BLOCKED', 'CRITICAL', 'SafetyGuard bloqueó la respuesta.'));
    }
    if (input.confidence < minConfidence) {
      hits.push(this.hit('LOW_CONFIDENCE', 'HUMAN_REQUIRED', 'HIGH', `Confianza ${input.confidence} menor a ${minConfidence}.`));
    }
    if (orderLike && !hasKnownProduct) {
      hits.push(this.hit('UNKNOWN_PRODUCT', 'HUMAN_REQUIRED', 'HIGH', 'No hay producto/catálogo reconocido para la intención de pedido.'));
    }
    if (this.hasUnknownPriceRisk(input)) {
      hits.push(this.hit('UNKNOWN_PRICE', 'HUMAN_REQUIRED', 'HIGH', 'La respuesta puede contener precio no validado.'));
    }
    if (/\b(promo|promocion|promoción|descuento|gratis|regalo|oferta especial)\b/.test(reply) && !input.catalogItems.length) {
      hits.push(this.hit('INVENTED_PROMOTION', 'BLOCKED', 'CRITICAL', 'Promoción no respaldada por catálogo.'));
    }
    if (this.hasMaxiFamilyRisk(input.candidateReply)) {
      hits.push(this.hit('MAXI_FAMILY_COPY_RISK', 'BLOCKED', 'CRITICAL', 'Copy de Maxi Family incompleto o con frase prohibida.'));
    }
    const paidClaimDetected = this.hasPaidClaim(message) || this.hasPaidClaim(reply);
    const paymentVerificationDetected = paidClaimDetected || this.hasPaymentVerificationClaim(message);
    if (this.hasPaidClaim(reply)) {
      hits.push(this.hit('PAID_CLAIM_BLOCKED', 'BLOCKED', 'CRITICAL', 'La respuesta afirma pago confirmado.'));
    }
    if (this.containsAny(message, SOFIA_AUTO_SAFE_SENSITIVE_PAYMENT_TERMS) && paymentVerificationDetected) {
      hits.push(this.hit('PAYMENT_SENSITIVE', 'HUMAN_REQUIRED', 'HIGH', 'Mensaje contiene pago sensible o verificación de pago.'));
      if (/\b(nequi|efectivo|transferencia)\b/.test(message)) {
        hits.push(this.hit('CASH_OR_NEQUI_VERIFICATION_REQUIRED', 'HUMAN_REQUIRED', 'HIGH', 'Pago manual requiere verificación operativa.'));
      }
    }
    if (this.containsAny(message, SOFIA_AUTO_SAFE_COMPLAINT_TERMS)) {
      hits.push(this.hit('CUSTOMER_COMPLAINT', 'HUMAN_REQUIRED', 'HIGH', 'Mensaje parece queja o reclamo.'));
    }
    if (/\b(bravo|enojado|molesto|furioso)\b/.test(message)) {
      hits.push(this.hit('CUSTOMER_ANGRY', 'HUMAN_REQUIRED', 'HIGH', 'Cliente molesto detectado.'));
    }
    if (input.missingFields.includes('deliveryAddress')) {
      hits.push(this.hit('ADDRESS_MISSING', 'DRAFT_ONLY', 'MEDIUM', 'Falta dirección para pedido.'));
    }
    if (input.missingFields.includes('customerName')) {
      hits.push(this.hit('CUSTOMER_NAME_MISSING', 'DRAFT_ONLY', 'MEDIUM', 'Falta nombre de cliente.'));
    }
    if (orderLike && input.intent !== 'CONFIRM_ORDER') {
      hits.push(this.hit('ORDER_CONFIRMATION_MISSING', 'DRAFT_ONLY', 'MEDIUM', 'Pedido no tiene confirmación explícita.'));
    }
    if (input.businessStatus?.isOpen === false) {
      hits.push(this.hit('OUTSIDE_HOURS', 'DRAFT_ONLY', 'MEDIUM', 'Fuera de horario operativo.'));
    }
    if (input.metadata && this.normalize(JSON.stringify(input.metadata)).includes('memory_uncertain')) {
      hits.push(this.hit('MEMORY_UNCERTAIN', 'HUMAN_REQUIRED', 'HIGH', 'Memoria incierta.'));
    }

    if (!hits.some((hit) => hit.code !== 'SANDBOX_ONLY')) {
      hits.push(this.hit('PASS_ALL_RULES', 'AUTO_SAFE_APPROVED', 'LOW', 'Todas las reglas pasaron.'));
    } else if (!hits.some((hit) => ['BLOCKED', 'HUMAN_REQUIRED', 'DRAFT_ONLY'].includes(hit.status))) {
      hits.push(this.hit('PASS_ALL_RULES', 'AUTO_SAFE_APPROVED', 'LOW', 'Todas las reglas pasaron.'));
    }

    if (hits.length === 0 || hits.every((hit) => hit.code === 'PASS_ALL_RULES')) {
      return [this.hit('PASS_ALL_RULES', 'AUTO_SAFE_APPROVED', 'LOW', 'Todas las reglas pasaron.')];
    }
    return hits;
  }

  private resolveFinalHit(hits: RuleHit[]): RuleHit {
    const blocked = hits.find((hit) => hit.status === 'BLOCKED');
    if (blocked) return { ...blocked, status: 'BLOCKED', risk: this.highestRisk(hits) };
    const human = hits.find((hit) => hit.status === 'HUMAN_REQUIRED');
    if (human) return { ...human, status: 'HUMAN_REQUIRED', risk: this.highestRisk(hits) };
    const draft = hits.find((hit) => hit.status === 'DRAFT_ONLY');
    if (draft) return { ...draft, status: 'DRAFT_ONLY', risk: this.highestRisk(hits) };
    return this.hit('PASS_ALL_RULES', 'AUTO_SAFE_APPROVED', 'LOW', 'Todas las reglas pasaron.');
  }

  private async persistDecision(input: SofiaAutoSafeInput, decision: SofiaAutoSafeDecision) {
    return this.prisma.sofiaAutoSafeDecisionEvent.create({
      data: {
        conversationId: input.conversationId ?? null,
        customerMemoryId: input.customerMemoryId ?? null,
        promptVersionId: input.promptVersionId ?? null,
        status: decision.status,
        riskLevel: decision.riskLevel,
        approved: decision.approved,
        shouldSend: decision.shouldSend,
        reasonCodesJson: decision.reasonCodes,
        blockingReasonsJson: decision.blockingReasons,
        warningsJson: decision.warnings,
        inputSummaryJson: this.inputSummary(input),
        outputSummaryJson: this.outputSummary(input, decision),
        safetyGuardSummaryJson: input.safetyGuardResult as Prisma.InputJsonValue,
        finalReplyPreview: decision.finalReply?.slice(0, 240) ?? null,
        channelMode: input.channelMode,
        isSandbox: input.isSandbox,
      },
    });
  }

  private inputSummary(input: SofiaAutoSafeInput): Prisma.InputJsonValue {
    return {
      conversationId: input.conversationId ?? null,
      phoneHash: input.phoneNormalized ? this.hashLite(input.phoneNormalized) : null,
      intent: input.intent,
      confidence: input.confidence,
      missingFields: input.missingFields,
      catalogItems: input.catalogItems.map((item) => ({ slug: item.slug, priceSource: item.priceSource, hasPrice: item.price != null })),
      channelMode: input.channelMode,
      isSandbox: input.isSandbox,
      flags: {
        humanTaken: input.isHumanTaken,
        sofiaPaused: input.isSofiaPaused,
        autoSafeEnabled: input.autoSafeEnabled,
        qrReady: input.qrReady,
        deepSeekReady: input.deepSeekReady,
      },
    };
  }

  private outputSummary(input: SofiaAutoSafeInput, decision: SofiaAutoSafeDecision): Prisma.InputJsonValue {
    return {
      status: decision.status,
      approved: decision.approved,
      shouldSend: decision.shouldSend,
      responseLength: input.candidateReply.length,
      finalReplyPresent: Boolean(decision.finalReply),
    };
  }

  private hasMaxiFamilyRisk(candidateReply: string) {
    const normalized = this.normalize(candidateReply);
    if (!normalized.includes('maxi family')) return false;
    const hasRequired = normalized.includes(this.normalize(SOFIA_AUTO_SAFE_REQUIRED_MAXI_COPY));
    const hasForbidden = SOFIA_AUTO_SAFE_FORBIDDEN_MAXI_CLAIMS.some((claim) => normalized.includes(this.normalize(claim)));
    return !hasRequired || hasForbidden;
  }

  private hasUnknownPriceRisk(input: SofiaAutoSafeInput) {
    if (!/\$|\b(cop|pesos|vale|cuesta|precio)\b/i.test(input.candidateReply)) return false;
    const hasValidatedPrice = input.productsMentioned.some((product) => product.price != null) || input.catalogItems.some((item) => item.price != null);
    return !hasValidatedPrice;
  }

  private hasPaidClaim(normalizedValue: string) {
    return /\b(ya pague|ya pagué|pague|pagué|pagado|paid|pago confirmado|confirmado pago|ya quedo pago|ya quedó pago|ya esta pago|ya está pago)\b/.test(
      this.normalize(normalizedValue),
    );
  }

  private hasPaymentVerificationClaim(normalizedValue: string) {
    return /\b(comprobante|recibo|capture|captura|transferi|transferí)\b/.test(this.normalize(normalizedValue));
  }

  private isOrderLike(intent: string, normalizedMessage: string) {
    if (['ORDER_ITEM', 'ADD_ITEM', 'MODIFY_QUANTITY', 'CONFIRM_ORDER'].includes(intent)) return true;
    return /\b(quiero|kiero|deme|dame|pedido|agrega|añade|anade)\b/.test(normalizedMessage);
  }

  private hit(code: SofiaAutoSafeReasonCode, status: SofiaAutoSafeDecisionStatus, risk: SofiaAutoSafeRiskLevel, message: string): RuleHit {
    return { code, status, risk, message };
  }

  private highestRisk(hits: RuleHit[]): SofiaAutoSafeRiskLevel {
    const order: SofiaAutoSafeRiskLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    return hits.reduce<SofiaAutoSafeRiskLevel>((current, hit) => (order.indexOf(hit.risk) > order.indexOf(current) ? hit.risk : current), 'LOW');
  }

  private containsAny(normalizedValue: string, needles: string[]) {
    const normalized = this.normalize(normalizedValue);
    return needles.some((needle) => normalized.includes(this.normalize(needle)));
  }

  private unique<T>(items: T[]) {
    return [...new Set(items)];
  }

  private normalize(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private hashLite(value: string) {
    let hash = 0;
    for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return hash.toString(16);
  }

  private buildAuditJson(input: SofiaAutoSafeInput, hits: RuleHit[], finalHit: RuleHit): Prisma.JsonValue {
    return {
      policyVersion: 'SOFIA_AUTO_SAFE_POLICY_V1',
      finalStatus: finalHit.status,
      finalRisk: finalHit.risk,
      reasonCodes: hits.map((hit) => hit.code),
      isSandbox: input.isSandbox,
      noWhatsappRealSent: true,
    };
  }
}
