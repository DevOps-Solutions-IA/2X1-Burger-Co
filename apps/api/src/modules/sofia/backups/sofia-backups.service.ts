import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { SofiaPrivacyService } from '../privacy/sofia-privacy.service';

const BACKUP_DIR = 'infra/environments/staging/selfhosted-data/backups/sofia-sanitized';

@Injectable()
export class SofiaBackupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
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
    await this.auditService.log({
      userId: actorId,
      action: 'SOFIA_SANITIZED_BACKUP_DRY_RUN',
      module: 'SofiaBackups',
      entity: 'sofia_backup',
      entityId: fileName,
      newValues: { fileName, dryRun: true, noSecrets: true } as Prisma.InputJsonValue,
    });
    const fallbackStorageUsed = !backupDir.endsWith(BACKUP_DIR);
    return {
      ...payload,
      fileName,
      filePathSanitized: fallbackStorageUsed
        ? `/tmp/sofia-sanitized-backups/${fileName}`
        : `${BACKUP_DIR}/${fileName}`,
      fallbackStorageUsed,
    };
  }

  /* Anclado al root del monorepo para que un CWD distinto (apps/api, contenedor)
     no genere un árbol infra/ espurio; sin root detectable se usa tmp. */
  private resolveWritableBackupDir() {
    const repoRoot = this.findRepoRoot();
    if (repoRoot) {
      try {
        const dir = path.join(repoRoot, BACKUP_DIR);
        mkdirSync(dir, { recursive: true });
        return dir;
      } catch {
        /* cae al fallback */
      }
    }
    const fallback = path.join(tmpdir(), 'sofia-sanitized-backups');
    mkdirSync(fallback, { recursive: true });
    return fallback;
  }

  private findRepoRoot(): string | null {
    let current = process.cwd();
    for (let depth = 0; depth < 6; depth += 1) {
      if (existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
    return null;
  }
}
