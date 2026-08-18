-- AlterTable
ALTER TABLE "whatsapp_outbound_messages" ADD COLUMN "auto_safe_decision_event_id" TEXT;

-- CreateIndex
CREATE INDEX "whatsapp_outbound_messages_auto_safe_decision_event_id_idx" ON "whatsapp_outbound_messages"("auto_safe_decision_event_id");

-- AddForeignKey
ALTER TABLE "whatsapp_outbound_messages" ADD CONSTRAINT "whatsapp_outbound_messages_auto_safe_decision_event_id_fkey" FOREIGN KEY ("auto_safe_decision_event_id") REFERENCES "sofia_auto_safe_decision_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
