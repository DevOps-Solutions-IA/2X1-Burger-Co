import { Injectable, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { SecureCommandError } from './secure-command.errors';
import type { CommandHandlerResult, CommandPolicyDefinition, CommandRecord, SecureCommandType } from './secure-command.types';
import { DeliveryAssignmentCommandHandler } from '../delivery-operations/production/delivery-assignment-command.handler';
import { WhatsappOutboundCommandHandler } from '../sofia/whatsapp/production/whatsapp-outbound-command.handler';
// Plain class import: this is a TS/JS file-level import only, it does NOT declare a NestJS
// `@Module({ imports: [...] })` edge, so it does not participate in the Nest DI module graph.
// OrderCheckoutModule already transitively imports SecureCommandModule (OrderCheckoutModule ->
// OrdersModule -> NotificationsModule -> SecureCommandModule); SecureCommandModule declaring
// `imports: [OrderCheckoutModule]` back would create a circular NestJS module graph. To avoid
// that, this handler is deliberately NEVER constructor-injected here (unlike
// WhatsappOutboundCommandHandler, which lives inside SofiaModule with no such cycle) -- it is
// resolved lazily at execute-time via `ModuleRef#get(SofiaCreateOrderCommandHandler,
// { strict: false })`, a global, import-graph-independent lookup that requires zero new
// `@Module` imports anywhere in the app.
import { SofiaCreateOrderCommandHandler } from '../order-checkout/sofia-create-order-command.handler';

const INTERNAL_POLICY: CommandPolicyDefinition = {
  commandType: 'SOFIA_INTERNAL_VALIDATE',
  enabled: true,
  operational: false,
  approvalRequired: true,
  allowedSources: ['admin', 'internal_validation'],
  allowedRoles: ['admin', 'supervisor'],
  requiredPermission: 'sofia.command.internal_validate',
};

// SOFIA_CREATE_ORDER: real handler wired (see execute()), still enabled: false -- an
// OWNER_ACTIVATION_GATE. Mirrors the SOFIA_SEND_WHATSAPP pattern exactly: `receive()` durably
// records and audits the command even while disabled (receiveWhileDisabled) for a narrow,
// SYSTEM-actor, single-source binding, but `execute()` remains policy-blocked in every
// environment until an owner-authorized change flips `enabled` to true.
const ORDER_CREATION_POLICY: CommandPolicyDefinition = {
  commandType: 'SOFIA_CREATE_ORDER',
  enabled: false,
  operational: true,
  approvalRequired: true,
  allowedSources: ['sofia_order_draft_confirmation'],
  allowedRoles: ['system'],
  requiredPermission: 'sofia.command.operational.disabled',
  receiveWhileDisabled: true,
};

const BLOCKED_TYPES = new Set<SecureCommandType>([
  'SOFIA_MARK_PAYMENT',
  'SOFIA_DEDUCT_STOCK',
  'SOFIA_MUTATE_CASH',
  'SOFIA_CREATE_SALE',
  'SOFIA_ASSIGN_DELIVERY',
  'SOFIA_CUSTOMER_AUTO_RESPONSE',
]);

@Injectable()
export class CommandHandlerRegistry {
  constructor(
    @Optional() private readonly moduleRef?: ModuleRef,
    @Optional() private readonly whatsappOutbound?: WhatsappOutboundCommandHandler,
    @Optional() private readonly deliveryAssignment?: DeliveryAssignmentCommandHandler,
  ) {}

  definition(commandType: string): CommandPolicyDefinition {
    if (commandType === INTERNAL_POLICY.commandType) return INTERNAL_POLICY;
    if (commandType === ORDER_CREATION_POLICY.commandType) return ORDER_CREATION_POLICY;
    if (commandType === 'SOFIA_SEND_WHATSAPP') {
      return {
        commandType,
        enabled: false,
        operational: true,
        approvalRequired: true,
        allowedSources: ['notification_outbox'],
        allowedRoles: ['system'],
        requiredPermission: 'sofia.command.operational.disabled',
        receiveWhileDisabled: true,
      };
    }
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
    if (command.commandType === 'SOFIA_SEND_WHATSAPP') {
      if (!this.whatsappOutbound) throw new SecureCommandError('SOFIA_COMMAND_POLICY_BLOCKED');
      return this.whatsappOutbound.execute(command);
    }
    if (command.commandType === 'SOFIA_CREATE_ORDER') {
      const handler = this.resolveOrderCreationHandler();
      if (!handler) throw new SecureCommandError('SOFIA_COMMAND_POLICY_BLOCKED');
      return handler.execute(command);
    }
    if (command.commandType === 'SOFIA_ASSIGN_DELIVERY') {
      // Unreachable in practice today: SOFIA_ASSIGN_DELIVERY stays inside
      // BLOCKED_TYPES with enabled:false and no receiveWhileDisabled, so
      // CommandPolicyService rejects it at the RECEIVE stage before a command
      // record can even be created. Wired here so the handler is a real,
      // testable dispatch target once an owner-authorized activation phase
      // moves this command type out of BLOCKED_TYPES.
      if (!this.deliveryAssignment) throw new SecureCommandError('SOFIA_COMMAND_POLICY_BLOCKED');
      return this.deliveryAssignment.execute(command);
    }
    if (command.commandType !== 'SOFIA_INTERNAL_VALIDATE') {
      throw new SecureCommandError('SOFIA_COMMAND_POLICY_BLOCKED');
    }
    return {
      resultCode: 'SOFIA_INTERNAL_VALIDATION_OK',
      payload: { commandId: command.id, validated: true },
      domainReferenceIds: [],
    };
  }

  private resolveOrderCreationHandler(): SofiaCreateOrderCommandHandler | undefined {
    if (!this.moduleRef) return undefined;
    try {
      return this.moduleRef.get(SofiaCreateOrderCommandHandler, { strict: false });
    } catch {
      return undefined;
    }
  }
}
