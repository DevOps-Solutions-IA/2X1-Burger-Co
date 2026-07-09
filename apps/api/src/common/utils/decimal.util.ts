import { Prisma } from '@prisma/client';

export function toDecimal(value: number | string | Prisma.Decimal) {
  return new Prisma.Decimal(value);
}

export function toNumber(value: Prisma.Decimal | number | null | undefined) {
  if (value == null) {
    return 0;
  }

  return value instanceof Prisma.Decimal ? value.toNumber() : value;
}
