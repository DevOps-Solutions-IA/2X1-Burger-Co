import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto';
import { CreateStockCountDto } from './dto/create-stock-count.dto';
import { FindInventoryMovementsDto } from './dto/find-inventory-movements.dto';
import { PreviewStockCountDto } from './dto/preview-stock-count.dto';
import { InventoryService } from './inventory.service';

@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('stock')
  @Roles('inventory.read')
  findStock() {
    return this.inventoryService.findStock();
  }

  @Get('movements')
  @Roles('inventory.read')
  findMovements(@Query() query: FindInventoryMovementsDto) {
    return this.inventoryService.findMovements(query);
  }

  @Get('stock-counts')
  @Roles('admin', 'inventory')
  findStockCounts() {
    return this.inventoryService.findStockCounts();
  }

  @Get('stock-counts/preview')
  @Roles('admin', 'inventory')
  previewStockCount(@Query() query: PreviewStockCountDto) {
    return this.inventoryService.previewStockCount(query);
  }

  @Get('reorder-suggestions')
  @Roles('admin', 'inventory', 'supervisor')
  getReorderSuggestions() {
    return this.inventoryService.getReorderSuggestions();
  }

  @Post('adjustments')
  @Roles('admin', 'inventory')
  createAdjustment(
    @Body() dto: CreateAdjustmentDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.inventoryService.createAdjustment(dto, actorId);
  }

  @Post('stock-counts')
  @Roles('admin', 'inventory')
  createStockCount(@Body() dto: CreateStockCountDto, @CurrentUser('sub') actorId: string) {
    return this.inventoryService.createStockCount(dto, actorId);
  }
}
