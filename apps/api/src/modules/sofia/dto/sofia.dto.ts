import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class SofiaOrderItemDto {
  @IsString()
  productId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateMockConversationDto {
  @IsString()
  phone!: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsObject()
  rawPayload?: Record<string, unknown>;
}

export class MockOutboundMessageDto {
  @IsString()
  body!: string;

  @IsOptional()
  @IsObject()
  rawPayload?: Record<string, unknown>;
}

export class CreateSofiaOrderDraftDto {
  @IsOptional()
  @IsString()
  conversationId?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  customerPhone?: string;

  @IsOptional()
  @IsString()
  deliveryAddress?: string;

  @IsOptional()
  @IsString()
  deliveryNeighborhood?: string;

  @IsOptional()
  @IsString()
  deliveryNotes?: string;

  @IsOptional()
  @IsString()
  aiSummary?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SofiaOrderItemDto)
  items?: SofiaOrderItemDto[];
}

export class UpdateSofiaOrderDraftDto {
  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsString()
  customerPhone?: string;

  @IsOptional()
  @IsString()
  deliveryAddress?: string;

  @IsOptional()
  @IsString()
  deliveryNeighborhood?: string;

  @IsOptional()
  @IsString()
  deliveryNotes?: string;

  @IsOptional()
  @IsString()
  aiSummary?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SofiaOrderItemDto)
  items?: SofiaOrderItemDto[];
}

export class UpdateWhatsappDeliveryOrderStatusDto {
  @IsIn(['CONFIRMED', 'SENT_TO_KITCHEN', 'IN_PREPARATION', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'])
  status!: 'CONFIRMED' | 'SENT_TO_KITCHEN' | 'IN_PREPARATION' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED';
}

export class MarkConversationHandoffDto {
  @IsOptional()
  @IsString()
  assignedToUserId?: string;
}

export class SetConversationSofiaEnabledDto {
  @IsBoolean()
  sofiaEnabled!: boolean;
}

export class SelectSofiaPaymentMethodDto {
  @IsIn(['ONLINE', 'NEQUI_MANUAL', 'CASH'])
  method!: 'ONLINE' | 'NEQUI_MANUAL' | 'CASH';
}

export class UpdateSofiaPaymentSettingsDto {
  @IsOptional()
  @IsBoolean()
  cashEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  nequiManualEnabled?: boolean;

  @IsOptional()
  @IsString()
  nequiManualPhone?: string;

  @IsOptional()
  @IsString()
  nequiManualHolderName?: string;

  @IsOptional()
  @IsBoolean()
  prepareCashOrdersImmediately?: boolean;

  @IsOptional()
  @IsBoolean()
  prepareManualTransferBeforeVerification?: boolean;

  @IsOptional()
  @IsBoolean()
  manualPaymentRequiresOperator?: boolean;

  @IsOptional()
  @IsString()
  paymentInstructionsText?: string;

  @IsOptional()
  @IsBoolean()
  onlinePaymentsEnabled?: boolean;

  @IsOptional()
  @IsIn(['MOCK', 'BOLD', 'NONE'])
  onlinePaymentProvider?: 'MOCK' | 'BOLD' | 'NONE';

  @IsOptional()
  @IsBoolean()
  mockOnlinePaymentsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  boldEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(5)
  paymentLinkTtlMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  onlinePaymentExpiresMinutes?: number;

  @IsOptional()
  @IsBoolean()
  prepareOnlineOrdersBeforePaid?: boolean;

}

export class UpdateSofiaManualPaymentStatusDto {
  @IsIn(['FAILED', 'MANUAL_REVIEW', 'CANCELLED'])
  status!: 'FAILED' | 'MANUAL_REVIEW' | 'CANCELLED';

  @IsOptional()
  @IsIn(['ONLINE', 'NEQUI_MANUAL', 'CASH'])
  paymentMethod?: 'ONLINE' | 'NEQUI_MANUAL' | 'CASH';

  @IsOptional()
  @IsString()
  message?: string;
}

export class MessageConfidenceDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence!: number;
}

export class MockSofiaPaymentWebhookDto {
  @IsOptional()
  @IsString()
  orderReference?: string;

  @IsOptional()
  @IsString()
  providerReference?: string;

  @IsOptional()
  @IsString()
  providerPaymentId?: string;

  @IsIn(['PAID', 'FAILED', 'REVIEW'])
  status!: 'PAID' | 'FAILED' | 'REVIEW';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  eventId?: string;
}

export class ProcessSofiaAgentMessageDto {
  @IsOptional()
  @IsString()
  conversationId?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsString()
  message!: string;

  @IsOptional()
  @IsIn(['TEXT', 'AUDIO_TRANSCRIPT'])
  messageType?: 'TEXT' | 'AUDIO_TRANSCRIPT';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  transcriptConfidence?: number;

  @IsOptional()
  @IsString()
  sandboxNow?: string;
}

export class RecoverSofiaAbandonedDraftDto {
  @IsOptional()
  @IsString()
  conversationId?: string;

  @IsOptional()
  @IsString()
  draftId?: string;
}

export class TestSofiaAiProviderDto {
  @IsString()
  message!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  customerName?: string;

  @IsOptional()
  @IsIn(['rules', 'deepseek', 'hybrid'])
  provider?: 'rules' | 'deepseek' | 'hybrid';

  @IsOptional()
  @IsIn(['disabled', 'dry_run', 'suggest', 'supervised', 'auto'])
  mode?: 'disabled' | 'dry_run' | 'suggest' | 'supervised' | 'auto';

  @IsOptional()
  @IsIn(['none', 'valid', 'invented_product', 'mark_paid', 'timeout', 'invalid_json', 'low_confidence'])
  scenario?: 'none' | 'valid' | 'invented_product' | 'mark_paid' | 'timeout' | 'invalid_json' | 'low_confidence';
}

export class EvaluateSofiaAutoSafeDto {
  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  messageText!: string;

  @IsOptional()
  @IsString()
  candidateReply?: string;

  @IsOptional()
  @IsObject()
  simulateMemory?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  simulateConversationState?: string;

  @IsOptional()
  @IsString()
  simulatePaymentIntent?: string;

  @IsOptional()
  @IsString()
  simulateOrderIntent?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  simulateConfidence?: number;

  @IsOptional()
  @IsString()
  simulateChannelMode?: string;

  @IsOptional()
  @IsBoolean()
  sandbox?: boolean;

  @IsOptional()
  @IsBoolean()
  autoSafeEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  secretRotationPending?: boolean;

  @IsOptional()
  @IsBoolean()
  qrReady?: boolean;

  @IsOptional()
  @IsBoolean()
  deepSeekReady?: boolean;
}

export class UpdateSofiaGovernanceSettingsDto {
  @IsOptional()
  @IsBoolean()
  qrRealAllowed?: boolean;

  @IsOptional()
  @IsBoolean()
  deepSeekRealAllowed?: boolean;

  @IsOptional()
  @IsBoolean()
  autoSafeProductionAllowed?: boolean;

  @IsOptional()
  @IsIn(['PENDING', 'COMPLETE', 'UNKNOWN'])
  secretRotationStatus?: 'PENDING' | 'COMPLETE' | 'UNKNOWN';
}

export class PauseSofiaGovernanceDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class SofiaWhatsappQrTestInboundDto {
  @IsString()
  phone!: string;

  @IsOptional()
  @IsString()
  text?: string;

  @IsOptional()
  @IsString()
  externalMessageId?: string;

  @IsOptional()
  @IsIn(['TEXT', 'IMAGE', 'AUDIO', 'INTERACTIVE', 'SYSTEM'])
  messageType?: 'TEXT' | 'IMAGE' | 'AUDIO' | 'INTERACTIVE' | 'SYSTEM';

  @IsOptional()
  @IsBoolean()
  fromMe?: boolean;

  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @IsOptional()
  @IsString()
  mediaMimeType?: string;

  @IsOptional()
  @IsString()
  transcript?: string;
}

export class SofiaWhatsappQrTestSendDto {
  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  body?: string;

  @IsOptional()
  @IsString()
  text?: string;
}
