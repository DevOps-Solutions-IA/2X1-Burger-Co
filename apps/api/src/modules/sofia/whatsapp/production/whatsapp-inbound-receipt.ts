const ALLOWED_RECEIPT_KEYS = [
  'duplicate',
  'mode',
  'provider',
  'processingStatus',
  'inboundEventId',
  'realSendingEnabled',
  'noWhatsappReal',
] as const;

type ReceiptSource<TProvider> = {
  mode: string;
  provider: TProvider;
  inboundEventId: string;
  duplicate?: boolean;
  processingStatus?: string;
  realSendingEnabled?: boolean;
  noWhatsappReal?: boolean;
  [key: string]: unknown;
};

export type WhatsappInboundReceipt<TProvider> = Pick<
  ReceiptSource<TProvider>,
  (typeof ALLOWED_RECEIPT_KEYS)[number]
>;

export function sanitizeWhatsappInboundReceipt<TProvider>(
  source: ReceiptSource<TProvider>,
): WhatsappInboundReceipt<TProvider> {
  return Object.fromEntries(
    ALLOWED_RECEIPT_KEYS.flatMap((key) =>
      source[key] === undefined ? [] : [[key, source[key]]],
    ),
  ) as WhatsappInboundReceipt<TProvider>;
}
