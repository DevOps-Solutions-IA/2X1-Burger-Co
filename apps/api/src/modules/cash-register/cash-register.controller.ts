import { Body, Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CashRegisterService } from './cash-register.service';
import { CloseCashSessionDto } from './dto/close-cash-session.dto';
import { CreateManualCashMovementDto } from './dto/create-manual-cash-movement.dto';
import { OpenCashSessionDto } from './dto/open-cash-session.dto';
import { ReopenCashSessionDto } from './dto/reopen-cash-session.dto';

@Controller('cash-register')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CashRegisterController {
  constructor(private readonly cashRegisterService: CashRegisterService) {}

  @Get('current')
  @Roles('cash.read', 'waiter')
  async getCurrent(@Res() response: Response) {
    const session = await this.cashRegisterService.getCurrent();
    return response.json(session);
  }

  @Get('history')
  @Roles('admin', 'supervisor')
  history() {
    return this.cashRegisterService.history();
  }

  @Get('operational-log')
  @Roles('admin', 'cashier', 'supervisor')
  getOperationalLog(@Query('date') date?: string) {
    return this.cashRegisterService.getOperationalLog(date);
  }

  @Get('daily-summary')
  @Roles('admin', 'cashier', 'supervisor')
  getDailySummary(@Query('actualAmount') actualAmount?: string) {
    const parsedAmount = actualAmount != null && actualAmount !== '' ? Number(actualAmount) : undefined;
    return this.cashRegisterService.getDailySummary(
      Number.isFinite(parsedAmount as number) ? (parsedAmount as number) : undefined,
    );
  }

  @Get('close-checklist')
  @Roles('admin', 'cashier', 'supervisor')
  getCloseChecklist(@Query('actualAmount') actualAmount?: string) {
    const parsedAmount = actualAmount != null && actualAmount !== '' ? Number(actualAmount) : undefined;
    return this.cashRegisterService.getCloseReadiness(
      Number.isFinite(parsedAmount as number) ? (parsedAmount as number) : undefined,
    );
  }

  @Post('open')
  @Roles('admin', 'cashier', 'supervisor')
  open(@Body() dto: OpenCashSessionDto, @CurrentUser('sub') actorId: string) {
    return this.cashRegisterService.open(dto, actorId);
  }

  @Post('close')
  @Roles('admin', 'cashier', 'supervisor')
  close(@Body() dto: CloseCashSessionDto, @CurrentUser('sub') actorId: string) {
    return this.cashRegisterService.close(dto, actorId);
  }

  @Post('reopen')
  @Roles('admin', 'supervisor')
  reopen(@Body() dto: ReopenCashSessionDto, @CurrentUser('sub') actorId: string) {
    return this.cashRegisterService.reopen(dto, actorId);
  }

  @Post('movements/manual')
  @Roles('admin', 'cashier', 'supervisor')
  createManualMovement(
    @Body() dto: CreateManualCashMovementDto,
    @CurrentUser('sub') actorId: string,
  ) {
    return this.cashRegisterService.createManualMovement(dto, actorId);
  }
}
