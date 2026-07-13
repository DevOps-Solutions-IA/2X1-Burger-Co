export const SOFIA_RUNTIME_SAFETY_SETTING_KEYS = {
  globalPaused: 'SOFIA_GLOBAL_PAUSED',
  killSwitch: 'SOFIA_KILL_SWITCH',
} as const;

export type SofiaRuntimeSafetyAction =
  | 'INBOUND_ANALYSIS'
  | 'OUTBOUND_SEND'
  | 'AUTO_REPLY'
  | 'AUTO_SAFE'
  | 'PRODUCTIVE_ACTION'
  | 'MARK_PAID'
  | 'ALLOWLIST'
  | 'DUPLICATE_INBOUND';

export type SofiaRuntimeSafetyState = {
  policy: 'SUPERVISED_PREPRODUCTION';
  declared: {
    realSendingEnabled: boolean;
    autoReplyEnabled: boolean;
    autoSafeEnabled: boolean;
    productionEnabled: boolean;
  };
  effective: {
    realSendingEnabled: false;
    autoReplyEnabled: false;
    autoSafeEnabled: false;
    productionEnabled: false;
    whatsappCanMarkPaid: false;
  };
  globalPaused: boolean;
  killSwitchActive: boolean;
  automationBlocked: boolean;
  precedence: readonly ['KILL_SWITCH', 'PAUSE', 'PRODUCTION', 'AUTO_SAFE', 'AUTO_REPLY', 'REAL_SEND'];
};

export type SofiaRuntimeSafetyDecision = {
  action: SofiaRuntimeSafetyAction;
  allowed: boolean;
  reason: string;
  blockers: string[];
  state: SofiaRuntimeSafetyState;
};

export type SofiaAllowlistDecision = {
  allowed: boolean;
  reason: 'ALLOWLIST_DISABLED' | 'ALLOWLIST_ALLOWED' | 'ALLOWLIST_REQUIRED' | 'INVALID_PHONE';
  phoneMasked: string | null;
  phoneHash: string | null;
};
