import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type Phase5Capability = 'ORDER_CREATION' | 'PAYMENT_ORCHESTRATION' | 'KITCHEN';

const FLAGS: Record<Phase5Capability, string> = {
  ORDER_CREATION: 'PHASE5_ORDER_CREATION_ENABLED',
  PAYMENT_ORCHESTRATION: 'PHASE5_PAYMENT_ORCHESTRATION_ENABLED',
  KITCHEN: 'PHASE5_KITCHEN_ENABLED',
};

@Injectable()
export class Phase5RuntimeGate {
  constructor(private readonly prisma: PrismaService) {}

  async assertEnabled(capability: Phase5Capability) {
    const settings = await this.prisma.setting.findMany({
      where: { key: { in: ['SOFIA_GLOBAL_PAUSED', 'SOFIA_KILL_SWITCH'] } },
      select: { key: true, value: true },
    });
    const values = new Map(settings.map((entry) => [entry.key, entry.value]));
    const paused = this.objectValue(values.get('SOFIA_GLOBAL_PAUSED')).paused === true;
    const killed = this.objectValue(values.get('SOFIA_KILL_SWITCH')).active === true;
    const enabled = this.strictTrue(process.env[FLAGS[capability]]);
    const testAuthorized = process.env.NODE_ENV === 'test' && this.strictTrue(process.env.PHASE5_TEST_OPERATIONAL_ENABLED);

    if (process.env.NODE_ENV === 'production' || paused || killed || !enabled || !testAuthorized) {
      throw new ForbiddenException({
        code: 'CHECKOUT_OPERATION_DISABLED',
        capability,
        blockers: [
          ...(process.env.NODE_ENV === 'production' ? ['PRODUCTION_FORBIDDEN'] : []),
          ...(paused ? ['GOVERNANCE_PAUSED'] : []),
          ...(killed ? ['KILL_SWITCH_ACTIVE'] : []),
          ...(!enabled ? ['CAPABILITY_DISABLED'] : []),
          ...(!testAuthorized ? ['TEST_AUTHORIZATION_REQUIRED'] : []),
        ],
      });
    }
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

