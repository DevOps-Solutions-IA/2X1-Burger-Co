import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SuppliersService } from './suppliers.service';

@Controller('suppliers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  @Roles('suppliers.read')
  findAll() {
    return this.suppliersService.findAll();
  }

  @Get(':id')
  @Roles('suppliers.read')
  findOne(@Param('id') id: string) {
    return this.suppliersService.findOne(id);
  }

  @Post()
  @Roles('admin', 'inventory')
  create(@Body() dto: CreateSupplierDto, @CurrentUser('sub') actorId: string) {
    return this.suppliersService.create(dto, actorId);
  }

  @Patch(':id')
  @Roles('admin', 'inventory')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.suppliersService.update(id, dto, actorId);
  }

  @Delete(':id')
  @Roles('admin', 'inventory')
  remove(@Param('id') id: string, @CurrentUser('sub') actorId: string) {
    return this.suppliersService.remove(id, actorId);
  }
}
