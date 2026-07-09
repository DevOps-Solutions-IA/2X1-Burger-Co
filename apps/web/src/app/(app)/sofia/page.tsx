'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Ban,
  Brain,
  CheckCircle2,
  Database,
  MessageCircle,
  Radio,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import {
  SofiaCommandCard,
  SofiaModeBadge,
  SofiaOperatorActionCard,
  SofiaPageHero,
  SofiaStatusCard,
  SofiaStatusPill,
  SofiaTechnicalDetailsAccordion,
} from '@/components/sofia';

type CountGroup = {
  totalDecisions: number;
  approvedCount: number;
  humanRequiredCount: number;
  blockedCount: number;
  draftCount: number;
  paymentSensitiveCount: number;
  unknownProductCount: number;
  lastDecisionAt: string | null;
};

type DashboardSummary = {
  generatedAt: string;
  dataPolicy: {
    noSecrets: boolean;
    noPii: boolean;
    noQrRaw: boolean;
    realOperationEnabled: boolean;
    realOperationReason: string;
    sandboxSeparated: boolean;
    mainDashboardScope: string;
  };
  general: {
    sofiaMode: string;
    productionEnabled: boolean;
    productionBlocked: boolean;
    receiveOnly: boolean;
    realSendingEnabled: boolean;
    autoReplyEnabled: boolean;
    autoSafeEnabled: boolean;
  };
  whatsappQr: {
    provider: string;
    mode: string;
    status: string;
    connected: boolean;
    adapterReal: boolean;
    qrAvailable: boolean;
    realSendingEnabled: false;
    inboundToday: number;
    lastInboundAt: string | null;
    validationInboundToday: number;
    source: 'real_operation' | 'internal_validation';
  };
  ai: {
    aiProvider: string;
    aiMode: string;
    deepSeekEnabled: boolean;
    dryRunEnabled: boolean;
    fallbackProvider: string;
    lastAiCheckAt: string | null;
    source: string;
  };
  safetyGuard: {
    real: CountGroup;
    sandbox: CountGroup;
    historical: CountGroup;
  };
  conversations: {
    totalConversations: number;
    realConversations: number;
    sandboxConversations: number;
    internalValidationConversations: number;
    humanRequired: number;
    paymentSensitive: number;
    unknownProduct: number;
    pendingReview: number;
  };
  internalValidation: {
    inboundToday: number;
    simulatedInboundToday: number;
    qrGatewayValidationInboundToday: number;
    autoSafeDecisionsToday: number;
    paidClaimsBlockedToday: number;
  };
  security: {
    secretRotationStatus: string;
    securityCleanupStatus: string;
    allowlistFinalStatus: string;
    productionReadinessStatus: string;
    blockedChecks: string[];
    passedChecks: string[];
    pendingChecks: string[];
  };
  routes: {
    sandboxUrl: string;
    conversationsUrl: string;
    whatsappQrUrl?: string;
    deliveriesUrl: string;
    posUrl: string;
  };
};

function formatDate(value: string | null) {
  if (!value) return 'No disponible';
  return new Date(value).toLocaleString('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function boolText(value: boolean) {
  return value ? 'Sí' : 'No';
}

function blockedLabel(value: boolean) {
  return value ? 'Bloqueada' : 'No bloqueada';
}

export default function SofiaMainDashboardPage() {
  const summary = useQuery({
    queryKey: ['sofia-main-dashboard-real-summary'],
    queryFn: () => apiFetch<DashboardSummary>('/admin/sofia/dashboard/summary'),
    refetchInterval: 30_000,
  });

  const data = summary.data;

  if (summary.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center" data-testid="sofia-admin-page">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-purple-200 border-t-purple-600" />
          <p className="mt-4 text-sm font-bold text-stone-500">
            Cargando datos reales del backend...
          </p>
        </div>
      </div>
    );
  }

  if (summary.isError || !data) {
    return (
      <div
        className="flex min-h-[50vh] flex-col items-center justify-center rounded-[2rem] border border-red-200 bg-red-50 p-10 text-center"
        data-testid="sofia-admin-page"
      >
        <AlertTriangle className="h-10 w-10 text-red-500" />
        <p className="mt-4 text-base font-extrabold text-red-800">
          No se pudo cargar el resumen real de Sofia
        </p>
        <p className="mt-2 max-w-md text-sm font-medium text-red-600">
          POS, Domicilios, Caja, Stock y Checkout no se ven afectados.
        </p>
      </div>
    );
  }

  const deepSeekLabel = data.ai.dryRunEnabled
    ? 'DeepSeek dry-run'
    : data.ai.deepSeekEnabled
      ? 'DeepSeek habilitado sin dry-run'
      : 'IA no disponible';
  const qrStatusLabel = data.whatsappQr.connected
    ? 'Conectado'
    : data.whatsappQr.qrAvailable
      ? 'QR listo'
      : data.whatsappQr.status || 'No disponible';

  return (
    <div className="space-y-6" data-testid="sofia-admin-page">
      <SofiaPageHero
        eyebrow="Centro de Gobierno Sofia"
        title="Consola supervisada"
        description="Consola supervisada para conversaciones, IA y seguridad operativa. Sofia analiza mensajes, genera sugerencias y protege la operación. Los pedidos reales siguen en POS y Domicilios."
        statusChips={
          <>
            <SofiaStatusPill
              status={data.general.sofiaMode === 'paused' ? 'BLOCKED' : 'INFO'}
              label={data.general.sofiaMode === 'paused' ? 'Sofía pausada' : 'Modo supervisado'}
            />
            <SofiaStatusPill
              status={data.general.receiveOnly ? 'RECEIVE_ONLY' : 'WARNING'}
              label={data.general.receiveOnly ? 'Receive-only' : 'Receive-only no confirmado'}
            />
            <SofiaStatusPill status={data.ai.dryRunEnabled ? 'DRY_RUN' : 'WARNING'} label={deepSeekLabel} />
            <SofiaStatusPill
              status={data.general.realSendingEnabled ? 'WARNING' : 'BLOCKED'}
              label={data.general.realSendingEnabled ? 'Envío real activo' : 'Envío real bloqueado'}
            />
            <SofiaStatusPill
              status={data.general.productionBlocked ? 'BLOCKED' : 'WARNING'}
              label={data.general.productionBlocked ? 'Producción bloqueada' : 'Producción no bloqueada'}
            />
          </>
        }
        actions={
          <>
            <Link
              href={data.routes.whatsappQrUrl ?? '/sofia/whatsapp-qr'}
              className="inline-flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2 text-xs font-extrabold text-white backdrop-blur-sm transition-colors hover:bg-white/25"
            >
              <Radio className="h-3.5 w-3.5" />
              Ver QR
            </Link>
            <Link
              href={data.routes.conversationsUrl}
              className="inline-flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2 text-xs font-extrabold text-white backdrop-blur-sm transition-colors hover:bg-white/25"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Conversations
            </Link>
            <Link
              href={data.routes.sandboxUrl}
              className="inline-flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2 text-xs font-extrabold text-white backdrop-blur-sm transition-colors hover:bg-white/25"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Sandbox
            </Link>
          </>
        }
        data-testid="sofia-main-real-data-hero"
      />

      <section
        className="rounded-[1.75rem] border border-red-200 bg-red-50/80 p-5"
        data-testid="sofia-main-production-blocked"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-100 text-red-600">
            <AlertTriangle className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-extrabold text-red-800">Producción bloqueada</p>
            <p className="mt-1 max-w-3xl text-xs font-semibold leading-5 text-red-700">
              Sofia está en modo seguro. Faltan validaciones finales antes de operar con clientes reales.
              La vista principal no suma sandbox, mocks ni validaciones internas como operación real.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <SofiaModeBadge label={`Allowlist: ${data.security.allowlistFinalStatus}`} tone="pending" />
              <SofiaModeBadge label={`Security cleanup: ${data.security.securityCleanupStatus}`} tone="pending" />
              <SofiaModeBadge label={`Scope: ${data.dataPolicy.mainDashboardScope}`} tone="info" />
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" data-testid="sofia-main-primary-real-cards">
        <SofiaStatusCard
          title="WhatsApp QR"
          value={qrStatusLabel}
          description="Estado real desde backend. Canal físico receive-only; no responde al cliente."
          detail={`Provider: ${data.whatsappQr.provider} · Adapter real: ${boolText(data.whatsappQr.adapterReal)}`}
          icon={Radio}
          tone={data.whatsappQr.connected ? 'safe' : data.whatsappQr.qrAvailable ? 'pending' : 'off'}
        />
        <SofiaStatusCard
          title="IA"
          value={deepSeekLabel}
          description="Genera sugerencias internas. No responde al cliente."
          detail={`Provider: ${data.ai.aiProvider} · Fallback: ${data.ai.fallbackProvider}`}
          icon={Brain}
          tone={data.ai.dryRunEnabled ? 'dryRun' : 'pending'}
        />
        <SofiaStatusCard
          title="Envío real"
          value={data.general.realSendingEnabled ? 'Activo' : 'Bloqueado'}
          description="El envío por WhatsApp está desactivado."
          detail={`SENT real hoy: ${data.whatsappQr.realSendingEnabled ? 'riesgo' : '0 esperado'}`}
          icon={Ban}
          tone="blocked"
        />
        <SofiaStatusCard
          title="Producción"
          value={blockedLabel(data.general.productionBlocked)}
          description="Faltan validaciones finales antes de preproducción formal."
          detail={`Readiness: ${data.security.productionReadinessStatus}`}
          icon={ShieldCheck}
          tone={data.general.productionBlocked ? 'blocked' : 'pending'}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_0.9fr]" data-testid="sofia-main-real-vs-validation">
        <div className="rounded-[1.75rem] border border-stone-200 bg-white p-5 shadow-sm md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-emerald-600">
                Operación real
              </p>
              <h2 className="mt-2 text-xl font-black text-stone-950">
                Datos reales visibles en esta consola
              </h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-stone-600">
                La operación real comercial sigue bloqueada hasta cerrar allowlist final.
                Por eso los conteos reales se muestran en cero si no hay fuente aprobada.
              </p>
            </div>
            <SofiaStatusPill
              status={data.dataPolicy.realOperationEnabled ? 'PASS' : 'WARNING'}
              label={data.dataPolicy.realOperationEnabled ? 'Real habilitado' : 'Pendiente'}
            />
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl bg-emerald-50 p-4">
              <p className="text-2xl font-black text-emerald-800">{data.conversations.realConversations}</p>
              <p className="mt-1 text-[11px] font-bold text-emerald-700">Conversaciones reales</p>
            </div>
            <div className="rounded-2xl bg-sky-50 p-4">
              <p className="text-2xl font-black text-sky-800">{data.whatsappQr.inboundToday}</p>
              <p className="mt-1 text-[11px] font-bold text-sky-700">Inbound real hoy</p>
            </div>
            <div className="rounded-2xl bg-amber-50 p-4">
              <p className="text-2xl font-black text-amber-800">{data.conversations.humanRequired}</p>
              <p className="mt-1 text-[11px] font-bold text-amber-700">Requieren humano</p>
            </div>
            <div className="rounded-2xl bg-red-50 p-4">
              <p className="text-2xl font-black text-red-800">{data.safetyGuard.real.blockedCount}</p>
              <p className="mt-1 text-[11px] font-bold text-red-700">Safety blocks reales</p>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-stone-200 bg-stone-50 p-4 text-xs font-semibold leading-5 text-stone-600">
            Último inbound QR registrado: {formatDate(data.whatsappQr.lastInboundAt)}. Fuente actual:
            {' '}
            <strong>{data.whatsappQr.source === 'real_operation' ? 'operación real' : 'validación interna'}</strong>.
          </div>
        </div>

        <div className="rounded-[1.75rem] border border-amber-200 bg-amber-50/80 p-5 shadow-sm md:p-6">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-amber-700">
            Validación interna
          </p>
          <h2 className="mt-2 text-xl font-black text-amber-950">
            Datos de pruebas separados
          </h2>
          <p className="mt-2 text-sm font-semibold leading-6 text-amber-800">
            Estos datos pueden venir de sandbox, QR test-inbound o validaciones previas. No se suman como operación real.
          </p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white/70 p-4">
              <p className="text-xl font-black text-amber-900">{data.internalValidation.qrGatewayValidationInboundToday}</p>
              <p className="mt-1 text-[11px] font-bold text-amber-700">Inbound QR validación</p>
            </div>
            <div className="rounded-2xl bg-white/70 p-4">
              <p className="text-xl font-black text-amber-900">{data.conversations.sandboxConversations}</p>
              <p className="mt-1 text-[11px] font-bold text-amber-700">Conversaciones sandbox</p>
            </div>
            <div className="rounded-2xl bg-white/70 p-4">
              <p className="text-xl font-black text-amber-900">{data.safetyGuard.sandbox.totalDecisions}</p>
              <p className="mt-1 text-[11px] font-bold text-amber-700">Safety sandbox hoy</p>
            </div>
            <div className="rounded-2xl bg-white/70 p-4">
              <p className="text-xl font-black text-amber-900">{data.internalValidation.simulatedInboundToday}</p>
              <p className="mt-1 text-[11px] font-bold text-amber-700">Simulados hoy</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3" data-testid="sofia-main-operational-state">
        <div className="rounded-[1.75rem] border border-stone-200 bg-white p-5 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-stone-400">
            Estado general
          </p>
          <div className="mt-4 space-y-3 text-sm font-semibold text-stone-700">
            <Row label="Modo Sofia" value={data.general.sofiaMode} />
            <Row label="Receive-only" value={boolText(data.general.receiveOnly)} />
            <Row label="Auto reply" value={data.general.autoReplyEnabled ? 'Activo' : 'OFF'} />
            <Row label="Auto Safe productivo" value={data.general.autoSafeEnabled ? 'Activo' : 'OFF'} />
          </div>
        </div>

        <div className="rounded-[1.75rem] border border-stone-200 bg-white p-5 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-stone-400">
            SafetyGuard
          </p>
          <div className="mt-4 space-y-3 text-sm font-semibold text-stone-700">
            <Row label="Decisiones reales" value={String(data.safetyGuard.real.totalDecisions)} />
            <Row label="Pago sensible real" value={String(data.safetyGuard.real.paymentSensitiveCount)} />
            <Row label="Producto no reconocido real" value={String(data.safetyGuard.real.unknownProductCount)} />
            <Row label="Última decisión real" value={formatDate(data.safetyGuard.real.lastDecisionAt)} />
          </div>
        </div>

        <div className="rounded-[1.75rem] border border-stone-200 bg-white p-5 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-stone-400">
            Seguridad / readiness
          </p>
          <div className="mt-4 space-y-3 text-sm font-semibold text-stone-700">
            <Row label="Rotación secretos" value={data.security.secretRotationStatus} />
            <Row label="Cleanup seguridad" value={data.security.securityCleanupStatus} />
            <Row label="Allowlist final" value={data.security.allowlistFinalStatus} />
            <Row label="Readiness" value={data.security.productionReadinessStatus} />
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1fr]" data-testid="sofia-main-pending-and-actions">
        <div className="rounded-[1.75rem] border border-stone-200 bg-white p-5 shadow-sm md:p-6">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-red-600">
            Pendientes y bloqueos
          </p>
          <div className="mt-4 grid gap-3">
            {[...data.security.blockedChecks, ...data.security.pendingChecks].slice(0, 10).map((item) => (
              <div key={item} className="rounded-2xl border border-stone-100 bg-stone-50 p-3 text-sm font-semibold text-stone-700">
                {item}
              </div>
            ))}
            {data.security.blockedChecks.length === 0 && data.security.pendingChecks.length === 0 ? (
              <div className="rounded-2xl border border-stone-100 bg-stone-50 p-3 text-sm font-semibold text-stone-500">
                Sin pendientes reportados por backend.
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3">
          <SofiaOperatorActionCard
            title="Acciones permitidas"
            description="Revisar sugerencias, monitorear SafetyGuard, validar inbound y documentar pendientes."
            icon={CheckCircle2}
            tone="safe"
          />
          <SofiaOperatorActionCard
            title="Acciones bloqueadas"
            description="Enviar WhatsApp real, activar auto reply, marcar PAID o mover pedidos desde Sofia."
            icon={Ban}
            tone="blocked"
          />
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="sofia-main-navigation">
        <SofiaCommandCard
          href={data.routes.whatsappQrUrl ?? '/sofia/whatsapp-qr'}
          label="WhatsApp QR"
          description="Estado Baileys receive-only"
          icon={Radio}
        />
        <SofiaCommandCard
          href={data.routes.conversationsUrl}
          label="Conversations"
          description="Inbox supervisado"
          icon={MessageCircle}
        />
        <SofiaCommandCard
          href={data.routes.sandboxUrl}
          label="Sandbox"
          description="Laboratorio separado"
          icon={Sparkles}
        />
        <SofiaCommandCard
          href={data.routes.posUrl}
          label="POS"
          description="Operación real separada"
          icon={Database}
        />
      </section>

      <SofiaTechnicalDetailsAccordion
        title="Detalle técnico"
        description="Fuente backend, politicas de datos y checks sin PII."
        data-testid="sofia-main-technical-details"
      >
        <div className="grid gap-3 text-xs font-semibold text-stone-600 md:grid-cols-2">
          <Row label="Endpoint principal" value="/admin/sofia/dashboard/summary" />
          <Row label="Generado" value={formatDate(data.generatedAt)} />
          <Row label="Sin secretos" value={boolText(data.dataPolicy.noSecrets)} />
          <Row label="Sin PII" value={boolText(data.dataPolicy.noPii)} />
          <Row label="Sin QR raw" value={boolText(data.dataPolicy.noQrRaw)} />
          <Row label="Sandbox separado" value={boolText(data.dataPolicy.sandboxSeparated)} />
          <Row label="QR status raw" value={data.whatsappQr.status} />
          <Row label="QR available" value={boolText(data.whatsappQr.qrAvailable)} />
          <Row label="Last AI check" value={formatDate(data.ai.lastAiCheckAt)} />
          <Row label="Real operation reason" value={data.dataPolicy.realOperationReason} />
        </div>
      </SofiaTechnicalDetailsAccordion>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-stone-50 px-3 py-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
      <span className="text-stone-500">{label}</span>
      <span className="break-words font-extrabold text-stone-900 sm:max-w-[60%] sm:text-right">
        {value || 'No disponible'}
      </span>
    </div>
  );
}
