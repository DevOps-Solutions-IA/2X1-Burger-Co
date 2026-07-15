import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, type AuditLog } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditContextService } from './audit-context.service';
import {
  AUDIT_EVENT_VERSION,
  type AuditDatabaseClient,
  type AuditInput,
  type AuditPage,
  type AuditResult,
} from './audit.types';
import type { ListAuditEventsDto } from './dto/list-audit-events.dto';

const MAX_JSON_BYTES = 16_384;
const MAX_STRING_LENGTH = 512;
const MAX_COLLECTION_LENGTH = 50;
const MAX_DEPTH = 5;
const BLOCKED_KEY = /(password|secret|token|cookie|authorization|qr|string|credential|card|cvv|sessionauth|apikey)/i;
const PHONE_KEY = /(phone|telefono|mobile|whatsapp|jid)/i;

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contextService: AuditContextService,
  ) {}

  async log(input: AuditInput, client: AuditDatabaseClient = this.prisma): Promise<AuditLog> {
    const context = this.contextService.current();
    const actorId = input.actorId ?? input.userId ?? context?.actorId ?? null;
    const actorRole = input.actorRole ?? context?.actorRole ?? null;
    const actorType = input.actorType ?? (actorId ? 'USER' : 'SYSTEM');
    const before = this.sanitize(input.before ?? input.oldValues);
    const after = this.sanitize(input.after ?? input.newValues);
    const metadata = this.sanitize(input.metadata);
    const reasonText = this.sanitizeText(input.reasonText);

    return client.auditLog.create({
      data: {
        eventVersion: AUDIT_EVENT_VERSION,
        timestamp: new Date(),
        userId: input.userId ?? (actorType === 'USER' ? actorId : null),
        actorId,
        actorType,
        actorRole,
        action: this.requiredIdentifier(input.action, 'action', 128),
        module: this.requiredIdentifier(input.module, 'module', 96),
        entity: this.requiredIdentifier(input.entity, 'entity', 96),
        entityType: this.identifier(input.entityType ?? input.entity, 96),
        entityId: this.identifier(input.entityId, 128),
        result: input.result ?? this.inferResult(input.action),
        reasonCode: this.identifier(input.reasonCode ?? this.defaultReasonCode(input), 128),
        reasonText,
        requestId: this.identifier(input.requestId ?? context?.requestId, 128),
        correlationId: this.identifier(input.correlationId ?? context?.correlationId, 128),
        traceId: this.traceId(input.traceId ?? context?.traceId),
        idempotencyKey: this.identifier(input.idempotencyKey ?? context?.idempotencyKey, 128),
        oldValues: before,
        newValues: after,
        before,
        after,
        metadata,
        source: this.identifier(input.source ?? context?.source, 64) ?? 'internal',
        environment: this.identifier(input.environment ?? context?.environment, 64),
        releaseVersion: this.identifier(input.releaseVersion ?? context?.releaseVersion, 128),
        ipAddress: this.sanitizeNetworkValue(input.ipAddress),
        userAgent: this.sanitizeText(input.userAgent, 256),
      },
    });
  }

  async list(filters: ListAuditEventsDto): Promise<AuditPage<ReturnType<AuditService['serialize']>>> {
    const where: Prisma.AuditLogWhereInput = {
      timestamp: {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(filters.to) } : {}),
      },
      ...(filters.actorId ? { actorId: filters.actorId } : {}),
      ...(filters.actorRole ? { actorRole: filters.actorRole } : {}),
      ...(filters.module ? { module: filters.module } : {}),
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.entityType ? { entityType: filters.entityType } : {}),
      ...(filters.entityId ? { entityId: filters.entityId } : {}),
      ...(filters.result ? { result: filters.result } : {}),
      ...(filters.requestId ? { requestId: filters.requestId } : {}),
      ...(filters.correlationId ? { correlationId: filters.correlationId } : {}),
      ...(filters.idempotencyKey ? { idempotencyKey: filters.idempotencyKey } : {}),
    };
    if (!filters.from && !filters.to) delete where.timestamp;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data: rows.map((row) => this.serialize(row)),
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        pages: Math.ceil(total / filters.limit),
      },
    };
  }

  private serialize(row: AuditLog) {
    const legacy = row.eventVersion < AUDIT_EVENT_VERSION;
    return {
      id: row.id,
      eventVersion: row.eventVersion,
      timestamp: row.timestamp,
      actorId: row.actorId,
      actorType: row.actorType,
      actorRole: row.actorRole,
      action: row.action,
      module: row.module,
      entityType: row.entityType ?? row.entity,
      entityId: row.entityId,
      result: row.result,
      reasonCode: row.reasonCode,
      reasonText: row.reasonText,
      requestId: row.requestId,
      correlationId: row.correlationId,
      traceId: row.traceId,
      idempotencyKey: row.idempotencyKey,
      before: this.sanitize(row.before ?? row.oldValues),
      after: this.sanitize(row.after ?? row.newValues),
      metadata: this.sanitize(row.metadata),
      source: row.source,
      environment: row.environment,
      releaseVersion: row.releaseVersion,
      legacy,
      contextAvailable: !legacy,
    };
  }

  private sanitize(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined || value === null) return undefined;
    const sanitized = this.sanitizeNode(value, 0, null);
    if (sanitized === undefined) return undefined;
    const serialized = JSON.stringify(sanitized);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_JSON_BYTES) {
      throw new BadRequestException('El contexto de auditoría supera el tamaño permitido.');
    }
    return JSON.parse(serialized) as Prisma.InputJsonValue;
  }

  private sanitizeNode(value: unknown, depth: number, key: string | null): unknown {
    if (depth > MAX_DEPTH) return '[TRUNCATED_DEPTH]';
    if (value === null) return null;
    if (key && BLOCKED_KEY.test(key)) return '[REDACTED]';
    if (key && PHONE_KEY.test(key)) return this.maskPhone(value);
    if (typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'string') return value.slice(0, MAX_STRING_LENGTH);
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) {
      return value.slice(0, MAX_COLLECTION_LENGTH).map((item) => this.sanitizeNode(item, depth + 1, key));
    }
    if (typeof value === 'object') {
      const output: Record<string, unknown> = {};
      for (const [entryKey, entryValue] of Object.entries(value).slice(0, MAX_COLLECTION_LENGTH)) {
        output[entryKey] = this.sanitizeNode(entryValue, depth + 1, entryKey);
      }
      return output;
    }
    return String(value).slice(0, MAX_STRING_LENGTH);
  }

  private maskPhone(value: unknown) {
    const digits = String(value ?? '').replace(/\D/g, '');
    return digits ? `***${digits.slice(-4)}` : '[REDACTED]';
  }

  private sanitizeText(value: unknown, max = MAX_STRING_LENGTH): string | null {
    if (typeof value !== 'string') return null;
    const clean = value.replace(/[\r\n\t]+/g, ' ').trim();
    return clean ? clean.slice(0, max) : null;
  }

  private sanitizeNetworkValue(value: string | undefined) {
    if (!value) return null;
    return /^(127\.0\.0\.1|::1)$/.test(value) ? value : '[REDACTED]';
  }

  private requiredIdentifier(value: string, field: string, max: number) {
    const normalized = this.identifier(value, max);
    if (!normalized) throw new BadRequestException(`Audit ${field} is required.`);
    return normalized;
  }

  private identifier(value: string | null | undefined, max: number): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return /^[A-Za-z0-9._:-]+$/.test(trimmed) ? trimmed.slice(0, max) : null;
  }

  private traceId(value: string | null | undefined) {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return /^[a-f0-9]{32}$/.test(normalized) ? normalized : null;
  }

  private inferResult(action: string): AuditResult {
    const normalized = action.toUpperCase();
    if (/(DENIED|BLOCKED|DISABLED)/.test(normalized)) return 'BLOCKED';
    if (/(REJECT|INVALID)/.test(normalized)) return 'REJECTED';
    if (/(CONFLICT|DUPLICATE|STALE)/.test(normalized)) return 'CONFLICT';
    if (/(FAIL|ERROR)/.test(normalized)) return 'FAILED';
    if (/(ROLLBACK|REVERT)/.test(normalized)) return 'ROLLED_BACK';
    return 'SUCCESS';
  }

  private defaultReasonCode(input: AuditInput) {
    return `${input.module}_${input.action}`.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase().slice(0, 128);
  }
}
