import type { SecureCommandStatus } from './secure-command.types';
import { SecureCommandError } from './secure-command.errors';

const TRANSITIONS: Readonly<Record<SecureCommandStatus, readonly SecureCommandStatus[]>> = {
  RECEIVED: ['VALIDATED', 'REJECTED', 'EXPIRED'],
  VALIDATED: ['APPROVAL_REQUIRED', 'REJECTED', 'EXPIRED'],
  APPROVAL_REQUIRED: ['APPROVED', 'REJECTED', 'EXPIRED'],
  APPROVED: ['CLAIMED', 'REJECTED', 'EXPIRED'],
  CLAIMED: ['EXECUTING', 'FAILED', 'EXPIRED'],
  EXECUTING: ['SUCCEEDED', 'FAILED'],
  SUCCEEDED: [],
  FAILED: ['CLAIMED', 'EXPIRED'],
  REJECTED: [],
  EXPIRED: [],
};

export function assertCommandTransition(from: SecureCommandStatus, to: SecureCommandStatus, retryable = false) {
  if (!TRANSITIONS[from].includes(to) || (from === 'FAILED' && !retryable)) {
    throw new SecureCommandError(from === 'FAILED' ? 'SOFIA_COMMAND_NOT_RETRYABLE' : 'SOFIA_COMMAND_POLICY_BLOCKED');
  }
}

export function isTerminalStatus(status: SecureCommandStatus) {
  return ['SUCCEEDED', 'REJECTED', 'EXPIRED'].includes(status);
}
