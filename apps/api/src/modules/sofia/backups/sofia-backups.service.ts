import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { SofiaPrivacyService } from '../privacy/sofia-privacy.service';

const BACKUP_DIR = 'infra/environments/staging/selfhosted-data/backups/sofia-sanitized';
const BACKUP_FILE_PATTERN = /^sofia-sanitized-dry-run-[A-Za-z0-9-]+\.json$/;

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
    const backupDir = await this.resolveWritableBackupDir();
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
    await this.writeSanitizedBackup(backupDir, filePath, JSON.stringify(payload, null, 2));
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
  private async resolveWritableBackupDir() {
    const repoRoot = await this.findRepoRoot();
    if (repoRoot) {
      try {
        const canonicalRepoRoot = await this.realPath(repoRoot);
        const dir = this.resolveInsideRoot(canonicalRepoRoot, BACKUP_DIR);
        return await this.ensureDirectory(dir, canonicalRepoRoot);
      } catch {
        /* cae al fallback */
      }
    }
    const fallbackRoot = await this.realPath(path.resolve(tmpdir()));
    const fallback = this.resolveInsideRoot(fallbackRoot, 'sofia-sanitized-backups');
    return this.ensureDirectory(fallback, fallbackRoot);
  }

  private async findRepoRoot(): Promise<string | null> {
    let current = path.resolve(process.cwd());
    for (let depth = 0; depth < 6; depth += 1) {
      const workspaceMarker = this.resolveInsideRoot(current, 'pnpm-workspace.yaml');
      if (await this.pathExists(workspaceMarker)) {
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

  private resolveInsideRoot(root: string, relativePath: string): string {
    const normalizedRoot = path.resolve(root);
    const candidate = path.resolve(normalizedRoot, relativePath);
    const relative = path.relative(normalizedRoot, candidate);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('SOFIA_BACKUP_PATH_OUTSIDE_ROOT');
    }
    return candidate;
  }

  private async ensureDirectory(directory: string, allowedRoot: string): Promise<string> {
    // ESLint cannot infer that callers pass only resolveInsideRoot() output.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    // realpath prevents subsequent writes through a replaced directory symlink.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const canonicalDirectory = await fs.realpath(directory);
    this.assertCanonicalChild(allowedRoot, canonicalDirectory);
    return canonicalDirectory;
  }

  private async writeSanitizedBackup(root: string, filePath: string, contents: string): Promise<void> {
    const fileName = path.basename(filePath);
    if (!BACKUP_FILE_PATTERN.test(fileName)) {
      throw new Error('SOFIA_BACKUP_FILENAME_INVALID');
    }
    const canonicalRoot = await this.realPath(root);
    if (canonicalRoot !== path.resolve(root)) {
      throw new Error('SOFIA_BACKUP_ROOT_CHANGED');
    }
    const safeFilePath = this.resolveInsideRoot(canonicalRoot, fileName);
    // ESLint cannot infer the canonical-root boundary enforced above.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await fs.writeFile(safeFilePath, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      // filePath is the bounded workspace marker resolved by resolveInsideRoot().
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private assertCanonicalChild(root: string, candidate: string): void {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('SOFIA_BACKUP_PATH_OUTSIDE_ROOT');
    }
  }

  private async realPath(directory: string): Promise<string> {
    // Canonicalization is required to reject directory symlink escapes.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return fs.realpath(directory);
  }
}
