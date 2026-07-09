import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { ExpensesService } from './expenses.service';

@Controller('expenses')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Get()
  @Roles('expenses.read')
  findAll() {
    return this.expensesService.findAll();
  }

  @Post()
  @Roles('admin', 'cashier', 'supervisor')
  create(@Body() dto: CreateExpenseDto, @CurrentUser('sub') actorId: string) {
    return this.expensesService.create(dto, actorId);
  }

  @Patch(':id')
  @Roles('admin', 'supervisor')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateExpenseDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.expensesService.update(id, dto, actorId);
  }
}
