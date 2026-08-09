# Invoice and receipt audit

The existing document is explicitly an operational POS receipt (`COMPROBANTE OPERATIVO POS`) exposed by the sales endpoint (`sales.controller.ts:29-35`; `sales.service.ts:397-401`). WhatsApp delivery of that receipt requires an authoritative paid sale (`whatsapp.service.ts:148-161`).

No `Invoice` model or DIAN/fiscal integration is present. Phase 5 may bind and send the authoritative operational receipt/reference generated after sale/payment application. It must not describe it as a tax invoice or invent fiscal behavior.
