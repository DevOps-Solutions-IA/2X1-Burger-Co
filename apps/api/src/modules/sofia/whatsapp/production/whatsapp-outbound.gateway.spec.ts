import type { ConfigService } from '@nestjs/config';
import { WhatsappOutboundGateway } from './whatsapp-outbound.gateway';

describe('WhatsappOutboundGateway provider result integrity', () => {
  function gateway(result: unknown) {
    const provider = { sendTextMessage: jest.fn().mockResolvedValue(result), sendMediaMessage: jest.fn() };
    const instance = new WhatsappOutboundGateway(
      { get: (key: string) => key === 'SOFIA_WHATSAPP_OUTBOUND_HANDLER_ENABLED' } as unknown as ConfigService,
      { getState: jest.fn().mockResolvedValue({ effective: { realSendingEnabled: true }, globalPaused: false, killSwitchActive: false }) } as never,
      { getProvider: jest.fn().mockReturnValue(provider) } as never,
    );
    return { instance, provider };
  }

  const input = {
    provider: 'hermes' as const,
    to: '573001234567',
    body: 'Mensaje gobernado',
    mediaUrl: null,
    idempotencyKey: 'command-1',
  };

  it('accepts SENT only with a validated provider identity', async () => {
    const { instance } = gateway({ status: 'SENT', providerMessageId: 'hermes-message-1' });

    await expect(instance.send(input)).resolves.toMatchObject({
      code: 'WHATSAPP_SENT',
      providerMessageId: 'hermes-message-1',
      unknownResult: false,
    });
  });

  it.each([null, '', ' ', 'message\nforged', 'a'.repeat(257), 123, { id: 'message-1' }])(
    'maps malformed SENT identity %p to a terminal unknown result',
    async (providerMessageId) => {
      const { instance } = gateway({ status: 'SENT', providerMessageId });

      await expect(instance.send(input)).resolves.toEqual({
        code: 'WHATSAPP_UNKNOWN_RESULT',
        providerMessageId: null,
        acceptedAt: null,
        retryable: false,
        unknownResult: true,
      });
    },
  );

  it('maps provider timeout or transport ambiguity to terminal unknown', async () => {
    const { instance, provider } = gateway({ status: 'SENT', providerMessageId: 'unused' });
    provider.sendTextMessage.mockRejectedValueOnce(new Error('timeout'));

    await expect(instance.send(input)).resolves.toMatchObject({
      code: 'WHATSAPP_UNKNOWN_RESULT',
      unknownResult: true,
      retryable: false,
    });
  });
});
