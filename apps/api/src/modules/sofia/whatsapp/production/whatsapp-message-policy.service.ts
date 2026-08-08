import { ForbiddenException, Injectable } from '@nestjs/common';
import { SofiaRuntimeSafetyService } from '../../runtime-safety/sofia-runtime-safety.service';
import { WhatsappConsentService } from './whatsapp-consent.service';
import { WhatsappHandoffService } from './whatsapp-handoff.service';
import type { WhatsappMessagePurpose } from './whatsapp-production.types';

@Injectable()
export class WhatsappMessagePolicyService {
  constructor(
    private readonly consent: WhatsappConsentService,
    private readonly handoff: WhatsappHandoffService,
    private readonly safety: SofiaRuntimeSafetyService,
  ) {}

  async inbound(conversationId: string, customerId: string | null) {
    const [consent, handoff, safety] = await Promise.all([
      this.consent.evaluate(customerId, 'SERVICE'), this.handoff.decision(conversationId), this.safety.getState(),
    ]);
    const allowed = consent.allowed && handoff.automationAllowed && !safety.globalPaused && !safety.killSwitchActive;
    return { allowed, consent, handoff, reasonCode: allowed ? 'WHATSAPP_INBOUND_AUTOMATION_ALLOWED' : safety.killSwitchActive ? 'KILL_SWITCH_ACTIVE' : safety.globalPaused ? 'GLOBAL_PAUSED' : !consent.allowed ? consent.reasonCode : handoff.reasonCode };
  }

  async outbound(conversationId: string, customerId: string | null, purpose: WhatsappMessagePurpose) {
    const [consent, handoff, safety] = await Promise.all([
      this.consent.evaluate(customerId, purpose), this.handoff.decision(conversationId), this.safety.getState(),
    ]);
    if (!consent.allowed || !handoff.automationAllowed || safety.globalPaused || safety.killSwitchActive || !safety.effective.realSendingEnabled) {
      throw new ForbiddenException({ code: safety.killSwitchActive ? 'KILL_SWITCH_ACTIVE' : safety.globalPaused ? 'GLOBAL_PAUSED' : !consent.allowed ? consent.reasonCode : !handoff.automationAllowed ? handoff.reasonCode : 'WHATSAPP_REAL_SEND_DISABLED' });
    }
    return { consent, handoff, safety };
  }
}
