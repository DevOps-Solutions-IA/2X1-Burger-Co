CREATE TYPE "WhatsappConversationStatus" AS ENUM ('ACTIVE', 'HUMAN_REQUIRED', 'HUMAN_TAKEN', 'RESOLVED', 'ARCHIVED');
CREATE TYPE "WhatsappMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'SYSTEM');
CREATE TYPE "WhatsappMessageType" AS ENUM ('TEXT', 'AUDIO', 'IMAGE', 'DOCUMENT', 'BUTTON', 'SYSTEM');
CREATE TYPE "SofiaOrderDraftStatus" AS ENUM ('DRAFT', 'NEEDS_INFO', 'READY_TO_CONFIRM', 'CONFIRMED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "WhatsappDeliveryOrderStatus" AS ENUM ('CONFIRMED', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED');
CREATE TYPE "WhatsappPaymentStatus" AS ENUM ('UNSELECTED', 'CASH_ON_DELIVERY', 'PENDING_MANUAL_VERIFICATION', 'MANUAL_REVIEW', 'PAID', 'FAILED');
CREATE TYPE "SofiaOrderSource" AS ENUM ('WHATSAPP', 'SOFIA', 'WHATSAPP_SOFIA', 'MOCK_ADMIN');

CREATE TABLE "whatsapp_conversations" (
  "id" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "customer_name" TEXT,
  "status" "WhatsappConversationStatus" NOT NULL DEFAULT 'ACTIVE',
  "source" "SofiaOrderSource" NOT NULL DEFAULT 'WHATSAPP',
  "sofia_enabled" BOOLEAN NOT NULL DEFAULT true,
  "assigned_to_user_id" TEXT,
  "last_message_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "whatsapp_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "whatsapp_messages" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "direction" "WhatsappMessageDirection" NOT NULL,
  "type" "WhatsappMessageType" NOT NULL DEFAULT 'TEXT',
  "body" TEXT,
  "media_url" TEXT,
  "transcript" TEXT,
  "raw_payload" JSONB,
  "ai_intent" TEXT,
  "confidence" DECIMAL(5,4),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sofia_order_drafts" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT,
  "status" "SofiaOrderDraftStatus" NOT NULL DEFAULT 'DRAFT',
  "customer_name" TEXT,
  "customer_phone" TEXT,
  "delivery_address" TEXT,
  "delivery_neighborhood" TEXT,
  "delivery_notes" TEXT,
  "items_snapshot" JSONB NOT NULL,
  "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "delivery_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'COP',
  "missing_fields" JSONB,
  "ai_summary" TEXT,
  "source" "SofiaOrderSource" NOT NULL DEFAULT 'SOFIA',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sofia_order_drafts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "whatsapp_delivery_orders" (
  "id" TEXT NOT NULL,
  "conversation_id" TEXT,
  "order_draft_id" TEXT,
  "order_ticket_id" TEXT,
  "status" "WhatsappDeliveryOrderStatus" NOT NULL DEFAULT 'CONFIRMED',
  "payment_status" "WhatsappPaymentStatus" NOT NULL DEFAULT 'UNSELECTED',
  "payment_method" TEXT,
  "customer_name_snapshot" TEXT,
  "customer_phone_snapshot" TEXT,
  "delivery_address_snapshot" TEXT,
  "delivery_neighborhood_snapshot" TEXT,
  "items_snapshot" JSONB NOT NULL,
  "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "delivery_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "source" "SofiaOrderSource" NOT NULL DEFAULT 'WHATSAPP_SOFIA',
  "created_by_agent_name_snapshot" TEXT NOT NULL DEFAULT 'Sofía',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "whatsapp_delivery_orders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "whatsapp_conversations_phone_idx" ON "whatsapp_conversations"("phone");
CREATE INDEX "whatsapp_conversations_status_updated_at_idx" ON "whatsapp_conversations"("status", "updated_at");
CREATE INDEX "whatsapp_conversations_assigned_to_user_id_idx" ON "whatsapp_conversations"("assigned_to_user_id");

CREATE INDEX "whatsapp_messages_conversation_id_created_at_idx" ON "whatsapp_messages"("conversation_id", "created_at");
CREATE INDEX "whatsapp_messages_direction_created_at_idx" ON "whatsapp_messages"("direction", "created_at");

CREATE INDEX "sofia_order_drafts_conversation_id_idx" ON "sofia_order_drafts"("conversation_id");
CREATE INDEX "sofia_order_drafts_status_updated_at_idx" ON "sofia_order_drafts"("status", "updated_at");
CREATE INDEX "sofia_order_drafts_customer_phone_idx" ON "sofia_order_drafts"("customer_phone");

CREATE UNIQUE INDEX "whatsapp_delivery_orders_order_draft_id_key" ON "whatsapp_delivery_orders"("order_draft_id");
CREATE UNIQUE INDEX "whatsapp_delivery_orders_order_ticket_id_key" ON "whatsapp_delivery_orders"("order_ticket_id");
CREATE INDEX "whatsapp_delivery_orders_conversation_id_idx" ON "whatsapp_delivery_orders"("conversation_id");
CREATE INDEX "whatsapp_delivery_orders_status_updated_at_idx" ON "whatsapp_delivery_orders"("status", "updated_at");
CREATE INDEX "whatsapp_delivery_orders_payment_status_updated_at_idx" ON "whatsapp_delivery_orders"("payment_status", "updated_at");
CREATE INDEX "whatsapp_delivery_orders_customer_phone_snapshot_idx" ON "whatsapp_delivery_orders"("customer_phone_snapshot");

ALTER TABLE "whatsapp_conversations"
  ADD CONSTRAINT "whatsapp_conversations_assigned_to_user_id_fkey"
  FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "whatsapp_messages"
  ADD CONSTRAINT "whatsapp_messages_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sofia_order_drafts"
  ADD CONSTRAINT "sofia_order_drafts_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "whatsapp_delivery_orders"
  ADD CONSTRAINT "whatsapp_delivery_orders_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "whatsapp_delivery_orders"
  ADD CONSTRAINT "whatsapp_delivery_orders_order_draft_id_fkey"
  FOREIGN KEY ("order_draft_id") REFERENCES "sofia_order_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "whatsapp_delivery_orders"
  ADD CONSTRAINT "whatsapp_delivery_orders_order_ticket_id_fkey"
  FOREIGN KEY ("order_ticket_id") REFERENCES "order_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
