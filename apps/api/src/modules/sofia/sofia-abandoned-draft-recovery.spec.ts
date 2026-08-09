import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SofiaTestOnlyGuard } from './runtime-safety/sofia-test-only.guard';
import { SofiaAgentService } from './sofia-agent.service';
import { SofiaController } from './sofia.controller';

describe('Sofia abandoned draft recovery isolation', () => {
  it('keeps the recovery route unavailable outside the explicit test runtime', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, SofiaController.prototype.recoverAbandonedDraft)).toContain(
      SofiaTestOnlyGuard,
    );
  });

  it('uses a neutral non-sandbox recovery action in the test-only response', async () => {
    const service = Object.create(SofiaAgentService.prototype) as SofiaAgentService;
    (service as unknown as { repository: { findDraftForRecovery: jest.Mock } }).repository = {
      findDraftForRecovery: jest.fn().mockResolvedValue({
        id: 'draft_test',
        conversationId: 'conversation_test',
        itemsSnapshot: [
          {
            productId: 'product_test',
            code: 'COMBO',
            name: 'Combo 2x1',
            quantity: 2,
            unitPrice: 25000,
            totalPrice: 50000,
          },
        ],
      }),
    };

    const result = await service.recoverAbandonedDraft({ draftId: 'draft_test' });

    expect(result).toMatchObject({
      conversationId: 'conversation_test',
      draftId: 'draft_test',
      detectedIntent: 'RECOVER_ABANDONED_ORDER',
      nextAction: 'RECOVERY_SUGGESTION_READY',
      safeguards: { noWhatsappReal: true },
    });
    expect(JSON.stringify(result)).not.toContain('SANDBOX');
  });
});
