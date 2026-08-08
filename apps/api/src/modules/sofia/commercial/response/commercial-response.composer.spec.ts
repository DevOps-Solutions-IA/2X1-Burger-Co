import { CommercialResponseComposer } from './commercial-response.composer';
import { CommercialResponseValidator } from './commercial-response.validator';
import type { CommercialFactEnvelope, CommercialLanguageGenerator, CommercialResponsePurpose } from './commercial-response.types';
import { SafeCommercialResponseTemplates } from './safe-commercial-response.templates';

const baseFacts = (overrides: Partial<CommercialFactEnvelope> = {}): CommercialFactEnvelope => ({
  responsePurpose: 'SUMMARIZE_DRAFT',
  allowedFacts: ['DRAFT_ONLY', 'NO_OPERATIONAL_MUTATION'],
  allowedOptions: ['ONLINE', 'CASH_ON_DELIVERY'],
  forbiddenClaims: ['pedido ya creado', 'pago confirmado', 'descuento aplicado'],
  customerContextSafe: { preferredTone: 'NATURAL_CONCISE', locale: 'es-CO' },
  fulfillment: 'DELIVERY',
  paymentOptions: ['ONLINE', 'CASH_ON_DELIVERY'],
  items: [{ name: 'Combo 2x1', quantity: 1, unitPrice: 25000, modifiers: [], available: true }],
  subtotal: 25000,
  deliveryFee: 5000,
  total: 30000,
  addressSafe: 'Carrera 10',
  missingFields: [],
  confirmationRequired: true,
  handoffRequired: false,
  reasonCode: null,
  ...overrides,
});

const fixture = (outputs: Array<string | null>) => {
  let index = 0;
  const generator: CommercialLanguageGenerator = { compose: jest.fn(async () => outputs[index++] ?? null) };
  return {
    composer: new CommercialResponseComposer(generator, new CommercialResponseValidator(), new SafeCommercialResponseTemplates()),
    generator,
  };
};

describe('bounded commercial response composition', () => {
  it.each([
    'Perfecto, ¿lo pagas ahora en línea o al recoger?',
    'Listo. ¿Prefieres pagarlo en línea de una vez o cuando vengas por él?',
    'Bien, para recoger: ¿pagas ahora en línea o en el punto?',
  ])('accepts a controlled takeaway payment variation without changing options: %s', async (output) => {
    const facts = baseFacts({
      responsePurpose: 'ASK_PAYMENT', fulfillment: 'TAKEAWAY', paymentOptions: ['ONLINE', 'PAY_AT_PICKUP'],
      allowedOptions: ['ONLINE', 'PAY_AT_PICKUP'], subtotal: null, deliveryFee: null, total: null, addressSafe: null, items: [],
    });
    const { composer } = fixture([output]);
    await expect(composer.compose(facts)).resolves.toMatchObject({ text: output, source: 'BOUNDED_AI', validation: { valid: true } });
  });

  it.each([
    ['ASK_PAYMENT', 'Listo, ¿lo pagas ahora en línea o en efectivo cuando llegue?'],
    ['ASK_ADDRESS', 'Claro, ¿a qué dirección debemos enviarlo?'],
    ['SUMMARIZE_DRAFT', 'Te confirmo 1 Combo 2x1 para enviar a Carrera 10. Subtotal $25.000, domicilio $5.000 y total $30.000. ¿Confirmamos así?'],
    ['PRICE_CHANGED', 'El precio cambió. 1 Combo 2x1 para enviar a Carrera 10: subtotal $25.000, domicilio $5.000, total $30.000. ¿Confirmamos el valor actualizado?'],
    ['QUOTE_EXPIRED', 'La cotización venció. Revisé 1 Combo 2x1 para enviar a Carrera 10: subtotal $25.000, domicilio $5.000 y total $30.000. ¿Confirmamos de nuevo?'],
  ] as Array<[CommercialResponsePurpose, string]>)('preserves bounded facts for %s', async (responsePurpose, output) => {
    const facts = baseFacts({ responsePurpose });
    const { composer } = fixture([output]);
    await expect(composer.compose(facts)).resolves.toMatchObject({ source: 'BOUNDED_AI', validation: { valid: true } });
  });

  it.each([
    ['MODIFIER_UNSUPPORTED', 'Esa modificación no está habilitada. Puedo mostrarte las opciones disponibles.'],
    ['DISCOUNT_UNAVAILABLE', 'No tengo un descuento habilitado para este pedido.'],
    ['DEPENDENCY_FAILURE', 'Ahora no puedo confirmar los datos de forma segura. Prefiero no darte información incorrecta.'],
    ['HUMAN_HANDOFF', 'Voy a pasarte con el equipo para resolverlo de forma segura.'],
  ] as Array<[CommercialResponsePurpose, string]>)('supports a safe non-transactional variation for %s', async (responsePurpose, output) => {
    const facts = baseFacts({ responsePurpose, subtotal: null, deliveryFee: null, total: null, items: [], handoffRequired: responsePurpose === 'HUMAN_HANDOFF' });
    const { composer } = fixture([output]);
    await expect(composer.compose(facts)).resolves.toMatchObject({ source: 'BOUNDED_AI', validation: { valid: true } });
  });

  it.each([
    'Tu pedido ya está creado.',
    'Ya quedó pagado y recibimos el pago.',
    'Te hice un descuento de 20%.',
    'El domicilio cuesta $0.',
    'Tu pedido sale en 5 minutos.',
    'Puedes pagar con Nequi.',
    'Usé sandbox para procesarlo.',
    'La clave Authorization Bearer está lista.',
    'Te confirmo 1 Sushi galáctico: subtotal $25.000, domicilio $5.000 y total $30.000.',
    'Te confirmo 1 Combo 2x1: subtotal $25.000, domicilio $5.000 y total $30.000. Ya recibimos el pago.',
    'Te confirmo 1 Combo 2x1: subtotal $25.000, domicilio $5.000 y total $30.000. Tu pedido ya está creado.',
  ])('rejects unsafe provider output and executes the safe fallback: %s', async (output) => {
    const { composer } = fixture([output]);
    const result = await composer.compose(baseFacts());
    expect(result.source).toBe('SAFE_TEMPLATE');
    expect(result.validation.valid).toBe(true);
    expect(result.text).toContain('$25.000');
    expect(result.text).toContain('$5.000');
    expect(result.text).toContain('$30.000');
    expect(result.text).not.toBe(output);
  });

  it('rejects changed or missing monetary values and preserves exact es-CO formatting in fallback', async () => {
    const { composer } = fixture(['1 Combo 2x1: subtotal $25.001, domicilio $5.000 y total $30.001.']);
    const result = await composer.compose(baseFacts());
    expect(result).toMatchObject({ source: 'SAFE_TEMPLATE', validation: { valid: true } });
    expect(result.text).toEqual(expect.stringContaining('Subtotal $25.000'));
    expect(result.text).toEqual(expect.stringContaining('domicilio $5.000'));
    expect(result.text).toEqual(expect.stringContaining('total $30.000'));
  });

  it('passes an immutable typed envelope and exposes no mutation or tool surface', async () => {
    const generator: CommercialLanguageGenerator = {
      compose: jest.fn(async (facts) => {
        expect(Object.isFrozen(facts)).toBe(true);
        expect(Object.isFrozen(facts.items)).toBe(true);
        expect(Object.isFrozen(facts.items[0])).toBe(true);
        expect(Object.keys(facts)).not.toEqual(expect.arrayContaining(['draftId', 'draftHash', 'customerId', 'tool', 'command']));
        return 'Te confirmo 1 Combo 2x1 para enviar a Carrera 10. Subtotal $25.000, domicilio $5.000 y total $30.000. ¿Confirmamos así?';
      }),
    };
    const composer = new CommercialResponseComposer(generator, new CommercialResponseValidator(), new SafeCommercialResponseTemplates());
    await expect(composer.compose(baseFacts())).resolves.toMatchObject({ source: 'BOUNDED_AI' });
  });

  it('falls back when generation is unavailable', async () => {
    const { composer } = fixture([null]);
    await expect(composer.compose(baseFacts())).resolves.toMatchObject({ source: 'SAFE_TEMPLATE', validation: { valid: true } });
  });

  it('rejects payment and fulfillment questions that omit an allowed option', async () => {
    const takeaway = baseFacts({
      responsePurpose: 'ASK_PAYMENT', fulfillment: 'TAKEAWAY', paymentOptions: ['ONLINE', 'PAY_AT_PICKUP'],
      allowedOptions: ['ONLINE', 'PAY_AT_PICKUP'], subtotal: null, deliveryFee: null, total: null, addressSafe: null, items: [],
    });
    const payment = await fixture(['¿Quieres pagarlo en línea?']).composer.compose(takeaway);
    expect(payment.source).toBe('SAFE_TEMPLATE');

    const fulfillment = baseFacts({
      responsePurpose: 'ASK_FULFILLMENT', fulfillment: null, paymentOptions: [], allowedOptions: ['DELIVERY', 'TAKEAWAY'],
      subtotal: null, deliveryFee: null, total: null, addressSafe: null, items: [],
    });
    const mode = await fixture(['¿Quieres domicilio?']).composer.compose(fulfillment);
    expect(mode.source).toBe('SAFE_TEMPLATE');
  });
});
