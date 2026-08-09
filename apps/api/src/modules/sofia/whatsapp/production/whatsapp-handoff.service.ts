import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SofiaRuntimeSafetyService } from '../../runtime-safety/sofia-runtime-safety.service';
import { WhatsappConsentService } from './whatsapp-consent.service';
import type { HandoffDecision } from './whatsapp-production.types';
import { WHATSAPP_PRODUCTION_REPOSITORY, type WhatsappProductionRepository } from './whatsapp-production.repository';

type HandoffTarget = 'SOFIA_ACTIVE' | 'HUMAN_REQUIRED' | 'HUMAN_TAKEN' | 'SOFIA_PAUSED' | 'PILOT_NOT_ALLOWED' | 'RESOLVED' | 'ARCHIVED';

const STATUS_BY_STATE = {
  SOFIA_ACTIVE: 'ACTIVE', HUMAN_REQUIRED: 'HUMAN_REQUIRED', HUMAN_TAKEN: 'HUMAN_TAKEN', SOFIA_PAUSED: 'SOFIA_PAUSED', PILOT_NOT_ALLOWED: 'HUMAN_REQUIRED', RESOLVED: 'RESOLVED', ARCHIVED: 'ARCHIVED',
} as const;

@Injectable()
export class WhatsappHandoffService {
  constructor(
    @Inject(WHATSAPP_PRODUCTION_REPOSITORY) private readonly repository: WhatsappProductionRepository,
    private readonly consent: WhatsappConsentService,
    private readonly safety: SofiaRuntimeSafetyService,
  ) {}

  async decision(conversationId: string): Promise<HandoffDecision> {
    const state = await this.required(conversationId);
    const consent = await this.consent.evaluate(state.customerId, 'SERVICE');
    const runtime = await this.safety.getState();
    const automationAllowed = consent.allowed && !runtime.globalPaused && !runtime.killSwitchActive && state.sofiaEnabled && state.humanStatus === 'SOFIA_ACTIVE' && state.status === 'ACTIVE';
    return {
      automationAllowed, state: state.humanStatus, version: state.handoffVersion, assignedActorId: state.assignedToUserId,
      reasonCode: automationAllowed ? 'AUTOMATION_ALLOWED' : runtime.killSwitchActive ? 'KILL_SWITCH_ACTIVE' : runtime.globalPaused ? 'GLOBAL_PAUSED' : !consent.allowed ? consent.reasonCode : 'HUMAN_HANDOFF_ACTIVE',
    };
  }

  async transition(input: {
    conversationId: string; actorId: string; target: HandoffTarget; reasonCode: string; expectedVersion?: number; assignedToUserId?: string | null;
  }) {
    const current = await this.required(input.conversationId);
    if (
      input.expectedVersion != null
      && input.expectedVersion !== current.handoffVersion
      && (
        input.expectedVersion + 1 !== current.handoffVersion
        || current.humanStatus !== input.target
      )
    ) {
      throw new ConflictException({ code: 'WHATSAPP_HANDOFF_VERSION_CONFLICT' });
    }
    if (input.target === 'SOFIA_ACTIVE') {
      const [consent, runtime] = await Promise.all([this.consent.evaluate(current.customerId, 'SERVICE'), this.safety.getState()]);
      if (!consent.allowed || runtime.globalPaused || runtime.killSwitchActive || current.status === 'ARCHIVED' || (current.assignedToUserId && current.assignedToUserId !== input.actorId)) {
        throw new ForbiddenException({ code: runtime.killSwitchActive ? 'KILL_SWITCH_ACTIVE' : runtime.globalPaused ? 'GLOBAL_PAUSED' : !consent.allowed ? consent.reasonCode : 'WHATSAPP_HANDOFF_RELEASE_FORBIDDEN' });
      }
    }
    try {
      return await this.repository.transitionHandoff({
        conversationId: input.conversationId,
        actorId: input.actorId,
        expectedVersion: input.expectedVersion ?? current.handoffVersion,
        previousState: current.humanStatus,
        nextState: input.target,
        reasonCode: input.reasonCode,
        status: STATUS_BY_STATE[input.target],
        sofiaEnabled: input.target === 'SOFIA_ACTIVE',
        assignedToUserId: input.target === 'HUMAN_TAKEN' ? input.assignedToUserId ?? input.actorId : input.target === 'SOFIA_ACTIVE' ? null : current.assignedToUserId,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'WHATSAPP_HANDOFF_VERSION_CONFLICT') {
        throw new ConflictException({ code: 'WHATSAPP_HANDOFF_VERSION_CONFLICT' });
      }
      throw error;
    }
  }

  private async required(conversationId: string) {
    const state = await this.repository.conversationPolicyState(conversationId);
    if (!state) throw new NotFoundException({ code: 'WHATSAPP_CONVERSATION_NOT_FOUND' });
    return state;
  }
}
