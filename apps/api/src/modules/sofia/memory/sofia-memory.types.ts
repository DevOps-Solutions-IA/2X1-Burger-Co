import { Prisma } from '@prisma/client';

export type SofiaMemorySnapshot = {
  id: string;
  phoneNormalized: string;
  displayName: string | null;
  lastKnownAddress: string | null;
  preferredPaymentMethod: string | null;
  lastOrderSummary: Prisma.JsonValue | null;
  preferences: Prisma.JsonValue | null;
  memorySummary: string | null;
  consentState: 'UNKNOWN' | 'IMPLIED_BY_CONVERSATION' | 'OPTED_OUT';
  lastInteractionAt: string | null;
};

export type SofiaMemoryUpdateInput = {
  phone?: string | null;
  displayName?: string | null;
  address?: string | null;
  preferredPaymentMethod?: string | null;
  lastProductDiscussed?: string | null;
};
