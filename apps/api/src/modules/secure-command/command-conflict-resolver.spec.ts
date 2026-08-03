import { CommandConflictResolver } from './command-conflict-resolver';
import { SecureCommandError, UnknownCommandResultError } from './secure-command.errors';

describe('CommandConflictResolver', () => {
  const resolver = new CommandConflictResolver();

  it('classifies unknown results as terminal and non-retryable', () => {
    expect(resolver.classify(new UnknownCommandResultError())).toEqual({
      failureClass: 'UNKNOWN_RESULT',
      code: 'SOFIA_COMMAND_UNKNOWN_RESULT',
      retryable: false,
    });
  });

  it('preserves structured dependency and conflict errors', () => {
    expect(resolver.classify(new SecureCommandError('SOFIA_COMMAND_DEPENDENCY_UNAVAILABLE', true))).toMatchObject({ failureClass: 'DEPENDENCY', retryable: true });
    expect(resolver.classify(new SecureCommandError('SOFIA_COMMAND_PAYLOAD_CONFLICT'))).toMatchObject({ failureClass: 'CONFLICT', retryable: false });
  });

  it('sanitizes arbitrary errors into a stable dependency code', () => {
    expect(resolver.classify(new Error('sensitive provider message'))).toEqual({
      failureClass: 'INTERNAL',
      code: 'SOFIA_COMMAND_DEPENDENCY_UNAVAILABLE',
      retryable: false,
    });
  });
});
