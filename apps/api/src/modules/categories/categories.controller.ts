import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Controller('categories')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @Roles('categories.read')
  findAll() {
    return this.categoriesService.findAll();
  }

  @Post()
  @Roles('admin', 'inventory')
  create(@Body() dto: CreateCategoryDto, @CurrentUser('sub') actorId: string) {
    return this.categoriesService.create(dto, actorId);
  }

  @Patch(':id')
  @Roles('admin', 'inventory')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.categoriesService.update(id, dto, actorId);
  }

  @Delete(':id')
  @Roles('admin')
  remove(@Param('id') id: string, @CurrentUser('sub') actorId: string) {
    return this.categoriesService.remove(id, actorId);
  }
}
