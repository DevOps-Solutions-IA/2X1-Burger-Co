import { formatCurrency } from './format';
import { formatReceiptNumber } from './receipt-number';

export type ThermalReceiptItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

export type ThermalReceiptPayment = {
  name: string;
  amount: number;
  receivedAmount?: number | null;
  changeAmount?: number | null;
};

export type ThermalReceiptData = {
  saleId: string;
  businessName: string;
  address: string;
  phone: string;
  whatsappUrl: string | null;
  receiptFooter: string;
  saleNumber: string;
  issuedAt: string;
  channelLabel: string;
  referenceLabel: string | null;
  customerLabel: string | null;
  notes: string | null;
  items: ThermalReceiptItem[];
  payments: ThermalReceiptPayment[];
  subtotal: number;
  discount: number;
  total: number;
};

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatReceiptDate(value: string) {
  return new Date(value).toLocaleString('es-CO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildReceiptHtml(data: ThermalReceiptData, qrCodeDataUrl: string | null) {
  const receiptNumber = formatReceiptNumber(data.saleNumber);
  const itemRows = data.items
    .map(
      (item) => `
        <div class="line-item">
          <div class="line-item__name">${escapeHtml(item.name)}</div>
          <div class="line-item__meta">${item.quantity} x ${formatCurrency(item.unitPrice)}</div>
          <div class="line-item__total">${formatCurrency(item.total)}</div>
        </div>
      `,
    )
    .join('');

  const paymentRows = data.payments
    .map(
      (payment) => `
        <div class="summary-row">
          <span>${escapeHtml(payment.name)}</span>
          <strong>${formatCurrency(payment.amount)}</strong>
        </div>
        ${
          payment.receivedAmount != null && payment.receivedAmount !== payment.amount
            ? `
        <div class="summary-row muted">
          <span>Recibido</span>
          <strong>${formatCurrency(payment.receivedAmount)}</strong>
        </div>
        `
            : ''
        }
        ${
          payment.changeAmount != null && payment.changeAmount > 0
            ? `
        <div class="summary-row muted">
          <span>Cambio</span>
          <strong>${formatCurrency(payment.changeAmount)}</strong>
        </div>
        `
            : ''
        }
      `,
    )
    .join('');

  return `<!doctype html>
  <html lang="es">
    <head>
      <meta charset="utf-8" />
      <title>Ticket ${escapeHtml(receiptNumber)}</title>
      <style>
        @page {
          size: 58mm auto;
          margin: 0;
        }
        * {
          box-sizing: border-box;
        }
        html, body {
          margin: 0;
          padding: 0;
          width: 58mm;
          background: #fff;
          color: #111827;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        }
        body {
          padding: 3mm;
        }
        .receipt {
          width: 100%;
          border: 1px solid #e5e7eb;
          border-radius: 3mm;
          padding: 3.5mm;
        }
        .center {
          text-align: center;
        }
        .brand {
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .muted {
          color: #4b5563;
          font-size: 10px;
          line-height: 1.35;
        }
        .block {
          margin-top: 3mm;
          padding-top: 3mm;
          border-top: 1px dashed #d1d5db;
        }
        .section-title {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 2mm;
        }
        .summary-row, .meta-row {
          display: flex;
          justify-content: space-between;
          gap: 2mm;
          align-items: flex-start;
          font-size: 10px;
          line-height: 1.35;
          margin-top: 1.25mm;
        }
        .summary-row strong, .line-item__total {
          white-space: nowrap;
        }
        .line-item {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 1mm 2mm;
          padding: 1.75mm 0;
          border-bottom: 1px dashed #e5e7eb;
        }
        .line-item__name {
          grid-column: 1 / -1;
          font-size: 10px;
          font-weight: 700;
          line-height: 1.35;
        }
        .line-item__meta,
        .line-item__total {
          font-size: 10px;
        }
        .line-item__total {
          text-align: right;
          font-weight: 700;
        }
        .totals {
          margin-top: 2.5mm;
          padding-top: 2.5mm;
          border-top: 1px solid #111827;
        }
        .totals .summary-row {
          font-size: 11px;
        }
        .totals .summary-row:last-child {
          font-size: 12px;
        }
        .badge {
          display: inline-block;
          margin-top: 1.5mm;
          padding: 1mm 2mm;
          border-radius: 999px;
          border: 1px solid #f59e0b;
          background: #fff7ed;
          color: #9a3412;
          font-size: 9px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .qr {
          margin-top: 3mm;
          text-align: center;
        }
        .qr img {
          width: 26mm;
          height: 26mm;
          object-fit: contain;
        }
        .footer {
          margin-top: 3mm;
          text-align: center;
          font-size: 9px;
          line-height: 1.45;
          color: #4b5563;
        }
      </style>
    </head>
    <body>
      <main class="receipt">
        <div class="center">
          <div class="brand">${escapeHtml(data.businessName)}</div>
          ${data.address ? `<div class="muted" style="margin-top: 1mm;">${escapeHtml(data.address)}</div>` : ''}
          ${data.phone ? `<div class="muted">${escapeHtml(data.phone)}</div>` : ''}
          <span class="badge">${escapeHtml(data.channelLabel)}</span>
        </div>

        <section class="block">
          <div class="section-title">Comprobante operativo POS</div>
          <div class="meta-row"><span>Comprobante</span><strong>${escapeHtml(receiptNumber)}</strong></div>
          <div class="meta-row"><span>Fecha</span><strong>${escapeHtml(formatReceiptDate(data.issuedAt))}</strong></div>
          ${data.referenceLabel ? `<div class="meta-row"><span>Referencia</span><strong>${escapeHtml(data.referenceLabel)}</strong></div>` : ''}
          ${data.customerLabel ? `<div class="meta-row"><span>Cliente</span><strong>${escapeHtml(data.customerLabel)}</strong></div>` : ''}
          ${data.notes ? `<div class="meta-row"><span>Notas</span><strong>${escapeHtml(data.notes)}</strong></div>` : ''}
        </section>

        <section class="block">
          <div class="section-title">Detalle de compra</div>
          ${itemRows}
        </section>

        <section class="block">
          <div class="section-title">Pagos</div>
          ${paymentRows}
        </section>

        <section class="totals">
          <div class="summary-row"><span>${data.discount > 0 ? 'Subtotal base' : 'Subtotal'}</span><strong>${formatCurrency(data.subtotal)}</strong></div>
          ${
            data.discount > 0
              ? `<div class="summary-row"><span>Ajuste aplicado</span><strong>${formatCurrency(data.discount)}</strong></div>`
              : ''
          }
          <div class="summary-row"><span>Total</span><strong>${formatCurrency(data.total)}</strong></div>
        </section>

        ${
          qrCodeDataUrl
            ? `<section class="qr block">
                <div class="section-title">WhatsApp</div>
                <img src="${qrCodeDataUrl}" alt="QR WhatsApp" />
                <div class="muted">Escanea para escribirnos</div>
              </section>`
            : ''
        }

        <div class="footer">
          ${data.receiptFooter ? `<div>${escapeHtml(data.receiptFooter)}</div>` : '<div>Gracias por tu compra</div>'}
          <div>Ticket térmico 58 mm</div>
        </div>
      </main>
    </body>
  </html>`;
}

export function buildWhatsAppUrl(phone: string) {
  const digits = phone.replace(/\D/g, '');

  if (!digits) {
    return null;
  }

  if (digits.startsWith('57')) {
    return `https://wa.me/${digits}`;
  }

  if (digits.length === 10) {
    return `https://wa.me/57${digits}`;
  }

  return `https://wa.me/${digits}`;
}

export async function printThermalReceipt(data: ThermalReceiptData) {
  const printWindow = window.open('', '_blank', 'popup=yes,width=420,height=720');

  if (!printWindow) {
    throw new Error('El navegador bloqueó la ventana de impresión. Permite ventanas emergentes e intenta de nuevo.');
  }

  let qrCodeDataUrl: string | null = null;

  if (data.whatsappUrl) {
    const QRCode = await import('qrcode');
    qrCodeDataUrl = await QRCode.toDataURL(data.whatsappUrl, {
      margin: 1,
      width: 180,
      color: {
        dark: '#111827',
        light: '#ffffff',
      },
    });
  }

  printWindow.document.open();
  printWindow.document.write(buildReceiptHtml(data, qrCodeDataUrl));
  printWindow.document.close();
  printWindow.focus();
  printWindow.onload = () => {
    printWindow.print();
  };
}

export function buildReceiptWhatsAppMessage(data: ThermalReceiptData) {
  const lines = [
    `${data.businessName}`,
    `Comprobante ${formatReceiptNumber(data.saleNumber)}`,
    `Fecha: ${formatReceiptDate(data.issuedAt)}`,
    `Canal: ${data.channelLabel}`,
  ];

  if (data.referenceLabel) {
    lines.push(`Referencia: ${data.referenceLabel}`);
  }

  if (data.customerLabel) {
    lines.push(`Cliente: ${data.customerLabel}`);
  }

  lines.push('', 'Detalle:');

  data.items.forEach((item) => {
    lines.push(`- ${item.name} x${item.quantity} · ${formatCurrency(item.total)}`);
  });

  lines.push('', `Total: ${formatCurrency(data.total)}`);

  if (data.notes) {
    lines.push(`Notas: ${data.notes}`);
  }

  if (data.receiptFooter) {
    lines.push('', data.receiptFooter);
  }

  return lines.join('\n');
}

export function openReceiptWhatsApp(data: ThermalReceiptData) {
  if (!data.whatsappUrl) {
    throw new Error('No hay un número de WhatsApp configurado para el negocio.');
  }

  const url = new URL(data.whatsappUrl);
  url.searchParams.set('text', buildReceiptWhatsAppMessage(data));
  window.open(url.toString(), '_blank', 'noopener,noreferrer');
}

export async function shareReceiptPdfViaWhatsApp(data: ThermalReceiptData, pdfBlob: Blob) {
  const fileName = `${formatReceiptNumber(data.saleNumber).toLowerCase()}.pdf`;
  const pdfFile = new File([pdfBlob], fileName, { type: 'application/pdf' });

  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [pdfFile] })
  ) {
    await navigator.share({
      title: `Comprobante ${formatReceiptNumber(data.saleNumber)}`,
      text: `${data.businessName} · ${formatReceiptNumber(data.saleNumber)}`,
      files: [pdfFile],
    });
    return;
  }

  const url = URL.createObjectURL(pdfBlob);
  window.open(url, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
