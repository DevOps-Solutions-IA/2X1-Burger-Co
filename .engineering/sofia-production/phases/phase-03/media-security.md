# Media security

## Status

`MEDIA_SECURITY_STATUS: PARTIAL_FAIL_CLOSED`

## Current controls

- The QR transport does not download inbound media.
- Provider media URLs are not persisted in `WhatsappMessage`; only MIME type and sanitized summary survive.
- Audio/image without usable text triggers human review and no multimodal inference.
- Group and broadcast messages are ignored.
- Outbound media is restricted to four local SOFIA offer paths by `isSofiaFeaturedOfferMedia`.
- Privacy sanitization redacts known secret, phone, address and raw payload keys.

## Gaps

- No authoritative maximum byte size, MIME allowlist, magic-byte validation, filename policy, malware scan, quarantine, or scan result.
- QR video is collapsed to `IMAGE`; document and location semantics are not represented correctly in the SOFIA adapter.
- Provider-supplied captions/transcripts can reach the model and remain prompt-injection input.
- Hermes accepts arbitrary remote media URLs and outbound media URLs.
- No media-specific retention enforcement or deletion proof exists.
- There is no download isolation, redirect policy, private-network protection, or content-disposition handling.

## Phase 3 actions

`WhatsappMediaSecurityService` must default to metadata-only. If later download is authorized, use a quarantined worker with byte/time limits, MIME and magic-byte checks, redirect and private-network denial, malware scanning, randomized storage names, encryption, retention expiry, and no model access before a clean result. Location must be a structured event, not media. All extracted text remains untrusted and passes prompt-injection policy. Failure yields human review, never automatic reply.
