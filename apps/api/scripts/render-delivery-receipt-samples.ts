/**
 * Genera PDFs de muestra de la cuenta de domicilio con datos ficticios,
 * sin tocar base de datos ni órdenes reales. Uso:
 *   npx tsx scripts/render-delivery-receipt-samples.ts <outputDir>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import {
  renderDeliveryReceiptPdf,
  type DeliveryReceiptRenderData,
} from '../src/modules/orders/delivery-receipt.renderer';

const outputDir = process.argv[2] ?? '/tmp/delivery-phase-a-final/pdf-samples';

const base = {
  businessName: '2X1 Burger Co.',
  businessAddress: 'Cra 10 # 12-34, Jamundí',
  businessPhone: '+57 316 052 7403',
  receiptFooter: 'Gracias por tu pedido',
  paymentMethodLabel: 'Nequi',
  paymentTarget: '3160527403',
  generatedAt: new Date('2026-07-10T18:30:00-05:00'),
};

async function qr() {
  return QRCode.toBuffer('https://wa.me/573160527403', {
    margin: 1,
    width: 180,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

async function main() {
  mkdirSync(outputDir, { recursive: true });
  const qrBuffer = await qr();

  const samples: Array<{ file: string; data: DeliveryReceiptRenderData }> = [
    {
      file: '01-inicial-corta.pdf',
      data: {
        ...base,
        updated: false,
        orderNumber: 'DOM-0241',
        version: 1,
        customerName: 'Laura Gómez',
        deliveryReference: 'Calle 9 # 12-34, barrio Centro',
        items: [
          { name: 'Hamburguesa 2x1', quantity: 2, unitPrice: 22000, totalPrice: 44000 },
          { name: 'Pepsi 1.5 L', quantity: 1, unitPrice: 8000, totalPrice: 8000 },
        ],
        itemsSubtotal: 52000,
        deliveryFee: 6000,
        total: 58000,
        qrBuffer,
      },
    },
    {
      file: '02-actualizada.pdf',
      data: {
        ...base,
        updated: true,
        orderNumber: 'DOM-0241',
        version: 3,
        customerName: 'Laura Gómez',
        deliveryReference: 'Calle 9 # 12-34, barrio Centro',
        items: [
          { name: 'Hamburguesa 2x1', quantity: 2, unitPrice: 22000, totalPrice: 44000 },
          { name: 'Porción de papitas', quantity: 1, unitPrice: 7000, totalPrice: 7000 },
          { name: 'Pepsi 1.5 L', quantity: 1, unitPrice: 8000, totalPrice: 8000 },
        ],
        itemsSubtotal: 59000,
        deliveryFee: 6000,
        total: 65000,
        qrBuffer,
      },
    },
    {
      file: '03-pedido-largo.pdf',
      data: {
        ...base,
        updated: false,
        orderNumber: 'DOM-0242',
        version: 1,
        customerName: 'Carlos Andrés Restrepo Cifuentes',
        deliveryReference: 'Av. Panamericana # 45-102',
        items: Array.from({ length: 14 }).map((_, index) => ({
          name:
            index % 3 === 0
              ? 'Hamburguesa Doble Todo con tocineta extra y queso cheddar en lonjas'
              : index % 3 === 1
                ? 'Maxy Family'
                : 'Limonada de coco natural grande',
          quantity: (index % 4) + 1,
          unitPrice: 15000 + index * 500,
          totalPrice: ((index % 4) + 1) * (15000 + index * 500),
        })),
        itemsSubtotal: 542000,
        deliveryFee: 9000,
        total: 551000,
        qrBuffer,
      },
    },
    {
      file: '04-con-adiciones.pdf',
      data: {
        ...base,
        updated: true,
        orderNumber: 'DOM-0243',
        version: 2,
        customerName: 'María Fernanda',
        deliveryReference: 'Cll 15 # 3-21',
        items: [
          {
            name: 'Hamburguesa 2X1\u{1F488} con caracteres raros \u{1F354} ',
            quantity: 1,
            unitPrice: 24000,
            totalPrice: 24000,
            notes: 'Adición: carne extra + tocineta 🍔',
          },
          { name: 'Doble Todo', quantity: 2, unitPrice: 26000, totalPrice: 52000, notes: 'Sin cebolla' },
        ],
        itemsSubtotal: 76000,
        deliveryFee: 7000,
        total: 83000,
        qrBuffer,
      },
    },
    {
      file: '05-direccion-larga.pdf',
      data: {
        ...base,
        updated: false,
        orderNumber: 'DOM-0244',
        version: 1,
        customerName: 'Ángela María Ñáñez Gutiérrez de la Espriella',
        deliveryReference:
          'Conjunto Residencial Altos de la Morada, Torre 7, Apartamento 1203, entrada por la portería de la Carrera 48 # 102-55, timbre dañado: llamar al llegar, frente al parque de los niños',
        notes: 'Casa esquinera con fachada blanca, dejar en portería si no contesta',
        items: [{ name: 'Maxy Family', quantity: 1, unitPrice: 89000, totalPrice: 89000 }],
        itemsSubtotal: 89000,
        deliveryFee: 12000,
        total: 101000,
        qrBuffer,
      },
    },
  ];

  for (const sample of samples) {
    const pdf = await renderDeliveryReceiptPdf(sample.data);
    writeFileSync(path.join(outputDir, sample.file), pdf);
    console.log(`ok ${sample.file} (${pdf.length} bytes)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
