import { Prisma } from '@prisma/client';

export type SofiaPromptSnapshot = {
  id: string;
  version: string;
  name: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  promptText: string;
  systemRules: Prisma.JsonValue | null;
  commercialRules: Prisma.JsonValue | null;
  safetyRules: Prisma.JsonValue | null;
  activatedAt: string | null;
};
