import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';

/**
 * Renderer puro de la cuenta de domicilio (térmica 58 mm, impresión negra).
 * No consulta base de datos: recibe datos planos y devuelve el PDF como Buffer.
 * Esto permite generar muestras e inspecciones visuales sin tocar órdenes reales.
 */

export type DeliveryReceiptItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  notes?: string | null;
};

export type DeliveryReceiptRenderData = {
  businessName: string;
  businessAddress?: string | null;
  businessPhone?: string | null;
  receiptFooter?: string | null;
  updated: boolean;
  orderNumber: string;
  version: number;
  generatedAt: Date;
  customerName?: string | null;
  deliveryReference?: string | null;
  notes?: string | null;
  paymentMethodLabel?: string | null;
  paymentTarget?: string | null;
  items: DeliveryReceiptItem[];
  itemsSubtotal: number;
  deliveryFee: number;
  total: number;
  qrBuffer?: Buffer | null;
  logoBuffer?: Buffer | null;
};

const PAGE_WIDTH = 58 * 2.83465; // 58 mm térmico
const MARGIN = 11;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BLACK = '#000000';

/* Helvetica usa WinAnsi: cualquier carácter fuera del set (emoji, símbolos
   exóticos) rompería o ensuciaría la impresión. Se eliminan de forma segura. */
const WIN_ANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160,
  0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

export function sanitizeForReceipt(value: string | null | undefined): string {
  if (!value) return '';
  let result = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_ANSI_EXTRAS.has(code)) {
      result += char;
    }
  }
  return result.replace(/\s+/g, ' ').trim();
}

function formatCop(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Bogota',
  }).format(value);
}

let cachedLogo: Buffer | null | undefined;

export function loadBrandLogo(): Buffer | null {
  if (cachedLogo !== undefined) return cachedLogo;
  const candidates = [
    path.join(__dirname, '../../assets/brand-logo.png'),
    path.join(__dirname, '../../../src/assets/brand-logo.png'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      cachedLogo = readFileSync(candidate);
      return cachedLogo;
    }
  }
  cachedLogo = null;
  return cachedLogo;
}

export async function renderDeliveryReceiptPdf(data: DeliveryReceiptRenderData): Promise<Buffer> {
  /* Página única alta: el papel térmico es continuo, no debe haber saltos. */
  const measure = new PDFDocument({ size: [PAGE_WIDTH, 4000], margin: MARGIN });
  const estimatedHeight = layoutReceipt(measure, data, true);
  measure.end();

  const document = new PDFDocument({
    size: [PAGE_WIDTH, Math.max(360, estimatedHeight + 26)],
    margin: MARGIN,
  });
  const chunks: Buffer[] = [];
  document.on('data', (chunk) => chunks.push(chunk));
  layoutReceipt(document, data, false);
  document.end();
  return await new Promise<Buffer>((resolve) => {
    document.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function layoutReceipt(doc: PDFKit.PDFDocument, data: DeliveryReceiptRenderData, measureOnly: boolean): number {
  const logo = data.logoBuffer ?? loadBrandLogo();

  doc.fillColor(BLACK);

  /* ---- Logo + encabezado ---- */
  if (logo) {
    const logoSize = 82;
    if (!measureOnly) {
      doc.image(logo, MARGIN + (CONTENT_WIDTH - logoSize) / 2, doc.y, { fit: [logoSize, logoSize] });
    }
    doc.y += logoSize + 2;
  } else {
    doc.font('Helvetica-Bold').fontSize(13).text(sanitizeForReceipt(data.businessName).toUpperCase(), MARGIN, doc.y, {
      width: CONTENT_WIDTH,
      align: 'center',
    });
  }

  doc.font('Helvetica-Bold').fontSize(8.4).text(
    data.updated ? 'CUENTA ACTUALIZADA DE DOMICILIO' : 'CUENTA DE DOMICILIO',
    MARGIN,
    doc.y + 1,
    { width: CONTENT_WIDTH, align: 'center', characterSpacing: 0.3 },
  );

  if (data.businessAddress || data.businessPhone) {
    doc.font('Helvetica').fontSize(6.4);
    if (data.businessAddress) {
      doc.text(sanitizeForReceipt(data.businessAddress), MARGIN, doc.y + 2, { width: CONTENT_WIDTH, align: 'center' });
    }
    if (data.businessPhone) {
      doc.text(sanitizeForReceipt(data.businessPhone), MARGIN, doc.y + 1, { width: CONTENT_WIDTH, align: 'center' });
    }
  }

  doc.moveDown(0.5);
  rule(doc, measureOnly);

  /* ---- Datos del pedido ---- */
  doc.moveDown(0.4);
  metaRow(doc, 'Pedido', sanitizeForReceipt(data.orderNumber), true);
  metaRow(doc, 'Versión', `VERSIÓN ${data.version}`, true);
  metaRow(doc, 'Estado', 'VIGENTE', true);
  metaRow(doc, 'Fecha', formatDateTime(data.generatedAt));
  if (data.customerName) metaRow(doc, 'Cliente', sanitizeForReceipt(data.customerName));
  if (data.deliveryReference) metaRow(doc, 'Dirección', sanitizeForReceipt(data.deliveryReference));
  if (data.notes) metaRow(doc, 'Referencia', sanitizeForReceipt(data.notes));
  if (data.paymentMethodLabel) {
    metaRow(doc, 'Pago', sanitizeForReceipt(`${data.paymentMethodLabel}${data.paymentTarget ? ` ${data.paymentTarget}` : ''}`));
  }

  doc.moveDown(0.4);
  rule(doc, measureOnly);

  /* ---- Detalle de productos ---- */
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(7).text('DETALLE', MARGIN, doc.y, {
    width: CONTENT_WIDTH,
    characterSpacing: 0.5,
  });
  doc.moveDown(0.25);

  for (const item of data.items) {
    const nameColumn = CONTENT_WIDTH * 0.66;
    const priceColumn = CONTENT_WIDTH * 0.34;
    const label = `${item.quantity} x ${sanitizeForReceipt(item.name) || 'Producto'}`;
    const rowY = doc.y;
    doc.font('Helvetica-Bold').fontSize(7.1);
    const nameHeight = doc.heightOfString(label, { width: nameColumn });
    doc.text(label, MARGIN, rowY, { width: nameColumn });
    doc.text(formatCop(item.totalPrice), MARGIN + nameColumn, rowY, { width: priceColumn, align: 'right' });
    doc.y = rowY + Math.max(nameHeight, 8);

    if (item.quantity > 1) {
      doc.font('Helvetica').fontSize(6.2).text(`${formatCop(item.unitPrice)} c/u`, MARGIN + 6, doc.y, {
        width: nameColumn - 6,
      });
    }
    if (item.notes) {
      doc.font('Helvetica').fontSize(6.2).text(`· ${sanitizeForReceipt(item.notes)}`, MARGIN + 6, doc.y, {
        width: CONTENT_WIDTH - 6,
      });
    }
    doc.moveDown(0.18);
  }

  doc.moveDown(0.3);
  rule(doc, measureOnly);

  /* ---- Totales ---- */
  doc.moveDown(0.4);
  metaRow(doc, 'Subtotal productos', formatCop(data.itemsSubtotal));
  metaRow(doc, 'Tarifa de domicilio', formatCop(data.deliveryFee));

  doc.moveDown(0.3);
  rule(doc, measureOnly, 1.4);
  doc.moveDown(0.35);

  const totalY = doc.y;
  doc.font('Helvetica-Bold').fontSize(8.8);
  doc.text('TOTAL A PAGAR', MARGIN, totalY + 1, { width: CONTENT_WIDTH * 0.56, lineBreak: false });
  doc.fontSize(10.2).text(formatCop(data.total), MARGIN + CONTENT_WIDTH * 0.56, totalY, {
    width: CONTENT_WIDTH * 0.44,
    align: 'right',
    lineBreak: false,
  });
  doc.y = totalY + 13;
  rule(doc, measureOnly, 1.4);

  /* ---- Notas logísticas ---- */
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(6.3).text(
    'La tarifa de domicilio corresponde al valor calculado por el sistema para esta orden.',
    MARGIN,
    doc.y,
    { width: CONTENT_WIDTH, align: 'center' },
  );
  doc.moveDown(0.2);
  doc.text('La ubicación compartida se utiliza únicamente para facilitar la entrega.', MARGIN, doc.y, {
    width: CONTENT_WIDTH,
    align: 'center',
  });

  if (data.updated) {
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(6.5).text(
      'Esta cuenta reemplaza las versiones anteriores del pedido.',
      MARGIN,
      doc.y,
      { width: CONTENT_WIDTH, align: 'center' },
    );
  }

  /* ---- QR de contacto ---- */
  if (data.qrBuffer) {
    doc.moveDown(0.55);
    doc.font('Helvetica').fontSize(6.3).text('Escanea para escribir al WhatsApp del negocio', MARGIN, doc.y, {
      width: CONTENT_WIDTH,
      align: 'center',
    });
    const qrSize = 66;
    doc.moveDown(0.25);
    if (!measureOnly) {
      doc.image(data.qrBuffer, MARGIN + (CONTENT_WIDTH - qrSize) / 2, doc.y, { fit: [qrSize, qrSize] });
    }
    doc.y += qrSize + 4;
  }

  /* ---- Pie ---- */
  doc.moveDown(0.35);
  doc.font('Helvetica').fontSize(6.3).text(sanitizeForReceipt(data.receiptFooter) || 'Gracias por tu pedido', MARGIN, doc.y, {
    width: CONTENT_WIDTH,
    align: 'center',
  });

  return doc.y;
}

function metaRow(doc: PDFKit.PDFDocument, label: string, value: string, bold = false) {
  const labelWidth = CONTENT_WIDTH * 0.42;
  const valueWidth = CONTENT_WIDTH * 0.58;
  const rowY = doc.y;
  doc.font('Helvetica').fontSize(6.8).text(label, MARGIN, rowY, { width: labelWidth });
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(6.8);
  const valueHeight = doc.heightOfString(value, { width: valueWidth });
  doc.text(value, MARGIN + labelWidth, rowY, { width: valueWidth, align: 'right' });
  doc.y = rowY + Math.max(valueHeight, 8.4);
}

function rule(doc: PDFKit.PDFDocument, measureOnly: boolean, thickness = 0.7) {
  if (!measureOnly) {
    doc
      .moveTo(MARGIN, doc.y)
      .lineTo(MARGIN + CONTENT_WIDTH, doc.y)
      .lineWidth(thickness)
      .strokeColor(BLACK)
      .stroke();
  }
  doc.y += thickness + 1;
}
