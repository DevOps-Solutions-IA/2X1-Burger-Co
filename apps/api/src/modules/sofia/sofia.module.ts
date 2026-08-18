import { Module } from '@nestjs/common';
import { DomainContractsModule } from '../../application/domain-contracts.module';
import {
  CUSTOMER_RESOLUTION_SERVICE,
  ORDER_CREATION_SERVICE,
  ORDER_DRAFT_SERVICE,
  PAYMENT_READ_SERVICE,
} from '../../application/contracts/sofia-domain-contracts';
import { DeepSeekAIProvider } from './ai/deepseek-ai.provider';
import { NullAIProvider } from './ai/null-ai.provider';
import { RulesAIProvider } from './ai/rules-ai.provider';
import { SofiaAIProviderFactory } from './ai/sofia-ai-provider.factory';
import { SofiaSafetyGuard } from './ai/sofia-ai-safety.guard';
import { SofiaAlertsService } from './alerts/sofia-alerts.service';
import { SofiaAutoSafeModule } from './auto-safe/sofia-auto-safe.module';
import { SofiaBackupsService } from './backups/sofia-backups.service';
import { SofiaCommercialCatalogService } from './catalog/sofia-commercial-catalog.service';
import { SofiaCrmController } from './crm/sofia-crm.controller';
import { Phase8CrmRepository } from './crm/phase8-crm.repository';
import { SofiaCrmService } from './crm/sofia-crm.service';
import { CommercialCheckoutService } from './commercial/commercial-checkout.service';
import { CommercialIntentEngine } from './commercial/commercial-intent.engine';
import { CommercialMetricsService } from './commercial/commercial-metrics.service';
import { CommercialPolicyService } from './commercial/commercial-policy.service';
import { COMMERCIAL_REPOSITORY } from './commercial/commercial.repository';
import { PrismaCommercialRepository } from './commercial/persistence/prisma-commercial.repository';
import { CommercialResponseComposer } from './commercial/response/commercial-response.composer';
import { CommercialResponseValidator } from './commercial/response/commercial-response.validator';
import { COMMERCIAL_LANGUAGE_GENERATOR } from './commercial/response/commercial-response.types';
import { SafeCommercialResponseTemplates } from './commercial/response/safe-commercial-response.templates';
import { SofiaAICommercialLanguageGenerator } from './commercial/response/sofia-ai-commercial-language.generator';
import {
  SofiaCustomerResolutionAdapter,
  SofiaOrderCreationAdapter,
  SofiaOrderDraftAdapter,
  SofiaPaymentReadAdapter,
} from './contracts/sofia-contract.adapters';
import { SofiaAgentRepository } from './repositories/sofia-agent.repository';
import { SofiaGovernanceService } from './governance/sofia-governance.service';
import { SofiaReadinessService } from './governance/sofia-readiness.service';
import { SofiaHardeningService } from './hardening/sofia-hardening.service';
import { SofiaHumanFeedbackService } from './learning/sofia-human-feedback.service';
import { SofiaLearningService } from './learning/sofia-learning.service';
import { SofiaConversationMemoryService } from './memory/sofia-conversation-memory.service';
import { SofiaCustomerMemoryService } from './memory/sofia-customer-memory.service';
import { SofiaMetricsService } from './metrics/sofia-metrics.service';
import { SofiaPromptService } from './prompt/sofia-prompt.service';
import { SofiaPrivacyService } from './privacy/sofia-privacy.service';
import { SofiaAdminResponseSanitizerInterceptor } from './privacy/sofia-admin-response-sanitizer.interceptor';
import { SofiaRetentionService } from './retention/sofia-retention.service';
import { SofiaRuntimeSafetyService } from './runtime-safety/sofia-runtime-safety.service';
import { SofiaTestOnlyGuard } from './runtime-safety/sofia-test-only.guard';
import { SofiaAgentService } from './sofia-agent.service';
import { SofiaController } from './sofia.controller';
import { SofiaPaymentLinkService } from './sofia-payment-link.service';
import { SofiaDevPaymentsController } from './sofia-payment-webhooks.controller';
import { SofiaService } from './sofia.service';
import { SofiaHermesWhatsappWebhookController, SofiaWhatsappWebhookController } from './sofia-whatsapp.controller';
import { SofiaWhatsappService } from './sofia-whatsapp.service';
import { HermesWhatsappProvider } from './whatsapp/hermes-whatsapp.provider';
import { NullWhatsappProvider } from './whatsapp/null-whatsapp.provider';
import { SofiaWhatsappQrGatewayController } from './whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.controller';
import { SofiaWhatsappQrGatewayProvider } from './whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.provider';
import { SofiaWhatsappQrGatewayService } from './whatsapp/qr-gateway/sofia-whatsapp-qr-gateway.service';
import { WhatsappProviderFactory } from './whatsapp/whatsapp-provider.factory';
import { PrismaWhatsappProductionRepository } from './whatsapp/production/persistence/prisma-whatsapp-production.repository';
import { PrismaWhatsappConversationRepository } from './whatsapp/production/persistence/prisma-whatsapp-conversation.repository';
import { WhatsappConsentService } from './whatsapp/production/whatsapp-consent.service';
import { WhatsappDeliveryStatusService } from './whatsapp/production/whatsapp-delivery-status.service';
import { WhatsappEventNormalizer } from './whatsapp/production/whatsapp-event-normalizer';
import { WhatsappHandoffService } from './whatsapp/production/whatsapp-handoff.service';
import { WhatsappInboundDeduplicator } from './whatsapp/production/whatsapp-inbound-deduplicator';
import { WhatsappInboundGateway } from './whatsapp/production/whatsapp-inbound.gateway';
import { WhatsappMediaSecurityService } from './whatsapp/production/whatsapp-media-security.service';
import { WhatsappMessagePolicyService } from './whatsapp/production/whatsapp-message-policy.service';
import { WhatsappOutboundCommandHandler } from './whatsapp/production/whatsapp-outbound-command.handler';
import { WhatsappOutboundGateway } from './whatsapp/production/whatsapp-outbound.gateway';
import { WhatsappProviderHealthService } from './whatsapp/production/whatsapp-provider-health.service';
import { WHATSAPP_PRODUCTION_REPOSITORY } from './whatsapp/production/whatsapp-production.repository';
import { WhatsappWebhookVerifier } from './whatsapp/production/whatsapp-webhook-verifier';
import { WhatsappInboundRecoveryWorker } from './whatsapp/production/whatsapp-inbound-recovery.worker';
import { CustomerServiceModule } from '../customer-service/customer-service.module';

const TEST_ONLY_CONTROLLERS = process.env.NODE_ENV === 'test'
  ? [SofiaDevPaymentsController]
  : [];

@Module({
  imports: [SofiaAutoSafeModule, DomainContractsModule, CustomerServiceModule],
  controllers: [
    SofiaController,
    ...TEST_ONLY_CONTROLLERS,
    SofiaWhatsappWebhookController,
    SofiaHermesWhatsappWebhookController,
    SofiaWhatsappQrGatewayController,
    SofiaCrmController,
  ],
  providers: [
    SofiaService,
    SofiaPaymentLinkService,
    SofiaAgentService,
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
    SofiaAdminResponseSanitizerInterceptor,
    SofiaMetricsService,
    SofiaHumanFeedbackService,
    SofiaLearningService,
    SofiaRetentionService,
    SofiaAlertsService,
    SofiaBackupsService,
    SofiaHardeningService,
    SofiaRuntimeSafetyService,
    SofiaTestOnlyGuard,
    Phase8CrmRepository,
    SofiaCrmService,
    CommercialIntentEngine,
    CommercialPolicyService,
    CommercialMetricsService,
    CommercialResponseValidator,
    SafeCommercialResponseTemplates,
    CommercialResponseComposer,
    SofiaAICommercialLanguageGenerator,
    { provide: COMMERCIAL_LANGUAGE_GENERATOR, useExisting: SofiaAICommercialLanguageGenerator },
    CommercialCheckoutService,
    PrismaCommercialRepository,
    { provide: COMMERCIAL_REPOSITORY, useExisting: PrismaCommercialRepository },
    SofiaAgentRepository,
    PrismaWhatsappProductionRepository,
    PrismaWhatsappConversationRepository,
    { provide: WHATSAPP_PRODUCTION_REPOSITORY, useExisting: PrismaWhatsappProductionRepository },
    WhatsappWebhookVerifier,
    WhatsappEventNormalizer,
    WhatsappInboundDeduplicator,
    WhatsappInboundGateway,
    WhatsappInboundRecoveryWorker,
    WhatsappConsentService,
    WhatsappHandoffService,
    WhatsappMessagePolicyService,
    WhatsappMediaSecurityService,
    WhatsappDeliveryStatusService,
    WhatsappProviderHealthService,
    WhatsappOutboundGateway,
    WhatsappOutboundCommandHandler,
    SofiaOrderDraftAdapter,
    SofiaOrderCreationAdapter,
    SofiaCustomerResolutionAdapter,
    SofiaPaymentReadAdapter,
    { provide: ORDER_DRAFT_SERVICE, useExisting: SofiaOrderDraftAdapter },
    { provide: ORDER_CREATION_SERVICE, useExisting: SofiaOrderCreationAdapter },
    { provide: CUSTOMER_RESOLUTION_SERVICE, useExisting: SofiaCustomerResolutionAdapter },
    { provide: PAYMENT_READ_SERVICE, useExisting: SofiaPaymentReadAdapter },
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
    SofiaCrmService,
    WhatsappOutboundCommandHandler,
    WhatsappMessagePolicyService,
  ],
})
export class SofiaModule {}
