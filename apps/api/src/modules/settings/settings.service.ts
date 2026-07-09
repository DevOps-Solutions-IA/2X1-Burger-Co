import { Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { type Prisma as PrismaNamespace } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

const BUSINESS_TIMEZONE = 'America/Bogota';

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
      const files = await fs.readdir(backupDir);
      const dumps = await Promise.all(
        files
          .filter((file) => file.endsWith('.dump'))
          .map(async (file) => {
            const absolutePath = path.join(backupDir, file);
            const stats = await fs.stat(absolutePath);

            return {
              fileName: file,
              absolutePath,
              sizeBytes: stats.size,
              createdAt: stats.mtime.toISOString(),
            };
          }),
      );

      const latest = dumps.sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
      return latest ?? null;
    } catch {
      return null;
    }
  }

  private resolveBackupDir() {
    const configured = process.env.BACKUP_DIR?.trim() || './backups';
    return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
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
