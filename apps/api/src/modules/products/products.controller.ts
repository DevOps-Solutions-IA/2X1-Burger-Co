import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuditContext } from '../../common/types/audit-context.type';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

@Controller('products')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  private readAuditContext(headers: Record<string, string | string[] | undefined>): AuditContext {
    const rawSource = headers['x-audit-source'];
    const rawReason = headers['x-audit-reason'];

    return {
      source: Array.isArray(rawSource) ? rawSource[0] : rawSource,
      reason: Array.isArray(rawReason) ? rawReason[0] : rawReason,
    };
  }

  @Get()
  findAll() {
    return this.productsService.findAll();
  }

  @Get('sellable')
  @Roles('admin', 'cashier', 'supervisor', 'waiter')
  findSellable(@Query('brand') brand?: string) {
    return this.productsService.findSellable(brand);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(id);
  }

  @Post()
  @Roles('admin', 'inventory')
  create(
    @Body() dto: CreateProductDto,
    @CurrentUser('sub') actorId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.productsService.create(dto, actorId, this.readAuditContext(headers));
  }

  @Patch(':id')
  @Roles('admin', 'inventory')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser('sub') actorId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.productsService.update(id, dto, actorId, this.readAuditContext(headers));
  }

  @Delete(':id')
  @Roles('admin', 'inventory')
  remove(
    @Param('id') id: string,
    @CurrentUser('sub') actorId: string,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.productsService.remove(id, actorId, this.readAuditContext(headers));
  }
}
