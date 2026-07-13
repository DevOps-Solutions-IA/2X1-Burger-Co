import { Module } from '@nestjs/common';
import { DeepSeekAIProvider } from './ai/deepseek-ai.provider';
import { NullAIProvider } from './ai/null-ai.provider';
import { RulesAIProvider } from './ai/rules-ai.provider';
import { SofiaAIProviderFactory } from './ai/sofia-ai-provider.factory';
import { SofiaSafetyGuard } from './ai/sofia-ai-safety.guard';
import { SofiaAlertsService } from './alerts/sofia-alerts.service';
import { SofiaAutoSafeModule } from './auto-safe/sofia-auto-safe.module';
import { SofiaBackupsService } from './backups/sofia-backups.service';
import { SofiaCommercialCatalogService } from './catalog/sofia-commercial-catalog.service';
import { SofiaGovernanceService } from './governance/sofia-governance.service';
import { SofiaReadinessService } from './governance/sofia-readiness.service';
import { SofiaHardeningService } from './hardening/sofia-hardening.service';
import { SofiaHumanFeedbackService } from './learning/sofia-human-feedback.service';
import { SofiaLearningService } from './learning/sofia-learning.service';
import { SofiaConversationMemoryService } from './memory/sofia-conversation-memory.service';
import { SofiaCustomerMemoryService } from './memory/sofia-customer-memory.service';
import { SofiaMetricsService } from './metrics/sofia-metrics.service';
import { BoldPaymentProvider } from './payments/bold-payment.provider';
import { MockPaymentProvider } from './payments/mock-payment.provider';
import { NullPaymentProvider } from './payments/null-payment.provider';
import { PaymentProviderFactory } from './payments/payment-provider.factory';
import { SofiaPromptService } from './prompt/sofia-prompt.service';
import { SofiaPrivacyService } from './privacy/sofia-privacy.service';
import { SofiaRetentionService } from './retention/sofia-retention.service';
import { SofiaRuntimeSafetyService } from './runtime-safety/sofia-runtime-safety.service';
import { SofiaAgentService } from './sofia-agent.service';
import { SofiaController } from './sofia.controller';
import { SofiaPaymentLinkService } from './sofia-payment-link.service';
import { SofiaDevPaymentsController, SofiaPaymentWebhooksController } from './sofia-payment-webhooks.controller';
import { SofiaPublicPaymentsController } from './sofia-public-payments.controller';
import { SofiaService } from './sofia.service';
import { SofiaHermesWhatsappWebhookController, SofiaWhatsappWebhookController } from './sofia-whatsapp.controller';
import { SofiaWhatsappService } from './sofia-whatsapp.service';
import { HermesWhatsappProvider } from './whatsapp/hermes-whatsapp.provider';
import { MockWhatsappProvider } from './whatsapp/mock-whatsapp.provider';
import { NullWhatsappProvider } from './whatsapp/null-whatsapp.provider';
import { SofiaWhatsappQrGatewayController } from './whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.controller';
import { SofiaWhatsappQrGatewayProvider } from './whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.provider';
import { SofiaWhatsappQrGatewayService } from './whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.service';
import { WhatsappProviderFactory } from './whatsapp/whatsapp-provider.factory';

@Module({
  imports: [SofiaAutoSafeModule],
  controllers: [
    SofiaController,
    SofiaPublicPaymentsController,
    SofiaPaymentWebhooksController,
    SofiaDevPaymentsController,
    SofiaWhatsappWebhookController,
    SofiaHermesWhatsappWebhookController,
    SofiaWhatsappQrGatewayController,
  ],
  providers: [
    SofiaService,
    SofiaPaymentLinkService,
    MockPaymentProvider,
    BoldPaymentProvider,
    NullPaymentProvider,
    PaymentProviderFactory,
    SofiaAgentService,
    MockWhatsappProvider,
    HermesWhatsappProvider,
    SofiaWhatsappQrGatewayProvider,
    NullWhatsappProvider,
    WhatsappProviderFactory,
    SofiaWhatsappService,
    SofiaWhatsappQrGatewayService,
    RulesAIProvider,
    DeepSeekAIProvider,
    NullAIProvider,
    SofiaSafetyGuard,
    SofiaAIProviderFactory,
    SofiaPromptService,
    SofiaCommercialCatalogService,
    SofiaCustomerMemoryService,
    SofiaConversationMemoryService,
    SofiaReadinessService,
    SofiaGovernanceService,
    SofiaPrivacyService,
    SofiaMetricsService,
    SofiaHumanFeedbackService,
    SofiaLearningService,
    SofiaRetentionService,
    SofiaAlertsService,
    SofiaBackupsService,
    SofiaHardeningService,
    SofiaRuntimeSafetyService,
  ],
  exports: [
    SofiaService,
    SofiaPaymentLinkService,
    SofiaAgentService,
    SofiaWhatsappService,
    SofiaWhatsappQrGatewayService,
    SofiaPromptService,
    SofiaCommercialCatalogService,
    SofiaCustomerMemoryService,
    SofiaConversationMemoryService,
    SofiaAutoSafeModule,
    SofiaReadinessService,
    SofiaGovernanceService,
    SofiaPrivacyService,
    SofiaMetricsService,
    SofiaHumanFeedbackService,
    SofiaLearningService,
    SofiaRetentionService,
    SofiaAlertsService,
    SofiaBackupsService,
    SofiaHardeningService,
    SofiaRuntimeSafetyService,
  ],
})
export class SofiaModule {}
