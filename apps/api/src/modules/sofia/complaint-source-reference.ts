import { createHash } from 'node:crypto';

const COMPLAINT_SOURCE_NAMESPACE = 'sofia-complaint:v2';

export function complaintSourceReference(input: {
  conversationId: string;
  sourceEventId: string;
}): string {
  const conversationId = boundedIdentity(input.conversationId);
  const sourceEventId = boundedIdentity(input.sourceEventId);
  return createHash('sha256')
    .update(`${COMPLAINT_SOURCE_NAMESPACE}\0${conversationId}\0${sourceEventId}`, 'utf8')
    .digest('hex');
}

function boundedIdentity(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 191) {
    throw new Error('SOFIA_COMPLAINT_SOURCE_IDENTITY_INVALID');
  }
  return normalized;
}
