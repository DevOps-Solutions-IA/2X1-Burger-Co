import { Injectable } from '@nestjs/common';
import { SofiaEnterpriseStatusResponse, SofiaGovernanceCheckStatus, SofiaReadinessItem } from './sofia-governance.types';

@Injectable()
export class SofiaReadinessService {
  buildChecklist(input: {
    promptActive: boolean;
    catalogActive: boolean;
    memoryReady: boolean;
    autoSafeReady: boolean;
    killSwitchReady: boolean;
    secretRotationComplete: boolean;
    qrGatewayReady: boolean;
    qrReceiveOnlyReady?: boolean;
    deepSeekReady: boolean;
    whatsappRealSendingEnabled: boolean;
    maxiFamilyProtected: boolean;
    whatsappCanMarkPaid: boolean;
    checkoutRegressionKnownPass: boolean;
  }): SofiaReadinessItem[] {
    return [
      this.item('prompt_active', 'Prompt activo', input.promptActive, 'Prompt maestro versionado activo.'),
      this.item('catalog_active', 'Catálogo activo', input.catalogActive, 'Catálogo comercial canónico disponible.'),
      this.item('memory_active', 'Memoria persistente', input.memoryReady, 'Memoria por cliente/conversación disponible.'),
      this.item('safetyguard_active', 'SafetyGuard activo', true, 'SafetyGuard está integrado en SofiaAgentService.'),
      this.item('auto_safe_sandbox', 'Auto Safe sandbox', input.autoSafeReady, 'Auto Safe Engine registra decisiones auditables.'),
      this.item('kill_switch', 'Kill-switch disponible', input.killSwitchReady, 'Pausa global persistente disponible.'),
      this.item(
        'secret_rotation',
        'Rotación externa de secretos',
        input.secretRotationComplete,
        input.secretRotationComplete ? 'Rotación externa marcada como completa.' : 'Rotación externa pendiente bloquea producción.',
        input.secretRotationComplete ? 'PASS' : 'BLOCKED',
      ),
      this.item(
        'qr_gateway_architecture',
        'QR Gateway arquitectura',
        input.qrGatewayReady,
        input.qrGatewayReady ? 'QR Gateway dedicado disponible para receive_only.' : 'QR Gateway dedicado no está listo.',
        input.qrGatewayReady ? 'PASS' : 'BLOCKED',
      ),
      this.item(
        'qr_receive_only',
        'QR receive_only',
        input.qrReceiveOnlyReady ?? input.qrGatewayReady,
        (input.qrReceiveOnlyReady ?? input.qrGatewayReady)
          ? 'Inbound controlado receive_only disponible.'
          : 'Inbound receive_only no está disponible.',
        (input.qrReceiveOnlyReady ?? input.qrGatewayReady) ? 'PASS' : 'BLOCKED',
      ),
      this.item(
        'qr_gateway_real_send',
        'QR envío real',
        false,
        'Envío real bloqueado en F4.',
        'BLOCKED',
      ),
      this.item(
        'qr_gateway_real',
        'QR Gateway producción',
        false,
        'Producción QR sigue bloqueada hasta rotación externa y fase piloto.',
        'BLOCKED',
      ),
      this.item(
        'deepseek_real',
        'DeepSeek real',
        input.deepSeekReady,
        input.deepSeekReady ? 'DeepSeek real configurado.' : 'DeepSeek real permanece desactivado en F3.',
        input.deepSeekReady ? 'PASS' : 'BLOCKED',
      ),
      this.item(
        'whatsapp_real',
        'WhatsApp real',
        input.whatsappRealSendingEnabled,
        input.whatsappRealSendingEnabled ? 'Envío real habilitado.' : 'Envío real bloqueado en F3.',
        input.whatsappRealSendingEnabled ? 'PASS' : 'BLOCKED',
      ),
      this.item('maxi_family_protected', 'Maxi Family protegido', input.maxiFamilyProtected, 'Regla comercial protegida.'),
      this.item(
        'whatsapp_no_paid',
        'WhatsApp no marca PAID',
        !input.whatsappCanMarkPaid,
        'IA/WhatsApp no tienen permiso para marcar pagos como PAID.',
      ),
      this.item('checkout_cash_stock_regression', 'Caja/Stock/Checkout regression', input.checkoutRegressionKnownPass, 'Gate de regresión documentado por fases previas.'),
    ];
  }

  summarize(checklist: SofiaReadinessItem[]): SofiaEnterpriseStatusResponse['productionReadiness'] {
    const blockers = checklist.filter((item) => item.status === 'BLOCKED').map((item) => item.key);
    const warnings = checklist.filter((item) => item.status === 'WARNING').map((item) => item.key);
    return {
      status: blockers.length > 0 ? 'BLOCKED' : warnings.length > 0 ? 'WARNING' : 'PASS',
      blockers,
      warnings,
      nextRequiredAction:
        blockers.length > 0
          ? 'Completar rotación externa y fases QR/DeepSeek/auto_safe real antes de producción.'
          : 'Mantener monitoreo y ejecutar piloto controlado.',
      checklist,
    };
  }

  private item(
    key: string,
    label: string,
    ok: boolean,
    reason: string,
    forcedStatus?: SofiaGovernanceCheckStatus,
  ): SofiaReadinessItem {
    return {
      key,
      label,
      status: forcedStatus ?? (ok ? 'PASS' : 'BLOCKED'),
      reason,
      evidence: ok ? 'Sistema auditado' : 'Bloqueo esperado en F3',
    };
  }
}
