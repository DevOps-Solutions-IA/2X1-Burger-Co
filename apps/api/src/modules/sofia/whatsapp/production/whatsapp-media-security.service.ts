import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { InboundMediaMetadata, MediaSecurityDecision } from './whatsapp-production.types';
import { WHATSAPP_PRODUCTION_REPOSITORY, type WhatsappProductionRepository } from './whatsapp-production.repository';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'audio/ogg', 'audio/mpeg', 'application/pdf']);
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

@Injectable()
export class WhatsappMediaSecurityService {
  constructor(@Inject(WHATSAPP_PRODUCTION_REPOSITORY) private readonly repository: WhatsappProductionRepository) {}

  evaluate(media: InboundMediaMetadata | null): MediaSecurityDecision {
    if (!media) return { accepted: true, status: 'METADATA_ONLY', reasonCode: 'NO_MEDIA', fetchAllowed: false, aiIngestionAllowed: false };
    if (!media.providerReference || !/^[A-Za-z0-9._:/-]{1,512}$/.test(media.providerReference)) {
      return this.reject('MEDIA_REFERENCE_UNSAFE');
    }
    if (!media.declaredMimeType || !ALLOWED_MIME.has(media.declaredMimeType.toLowerCase())) {
      return this.reject('MEDIA_MIME_UNSUPPORTED');
    }
    if (media.declaredSizeBytes == null) {
      return { accepted: false, status: 'QUARANTINED', reasonCode: 'MEDIA_SIZE_REQUIRED', fetchAllowed: false, aiIngestionAllowed: false };
    }
    if (media.declaredSizeBytes > MAX_MEDIA_BYTES) return this.reject('MEDIA_TOO_LARGE');
    return { accepted: true, status: 'METADATA_ONLY', reasonCode: 'MEDIA_METADATA_ACCEPTED_NO_FETCH', fetchAllowed: false, aiIngestionAllowed: false };
  }

  referenceHash(reference: string) {
    return createHash('sha256').update(reference).digest('hex');
  }

  async persist(messageId: string, media: InboundMediaMetadata) {
    const decision = this.evaluate(media);
    const reference = media.providerReference ?? `missing:${messageId}`;
    await this.repository.createMediaEnvelope({
      messageId,
      providerReferenceHash: this.referenceHash(reference),
      declaredMimeType: media.declaredMimeType,
      declaredSizeBytes: media.declaredSizeBytes == null ? null : BigInt(media.declaredSizeBytes),
      securityStatus: decision.status,
      rejectionCode: decision.accepted ? null : decision.reasonCode,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    return decision;
  }

  private reject(reasonCode: string): MediaSecurityDecision {
    return { accepted: false, status: 'REJECTED', reasonCode, fetchAllowed: false, aiIngestionAllowed: false };
  }
}
