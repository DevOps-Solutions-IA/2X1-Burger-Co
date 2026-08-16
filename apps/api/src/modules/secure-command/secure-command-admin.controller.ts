import { Body, ConflictException, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { AuthUser } from '../../common/types/auth-user.type';
import { CommandAdminReadService } from './command-admin-read.service';
import { CommandApprovalService } from './command-approval.service';
import { ApproveSecureCommandDto, ListSecureCommandsDto, RejectSecureCommandDto } from './dto/list-secure-commands.dto';
import { SecureCommandError } from './secure-command.errors';

const APPROVAL_WINDOW_MS = 15 * 60 * 1000;

/**
 * Superficie admin de solo lectura + aprobación/rechazo humano sobre
 * SecureCommand. No expone la creación de comandos (`receive()`) — esa
 * sigue siendo exclusiva de los flujos operacionales existentes (ej.
 * notification-dispatch). Aprobar delega en `CommandApprovalService`, que
 * ya aplica separación de funciones, política y estado de runtime-safety;
 * esta capa no reimplementa ninguna de esas reglas.
 */
@Controller('admin/secure-commands')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'supervisor')
export class SecureCommandAdminController {
  constructor(
    private readonly reads: CommandAdminReadService,
    private readonly approvals: CommandApprovalService,
  ) {}

  @Get()
  @Permissions('settings.read')
  list(@Query() query: ListSecureCommandsDto) {
    return this.reads.list(query);
  }

  @Get(':id')
  @Permissions('settings.read')
  get(@Param('id') id: string) {
    return this.reads.get(id);
  }

  @Post(':id/approve')
  @Permissions('settings.update')
  async approve(@Param('id') id: string, @Body() dto: ApproveSecureCommandDto, @CurrentUser() actor: AuthUser) {
    const { command } = await this.reads.get(id);
    try {
      return await this.approvals.grant({
        commandId: id,
        approver: { actorId: actor.sub, actorType: 'USER', roles: actor.roles },
        binding: {
          payloadHash: command.payloadHash,
          expectedVersion: command.expectedVersion,
          targetType: command.targetType,
          targetId: command.targetId,
          source: command.source,
        },
        expiresAt: new Date(Math.min(Date.now() + APPROVAL_WINDOW_MS, command.expiresAt.getTime())),
        reasonCode: dto.reasonCode,
        policyReference: dto.policyReference,
      });
    } catch (error) {
      if (error instanceof SecureCommandError) throw new ConflictException(error.code);
      throw error;
    }
  }

  @Post(':id/reject')
  @Permissions('settings.update')
  async reject(@Param('id') id: string, @Body() dto: RejectSecureCommandDto, @CurrentUser() actor: AuthUser) {
    try {
      return await this.reads.reject(id, { actorId: actor.sub, actorType: 'USER', roles: actor.roles }, dto.reasonCode);
    } catch (error) {
      if (error instanceof SecureCommandError) throw new ConflictException(error.code);
      throw error;
    }
  }
}
