import { Injectable } from '@nestjs/common';
import { SofiaPromptStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SOFIA_MASTER_PROMPT_SEED, SOFIA_MASTER_PROMPT_VERSION } from './sofia-master-prompt.seed';
import { SofiaPromptSnapshot } from './sofia-prompt.types';

@Injectable()
export class SofiaPromptService {
  constructor(private readonly prisma: PrismaService) {}

  async getActivePrompt(): Promise<SofiaPromptSnapshot> {
    const active = await this.ensureActivePrompt();
    return {
      id: active.id,
      version: active.version,
      name: active.name,
      status: active.status,
      promptText: active.promptText,
      systemRules: active.systemRulesJson,
      commercialRules: active.commercialRulesJson,
      safetyRules: active.safetyRulesJson,
      activatedAt: active.activatedAt?.toISOString() ?? null,
    };
  }

  async listPromptVersions() {
    await this.ensureActivePrompt();
    return this.prisma.sofiaPromptVersion.findMany({
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      select: {
        id: true,
        version: true,
        name: true,
        status: true,
        activatedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async assertSingleActivePrompt() {
    await this.ensureActivePrompt();
    const activeCount = await this.prisma.sofiaPromptVersion.count({ where: { status: SofiaPromptStatus.ACTIVE } });
    return { activeCount, ok: activeCount === 1 };
  }

  private async ensureActivePrompt() {
    const existingActive = await this.prisma.sofiaPromptVersion.findFirst({
      where: { status: SofiaPromptStatus.ACTIVE },
      orderBy: { updatedAt: 'desc' },
    });
    if (existingActive) {
      await this.prisma.sofiaPromptVersion.updateMany({
        where: { status: SofiaPromptStatus.ACTIVE, id: { not: existingActive.id } },
        data: { status: SofiaPromptStatus.ARCHIVED },
      });
      return existingActive;
    }

    return this.prisma.sofiaPromptVersion.upsert({
      where: { version: SOFIA_MASTER_PROMPT_VERSION },
      create: {
        ...SOFIA_MASTER_PROMPT_SEED,
        activatedAt: new Date(),
      },
      update: {
        status: SofiaPromptStatus.ACTIVE,
        name: SOFIA_MASTER_PROMPT_SEED.name,
        promptText: SOFIA_MASTER_PROMPT_SEED.promptText,
        systemRulesJson: SOFIA_MASTER_PROMPT_SEED.systemRulesJson,
        commercialRulesJson: SOFIA_MASTER_PROMPT_SEED.commercialRulesJson,
        safetyRulesJson: SOFIA_MASTER_PROMPT_SEED.safetyRulesJson,
        approvedBy: SOFIA_MASTER_PROMPT_SEED.approvedBy,
        activatedAt: new Date(),
      },
    });
  }
}
