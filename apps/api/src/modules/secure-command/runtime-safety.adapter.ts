import { Injectable } from '@nestjs/common';
import { SofiaRuntimeSafetyService } from '../sofia/runtime-safety/sofia-runtime-safety.service';
import type { CommandRuntimeSafety } from './ports/command-repository.port';

@Injectable()
export class SofiaCommandRuntimeSafetyAdapter implements CommandRuntimeSafety {
  constructor(private readonly safety: SofiaRuntimeSafetyService) {}

  async current() {
    const state = await this.safety.getState();
    return {
      globalPaused: state.globalPaused,
      killSwitchActive: state.killSwitchActive,
      productionEnabled: state.effective.productionEnabled,
    };
  }
}
