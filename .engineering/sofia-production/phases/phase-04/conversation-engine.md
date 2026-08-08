# Conversation engine

`CommercialIntentEngine` normalizes natural Spanish phrases into purchase/change/confirm/reject/handoff intent, fulfillment, payment preference, quantity and bounded modifiers. `CommercialCheckoutService` merges those facts with versioned conversation state, asks only for unresolved fields and emits a fact envelope independent from response wording.

Context-free `si` cannot confirm. A confirmation requires `lastQuestionPurpose=CONFIRM_ORDER`, current draft ID/version/hash and unexpired bindings. Existing Sofia catalog, prior-order, complaint and controlled-AI capabilities retain their specialized paths.
