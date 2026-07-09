import { Injectable } from '@nestjs/common';
import { SofiaAIAnalysisOutput, SofiaAISnapshotProduct } from './sofia-ai-provider.adapter';

const FORBIDDEN_MAXI_CLAIM_TOKENS = [
  ['papas', 'familiares'],
  ['papas', 'grandes'],
  ['papas', 'para', 'todos'],
  ['porción', 'familiar', 'de', 'papas'],
  ['porcion', 'familiar', 'de', 'papas'],
  ['papitas', 'para', 'todos'],
  ['combo', 'familiar', 'con', 'papas', 'familiares'],
  ['papas', 'incluidas', 'para', 'todos'],
];

const FORBIDDEN_MAXI_CLAIMS = FORBIDDEN_MAXI_CLAIM_TOKENS.map((tokens) => tokens.join(' '));

@Injectable()
export class SofiaSafetyGuard {
  validate(input: {
    aiOutput: SofiaAIAnalysisOutput;
    normalizedMessage: string;
    availableProducts: SofiaAISnapshotProduct[];
    maxiFamilyCopy: string;
  }): SofiaAIAnalysisOutput {
    const { aiOutput, normalizedMessage, availableProducts, maxiFamilyCopy } = input;
    const diagnostics = [...aiOutput.diagnostics];
    const safetyFlags = [...aiOutput.safetyFlags];
    const forbiddenClaimsDetected = [
      ...aiOutput.forbiddenClaimsDetected,
      ...this.detectForbiddenMaxiClaims(aiOutput.suggestedReply ?? ''),
    ];
    const replyText = aiOutput.suggestedReply ?? '';
    const mentionsPaymentPaid = /\b(pagado|paid|pago recibido|ya quedo pagado|ya quedó pagado)\b/i.test(replyText);
    const paymentSensitiveInput =
      /\b(nequi|comprobante|transferencia|consignacion|consignación|ya pague|ya pagué|pague|pagué)\b/i.test(
        normalizedMessage,
      );
    const humanRequestedInput =
      /\b(hablar con alguien|hablar con una persona|asesor|humano|persona|atencion humana|atención humana)\b/i.test(
        normalizedMessage,
      );
    const unknownProductInput = /\b(sushi)\b/i.test(normalizedMessage);
    const productValidation = this.validateExtractedProducts(aiOutput, availableProducts);

    let next: SofiaAIAnalysisOutput = {
      ...aiOutput,
      extractedItems: productValidation.items,
      safetyFlags,
      forbiddenClaimsDetected,
      diagnostics,
    };

    if (productValidation.blocked) {
      next = {
        ...next,
        confidence: Math.min(next.confidence, 0.4),
        suggestedReply: 'Déjame confirmarlo con el equipo para no darte información incorrecta.',
        shouldCreateDraft: false,
        shouldCreateOrder: false,
        shouldGeneratePaymentLink: false,
        shouldHandoff: true,
        handoffReason: 'AI_SAFETY_BLOCKED_PRODUCT',
        safetyFlags: [...next.safetyFlags, 'AI_SAFETY_BLOCKED_PRODUCT'],
        diagnostics: [...next.diagnostics, 'AI_SAFETY_BLOCKED:product'],
      };
    }

    if (mentionsPaymentPaid || next.shouldCreateOrder || next.shouldGeneratePaymentLink) {
      next = {
        ...next,
        suggestedReply: mentionsPaymentPaid ? 'El pago solo puede confirmarlo el sistema o el equipo autorizado.' : next.suggestedReply,
        shouldCreateOrder: false,
        shouldGeneratePaymentLink: false,
        safetyFlags: [...next.safetyFlags, mentionsPaymentPaid ? 'AI_SAFETY_BLOCKED_PAYMENT' : 'AI_CRITICAL_ACTION_BLOCKED'],
        diagnostics: [...next.diagnostics, 'AI_SAFETY_BLOCKED:critical-action'],
      };
    }

    if (paymentSensitiveInput) {
      next = {
        ...next,
        confidence: Math.min(next.confidence, 0.5),
        suggestedReply: 'El pago debe revisarlo el equipo autorizado antes de confirmar tu pedido.',
        shouldCreateDraft: false,
        shouldCreateOrder: false,
        shouldGeneratePaymentLink: false,
        shouldHandoff: true,
        handoffReason: 'PAYMENT_SENSITIVE',
        safetyFlags: [...next.safetyFlags, 'PAYMENT_SENSITIVE'],
        diagnostics: [...next.diagnostics, 'AI_SAFETY_BLOCKED:payment-sensitive-input'],
      };
    }

    if (humanRequestedInput) {
      next = {
        ...next,
        shouldCreateDraft: false,
        shouldCreateOrder: false,
        shouldGeneratePaymentLink: false,
        shouldHandoff: true,
        handoffReason: 'CUSTOMER_REQUESTED_HUMAN',
        safetyFlags: [...next.safetyFlags, 'HUMAN_REQUIRED'],
        diagnostics: [...next.diagnostics, 'AI_HANDOFF_REQUIRED:customer-requested-human'],
      };
    }

    if (unknownProductInput) {
      next = {
        ...next,
        confidence: Math.min(next.confidence, 0.4),
        suggestedReply: 'Ese producto no aparece en nuestro catálogo. Déjame confirmarlo con el equipo para no darte información incorrecta.',
        shouldCreateDraft: false,
        shouldCreateOrder: false,
        shouldGeneratePaymentLink: false,
        shouldHandoff: true,
        handoffReason: 'UNKNOWN_PRODUCT',
        safetyFlags: [...next.safetyFlags, 'UNKNOWN_PRODUCT'],
        diagnostics: [...next.diagnostics, 'AI_SAFETY_BLOCKED:unknown-product'],
      };
    }

    if (this.isMaxiFamilyContext(normalizedMessage, next.suggestedReply) || forbiddenClaimsDetected.length) {
      next = this.enforceMaxiFamilyCopy(next, maxiFamilyCopy, forbiddenClaimsDetected);
    }

    if (next.confidence < 0.45) {
      next = {
        ...next,
        shouldHandoff: true,
        handoffReason: next.handoffReason ?? 'LOW_CONFIDENCE',
        diagnostics: [...next.diagnostics, 'AI_HANDOFF_REQUIRED'],
      };
    }

    return next;
  }

  forbiddenMaxiClaims() {
    return [...FORBIDDEN_MAXI_CLAIMS];
  }

  private validateExtractedProducts(aiOutput: SofiaAIAnalysisOutput, availableProducts: SofiaAISnapshotProduct[]) {
    const normalizedProducts = availableProducts.map((product) => ({
      ...product,
      normalizedName: this.normalize(product.name),
    }));
    let blocked = false;
    const items = aiOutput.extractedItems
      .map((item) => {
        const match = item.productId
          ? normalizedProducts.find((product) => product.id === item.productId)
          : normalizedProducts.find((product) => product.normalizedName === this.normalize(item.name));
        if (!match || !match.available) {
          blocked = true;
          return null;
        }
        if (item.unitPrice != null && Number(item.unitPrice) !== match.price) {
          blocked = true;
        }
        return {
          productId: match.id,
          name: match.name,
          quantity: Math.max(1, Number(item.quantity) || 1),
          unitPrice: match.price,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    return { blocked, items };
  }

  private enforceMaxiFamilyCopy(aiOutput: SofiaAIAnalysisOutput, maxiFamilyCopy: string, forbiddenClaimsDetected: string[]) {
    const base = `El Maxi Family trae ${maxiFamilyCopy}. Si quieres más acompañamiento, te puedo agregar porciones adicionales.`;
    return {
      ...aiOutput,
      suggestedReply: base,
      forbiddenClaimsDetected,
      safetyFlags: forbiddenClaimsDetected.length ? [...aiOutput.safetyFlags, 'MAXI_FAMILY_COPY_CORRECTED'] : aiOutput.safetyFlags,
      diagnostics: [...aiOutput.diagnostics, 'AI_SAFETY_MAXI_FAMILY_COPY'],
    };
  }

  private detectForbiddenMaxiClaims(value: string) {
    const normalized = this.normalize(value);
    return FORBIDDEN_MAXI_CLAIMS.filter((phrase) => normalized.includes(this.normalize(phrase)));
  }

  private isMaxiFamilyContext(normalizedMessage: string, suggestedReply: string | null) {
    return /\b(maxi|family|familiar)\b/.test(normalizedMessage) || this.normalize(suggestedReply ?? '').includes('maxi family');
  }

  private normalize(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }
}
