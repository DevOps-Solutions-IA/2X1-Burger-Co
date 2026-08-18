import { SofiaSafetyGuard } from './sofia-ai-safety.guard';
import { SofiaAIAnalysisOutput, SofiaAISnapshotProduct } from './sofia-ai-provider.adapter';

const MAXI_FAMILY_COPY = '6 burgers + 1 porción personal de papitas + 1 Pepsi 1.5 L';

function baseOutput(overrides: Partial<SofiaAIAnalysisOutput> = {}): SofiaAIAnalysisOutput {
  return {
    provider: 'deepseek',
    mode: 'suggest',
    intent: 'ORDER_ITEM',
    confidence: 0.9,
    extractedItems: [],
    missingFields: [],
    suggestedReply: 'Claro, aquí tienes tu pedido.',
    suggestedUpsell: null,
    shouldCreateDraft: true,
    shouldCreateOrder: false,
    shouldGeneratePaymentLink: false,
    shouldHandoff: false,
    handoffReason: null,
    safetyFlags: [],
    forbiddenClaimsDetected: [],
    fallbackUsed: false,
    diagnostics: [],
    ...overrides,
  };
}

const AVAILABLE_PRODUCTS: SofiaAISnapshotProduct[] = [
  { id: 'prod-1', code: 'BURGER-01', name: 'Burger Clásica', price: 15000, available: true },
];

describe('SofiaSafetyGuard', () => {
  const guard = new SofiaSafetyGuard();

  it('allows a reply with no risk signals through unchanged (except item validation)', () => {
    const result = guard.validate({
      aiOutput: baseOutput(),
      normalizedMessage: 'quiero una burger clasica',
      availableProducts: AVAILABLE_PRODUCTS,
      maxiFamilyCopy: MAXI_FAMILY_COPY,
    });

    expect(result.shouldHandoff).toBe(false);
    expect(result.safetyFlags).toEqual([]);
    expect(result.suggestedReply).toBe('Claro, aquí tienes tu pedido.');
  });

  it('blocks an AI-claimed payment confirmation and forces handoff-safe copy', () => {
    const result = guard.validate({
      aiOutput: baseOutput({ suggestedReply: 'Listo, tu pago quedó pagado.' }),
      normalizedMessage: 'confirmame mi pedido',
      availableProducts: AVAILABLE_PRODUCTS,
      maxiFamilyCopy: MAXI_FAMILY_COPY,
    });

    expect(result.safetyFlags).toContain('AI_SAFETY_BLOCKED_PAYMENT');
    expect(result.suggestedReply).toBe('El pago solo puede confirmarlo el sistema o el equipo autorizado.');
    expect(result.shouldCreateOrder).toBe(false);
    expect(result.shouldGeneratePaymentLink).toBe(false);
  });

  it('blocks an extracted item that does not match the catalog snapshot', () => {
    const result = guard.validate({
      aiOutput: baseOutput({
        extractedItems: [{ productId: null, name: 'Sushi Roll', quantity: 1, unitPrice: null }],
      }),
      normalizedMessage: 'quiero sushi',
      availableProducts: AVAILABLE_PRODUCTS,
      maxiFamilyCopy: MAXI_FAMILY_COPY,
    });

    expect(result.safetyFlags).toContain('AI_SAFETY_BLOCKED_PRODUCT');
    expect(result.shouldHandoff).toBe(true);
    expect(result.extractedItems).toEqual([]);
    expect(result.confidence).toBeLessThanOrEqual(0.4);
  });

  it('requires human handoff when the customer explicitly asks for a person', () => {
    const result = guard.validate({
      aiOutput: baseOutput(),
      normalizedMessage: 'quiero hablar con un humano',
      availableProducts: AVAILABLE_PRODUCTS,
      maxiFamilyCopy: MAXI_FAMILY_COPY,
    });

    expect(result.shouldHandoff).toBe(true);
    expect(result.handoffReason).toBe('CUSTOMER_REQUESTED_HUMAN');
    expect(result.safetyFlags).toContain('HUMAN_REQUIRED');
  });

  it('corrects a forbidden Maxi Family claim to the authorized copy', () => {
    const result = guard.validate({
      aiOutput: baseOutput({ suggestedReply: 'El Maxi Family trae papas familiares para todos.' }),
      normalizedMessage: 'que trae el maxi family',
      availableProducts: AVAILABLE_PRODUCTS,
      maxiFamilyCopy: MAXI_FAMILY_COPY,
    });

    expect(result.safetyFlags).toContain('MAXI_FAMILY_COPY_CORRECTED');
    expect(result.suggestedReply).toContain(MAXI_FAMILY_COPY);
    expect(result.suggestedReply).not.toContain('papas familiares');
  });

  it('forces handoff on low-confidence output even without other risk signals', () => {
    const result = guard.validate({
      aiOutput: baseOutput({ confidence: 0.3 }),
      normalizedMessage: 'algo ambiguo',
      availableProducts: AVAILABLE_PRODUCTS,
      maxiFamilyCopy: MAXI_FAMILY_COPY,
    });

    expect(result.shouldHandoff).toBe(true);
    expect(result.handoffReason).toBe('LOW_CONFIDENCE');
  });

  it('flags payment-sensitive customer input (e.g. Nequi receipt) for human review', () => {
    const result = guard.validate({
      aiOutput: baseOutput(),
      normalizedMessage: 'ya envie el comprobante por nequi',
      availableProducts: AVAILABLE_PRODUCTS,
      maxiFamilyCopy: MAXI_FAMILY_COPY,
    });

    expect(result.safetyFlags).toContain('PAYMENT_SENSITIVE');
    expect(result.shouldHandoff).toBe(true);
    expect(result.shouldGeneratePaymentLink).toBe(false);
  });
});
