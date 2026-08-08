import { Injectable } from '@nestjs/common';
import type { CommercialFactEnvelope } from './commercial-response.types';

const money = (value: number | null) => `$${(value ?? 0).toLocaleString('es-CO')}`;

@Injectable()
export class SafeCommercialResponseTemplates {
  render(facts: CommercialFactEnvelope): string {
    const items = facts.items
      .map((item) => `${item.quantity} ${item.name}${item.modifiers.length ? ` (${item.modifiers.map((modifier) => `${modifier.kind === 'REMOVE' ? 'sin' : 'con'} ${modifier.name}`).join(', ')})` : ''}`)
      .join(', ');
    const summary = `${items}, ${facts.fulfillment === 'TAKEAWAY' ? 'para recoger' : `para enviar a ${facts.addressSafe}`}. Subtotal ${money(facts.subtotal)}, domicilio ${money(facts.deliveryFee)}, total ${money(facts.total)}.`;

    switch (facts.responsePurpose) {
      case 'ASK_PRODUCT': return '¿Qué producto quieres pedir? Puedo revisar el catálogo activo.';
      case 'ASK_FULFILLMENT': return '¿Te lo enviamos o prefieres recogerlo?';
      case 'ASK_PAYMENT':
      case 'CLARIFY_PAYMENT':
        return facts.fulfillment === 'TAKEAWAY'
          ? 'Perfecto, ¿lo pagas ahora en línea o al recoger?'
          : 'Listo, ¿lo pagas ahora en línea o en efectivo cuando llegue?';
      case 'ASK_ADDRESS': return '¿A qué dirección debemos enviarlo?';
      case 'CLARIFY_PRODUCT': return '¿Cuál de los productos disponibles prefieres?';
      case 'PRICE_CHANGED': return `El precio cambió desde la consulta anterior. ${summary} ¿Confirmamos con este valor?`;
      case 'QUOTE_EXPIRED': return `La cotización anterior venció. Revisé nuevamente los datos: ${summary} ¿Confirmamos así?`;
      case 'PRODUCT_UNAVAILABLE': return 'Ese producto no está disponible en este momento. Puedo mostrarte alternativas reales del catálogo.';
      case 'MODIFIER_UNSUPPORTED': return 'Esa modificación no aparece habilitada para ese producto. Puedo mostrarte las opciones disponibles.';
      case 'DISCOUNT_UNAVAILABLE': return 'No tengo un descuento habilitado para este pedido.';
      case 'DEPENDENCY_FAILURE': return 'En este momento no puedo confirmar los datos de forma segura. Prefiero no darte información incorrecta.';
      case 'HUMAN_HANDOFF': return 'Prefiero pasarte con el equipo para resolverlo sin arriesgar datos o cobros incorrectos.';
      case 'TAKEAWAY_CONFIRMED': return 'El borrador para recoger quedó confirmado para revisión supervisada. Aún no se creó pedido ni cobro.';
      case 'DELIVERY_CONFIRMED': return 'El borrador con entrega quedó confirmado para revisión supervisada. Aún no se creó pedido, cobro ni envío.';
      case 'CONFIRM_DRAFT': return facts.confirmationRequired ? `Te confirmo: ${summary} ¿Confirmamos así?` : 'Entendido. No confirmaré ese borrador. Dime qué quieres cambiar.';
      case 'SUMMARIZE_DRAFT': return `Te confirmo: ${summary} ¿Confirmamos así?`;
    }
  }
}
