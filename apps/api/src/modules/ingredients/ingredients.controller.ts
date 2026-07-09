import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateIngredientDto } from './dto/create-ingredient.dto';
import { UpdateIngredientDto } from './dto/update-ingredient.dto';
import { IngredientsService } from './ingredients.service';

@Controller('ingredients')
@UseGuards(JwtAuthGuard, RolesGuard)
export class IngredientsController {
  constructor(private readonly ingredientsService: IngredientsService) {}

  @Get()
  @Roles('ingredients.read')
  findAll() {
    return this.ingredientsService.findAll();
  }

  @Get(':id')
  @Roles('ingredients.read')
  findOne(@Param('id') id: string) {
    return this.ingredientsService.findOne(id);
  }

  @Post()
  @Roles('admin', 'inventory')
  create(@Body() dto: CreateIngredientDto, @CurrentUser('sub') actorId: string) {
    return this.ingredientsService.create(dto, actorId);
  }

  @Patch(':id')
  @Roles('admin', 'inventory')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateIngredientDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.ingredientsService.update(id, dto, actorId);
  }

  @Delete(':id')
  @Roles('admin', 'inventory')
  remove(@Param('id') id: string, @CurrentUser('sub') actorId: string) {
    return this.ingredientsService.remove(id, actorId);
  }
}
