import { CommandHandlerRegistry } from './command-handler.registry';
import { SecureCommandError } from './secure-command.errors';
import type { SecureCommandType } from './secure-command.types';

describe('CommandHandlerRegistry', () => {
  const registry = new CommandHandlerRegistry();
  const blocked: SecureCommandType[] = [
    'SOFIA_CREATE_ORDER',
    'SOFIA_SEND_WHATSAPP',
    'SOFIA_MARK_PAYMENT',
    'SOFIA_DEDUCT_STOCK',
    'SOFIA_MUTATE_CASH',
    'SOFIA_CREATE_SALE',
    'SOFIA_ASSIGN_DELIVERY',
    'SOFIA_CUSTOMER_AUTO_RESPONSE',
  ];

  it('registers only the internal validation handler as enabled', () => {
    expect(registry.definition('SOFIA_INTERNAL_VALIDATE')).toMatchObject({ enabled: true, operational: false });
  });

  it.each(blocked)('keeps %s operationally blocked', (commandType) => {
    expect(registry.definition(commandType)).toMatchObject({ enabled: false, operational: true });
  });

  it('fails closed for arbitrary handler strings', () => {
    expect(() => registry.definition('ARBITRARY_TOOL')).toThrow(SecureCommandError);
  });
});
