# Domain audit

Phase 4 reuses the Phase 1 application contracts for catalog, product and recipe availability, customer resolution, delivery quoting and audit. It maps `DELIVERY` to `OrderTicketType.DELIVERY` / `SaleChannel.DOMICILIO`, and `TAKEAWAY` to `OrderTicketType.TAKEAWAY` / `SaleChannel.PARA_LLEVAR`.

No parallel order, payment, inventory, cash, sale, kitchen or delivery-assignment authority was introduced. Payment execution remains owned by the existing payment-link/Bold stack and is not called by Phase 4.
