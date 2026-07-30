import { Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { type Prisma as PrismaNamespace } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

const BUSINESS_TIMEZONE = 'America/Bogota';
const BACKUP_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}\.dump$/;

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  findAll() {
    return this.prisma.setting.findMany({
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    });
  }

  async getOperationsStatus() {
    const [lastBackup, catalogSyncEvents] = await Promise.all([
      this.readLatestBackup(),
      this.prisma.auditLog.findMany({
        where: {
          module: 'catalog_sync',
          entity: 'product',
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: {
          user: {
            select: {
              fullName: true,
              email: true,
            },
          },
        },
      }),
    ]);

    const cronExpression = process.env.BACKUP_CRON_SCHEDULE ?? '0 2 * * *';

    return {
      backup: {
        cronExpression,
        nextRunAt: this.estimateNextRun(cronExpression)?.toISOString() ?? null,
        latest: lastBackup,
      },
      catalogSyncEvents: catalogSyncEvents.map((entry) => ({
        id: entry.id,
        action: entry.action,
        createdAt: entry.createdAt,
        entityId: entry.entityId,
        actor: entry.user?.fullName ?? entry.user?.email ?? 'Sistema',
        source: this.readAuditMeta(entry.newValues, 'source') ?? this.readAuditMeta(entry.oldValues, 'source'),
        reason: this.readAuditMeta(entry.newValues, 'reason') ?? this.readAuditMeta(entry.oldValues, 'reason'),
      })),
    };
  }

  async update(dto: UpdateSettingsDto, actorId: string) {
    const operations = dto.items.map((item) =>
      {
        const normalizedValue =
          item.key === 'reports.daily-close'
            ? {
                ...item.value,
                timezone: BUSINESS_TIMEZONE,
              }
            : item.value;

        return this.prisma.setting.upsert({
          where: { key: item.key },
          update: {
            value: normalizedValue as PrismaNamespace.InputJsonValue,
            category: item.category,
            description: item.description,
          },
          create: {
            key: item.key,
            value: normalizedValue as PrismaNamespace.InputJsonValue,
            category: item.category,
            description: item.description,
          },
        });
      }
    );

    const updated = await this.prisma.$transaction(operations);

    await this.auditService.log({
      userId: actorId,
      action: 'UPDATE',
      module: 'settings',
      entity: 'setting',
      newValues: dto.items,
    });

    return updated;
  }

  private async readLatestBackup() {
    const backupDir = this.resolveBackupDir();

    try {
      // BACKUP_DIR is normalized below; entries are subsequently filename- and containment-checked.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const files = await fs.readdir(backupDir, { withFileTypes: true });
      const dumps = await Promise.all(
        files
          .filter((entry) => entry.isFile() && BACKUP_FILE_NAME.test(entry.name))
          .map(async (entry) => {
            const absolutePath = this.resolveBackupEntry(backupDir, entry.name);
            // The directory entry is a regular file and resolveBackupEntry enforces containment.
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            const stats = await fs.lstat(absolutePath);
            if (!stats.isFile() || stats.isSymbolicLink()) return null;

            return {
              fileName: entry.name,
              absolutePath,
              sizeBytes: stats.size,
              createdAt: stats.mtime.toISOString(),
            };
          }),
      );

      const latest = dumps
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
      return latest ?? null;
    } catch {
      return null;
    }
  }

  private resolveBackupDir() {
    const configured = process.env.BACKUP_DIR?.trim() || './backups';
    if (configured.length > 4096 || configured.includes('\0')) {
      throw new Error('Backup directory path is invalid');
    }
    const resolved = path.resolve(configured);
    if (resolved === path.parse(resolved).root) {
      throw new Error('Filesystem root cannot be used as backup directory');
    }
    return resolved;
  }

  private resolveBackupEntry(backupDir: string, fileName: string): string {
    if (!BACKUP_FILE_NAME.test(fileName) || path.basename(fileName) !== fileName) {
      throw new Error('Backup filename is invalid');
    }
    const resolved = path.resolve(backupDir, fileName);
    if (path.dirname(resolved) !== backupDir) {
      throw new Error('Backup file escaped configured directory');
    }
    return resolved;
  }

  private estimateNextRun(cronExpression: string) {
    const [minuteToken, hourToken, dayToken, monthToken, weekDayToken] = cronExpression.trim().split(/\s+/);

    if (!minuteToken || !hourToken || !dayToken || !monthToken || !weekDayToken) {
      return null;
    }

    if (dayToken !== '*' || monthToken !== '*' || weekDayToken !== '*') {
      return null;
    }

    const minute = Number(minuteToken);
    const hour = Number(hourToken);

    if (!Number.isInteger(minute) || !Number.isInteger(hour)) {
      return null;
    }

    const now = new Date();
    const next = new Date(now);
    next.setSeconds(0, 0);
    next.setHours(hour, minute, 0, 0);

    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    return next;
  }

  private readAuditMeta(value: unknown, key: 'source' | 'reason') {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const audit = (value as { _audit?: { source?: string | null; reason?: string | null } })._audit;
    return audit?.[key] ?? null;
  }
}
