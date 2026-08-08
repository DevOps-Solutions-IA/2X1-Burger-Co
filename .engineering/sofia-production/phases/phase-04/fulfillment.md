# Fulfillment

Only `DELIVERY` and `TAKEAWAY` are accepted by Phase 4 policy. `DINE_IN` and `COUNTER` remain outside scope.

Takeaway clears address and quote bindings and fixes delivery fee to zero. Delivery requires an explicit address and an authoritative quote before a draft can become ready to confirm. Changing fulfillment invalidates prior confirmation and creates a newer draft version.
