# Delivery checkout

Delivery uses `DeliveryQuoteService`; the LLM cannot calculate the fee. The draft binds audit ID, calculation version, quote expiry, address, fee and total. Location coordinates remain logistical context and never replace address or pricing authority.

Missing, rejected or expired quotes fail closed. Quote refresh creates a new version and requires a new exact confirmation.
