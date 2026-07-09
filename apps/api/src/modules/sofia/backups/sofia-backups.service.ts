import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaService } from '../../../prisma/prisma.service';
import { SofiaPrivacyService } from '../privacy/sofia-privacy.service';

const BACKUP_DIR = 'infra/environments/staging/selfhosted-data/backups/sofia-sanitized';

@Injectable()
export class SofiaBackupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly privacyService: SofiaPrivacyService,
  ) {}

  async status() {
    const setting = await this.prisma.setting.findUnique({ where: { key: 'SOFIA_SANITIZED_BACKUP_LAST_DRY_RUN' } });
    return {
      status: 'DRY_RUN_READY',
      backupDirSanitized: BACKUP_DIR,
      lastBackupAt:
        setting?.value && typeof setting.value === 'object' && !Array.isArray(setting.value)
          ? String((setting.value as { generatedAt?: unknown }).generatedAt ?? '')
          : null,
      excludes: ['.env', 'storage/whatsapp-sessions', 'secrets', 'tokens', 'payment credentials'],
      noSecrets: true,
    };
  }

  async dryRun(actorId: string) {
    const backupDir = this.resolveWritableBackupDir();
    const [promptVersions, catalogItems, customerMemories, conversationMemories, autoSafeAggregates, feedbackCount, governanceSettings] =
      await Promise.all([
        this.prisma.sofiaPromptVersion.count(),
        this.prisma.sofiaCommercialCatalogItem.count(),
        this.prisma.sofiaCustomerMemory.count(),
        this.prisma.sofiaConversationMemory.count(),
        this.prisma.sofiaAutoSafeDecisionEvent.groupBy({ by: ['status'], _count: { _all: true } }),
        this.prisma.auditLog.count({ where: { module: 'SofiaLearningFeedback' } }),
        this.prisma.setting.count({ where: { category: { in: ['sofia_governance', 'sofia_whatsapp_qr'] } } }),
      ]);
    const payload = this.privacyService.sanitizeJson({
      generatedAt: new Date().toISOString(),
      dryRun: true,
      noSecrets: true,
      excluded: ['.env', '.env.*', 'storage/whatsapp-sessions', 'apps/api/storage/whatsapp-sessions', 'raw tokens', 'payment secrets'],
      scope: {
        promptVersions,
        catalogItems,
        customerMemoriesSanitized: customerMemories,
        conversationMemoriesSanitized: conversationMemories,
        autoSafeAggregates,
        feedbackCount,
        governanceSettings,
      },
    });
    const fileName = `sofia-sanitized-dry-run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    const filePath = path.join(backupDir, fileName);
    writeFileSync(filePath, JSON.stringify(payload, null, 2));
    await this.prisma.setting.upsert({
      where: { key: 'SOFIA_SANITIZED_BACKUP_LAST_DRY_RUN' },
      create: {
        key: 'SOFIA_SANITIZED_BACKUP_LAST_DRY_RUN',
        category: 'sofia_backup',
        description: 'Último backup sanitizado dry-run de Sofía',
        value: { generatedAt: payload.generatedAt, fileName, dryRun: true } as Prisma.InputJsonValue,
      },
      update: {
        value: { generatedAt: payload.generatedAt, fileName, dryRun: true } as Prisma.InputJsonValue,
        category: 'sofia_backup',
        description: 'Último backup sanitizado dry-run de Sofía',
      },
    });
    await this.prisma.auditLog.create({
      data: {
        userId: actorId,
        action: 'SOFIA_SANITIZED_BACKUP_DRY_RUN',
        module: 'SofiaBackups',
        entity: 'sofia_backup',
        entityId: fileName,
        newValues: { fileName, dryRun: true, noSecrets: true } as Prisma.InputJsonValue,
      },
    });
    return {
      ...payload,
      fileName,
      filePathSanitized: backupDir === BACKUP_DIR ? `${BACKUP_DIR}/${fileName}` : `/tmp/sofia-sanitized-backups/${fileName}`,
      fallbackStorageUsed: backupDir !== BACKUP_DIR,
    };
  }

  private resolveWritableBackupDir() {
    try {
      mkdirSync(BACKUP_DIR, { recursive: true });
      return BACKUP_DIR;
    } catch {
      const fallback = path.join(tmpdir(), 'sofia-sanitized-backups');
      mkdirSync(fallback, { recursive: true });
      return fallback;
    }
  }
}
