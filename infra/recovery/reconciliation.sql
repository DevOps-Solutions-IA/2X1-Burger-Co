WITH summary AS (
  SELECT jsonb_build_object(
    'schema', jsonb_build_object(
      'tables', (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'),
      'indexes', (SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public'),
      'unvalidatedConstraints', (SELECT COUNT(*) FROM pg_constraint WHERE NOT convalidated),
      'appliedMigrations', (SELECT COUNT(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
      'failedMigrations', (SELECT COUNT(*) FROM "_prisma_migrations" WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    ),
    'counts', jsonb_build_object(
      'users', (SELECT COUNT(*) FROM users),
      'cashSessions', (SELECT COUNT(*) FROM cash_sessions),
      'sales', (SELECT COUNT(*) FROM sales),
      'payments', (SELECT COUNT(*) FROM sale_payments),
      'orders', (SELECT COUNT(*) FROM order_tickets),
      'deliveryOrders', (SELECT COUNT(*) FROM order_tickets WHERE type = 'DELIVERY'),
      'products', (SELECT COUNT(*) FROM products),
      'inventoryMovements', (SELECT COUNT(*) FROM inventory_movements),
      'auditLogs', (SELECT COUNT(*) FROM audit_logs),
      'settings', (SELECT COUNT(*) FROM settings),
      'whatsappConversations', (SELECT COUNT(*) FROM whatsapp_conversations),
      'whatsappInbound', (SELECT COUNT(*) FROM whatsapp_inbound_events),
      'whatsappOutbound', (SELECT COUNT(*) FROM whatsapp_outbound_messages),
      'crmPipelines', (SELECT COUNT(*) FROM crm_pipelines),
      'crmPipelineStages', (SELECT COUNT(*) FROM crm_pipeline_stages),
      'crmLeads', (SELECT COUNT(*) FROM crm_leads),
      'crmLeadStageHistory', (SELECT COUNT(*) FROM crm_lead_stage_history),
      'crmTasks', (SELECT COUNT(*) FROM crm_tasks),
      'crmNotes', (SELECT COUNT(*) FROM crm_notes)
    ),
    'financial', jsonb_build_object(
      'salesSubtotal', (SELECT COALESCE(SUM(subtotal), 0)::text FROM sales),
      'salesTotal', (SELECT COALESCE(SUM(total), 0)::text FROM sales),
      'paymentsTotal', (SELECT COALESCE(SUM(amount), 0)::text FROM sale_payments),
      'cashOpeningTotal', (SELECT COALESCE(SUM("openingAmount"), 0)::text FROM cash_sessions),
      'cashClosingTotal', (SELECT COALESCE(SUM("closingAmount"), 0)::text FROM cash_sessions),
      'ordersSubtotal', (SELECT COALESCE(SUM(subtotal), 0)::text FROM order_tickets),
      'deliveryFeeTotal', (SELECT COALESCE(SUM(delivery_fee), 0)::text FROM order_tickets)
    ),
    'inventory', jsonb_build_object(
      'productStockTotal', (SELECT COALESCE(SUM("currentStock"), 0)::text FROM products),
      'movementQuantityTotal', (SELECT COALESCE(SUM(quantity), 0)::text FROM inventory_movements)
    ),
    'logicalChecksums', jsonb_build_object(
      'users', (SELECT md5(COALESCE(string_agg(concat_ws('|', id, email, "isActive", session_version), '||' ORDER BY id), '')) FROM users),
      'cashSessions', (SELECT md5(COALESCE(string_agg(concat_ws('|', id, status, "openingAmount", "closingAmount", "expectedAmount", difference), '||' ORDER BY id), '')) FROM cash_sessions),
      'sales', (SELECT md5(COALESCE(string_agg(concat_ws('|', id, number, status, subtotal, total, "cashSessionId"), '||' ORDER BY id), '')) FROM sales),
      'payments', (SELECT md5(COALESCE(string_agg(concat_ws('|', id, "saleId", "paymentMethodId", amount), '||' ORDER BY id), '')) FROM sale_payments),
      'orders', (SELECT md5(COALESCE(string_agg(concat_ws('|', id, number, status, type, revision, subtotal, delivery_fee), '||' ORDER BY id), '')) FROM order_tickets),
      'products', (SELECT md5(COALESCE(string_agg(concat_ws('|', id, code, "currentStock", "salePrice"), '||' ORDER BY id), '')) FROM products),
      'inventoryMovements', (SELECT md5(COALESCE(string_agg(concat_ws('|', id, "ingredientId", "productId", type, quantity, "balanceAfter"), '||' ORDER BY id), '')) FROM inventory_movements),
      'auditLogs', (SELECT md5(COALESCE(string_agg(concat_ws('|', id, action, module, entity, "entityId", "createdAt"), '||' ORDER BY id), '')) FROM audit_logs),
      'settings', (SELECT md5(COALESCE(string_agg(concat_ws('|', id, key, md5(value::text)), '||' ORDER BY id), '')) FROM settings)
    )
  ) AS value
)
SELECT value::text FROM summary;
