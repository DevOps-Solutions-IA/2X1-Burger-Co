import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  findAll() {
    return this.prisma.category.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async create(dto: CreateCategoryDto, actorId: string) {
    const category = await this.prisma.category.create({
      data: {
        name: dto.name,
        slug: slugify(dto.name),
        description: dto.description,
      },
    });

    await this.auditService.log({
      userId: actorId,
      action: 'CREATE',
      module: 'categories',
      entity: 'category',
      entityId: category.id,
      newValues: dto,
    });

    return category;
  }

  async update(id: string, dto: UpdateCategoryDto, actorId: string) {
    const existing = await this.prisma.category.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException('No se encontró la categoría.');
    }

    const category = await this.prisma.category.update({
      where: { id },
      data: {
        name: dto.name,
        slug: dto.name ? slugify(dto.name) : undefined,
        description: dto.description,
        isActive: dto.isActive,
      },
    });

    await this.auditService.log({
      userId: actorId,
      action: 'UPDATE',
      module: 'categories',
      entity: 'category',
      entityId: id,
      oldValues: existing,
      newValues: dto,
    });

    return category;
  }

  remove(id: string, actorId: string) {
    return this.update(id, { isActive: false }, actorId);
  }
}
