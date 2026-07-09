export type OperationalOrderType = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY' | 'COUNTER';

const ORDER_DISPLAY_CODES: Record<OperationalOrderType, string> = {
  COUNTER: 'MOSTRADOR-001',
  TAKEAWAY: 'MOSTRADOR-001',
  DINE_IN: 'MESA-002',
  DELIVERY: 'DOMICILIO-003',
};

export function getOperationalOrderDisplayCode(type: OperationalOrderType) {
  return ORDER_DISPLAY_CODES[type];
}
