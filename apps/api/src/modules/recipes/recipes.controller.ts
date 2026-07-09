import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UpsertRecipeDto } from './dto/upsert-recipe.dto';
import { RecipesService } from './recipes.service';

@Controller('recipes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RecipesController {
  constructor(private readonly recipesService: RecipesService) {}

  @Get(':productId')
  @Roles('recipes.read')
  findByProduct(@Param('productId') productId: string) {
    return this.recipesService.findByProduct(productId);
  }

  @Put(':productId')
  @Roles('admin', 'inventory')
  upsert(
    @Param('productId') productId: string,
    @Body() dto: UpsertRecipeDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.recipesService.upsert(productId, dto, actorId);
  }
}
