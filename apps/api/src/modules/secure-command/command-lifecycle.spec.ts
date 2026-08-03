import { assertCommandTransition, isTerminalStatus } from './command-lifecycle';
import { SecureCommandError } from './secure-command.errors';
import type { SecureCommandStatus } from './secure-command.types';

describe('secure command lifecycle', () => {
  const legal: Array<[SecureCommandStatus, SecureCommandStatus, boolean?]> = [
    ['RECEIVED', 'VALIDATED'],
    ['VALIDATED', 'APPROVAL_REQUIRED'],
    ['APPROVAL_REQUIRED', 'APPROVED'],
    ['APPROVED', 'CLAIMED'],
    ['CLAIMED', 'EXECUTING'],
    ['EXECUTING', 'SUCCEEDED'],
    ['EXECUTING', 'FAILED'],
    ['APPROVAL_REQUIRED', 'REJECTED'],
    ['APPROVED', 'EXPIRED'],
    ['CLAIMED', 'EXPIRED'],
    ['FAILED', 'CLAIMED', true],
    ['FAILED', 'EXPIRED', true],
  ];

  it.each(legal)('allows %s -> %s', (from, to, retryable = false) => {
    expect(() => assertCommandTransition(from, to, retryable)).not.toThrow();
  });

  it.each([
    ['SUCCEEDED', 'EXECUTING'],
    ['REJECTED', 'CLAIMED'],
    ['EXPIRED', 'APPROVED'],
    ['RECEIVED', 'SUCCEEDED'],
    ['FAILED', 'CLAIMED'],
  ] as Array<[SecureCommandStatus, SecureCommandStatus]>)('blocks illegal %s -> %s', (from, to) => {
    expect(() => assertCommandTransition(from, to)).toThrow(SecureCommandError);
  });

  it('recognizes only immutable terminal states', () => {
    expect(isTerminalStatus('SUCCEEDED')).toBe(true);
    expect(isTerminalStatus('REJECTED')).toBe(true);
    expect(isTerminalStatus('EXPIRED')).toBe(true);
    expect(isTerminalStatus('FAILED')).toBe(false);
  });
});
