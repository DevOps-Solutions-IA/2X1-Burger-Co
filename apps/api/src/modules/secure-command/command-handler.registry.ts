import { Injectable } from '@nestjs/common';
import { SecureCommandError } from './secure-command.errors';
import type { CommandHandlerResult, CommandPolicyDefinition, CommandRecord, SecureCommandType } from './secure-command.types';

const INTERNAL_POLICY: CommandPolicyDefinition = {
  commandType: 'SOFIA_INTERNAL_VALIDATE',
  enabled: true,
  operational: false,
  approvalRequired: true,
  allowedSources: ['admin', 'internal_validation'],
  allowedRoles: ['admin', 'supervisor'],
  requiredPermission: 'sofia.command.internal_validate',
};

const BLOCKED_TYPES = new Set<SecureCommandType>([
  'SOFIA_CREATE_ORDER',
  'SOFIA_SEND_WHATSAPP',
  'SOFIA_MARK_PAYMENT',
  'SOFIA_DEDUCT_STOCK',
  'SOFIA_MUTATE_CASH',
  'SOFIA_CREATE_SALE',
  'SOFIA_ASSIGN_DELIVERY',
  'SOFIA_CUSTOMER_AUTO_RESPONSE',
]);

@Injectable()
export class CommandHandlerRegistry {
  definition(commandType: string): CommandPolicyDefinition {
    if (commandType === INTERNAL_POLICY.commandType) return INTERNAL_POLICY;
    if (BLOCKED_TYPES.has(commandType as SecureCommandType)) {
      return {
        commandType: commandType as SecureCommandType,
        enabled: false,
        operational: true,
        approvalRequired: true,
        allowedSources: [],
        allowedRoles: [],
        requiredPermission: 'sofia.command.operational.disabled',
      };
    }
    throw new SecureCommandError('SOFIA_COMMAND_POLICY_BLOCKED');
  }

  async execute(command: CommandRecord): Promise<CommandHandlerResult> {
    if (command.commandType !== 'SOFIA_INTERNAL_VALIDATE') {
      throw new SecureCommandError('SOFIA_COMMAND_POLICY_BLOCKED');
    }
    return {
      resultCode: 'SOFIA_INTERNAL_VALIDATION_OK',
      payload: { commandId: command.id, validated: true },
      domainReferenceIds: [],
    };
  }
}
