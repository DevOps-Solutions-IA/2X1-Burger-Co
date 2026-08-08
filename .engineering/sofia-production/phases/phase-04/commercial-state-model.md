# Commercial state model

The state is stored as schema version 4 in the existing `SofiaConversationMemory.currentOrderIntentJson`. Historical JSON without `schemaVersion: 4` is ignored by the Phase 4 repository.

Operational state includes customer/conversation references, items, modifiers, fulfillment, address confirmation, location context, payment preference/readiness, subtotal, delivery fee, total, quote binding, availability snapshot, draft ID/version/hash, confirmation state, missing fields, ambiguity, confidence, handoff and expiry. Raw hidden reasoning and chain-of-thought are not persisted.
