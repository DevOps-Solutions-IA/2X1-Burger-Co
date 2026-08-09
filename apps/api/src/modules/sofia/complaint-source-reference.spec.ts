import { complaintSourceReference } from './complaint-source-reference';

describe('complaintSourceReference', () => {
  it('deduplicates only replay of the same inbound event', () => {
    const first = complaintSourceReference({
      conversationId: 'conversation-1',
      sourceEventId: 'inbound-event-1',
    });
    const replay = complaintSourceReference({
      conversationId: 'conversation-1',
      sourceEventId: 'inbound-event-1',
    });
    const laterComplaint = complaintSourceReference({
      conversationId: 'conversation-1',
      sourceEventId: 'inbound-event-2',
    });

    expect(replay).toBe(first);
    expect(laterComplaint).not.toBe(first);
  });

  it('keeps equal local event identifiers scoped to their conversation', () => {
    expect(complaintSourceReference({
      conversationId: 'conversation-1',
      sourceEventId: 'inbound-event-1',
    })).not.toBe(complaintSourceReference({
      conversationId: 'conversation-2',
      sourceEventId: 'inbound-event-1',
    }));
  });

  it('rejects missing transport identity instead of falling back to message text', () => {
    expect(() => complaintSourceReference({
      conversationId: 'conversation-1',
      sourceEventId: ' ',
    })).toThrow('SOFIA_COMPLAINT_SOURCE_IDENTITY_INVALID');
  });
});
