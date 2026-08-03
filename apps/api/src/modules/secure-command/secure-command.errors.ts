export const SECURE_COMMAND_ERROR_CODES = [
  'SOFIA_COMMAND_IDEMPOTENCY_CONFLICT',
  'SOFIA_COMMAND_ACTOR_CONFLICT',
  'SOFIA_COMMAND_SOURCE_CONFLICT',
  'SOFIA_COMMAND_TARGET_CONFLICT',
  'SOFIA_COMMAND_PAYLOAD_CONFLICT',
  'SOFIA_COMMAND_ALREADY_RUNNING',
  'SOFIA_COMMAND_EXPIRED',
  'SOFIA_COMMAND_APPROVAL_REQUIRED',
  'SOFIA_COMMAND_APPROVAL_INVALID',
  'SOFIA_COMMAND_POLICY_BLOCKED',
  'SOFIA_COMMAND_NOT_RETRYABLE',
  'SOFIA_COMMAND_DEPENDENCY_UNAVAILABLE',
] as const;

export type SecureCommandErrorCode = (typeof SECURE_COMMAND_ERROR_CODES)[number];

export class SecureCommandError extends Error {
  constructor(
    readonly code: SecureCommandErrorCode,
    readonly retryable = false,
  ) {
    super(code);
    this.name = 'SecureCommandError';
  }
}

export class UnknownCommandResultError extends Error {
  constructor(readonly code = 'SOFIA_COMMAND_UNKNOWN_RESULT') {
    super(code);
    this.name = 'UnknownCommandResultError';
  }
}
