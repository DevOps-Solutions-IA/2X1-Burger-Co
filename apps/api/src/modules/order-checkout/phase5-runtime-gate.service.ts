import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaOrderCheckoutRepository } from './persistence/prisma-order-checkout.repository';

export type Phase5Capability = 'ORDER_CREATION' | 'PAYMENT_ORCHESTRATION' | 'KITCHEN';

export type Phase5GateDecision = Readonly<{
  enabled: boolean;
  capability: Phase5Capability;
  blockers: readonly string[];
}>;

const FLAGS: Record<Phase5Capability, string> = {
  ORDER_CREATION: 'PHASE5_ORDER_CREATION_ENABLED',
  PAYMENT_ORCHESTRATION: 'PHASE5_PAYMENT_ORCHESTRATION_ENABLED',
  KITCHEN: 'PHASE5_KITCHEN_ENABLED',
};

@Injectable()
export class Phase5RuntimeGate {
  constructor(private readonly repository: PrismaOrderCheckoutRepository) {}

  async assertEnabled(capability: Phase5Capability) {
    const decision = await this.decision(capability);
    if (!decision.enabled) {
      throw new ForbiddenException({
        code: 'CHECKOUT_OPERATION_DISABLED',
        capability,
        blockers: decision.blockers,
      });
    }
  }

  async decision(capability: Phase5Capability): Promise<Phase5GateDecision> {
    const settings = await this.repository.findRuntimeSafetySettings();
    const values = new Map(settings.map((entry) => [entry.key, entry.value]));
    const paused = this.objectValue(values.get('SOFIA_GLOBAL_PAUSED')).paused === true;
    const killed = this.objectValue(values.get('SOFIA_KILL_SWITCH')).active === true;
    const enabled = this.strictTrue(process.env[FLAGS[capability]]);
    const testAuthorized = process.env.NODE_ENV === 'test' && this.strictTrue(process.env.PHASE5_TEST_OPERATIONAL_ENABLED);
    const blockers = [
      ...(process.env.NODE_ENV === 'production' ? ['PRODUCTION_FORBIDDEN'] : []),
      ...(paused ? ['GOVERNANCE_PAUSED'] : []),
      ...(killed ? ['KILL_SWITCH_ACTIVE'] : []),
      ...(!enabled ? ['CAPABILITY_DISABLED'] : []),
      ...(!testAuthorized ? ['TEST_AUTHORIZATION_REQUIRED'] : []),
    ];
    return Object.freeze({ enabled: blockers.length === 0, capability, blockers: Object.freeze(blockers) });
  }

  state() {
    return {
      orderCreationEnabled: false,
      paymentMutationEnabled: false,
      boldProductionEnabled: false,
      kitchenMutationEnabled: false,
      productionDeployed: false,
    } as const;
  }

  private strictTrue(value: string | undefined) {
    return value?.trim().toLowerCase() === 'true';
  }

  private objectValue(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }
}
