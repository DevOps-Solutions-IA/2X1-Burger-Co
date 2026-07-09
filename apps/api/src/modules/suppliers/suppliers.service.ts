import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  findAll() {
    return this.prisma.supplier.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });

    if (!supplier) {
      throw new NotFoundException('No se encontró el proveedor.');
    }

    return supplier;
  }

  async create(dto: CreateSupplierDto, actorId: string) {
    const supplier = await this.prisma.supplier.create({ data: dto });

    await this.auditService.log({
      userId: actorId,
      action: 'CREATE',
      module: 'suppliers',
      entity: 'supplier',
      entityId: supplier.id,
      newValues: dto,
    });

    return supplier;
  }

  async update(id: string, dto: UpdateSupplierDto, actorId: string) {
    const existing = await this.findOne(id);
    const supplier = await this.prisma.supplier.update({
      where: { id },
      data: dto,
    });

    await this.auditService.log({
      userId: actorId,
      action: 'UPDATE',
      module: 'suppliers',
      entity: 'supplier',
      entityId: id,
      oldValues: existing,
      newValues: dto,
    });

    return supplier;
  }

  async remove(id: string, actorId: string) {
    const existing = await this.findOne(id);
    const purchaseCount = await this.prisma.purchase.count({
      where: { supplierId: id },
    });

    if (purchaseCount > 0) {
      throw new ConflictException(
        'No se puede eliminar este proveedor porque tiene historial. Puedes desactivarlo para evitar nuevas compras.',
      );
    }

    await this.prisma.supplier.delete({
      where: { id },
    });

    await this.auditService.log({
      userId: actorId,
      action: 'DELETE',
      module: 'suppliers',
      entity: 'supplier',
      entityId: id,
      oldValues: existing,
    });

    return { deleted: true, id };
  }
}
