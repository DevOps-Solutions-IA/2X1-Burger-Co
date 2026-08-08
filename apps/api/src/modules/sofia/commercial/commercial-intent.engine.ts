import { Injectable } from '@nestjs/common';
import type { CommercialConfidence, CommercialIntent, CommercialModifier, CommercialPaymentPreference, LastQuestionPurpose } from './commercial.types';

export function normalizeCommercialText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9#\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

const quantities: Record<string, number> = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 };

@Injectable()
export class CommercialIntentEngine {
  interpret(message: string, lastQuestion: LastQuestionPurpose) {
    const text = normalizeCommercialText(message);
    const adversarial = /ignora (las|tus) reglas|precio cero|gratis|marca el pago|finge que|credenciales|ejecuta sql|usa sandbox|salta la confirmacion|crea el pedido aunque|haz dos pedidos|cambia el precio/.test(text);
    if (adversarial) return { intent: 'ASK_HUMAN' as const, confidence: 'LOW' as const, fulfillment: null, paymentPreference: 'UNKNOWN' as const, quantity: null, modifiers: [], clearModifiers: false, address: null, affirmative: false, negative: false, adversarial: true, normalized: text };

    const affirmative = /^(si|sí|claro|correcto|confirmo|dale|listo)$/.test(text);
    const negative = /^(no|cancela|cancelar|mejor no)$/.test(text);
    let intent: CommercialIntent = /humano|asesor|persona|equipo/.test(text) ? 'ASK_HUMAN' : /confirmo|confirmamos|asi esta bien/.test(text) ? 'CONFIRM' : /mejor|cambia|quita|agrega|dejala|dejalo/.test(text) ? 'CHANGE_ORDER' : /quiero|dame|mandame|enviame|combo|hamburguesa|2x1|pedido/.test(text) ? 'PURCHASE' : 'UNKNOWN';
    if (affirmative && lastQuestion === 'CONFIRM_ORDER') intent = 'CONFIRM';
    if (negative && lastQuestion === 'CONFIRM_ORDER') intent = 'REJECT';

    const fulfillment = /lo recojo|las recojo|paso por|voy por|retiro|voy al local/.test(text)
      ? 'TAKEAWAY' as const
      : /mandame|mándame|enviame|domicilio|a la casa|me lo mandas|mejor enviamelo/.test(text)
        ? 'DELIVERY' as const
        : affirmative && lastQuestion === 'FULFILLMENT' ? null : null;

    let paymentPreference: CommercialPaymentPreference = 'UNKNOWN';
    if (/pago cuando llegue|al domiciliario|pago al recibir|cuando me lo entreguen/.test(text)) paymentPreference = 'CASH_ON_DELIVERY';
    else if (/pago alla|cuando vaya|al recoger|en el local/.test(text)) paymentPreference = 'PAY_AT_PICKUP';
    else if (/pago ya|pagar de una|pasame el link|pagarlo ahora|pago en linea|pago ahora/.test(text)) paymentPreference = 'ONLINE';
    else if (affirmative && lastQuestion === 'PAYMENT') paymentPreference = 'ONLINE';

    const quantityToken = text.match(/\b(\d+|un|una|uno|dos|tres|cuatro|cinco|seis)\b/)?.[1];
    const quantity = quantityToken ? (Number(quantityToken) || quantities[quantityToken] || null) : null;
    const modifiers: CommercialModifier[] = [];
    for (const match of text.matchAll(/\b(?:(\d+|un|una|uno|dos|tres|cuatro|cinco|seis)\s+)?sin\s+([a-z]+)/g)) {
      const modifierQuantity = match[1] ? (Number(match[1]) || quantities[match[1]] || undefined) : undefined;
      modifiers.push({ kind: 'REMOVE', name: match[2]!.trim(), quantity: modifierQuantity });
    }
    for (const match of text.matchAll(/\b(?:con|agrega|adicional)\s+(tocineta|queso|carne|salsa|papitas)(?:\s+adicional)?/g)) modifiers.push({ kind: 'ADD', name: match[1]! });
    const address = message.match(/(?:a|para|direccion\s+es|dirección\s+es)\s+(la\s+)?((?:carrera|calle|avenida|cra|cl)\s+.*?)(?=\s+y\s+(?:pago|lo pago)|[,.;]|$)/i)?.[2]?.trim() ?? null;
    const confidence: CommercialConfidence = adversarial ? 'LOW' : intent !== 'UNKNOWN' && (fulfillment || paymentPreference !== 'UNKNOWN' || quantity || /2x1|combo|hamburguesa/.test(text)) ? 'HIGH' : intent !== 'UNKNOWN' ? 'MEDIUM' : 'LOW';
    return { intent, confidence, fulfillment, paymentPreference, quantity, modifiers, clearModifiers: /(?:dejala|dejalo|deja)\s+normal/.test(text), address, affirmative, negative, adversarial, normalized: text };
  }
}
