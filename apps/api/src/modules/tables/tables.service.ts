import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DiningTableStatus, OrderTicketStatus, Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/types/auth-user.type';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AssignTableGroupDto } from './dto/assign-table-group.dto';
import { CreateDiningTableDto } from './dto/create-dining-table.dto';
import { CreateTableGroupDto } from './dto/create-table-group.dto';
import { CreateWaiterAssignmentDto } from './dto/create-waiter-assignment.dto';
import { UpdateDiningTableDto } from './dto/update-dining-table.dto';
import { UpdateTableGroupDto } from './dto/update-table-group.dto';
import { UpdateWaiterAssignmentDto } from './dto/update-waiter-assignment.dto';

const ACTIVE_ORDER_STATUSES: OrderTicketStatus[] = [
  OrderTicketStatus.OPEN,
  OrderTicketStatus.IN_PREPARATION,
  OrderTicketStatus.SERVED,
  OrderTicketStatus.PAYMENT_PENDING,
];

const waiterTableSelect = {
  id: true,
  label: true,
  area: true,
  groupId: true,
  group: {
    select: {
      id: true,
      name: true,
      area: true,
      color: true,
      isActive: true,
    },
  },
  capacity: true,
  status: true,
  isActive: true,
  orderTickets: {
    where: {
      status: {
        in: ACTIVE_ORDER_STATUSES,
      },
    },
    select: {
      id: true,
      number: true,
      status: true,
      subtotal: true,
      updatedAt: true,
      createdById: true,
      assignedWaiterId: true,
      waiterNameSnapshot: true,
      waiterAccessNameSnapshot: true,
      assignedWaiter: {
        select: {
          id: true,
          fullName: true,
          accessName: true,
        },
      },
      _count: {
        select: {
          items: true,
        },
      },
    },
    orderBy: {
      openedAt: 'desc',
    },
    take: 1,
  },
} as const;

const tableGroupInclude = {
  tables: {
    select: {
      id: true,
      label: true,
      area: true,
      status: true,
      isActive: true,
    },
    orderBy: [{ area: 'asc' as const }, { label: 'asc' as const }],
  },
  assignments: {
    where: { isActive: true },
    include: {
      waiter: {
        select: {
          id: true,
          fullName: true,
          accessName: true,
          isActive: true,
        },
      },
    },
    orderBy: { assignedAt: 'desc' as const },
  },
} satisfies Prisma.TableGroupInclude;

type TableAssignmentClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class TablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly realtimeService: RealtimeService,
  ) {}

  private isPrivilegedTableOperator(actor?: AuthUser) {
    return !actor || actor.roles.some((role) => ['admin', 'cashier', 'supervisor'].includes(role));
  }

  async hasAnyActiveWaiterAssignments(client: TableAssignmentClient = this.prisma) {
    const [groupAssignments, tableAssignments] = await Promise.all([
      client.waiterTableGroupAssignment.count({
        where: { isActive: true, tableGroup: { isActive: true } },
      }),
      client.waiterTableAssignment.count({
        where: { isActive: true, table: { isActive: true } },
      }),
    ]);

    return groupAssignments + tableAssignments > 0;
  }

  async findAssignedTableIdsForWaiter(
    waiterId: string,
    client: TableAssignmentClient = this.prisma,
  ) {
    const [groupAssignments, directAssignments, allActiveDirectAssignments] = await Promise.all([
      client.waiterTableGroupAssignment.findMany({
        where: {
          waiterId,
          isActive: true,
          tableGroup: { isActive: true },
        },
        select: {
          tableGroup: {
            select: {
              tables: {
                where: { isActive: true },
                select: { id: true },
              },
            },
          },
        },
      }),
      client.waiterTableAssignment.findMany({
        where: {
          waiterId,
          isActive: true,
          table: { isActive: true },
        },
        select: { tableId: true },
      }),
      client.waiterTableAssignment.findMany({
        where: {
          isActive: true,
          table: { isActive: true },
        },
        select: {
          waiterId: true,
          tableId: true,
        },
      }),
    ]);

    const directTableOwner = new Map(
      allActiveDirectAssignments.map((assignment) => [assignment.tableId, assignment.waiterId]),
    );

    return new Set([
      ...directAssignments.map((assignment) => assignment.tableId),
      ...groupAssignments.flatMap((assignment) =>
        assignment.tableGroup.tables
          .map((table) => table.id)
          .filter((tableId) => {
            const directOwnerId = directTableOwner.get(tableId);
            return !directOwnerId || directOwnerId === waiterId;
          }),
      ),
    ]);
  }

  async assertWaiterCanOperateTable(
    actor: AuthUser,
    tableId: string | null | undefined,
    client: TableAssignmentClient = this.prisma,
  ) {
    if (this.isPrivilegedTableOperator(actor) || !actor.roles.includes('waiter')) {
      return;
    }

    if (!tableId) {
      throw new BadRequestException('Meseros solo pueden guardar comandas asociadas a una mesa.');
    }

    const table = await client.diningTable.findUnique({
      where: { id: tableId },
      select: { id: true, isActive: true, status: true },
    });

    if (!table || !table.isActive || table.status === DiningTableStatus.OUT_OF_SERVICE) {
      throw new BadRequestException('La mesa no está disponible para operación.');
    }

    if (!(await this.hasAnyActiveWaiterAssignments(client))) {
      return;
    }

    const assignedTableIds = await this.findAssignedTableIdsForWaiter(actor.sub, client);
    if (!assignedTableIds.has(tableId)) {
      throw new ConflictException('No tienes esta mesa asignada. Consulta con el administrador.');
    }
  }

  async findWaiterView(actor?: AuthUser) {
    const where: Prisma.DiningTableWhereInput = {};

    if (!this.isPrivilegedTableOperator(actor) && actor?.roles.includes('waiter')) {
      if (await this.hasAnyActiveWaiterAssignments()) {
        const assignedTableIds = await this.findAssignedTableIdsForWaiter(actor.sub);
        if (!assignedTableIds.size) {
          return [];
        }
        where.id = { in: [...assignedTableIds] };
      }
    }

    return this.prisma.diningTable.findMany({
      where,
      select: waiterTableSelect,
      orderBy: [{ area: 'asc' }, { label: 'asc' }],
    });
  }

  findAll() {
    return this.prisma.diningTable.findMany({
      include: {
        group: true,
        orderTickets: {
          where: {
            status: {
              in: ACTIVE_ORDER_STATUSES,
            },
          },
          include: {
            table: true,
            assignedWaiter: {
              select: {
                id: true,
                fullName: true,
                accessName: true,
              },
            },
            items: {
              include: {
                product: true,
              },
            },
          },
          orderBy: {
            openedAt: 'desc',
          },
          take: 1,
        },
      },
      orderBy: [{ area: 'asc' }, { label: 'asc' }],
    });
  }

  async create(dto: CreateDiningTableDto, actorId: string) {
    if (dto.groupId) {
      await this.assertActiveTableGroup(dto.groupId);
    }

    const table = await this.prisma.diningTable.create({
      data: {
        label: dto.label.trim(),
        area: dto.area?.trim() || null,
        groupId: dto.groupId || null,
        capacity: dto.capacity,
        status: (dto.status as DiningTableStatus | undefined) ?? DiningTableStatus.FREE,
        isActive: dto.isActive ?? true,
        notes: dto.notes?.trim() || null,
      },
    });

    await this.auditService.log({
      userId: actorId,
      action: 'CREATE',
      module: 'tables',
      entity: 'dining_table',
      entityId: table.id,
      newValues: dto,
    });

    this.realtimeService.publishOperationalRefresh('tables');

    return table;
  }

  async update(id: string, dto: UpdateDiningTableDto, actorId: string) {
    const table = await this.prisma.diningTable.findUnique({
      where: { id },
      include: {
        orderTickets: {
          where: {
            status: {
              in: ACTIVE_ORDER_STATUSES,
            },
          },
        },
      },
    });

    if (!table) {
      throw new NotFoundException('No se encontró la mesa.');
    }

    if (table.orderTickets.length && (dto.status || dto.isActive === false)) {
      throw new BadRequestException('No puedes desactivar ni cambiar el estado de una mesa con comandas activas.');
    }

    if (dto.groupId) {
      await this.assertActiveTableGroup(dto.groupId);
    }

    const updated = await this.prisma.diningTable.update({
      where: { id },
      data: {
        label: dto.label?.trim(),
        area: dto.area === undefined ? undefined : dto.area.trim() || null,
        groupId: dto.groupId === undefined ? undefined : dto.groupId || null,
        capacity: dto.capacity,
        status: dto.status as DiningTableStatus | undefined,
        isActive: dto.isActive,
        notes: dto.notes === undefined ? undefined : dto.notes.trim() || null,
      },
    });

    await this.auditService.log({
      userId: actorId,
      action: 'UPDATE',
      module: 'tables',
      entity: 'dining_table',
      entityId: updated.id,
      oldValues: table,
      newValues: dto,
    });

    this.realtimeService.publishOperationalRefresh('tables');

    return updated;
  }

  async deleteTable(id: string, actorId: string) {
    const table = await this.prisma.diningTable.findUnique({
      where: { id },
      include: {
        orderTickets: {
          select: {
            id: true,
            status: true,
          },
        },
        waiterAssignments: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!table) {
      throw new NotFoundException('No se encontró la mesa.');
    }

    const activeOrders = table.orderTickets.filter((order) => ACTIVE_ORDER_STATUSES.includes(order.status));
    if (activeOrders.length) {
      throw new BadRequestException('No puedes eliminar una mesa con comandas activas. Cierra o cancela la comanda primero.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.waiterTableAssignment.deleteMany({ where: { tableId: id } });
      await tx.diningTable.delete({ where: { id } });
    });

    await this.auditService.log({
      userId: actorId,
      action: 'DELETE',
      module: 'tables',
      entity: 'dining_table',
      entityId: id,
      oldValues: table,
    });

    this.realtimeService.publishOperationalRefresh('tables');

    return { success: true, mode: 'deleted' as const };
  }

  findTableGroups() {
    return this.prisma.tableGroup.findMany({
      include: tableGroupInclude,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  async createTableGroup(dto: CreateTableGroupDto, actorId: string) {
    const group = await this.prisma.tableGroup.create({
      data: {
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        area: dto.area?.trim() || null,
        color: dto.color?.trim() || null,
        isActive: dto.isActive ?? true,
      },
      include: tableGroupInclude,
    });

    await this.auditService.log({
      userId: actorId,
      action: 'CREATE',
      module: 'tables',
      entity: 'table_group',
      entityId: group.id,
      newValues: dto,
    });

    this.realtimeService.publishOperationalRefresh('tables');
    return group;
  }

  async updateTableGroup(id: string, dto: UpdateTableGroupDto, actorId: string) {
    const current = await this.prisma.tableGroup.findUnique({ where: { id } });
    if (!current) {
      throw new NotFoundException('No se encontró el grupo de mesas.');
    }

    const updated = await this.prisma.tableGroup.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        description: dto.description === undefined ? undefined : dto.description.trim() || null,
        area: dto.area === undefined ? undefined : dto.area.trim() || null,
        color: dto.color === undefined ? undefined : dto.color.trim() || null,
        isActive: dto.isActive,
      },
      include: tableGroupInclude,
    });

    await this.auditService.log({
      userId: actorId,
      action: 'UPDATE',
      module: 'tables',
      entity: 'table_group',
      entityId: updated.id,
      oldValues: current,
      newValues: dto,
    });

    this.realtimeService.publishOperationalRefresh('tables');
    return updated;
  }

  async deactivateTableGroup(id: string, actorId: string) {
    return this.deleteTableGroup(id, actorId);
  }

  async deleteTableGroup(id: string, actorId: string) {
    const group = await this.prisma.tableGroup.findUnique({
      where: { id },
      include: {
        tables: { select: { id: true } },
        assignments: { select: { id: true } },
      },
    });

    if (!group) {
      throw new NotFoundException('No se encontró el grupo de mesas.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.waiterTableGroupAssignment.deleteMany({
        where: { tableGroupId: id },
      });
      await tx.diningTable.updateMany({
        where: { groupId: id },
        data: { groupId: null },
      });
      await tx.tableGroup.delete({ where: { id } });
    });

    await this.auditService.log({
      userId: actorId,
      action: 'DELETE',
      module: 'tables',
      entity: 'table_group',
      entityId: id,
      oldValues: group,
      newValues: { detachedTables: group.tables.map((table) => table.id) },
    });

    this.realtimeService.publishOperationalRefresh('tables');
    return { success: true, mode: 'deleted' as const };
  }

  async assignTableGroup(tableId: string, dto: AssignTableGroupDto, actorId: string) {
    const table = await this.prisma.diningTable.findUnique({ where: { id: tableId } });
    if (!table) {
      throw new NotFoundException('No se encontró la mesa.');
    }

    if (dto.groupId) {
      await this.assertActiveTableGroup(dto.groupId);
    }

    const updated = await this.prisma.diningTable.update({
      where: { id: tableId },
      data: { groupId: dto.groupId || null },
      include: { group: true },
    });

    await this.auditService.log({
      userId: actorId,
      action: 'ASSIGN_GROUP',
      module: 'tables',
      entity: 'dining_table',
      entityId: tableId,
      oldValues: { groupId: table.groupId },
      newValues: { groupId: dto.groupId || null },
    });

    this.realtimeService.publishOperationalRefresh('tables');
    return updated;
  }

  async addTableToGroup(groupId: string, tableId: string, actorId: string) {
    await this.assertActiveTableGroup(groupId);
    return this.assignTableGroup(tableId, { groupId }, actorId);
  }

  async removeTableFromGroup(groupId: string, tableId: string, actorId: string) {
    const table = await this.prisma.diningTable.findUnique({ where: { id: tableId } });
    if (!table) {
      throw new NotFoundException('No se encontró la mesa.');
    }
    if (table.groupId !== groupId) {
      throw new BadRequestException('La mesa no pertenece a este grupo.');
    }
    return this.assignTableGroup(tableId, { groupId: null }, actorId);
  }

  async findWaiterAssignments() {
    const [groupAssignments, tableAssignments] = await Promise.all([
      this.prisma.waiterTableGroupAssignment.findMany({
        include: {
          waiter: { select: { id: true, fullName: true, accessName: true, isActive: true } },
          tableGroup: { include: { tables: true } },
          assignedBy: { select: { id: true, fullName: true } },
        },
        orderBy: [{ isActive: 'desc' }, { assignedAt: 'desc' }],
      }),
      this.prisma.waiterTableAssignment.findMany({
        include: {
          waiter: { select: { id: true, fullName: true, accessName: true, isActive: true } },
          table: true,
          assignedBy: { select: { id: true, fullName: true } },
        },
        orderBy: [{ isActive: 'desc' }, { assignedAt: 'desc' }],
      }),
    ]);

    return [
      ...groupAssignments.map((assignment) => ({ ...assignment, scope: 'GROUP' as const })),
      ...tableAssignments.map((assignment) => ({ ...assignment, scope: 'TABLE' as const })),
    ];
  }

  async findMyWaiterAssignments(actor: AuthUser) {
    const [assignments, tableIds, globalAssignmentsActive] = await Promise.all([
      this.findWaiterAssignments(),
      this.findAssignedTableIdsForWaiter(actor.sub),
      this.hasAnyActiveWaiterAssignments(),
    ]);

    return {
      assignments: assignments.filter((assignment) => assignment.waiterId === actor.sub),
      tableIds: [...tableIds],
      globalAssignmentsActive,
    };
  }

  async createWaiterAssignment(dto: CreateWaiterAssignmentDto, actorId: string) {
    const waiter = await this.assertWaiterUser(dto.waiterId);

    if (dto.scope === 'GROUP') {
      if (!dto.tableGroupId) {
        throw new BadRequestException('Selecciona un grupo para asignarlo al mesero.');
      }
      await this.assertActiveTableGroup(dto.tableGroupId);

      const assignment = await this.replaceGroupAssignment(dto.tableGroupId, dto.waiterId, actorId, dto.isActive ?? true);

      await this.auditService.log({
        userId: actorId,
        action: 'REPLACE_WAITER_GROUP_ASSIGNMENT',
        module: 'tables',
        entity: 'waiter_table_group_assignment',
        entityId: assignment.id,
        newValues: { ...dto, waiterName: waiter.fullName },
      });

      this.realtimeService.publishOperationalRefresh('tables');
      return { ...assignment, scope: 'GROUP' as const };
    }

    if (!dto.tableId) {
      throw new BadRequestException('Selecciona una mesa para asignarla al mesero.');
    }
    await this.assertActiveTable(dto.tableId);

    const assignment = await this.replaceTableAssignment(dto.tableId, dto.waiterId, actorId, dto.isActive ?? true);

    await this.auditService.log({
      userId: actorId,
      action: 'ASSIGN_WAITER_TABLE',
      module: 'tables',
      entity: 'waiter_table_assignment',
      entityId: assignment.id,
      newValues: { ...dto, waiterName: waiter.fullName },
    });

    this.realtimeService.publishOperationalRefresh('tables');
    return { ...assignment, scope: 'TABLE' as const };
  }

  async replaceGroupAssignment(tableGroupId: string, waiterId: string, actorId: string, isActive = true) {
    await this.assertWaiterUser(waiterId);
    await this.assertActiveTableGroup(tableGroupId);

    return this.prisma.$transaction(async (tx) => {
      if (isActive) {
        const groupTables = await tx.diningTable.findMany({
          where: { groupId: tableGroupId, isActive: true },
          select: { id: true },
        });

        const groupAssignmentsToDeactivate = await tx.waiterTableGroupAssignment.findMany({
          where: {
            tableGroupId,
            isActive: true,
            waiterId: { not: waiterId },
          },
          select: { id: true, waiterId: true, tableGroupId: true },
        });

        for (const assignment of groupAssignmentsToDeactivate) {
          await tx.waiterTableGroupAssignment.deleteMany({
            where: {
              waiterId: assignment.waiterId,
              tableGroupId: assignment.tableGroupId,
              isActive: false,
            },
          });
          await tx.waiterTableGroupAssignment.update({
            where: { id: assignment.id },
            data: { isActive: false },
          });
        }

        if (groupTables.length) {
          const tableAssignmentsToDeactivate = await tx.waiterTableAssignment.findMany({
            where: {
              tableId: { in: groupTables.map((table) => table.id) },
              isActive: true,
              waiterId: { not: waiterId },
            },
            select: { id: true, waiterId: true, tableId: true },
          });

          for (const assignment of tableAssignmentsToDeactivate) {
            await tx.waiterTableAssignment.deleteMany({
              where: {
                waiterId: assignment.waiterId,
                tableId: assignment.tableId,
                isActive: false,
              },
            });
            await tx.waiterTableAssignment.update({
              where: { id: assignment.id },
              data: { isActive: false },
            });
          }
        }
      }

      const activeAssignment = await tx.waiterTableGroupAssignment.findFirst({
        where: {
          waiterId,
          tableGroupId,
          isActive: true,
        },
      });

      if (activeAssignment) {
        return tx.waiterTableGroupAssignment.update({
          where: { id: activeAssignment.id },
          data: {
            isActive,
            assignedById: actorId,
            assignedAt: new Date(),
          },
          include: {
            waiter: { select: { id: true, fullName: true, accessName: true, isActive: true } },
            tableGroup: true,
            assignedBy: { select: { id: true, fullName: true } },
          },
        });
      }

      return tx.waiterTableGroupAssignment.create({
        data: {
          waiterId,
          tableGroupId,
          isActive,
          assignedById: actorId,
        },
        include: {
          waiter: { select: { id: true, fullName: true, accessName: true, isActive: true } },
          tableGroup: true,
          assignedBy: { select: { id: true, fullName: true } },
        },
      });
    });
  }

  async replaceTableAssignment(tableId: string, waiterId: string, actorId: string, isActive = true) {
    await this.assertWaiterUser(waiterId);
    await this.assertActiveTable(tableId);

    return this.prisma.$transaction(async (tx) => {
      if (isActive) {
        const tableAssignmentsToDeactivate = await tx.waiterTableAssignment.findMany({
          where: {
            tableId,
            isActive: true,
            waiterId: { not: waiterId },
          },
          select: { id: true, waiterId: true, tableId: true },
        });

        for (const assignment of tableAssignmentsToDeactivate) {
          await tx.waiterTableAssignment.deleteMany({
            where: {
              waiterId: assignment.waiterId,
              tableId: assignment.tableId,
              isActive: false,
            },
          });
          await tx.waiterTableAssignment.update({
            where: { id: assignment.id },
            data: { isActive: false },
          });
        }
      }

      const activeAssignment = await tx.waiterTableAssignment.findFirst({
        where: {
          waiterId,
          tableId,
          isActive: true,
        },
      });

      if (activeAssignment) {
        return tx.waiterTableAssignment.update({
          where: { id: activeAssignment.id },
          data: {
            isActive,
            assignedById: actorId,
            assignedAt: new Date(),
          },
          include: {
            waiter: { select: { id: true, fullName: true, accessName: true, isActive: true } },
            table: true,
            assignedBy: { select: { id: true, fullName: true } },
          },
        });
      }

      return tx.waiterTableAssignment.create({
        data: {
          waiterId,
          tableId,
          isActive,
          assignedById: actorId,
        },
        include: {
          waiter: { select: { id: true, fullName: true, accessName: true, isActive: true } },
          table: true,
          assignedBy: { select: { id: true, fullName: true } },
        },
      });
    });
  }

  async updateWaiterAssignment(scope: 'GROUP' | 'TABLE', id: string, dto: UpdateWaiterAssignmentDto, actorId: string) {
    if (scope === 'GROUP') {
      const current = await this.prisma.waiterTableGroupAssignment.findUnique({ where: { id } });
      if (!current) {
        throw new NotFoundException('No se encontró la asignación.');
      }

      if (dto.isActive === true) {
        const updated = await this.replaceGroupAssignment(current.tableGroupId, current.waiterId, actorId, true);
        await this.logAssignmentUpdate(actorId, scope, id, current, dto);
        return { ...updated, scope };
      }

      const updated = await this.prisma.$transaction(async (tx) => {
        if (dto.isActive === false) {
          await tx.waiterTableGroupAssignment.deleteMany({
            where: {
              id: { not: id },
              waiterId: current.waiterId,
              tableGroupId: current.tableGroupId,
              isActive: false,
            },
          });
        }

        return tx.waiterTableGroupAssignment.update({
          where: { id },
          data: { isActive: dto.isActive },
        });
      });
      await this.logAssignmentUpdate(actorId, scope, id, current, dto);
      return { ...updated, scope };
    }

    const current = await this.prisma.waiterTableAssignment.findUnique({ where: { id } });
    if (!current) {
      throw new NotFoundException('No se encontró la asignación.');
    }

    if (dto.isActive === true) {
      const updated = await this.replaceTableAssignment(current.tableId, current.waiterId, actorId, true);
      await this.logAssignmentUpdate(actorId, scope, id, current, dto);
      return { ...updated, scope };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.isActive === false) {
        await tx.waiterTableAssignment.deleteMany({
          where: {
            id: { not: id },
            waiterId: current.waiterId,
            tableId: current.tableId,
            isActive: false,
          },
        });
      }

      return tx.waiterTableAssignment.update({
        where: { id },
        data: { isActive: dto.isActive },
      });
    });
    await this.logAssignmentUpdate(actorId, scope, id, current, dto);
    return { ...updated, scope };
  }

  async deactivateWaiterAssignment(scope: 'GROUP' | 'TABLE', id: string, actorId: string) {
    return this.updateWaiterAssignment(scope, id, { isActive: false }, actorId);
  }

  private async logAssignmentUpdate(
    actorId: string,
    scope: 'GROUP' | 'TABLE',
    id: string,
    oldValues: unknown,
    dto: UpdateWaiterAssignmentDto,
  ) {
    await this.auditService.log({
      userId: actorId,
      action: 'UPDATE_WAITER_ASSIGNMENT',
      module: 'tables',
      entity: scope === 'GROUP' ? 'waiter_table_group_assignment' : 'waiter_table_assignment',
      entityId: id,
      oldValues,
      newValues: dto,
    });

    this.realtimeService.publishOperationalRefresh('tables');
  }

  private async assertActiveTableGroup(groupId: string) {
    const group = await this.prisma.tableGroup.findUnique({ where: { id: groupId } });
    if (!group || !group.isActive) {
      throw new BadRequestException('El grupo de mesas no existe o está inactivo.');
    }
    return group;
  }

  private async assertActiveTable(tableId: string) {
    const table = await this.prisma.diningTable.findUnique({ where: { id: tableId } });
    if (!table || !table.isActive || table.status === DiningTableStatus.OUT_OF_SERVICE) {
      throw new BadRequestException('La mesa no existe o está inactiva.');
    }
    return table;
  }

  private async assertWaiterUser(waiterId: string) {
    const waiter = await this.prisma.user.findUnique({
      where: { id: waiterId },
      include: { roles: { include: { role: true } } },
    });

    if (!waiter || !waiter.isActive || !waiter.roles.some(({ role }) => role.name === 'waiter')) {
      throw new BadRequestException('Solo puedes asignar mesas a usuarios activos con rol mesero.');
    }

    return waiter;
  }
}
