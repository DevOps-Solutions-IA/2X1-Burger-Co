import { Injectable } from '@nestjs/common';
import type { CommercialFactEnvelope, CommercialResponseValidation } from './commercial-response.types';

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const monetaryPurposes = new Set(['SUMMARIZE_DRAFT', 'CONFIRM_DRAFT', 'PRICE_CHANGED', 'QUOTE_EXPIRED']);
const productPurposes = new Set(['SUMMARIZE_DRAFT', 'CONFIRM_DRAFT', 'PRICE_CHANGED', 'QUOTE_EXPIRED']);

const forbiddenPatterns: Array<[string, RegExp]> = [
  ['PAYMENT_CLAIM', /\b(pago (?:recibido|aprobado|confirmado)|ya (?:esta|quedo) pagad[oa]|marque? el pago|recibimos el pago|pago procesado)\b/i],
  ['ORDER_CLAIM', /\b(pedido (?:ya )?(?:(?:esta|quedo) )?(?:creado|registrado|generado)|ya cree? (?:tu |el )?pedido|creamos (?:tu |el )?pedido)\b/i],
  ['KITCHEN_CLAIM', /\b(cocina|preparacion|preparando|plancha|ticket de cocina)\b/i],
  ['ETA_CLAIM', /\b(?:sale|llega|estara listo|te llega)\s+(?:en\s+)?\d+\s*(?:minutos?|horas?)\b/i],
  ['DISCOUNT_CLAIM', /\b(?:descuento|rebaja|cupon)\s+(?:de\s+)?\d+\s*%|\bte hice (?:un )?descuento\b/i],
  ['SANDBOX_CLAIM', /\b(?:sandbox|mock|proveedor de prueba)\b/i],
  ['SECRET_LEAK', /\b(?:api[_ -]?key|access[_ -]?token|authorization|bearer|credenciales?|system prompt|instrucciones internas)\b/i],
  ['INTERNAL_METADATA', /\b(?:SOFIA_[A-Z0-9_]+|CRM_[A-Z0-9_]+|CASH_ON_DELIVERY|PAY_AT_PICKUP|DRAFT_ONLY|NO_OPERATIONAL_MUTATION)\b/],
  ['OPERATIONAL_ACTION', /\b(?:desconte|deduje|cobre|envie el whatsapp|asigne domiciliario|cree la venta)\b/i],
];

@Injectable()
export class CommercialResponseValidator {
  validate(text: string, facts: CommercialFactEnvelope): CommercialResponseValidation {
    const violations: string[] = [];
    const normalized = normalize(text.trim());
    if (!normalized || text.length > 700) violations.push('INVALID_LENGTH');

    for (const [code, pattern] of forbiddenPatterns) if (pattern.test(normalized)) violations.push(code);
    for (const claim of facts.forbiddenClaims) if (claim && normalized.includes(normalize(claim))) violations.push('FORBIDDEN_FACT');

    const expectedMoney = [facts.subtotal, facts.deliveryFee, facts.total].filter((value): value is number => value !== null);
    const mentionedMoney = [...text.matchAll(/\$\s*([\d.,]+)/g)].map((match) => Number(match[1]!.replace(/[.,]/g, '')));
    if (mentionedMoney.some((value) => !expectedMoney.includes(value))) violations.push('MONETARY_VALUE_CHANGED');
    if (monetaryPurposes.has(facts.responsePurpose) && expectedMoney.some((value) => !mentionedMoney.includes(value))) violations.push('MONETARY_VALUE_MISSING');

    if (productPurposes.has(facts.responsePurpose)) {
      for (const item of facts.items) {
        if (!normalized.includes(normalize(item.name))) violations.push('PRODUCT_MISSING');
        const quantityPattern = new RegExp(`(?:^|\\D)${item.quantity}(?:\\D|$)`);
        if (!quantityPattern.test(normalized)) violations.push('QUANTITY_MISMATCH');
      }
    }

    const paymentMentions: Array<[string, RegExp]> = [
      ['ONLINE', /\b(?:en linea|online|pagar ahora)\b/],
      ['CASH_ON_DELIVERY', /\b(?:efectivo cuando llegue|pago al recibir|domiciliario)\b/],
      ['PAY_AT_PICKUP', /\b(?:al recoger|cuando vengas|en el punto|en el local)\b/],
    ];
    for (const [option, pattern] of paymentMentions) {
      if (pattern.test(normalized) && !facts.paymentOptions.includes(option as never)) violations.push('UNSUPPORTED_PAYMENT_OPTION');
      if (['ASK_PAYMENT', 'CLARIFY_PAYMENT'].includes(facts.responsePurpose) && facts.paymentOptions.includes(option as never) && !pattern.test(normalized)) {
        violations.push('PAYMENT_OPTION_MISSING');
      }
    }
    if (/\b(?:nequi|daviplata|transferencia|tarjeta|paypal|criptomoneda)\b/.test(normalized)) violations.push('UNSUPPORTED_PAYMENT_OPTION');

    if (facts.fulfillment === 'TAKEAWAY' && /\b(?:te lo enviamos|para enviar|cuando llegue|domiciliario)\b/.test(normalized)) violations.push('FULFILLMENT_CHANGED');
    if (facts.fulfillment === 'DELIVERY' && /\b(?:recoger|recojas|vengas por|en el punto|en el local)\b/.test(normalized)) violations.push('FULFILLMENT_CHANGED');
    if (facts.responsePurpose === 'ASK_FULFILLMENT' && (!/\b(?:enviar|enviamos|domicilio|entrega)\b/.test(normalized) || !/\b(?:recoger|recoges|recogerlo|pasas por|retirar)\b/.test(normalized))) {
      violations.push('FULFILLMENT_OPTION_MISSING');
    }
    if (facts.items.some((item) => item.available === false) && /\b(?:disponible|confirmado|listo)\b/.test(normalized)) violations.push('AVAILABILITY_CLAIM');

    return Object.freeze({ valid: violations.length === 0, violations: Object.freeze([...new Set(violations)]) });
  }
}
