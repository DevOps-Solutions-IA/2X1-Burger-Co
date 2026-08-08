# Draft and confirmation

The existing `SofiaOrderDraft` is extended rather than duplicated. Hashes use canonical SHA-256 facts and exclude LLM prose, raw messages and hidden reasoning. Material changes advance `version`; updates use `id + expectedVersion` optimistic concurrency.

Confirmation binds draft ID, current version and draft hash. Expired drafts/quotes are refreshed and reconfirmed. Confirmed history is preserved: a later material change creates a new row/version. Duplicate confirmation replays without executing a second mutation. Legacy unbound drafts are non-confirmable.
