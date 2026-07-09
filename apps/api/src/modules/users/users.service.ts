import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { hash } from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';

const ARCHIVED_USER_EMAIL = 'archivo.usuarios@2x1burgerco.local';
const ARCHIVED_USER_NAME = 'Usuario archivado del sistema';
const ARCHIVED_USER_PASSWORD = 'ArchivoUsuarios12345*';
const WAITER_EMAIL_DOMAIN = 'meseros.2x1burgerco.local';
const DELIVERY_EMAIL_DOMAIN = 'domiciliarios.2x1burgerco.local';
const OPERATIONAL_ROLE_NAMES = ['waiter', 'delivery'] as const;
type OperationalRoleName = (typeof OPERATIONAL_ROLE_NAMES)[number];

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async findAll() {
    const users = await this.prisma.user.findMany({
      where: {
        email: {
          not: ARCHIVED_USER_EMAIL,
        },
      },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return users.map((user) => ({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      accessName: user.accessName,
      hasAccessCode: Boolean(user.accessCodeHash),
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      roles: user.roles.map(({ role }) => ({
        id: role.id,
        name: role.name,
      })),
    }));
  }

  async create(dto: CreateUserDto, actorId: string) {
    const roleNames = await this.getRoleNames(dto.roleIds);
    const operationalRole = this.resolveOperationalOnlyRole(roleNames);
    const passwordHash = await hash(this.resolvePasswordValue(dto.password, Boolean(operationalRole)), 12);
    const accessData = await this.resolveAccessData(
      dto.roleIds,
      operationalRole ? dto.fullName : dto.accessName,
      dto.accessCode,
    );

    const user = await this.prisma.user.create({
      data: {
        email: await this.resolveEmailValue(dto.email, dto.fullName, operationalRole),
        fullName: dto.fullName,
        passwordHash,
        accessName: accessData.accessName,
        accessCodeHash: accessData.accessCodeHash,
        roles: {
          createMany: {
            data: dto.roleIds.map((roleId) => ({
              roleId,
              assignedById: actorId,
            })),
          },
        },
      },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });

    await this.auditService.log({
      userId: actorId,
      action: 'CREATE',
      module: 'users',
      entity: 'user',
      entityId: user.id,
      newValues: {
        email: user.email,
        fullName: user.fullName,
        roleIds: dto.roleIds,
        accessName: accessData.accessName,
        hasAccessCode: Boolean(accessData.accessCodeHash),
      },
    });

    return user;
  }

  async update(id: string, dto: UpdateUserDto, actorId: string) {
    const existing = await this.prisma.user.findUnique({
      where: { id },
      include: {
        roles: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('No se encontró el usuario.');
    }

    const nextRoleIds = dto.roleIds ?? existing.roles.map((role) => role.roleId);
    const roleNames = await this.getRoleNames(nextRoleIds);
    const operationalRole = this.resolveOperationalOnlyRole(roleNames);
    const passwordHash =
      dto.password && !operationalRole ? await hash(dto.password, 12) : undefined;
    const accessData = await this.resolveAccessData(
      nextRoleIds,
      operationalRole ? dto.fullName ?? existing.fullName : dto.accessName,
      dto.accessCode,
      existing.accessName,
      existing.accessCodeHash,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.roleIds) {
        await tx.userRole.deleteMany({ where: { userId: id } });
      }

      return tx.user.update({
        where: { id },
        data: {
          email: operationalRole ? existing.email : dto.email?.toLowerCase(),
          fullName: dto.fullName,
          passwordHash,
          accessName: accessData.accessName,
          accessCodeHash: accessData.accessCodeHash,
          roles: dto.roleIds
            ? {
                createMany: {
                  data: dto.roleIds.map((roleId) => ({
                    roleId,
                    assignedById: actorId,
                  })),
                },
              }
            : undefined,
        },
        include: {
          roles: {
            include: { role: true },
          },
        },
      });
    });

    if (operationalRole && (dto.fullName !== undefined || dto.accessCode !== undefined || dto.accessName !== undefined)) {
      await this.invalidateUserSessions(id);
    }

    await this.auditService.log({
      userId: actorId,
      action: 'UPDATE',
      module: 'users',
      entity: 'user',
      entityId: id,
      oldValues: {
        email: existing.email,
        fullName: existing.fullName,
        roleIds: existing.roles.map((role) => role.roleId),
        accessName: existing.accessName,
        hasAccessCode: Boolean(existing.accessCodeHash),
      },
      newValues: {
        ...dto,
        accessName: accessData.accessName,
        hasAccessCode: Boolean(accessData.accessCodeHash),
      },
    });

    return updated;
  }

  async updateStatus(id: string, dto: UpdateUserStatusDto, actorId: string) {
    const user = await this.prisma.user.update({
      where: { id },
      data: { isActive: dto.isActive },
    });

    if (!dto.isActive) {
      await this.invalidateUserSessions(id);
    }

    await this.auditService.log({
      userId: actorId,
      action: 'STATUS_CHANGE',
      module: 'users',
      entity: 'user',
      entityId: id,
      newValues: dto,
    });

    return user;
  }

  async remove(id: string, actorId: string) {
    if (id === actorId) {
      throw new BadRequestException('No puedes eliminar tu propia cuenta mientras estás en sesión.');
    }

    const existing = await this.prisma.user.findUnique({
      where: { id },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
        _count: {
          select: {
            purchases: true,
            sales: true,
            orderTickets: true,
            openedSessions: true,
            expenses: true,
            reports: true,
            auditLogs: true,
            stockCounts: true,
            approvedStockCounts: true,
          },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException('No se encontró el usuario.');
    }

    if (existing.email === ARCHIVED_USER_EMAIL) {
      throw new BadRequestException('La cuenta interna de archivo no se puede eliminar.');
    }

    const archivedUserId = await this.ensureArchivedUser(actorId);

    await this.prisma.$transaction(async (tx) => {
      await tx.purchase.updateMany({
        where: { createdById: id },
        data: { createdById: archivedUserId },
      });
      await tx.sale.updateMany({
        where: { createdById: id },
        data: { createdById: archivedUserId },
      });
      await tx.orderTicket.updateMany({
        where: { createdById: id },
        data: { createdById: archivedUserId },
      });
      await tx.cashSession.updateMany({
        where: { openedById: id },
        data: { openedById: archivedUserId },
      });
      await tx.expense.updateMany({
        where: { createdById: id },
        data: { createdById: archivedUserId },
      });
      await tx.stockCountSession.updateMany({
        where: { createdById: id },
        data: { createdById: archivedUserId },
      });
      await tx.reportSnapshot.updateMany({
        where: { generatedById: id },
        data: { generatedById: archivedUserId },
      });
      await tx.inventoryMovement.updateMany({
        where: { performedById: id },
        data: { performedById: archivedUserId },
      });
      await tx.cashMovement.updateMany({
        where: { createdById: id },
        data: { createdById: archivedUserId },
      });
      await tx.supplierNotification.updateMany({
        where: { createdById: id },
        data: { createdById: archivedUserId },
      });
      await tx.stockCountSession.updateMany({
        where: { approvedById: id },
        data: { approvedById: archivedUserId },
      });
      await tx.cashSession.updateMany({
        where: { closedById: id },
        data: { closedById: archivedUserId },
      });
      await tx.cashSession.updateMany({
        where: { reopenedById: id },
        data: { reopenedById: archivedUserId },
      });
      await tx.auditLog.updateMany({
        where: { userId: id },
        data: { userId: archivedUserId },
      });
      await tx.user.delete({
        where: { id },
      });
    });

    await this.auditService.log({
      userId: actorId,
      action: 'DELETE',
      module: 'users',
      entity: 'user',
      entityId: id,
      oldValues: {
        email: existing.email,
        fullName: existing.fullName,
        isActive: existing.isActive,
        roleIds: existing.roles.map((role) => role.role.id),
      },
    });

    return {
      success: true,
      id,
    };
  }

  private async ensureArchivedUser(actorId: string) {
    const existing = await this.prisma.user.findUnique({
      where: { email: ARCHIVED_USER_EMAIL },
      select: { id: true },
    });

    if (existing) {
      return existing.id;
    }

    const passwordHash = await hash(ARCHIVED_USER_PASSWORD, 12);
    const archived = await this.prisma.user.create({
      data: {
        email: ARCHIVED_USER_EMAIL,
        fullName: ARCHIVED_USER_NAME,
        passwordHash,
        isActive: false,
      },
    });

    await this.auditService.log({
      userId: actorId,
      action: 'CREATE',
      module: 'users',
      entity: 'user',
      entityId: archived.id,
      newValues: {
        email: archived.email,
        fullName: archived.fullName,
        internal: true,
      },
    });

    return archived.id;
  }

  private async resolveAccessData(
    roleIds: string[],
    accessName?: string,
    accessCode?: string,
    existingAccessName?: string | null,
    existingAccessCodeHash?: string | null,
  ) {
    const roles = await this.prisma.role.findMany({
      where: {
        id: {
          in: roleIds,
        },
      },
      select: {
        name: true,
      },
    });

    const operationalRole = roles
      .map((role) => role.name)
      .find((role): role is OperationalRoleName =>
        (OPERATIONAL_ROLE_NAMES as readonly string[]).includes(role),
      );

    if (!operationalRole) {
      return {
        accessName: null,
        accessCodeHash: null,
      };
    }

    const normalizedAccessName =
      accessName !== undefined
        ? this.normalizeAccessName(accessName)
        : existingAccessName ?? null;

    if (!normalizedAccessName) {
      throw new BadRequestException(
        operationalRole === 'delivery'
          ? 'Debes asignar un nombre de acceso para el domiciliario.'
          : 'Debes asignar un nombre de acceso para el mesero.',
      );
    }

    const nextAccessCodeHash =
      accessCode !== undefined && accessCode.trim()
        ? await hash(accessCode.trim(), 12)
        : existingAccessCodeHash ?? null;

    if (!nextAccessCodeHash) {
      throw new BadRequestException(
        operationalRole === 'delivery'
          ? 'Debes asignar un código de acceso para el domiciliario.'
          : 'Debes asignar un código de acceso para el mesero.',
      );
    }

    return {
      accessName: normalizedAccessName,
      accessCodeHash: nextAccessCodeHash,
    };
  }

  private async getRoleNames(roleIds: string[]) {
    const roles = await this.prisma.role.findMany({
      where: {
        id: {
          in: roleIds,
        },
      },
      select: {
        name: true,
      },
    });

    return roles.map((role) => role.name);
  }

  private resolveOperationalOnlyRole(roleNames: string[]) {
    return (OPERATIONAL_ROLE_NAMES as readonly string[]).find(
      (roleName) => roleNames.includes(roleName) && roleNames.every((currentRoleName) => currentRoleName === roleName),
    ) as OperationalRoleName | undefined;
  }

  private resolvePasswordValue(password: string | undefined, operationalOnly: boolean) {
    if (password?.trim()) {
      return password.trim();
    }

    if (operationalOnly) {
      return `operational-${randomUUID()}`;
    }

    throw new BadRequestException('Debes asignar una contraseña al usuario del sistema.');
  }

  private async resolveEmailValue(
    email: string | undefined,
    fullName: string,
    operationalRole: OperationalRoleName | undefined,
  ) {
    if (!operationalRole) {
      if (!email?.trim()) {
        throw new BadRequestException('Debes asignar un correo al usuario del sistema.');
      }

      return email.trim().toLowerCase();
    }

    const base = this.slugifyWaiterName(fullName) || (operationalRole === 'delivery' ? 'domiciliario' : 'mesero');
    const domain = operationalRole === 'delivery' ? DELIVERY_EMAIL_DOMAIN : WAITER_EMAIL_DOMAIN;
    return `${base}.${randomUUID().slice(0, 8)}@${domain}`;
  }

  private async invalidateUserSessions(userId: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: {
          sessionVersion: {
            increment: 1,
          },
        },
      });
    });
  }

  private normalizeAccessName(value: string) {
    const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
    return normalized || null;
  }

  private slugifyWaiterName(value: string) {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.+|\.+$/g, '');
  }
}
