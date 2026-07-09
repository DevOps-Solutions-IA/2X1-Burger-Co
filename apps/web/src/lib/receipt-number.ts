export function formatReceiptNumber(value: string) {
  const digits = value.replace(/\D/g, '');
  const suffix = digits.slice(-6).padStart(6, '0');
  return `FAC-${suffix}`;
}
