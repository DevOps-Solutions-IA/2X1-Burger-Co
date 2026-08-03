import { Injectable } from '@nestjs/common';
import { SecureCommandError, UnknownCommandResultError } from './secure-command.errors';
import type { CommandFailureClass } from './secure-command.types';

@Injectable()
export class CommandConflictResolver {
  classify(error: unknown): { failureClass: CommandFailureClass; code: string; retryable: boolean } {
    if (error instanceof UnknownCommandResultError) {
      return { failureClass: 'UNKNOWN_RESULT', code: error.code, retryable: false };
    }
    if (error instanceof SecureCommandError) {
      const failureClass: CommandFailureClass = error.code.includes('CONFLICT')
        ? 'CONFLICT'
        : error.code.includes('DEPENDENCY')
          ? 'DEPENDENCY'
          : 'POLICY';
      return { failureClass, code: error.code, retryable: error.retryable };
    }
    return { failureClass: 'INTERNAL', code: 'SOFIA_COMMAND_DEPENDENCY_UNAVAILABLE', retryable: false };
  }
}
