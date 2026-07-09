import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CashMovementType, CashSessionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toDecimal } from '../../common/utils/decimal.util';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  findAll() {
    return this.prisma.expense.findMany({
      include: {
        paymentMethod: true,
        cashSession: true,
        createdBy: true,
      },
      orderBy: {
        spentAt: 'desc',
      },
    });
  }

  async create(dto: CreateExpenseDto, actorId: string) {
    const spentAt = dto.spentAt ? new Date(dto.spentAt) : new Date();
    if (dto.paymentMethodId) {
      const paymentMethod = await this.prisma.paymentMethod.findUnique({
        where: { id: dto.paymentMethodId },
      });

      if (!paymentMethod || !paymentMethod.isActive) {
        throw new BadRequestException('El método de pago no existe o está inactivo.');
      }
    }

    const currentSession = await this.prisma.cashSession.findFirst({
      where: { status: CashSessionStatus.OPEN },
      orderBy: { openedAt: 'desc' },
    });

    const expense = await this.prisma.expense.create({
      data: {
        concept: dto.concept,
        classification: dto.classification?.trim() || dto.concept.trim(),
        description: dto.description,
        amount: toDecimal(dto.amount),
        spentAt,
        paymentMethodId: dto.paymentMethodId,
        cashSessionId: currentSession?.id,
        createdById: actorId,
      },
      include: {
        paymentMethod: true,
        cashSession: true,
      },
    });

    if (currentSession) {
      await this.prisma.cashMovement.create({
        data: {
          cashSessionId: currentSession.id,
          type: CashMovementType.EXPENSE,
          amount: toDecimal(dto.amount),
          description: dto.concept,
          paymentMethodId: dto.paymentMethodId,
          referenceType: 'expense',
          referenceId: expense.id,
          createdById: actorId,
        },
      });
    }

    await this.auditService.log({
      userId: actorId,
      action: 'CREATE',
      module: 'expenses',
      entity: 'expense',
      entityId: expense.id,
      newValues: dto,
    });

    return expense;
  }

  async update(id: string, dto: UpdateExpenseDto, actorId: string) {
    const existing = await this.prisma.expense.findUnique({
      where: { id },
      include: {
        cashSession: true,
      },
    });

    if (!existing) {
      throw new NotFoundException('No se encontró el gasto.');
    }

    if (existing.cashSession?.status === CashSessionStatus.CLOSED) {
      throw new BadRequestException('No puedes editar un gasto de una sesión de caja ya cerrada.');
    }

    const expense = await this.prisma.expense.update({
      where: { id },
      data: {
        concept: dto.concept,
        classification: dto.classification?.trim() || undefined,
        description: dto.description,
        amount: dto.amount != null ? toDecimal(dto.amount) : undefined,
        paymentMethodId: dto.paymentMethodId,
        spentAt: dto.spentAt ? new Date(dto.spentAt) : undefined,
      },
    });

    await this.auditService.log({
      userId: actorId,
      action: 'UPDATE',
      module: 'expenses',
      entity: 'expense',
      entityId: id,
      oldValues: existing,
      newValues: dto,
    });

    return expense;
  }
}
