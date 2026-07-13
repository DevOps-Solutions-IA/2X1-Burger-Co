'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Eye,
  EyeOff,
  LogOut,
  MessageCircle,
  Plug,
  Power,
  QrCode,
  RefreshCw,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  SofiaPageHero,
  SofiaPageShell,
  SofiaStatusPill,
  SofiaSectionCard,
  SofiaSectionHeader,
  SofiaStatusCard,
  SofiaModeBadge,
  SofiaRiskBanner,
  SofiaTechnicalDetailsAccordion,
  SofiaLiveStatusDot,
  humanizeEventStatus,
} from '@/components/sofia';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type QrStatus = {
  provider: 'qr_gateway';
  mode: 'disabled' | 'receive_only' | 'supervised' | 'auto_safe';
  status: string;
  ok: boolean;
  connected: boolean;
  adapterReal: boolean;
  phoneNumber: string | null;
  deviceName: string | null;
  qrAvailable: boolean;
  qrImageDataUrl: string | null;
  qrString: string | null;
  qrIssuedAt: string | null;
  qrExpiresAt: string | null;
  lastQrAt: string | null;
  sessionName: string;
  sessionPathSanitized: string;
  inboundToday: number;
  outboundToday: number;
  pendingOutbound: number;
  realSendingEnabled: false;
  autoReplyEnabled: false;
  deepSeekEnabled: false;
  productionBlocked: boolean;
  blockers: string[];
  warnings: string[];
  reason: string | null;
  operatorMessage: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastConnectionUpdateAt: string | null;
  updatedAt: string;
};

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function SofiaWhatsappQrPage() {
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState('573001112233');
  const [text, setText] = useState('quiero un maxi family');
  const [lastInbound, setLastInbound] = useState<Record<string, unknown> | null>(null);
  const [lastSend, setLastSend] = useState<Record<string, unknown> | null>(null);
  const [qrRevealed, setQrRevealed] = useState(false);

  const status = useQuery({
    queryKey: ['sofia-whatsapp-qr-status'],
    queryFn: () => apiFetch<QrStatus>('/admin/sofia/whatsapp/qr/status'),
    refetchInterval: 15_000,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['sofia-whatsapp-qr-status'] });

  const connect = useMutation({
    mutationFn: () => apiFetch<QrStatus>('/admin/sofia/whatsapp/qr/connect', { method: 'POST' }),
    onSuccess: async (result) => {
      if (result.status === 'CONNECTED' && result.adapterReal && result.connected) {
        toast.success('WhatsApp Business conectado');
      } else if (result.status === 'QR_READY' && result.adapterReal && result.qrAvailable) {
        toast.success('QR real de WhatsApp listo para escanear');
      } else if (result.status === 'WAITING_QR' || result.status === 'CONNECTING') {
        toast.info(result.operatorMessage || 'Esperando QR real de WhatsApp');
      } else {
        toast.warning(result.operatorMessage || 'No se generó QR real: adapter no disponible');
      }
      await invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No se pudo preparar QR'),
  });

  const disconnect = useMutation({
    mutationFn: () =>
      apiFetch<QrStatus>('/admin/sofia/whatsapp/qr/disconnect', { method: 'POST' }),
    onSuccess: async () => {
      toast.success('Sesión QR desconectada');
      setQrRevealed(false);
      await invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No se pudo desconectar QR'),
  });

  const logout = useMutation({
    mutationFn: () => apiFetch<QrStatus>('/admin/sofia/whatsapp/qr/logout', { method: 'POST' }),
    onSuccess: async () => {
      toast.success('Sesión QR cerrada');
      setQrRevealed(false);
      await invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No se pudo cerrar sesión QR'),
  });

  const testInbound = useMutation({
    mutationFn: () =>
      apiFetch<Record<string, unknown>>('/admin/sofia/whatsapp/qr/test-inbound', {
        method: 'POST',
        body: JSON.stringify({
          phone,
          text,
          externalMessageId: `qr-e2e-${Date.now()}`,
          messageType: 'TEXT',
        }),
      }),
    onSuccess: async (result) => {
      setLastInbound(result);
      toast.success('Inbound QR receive-only registrado');
      await invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No se pudo registrar inbound QR'),
  });

  const testSend = useMutation({
    mutationFn: () =>
      apiFetch<Record<string, unknown>>('/admin/sofia/whatsapp/qr/test-send', {
        method: 'POST',
        body: JSON.stringify({
          to: phone,
          body: 'Mensaje de prueba bloqueado F4',
        }),
      }),
    onSuccess: (result) => {
      setLastSend(result);
      toast.success('Envío real bloqueado correctamente');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No se pudo probar bloqueo de envío'),
  });

  const data = connect.data ?? disconnect.data ?? logout.data ?? status.data;
  const hasRealQr = Boolean(
    data?.adapterReal &&
      data.qrAvailable &&
      data.status === 'QR_READY' &&
      data.qrImageDataUrl,
  );
  const statusOperatorMessage =
    data?.operatorMessage ??
    'Adapter real no disponible. No se generó QR de WhatsApp.';
  const qrPanelTitle = hasRealQr ? 'QR real de WhatsApp' : 'Sin QR activo';

  return (
    <SofiaPageShell data-testid="sofia-whatsapp-qr-page">
      {/* ---- Back link ---- */}
      <Link
        href="/sofia"
        className="inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.14em] text-sofia-500 transition-colors hover:text-sofia-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Centro de Gobierno Sofía
      </Link>

      {/* ---- Hero ---- */}
      <SofiaPageHero
        eyebrow="Sofía"
        title="WhatsApp QR Gateway"
        description="Canal receive-only para vinculación y recepción controlada. El envío real permanece bloqueado."
        statusChips={
          <>
            <SofiaStatusPill
              status={data?.adapterReal ? 'CONNECTED' : 'WARNING'}
              label={data?.adapterReal ? 'Adapter Baileys' : 'Adapter pendiente'}
            />
            <SofiaStatusPill status="RECEIVE_ONLY" label="Receive-only" />
            <SofiaStatusPill status="BLOCKED" label="Envío real OFF" />
          </>
        }
        data-testid="sofia-qr-hero"
      />

      {/* ---- Receive-only warning ---- */}
      <SofiaRiskBanner
        tone="warning"
        icon={AlertTriangle}
        title="Solo receive-only. Envío real bloqueado."
        description="Auto reply y auto_safe con clientes permanecen apagados. DeepSeek solo opera en dry-run."
        data-testid="sofia-qr-receive-only-warning"
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" data-testid="sofia-qr-operator-summary">
        <SofiaStatusCard
          title="Estado"
          value={humanizeEventStatus(data?.status ?? 'DISCONNECTED')}
          description={
            data?.connected
              ? 'WhatsApp Business conectado.'
              : hasRealQr
                ? 'QR real listo para escanear.'
                : 'No hay QR escaneable activo.'
          }
          icon={QrCode}
          tone={data?.connected ? 'safe' : hasRealQr ? 'pending' : 'off'}
        />
        <SofiaStatusCard
          title="Adapter"
          value={data?.adapterReal ? 'Baileys real' : 'No disponible'}
          description="QR_READY solo es válido si viene de Baileys y qrAvailable=true."
          icon={Plug}
          tone={data?.adapterReal ? 'safe' : 'pending'}
        />
        <SofiaStatusCard
          title="Envío real"
          value="Bloqueado"
          description="Ningún flujo QR llama send real con el gate apagado."
          icon={Send}
          tone="blocked"
        />
        <SofiaStatusCard
          title="Modo consola"
          value="Supervisado"
          description="DeepSeek dry-run y SafetyGuard se revisan en Conversations/Sandbox."
          icon={ShieldCheck}
          tone="dryRun"
        />
      </section>

      {/* ---- Status + QR ---- */}
      <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        {/* Status card */}
        <div
          className="rounded-2xl border border-stone-200/80 bg-white p-5 shadow-sm md:p-6"
          data-testid="sofia-qr-status-card"
        >
          <SofiaSectionHeader
            eyebrow="Estado QR"
            title={humanizeEventStatus(data?.status ?? 'DISCONNECTED')}
            icon={<ShieldCheck className="h-4 w-4" />}
            actions={
              <SofiaLiveStatusDot
                tone={data?.connected ? 'safe' : hasRealQr ? 'pending' : 'off'}
                pulse={Boolean(data?.connected || hasRealQr)}
              />
            }
          />

          <div className="mt-5 space-y-2">
            <div className="flex items-center justify-between rounded-lg py-1.5">
              <span className="text-xs font-bold text-stone-500">Provider</span>
              <span className="text-xs font-extrabold text-stone-800">
                {data?.provider ?? 'qr_gateway'}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg py-1.5">
              <span className="text-xs font-bold text-stone-500">Status</span>
              <SofiaStatusPill
                status={
                  data?.status === 'CONNECTED'
                    ? 'CONNECTED'
                    : data?.status === 'QR_READY'
                      ? 'QR_READY'
                      : 'DISCONNECTED'
                }
                label={humanizeEventStatus(data?.status ?? 'DISCONNECTED')}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg py-1.5">
              <span className="text-xs font-bold text-stone-500">Adapter real</span>
              <SofiaStatusPill
                status={data?.adapterReal ? 'PASS' : 'WARNING'}
                label={data?.adapterReal ? 'Baileys activo' : 'No disponible'}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg py-1.5">
              <span className="text-xs font-bold text-stone-500">Connected</span>
              <SofiaStatusPill
                status={data?.connected ? 'CONNECTED' : 'DISCONNECTED'}
                label={data?.connected ? 'Sí' : 'No'}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg py-1.5">
              <span className="text-xs font-bold text-stone-500">Sesión</span>
              <span className="text-xs font-extrabold text-stone-800">
                {data?.sessionName ?? 'sofia-main'}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg py-1.5">
              <span className="text-xs font-bold text-stone-500">Inbound hoy</span>
              <span className="text-xs font-extrabold text-stone-800">
                {data?.inboundToday ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg py-1.5">
              <span className="text-xs font-bold text-stone-500">Pending outbound</span>
              <span className="text-xs font-extrabold text-stone-800">
                {data?.pendingOutbound ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg py-1.5">
              <span className="text-xs font-bold text-stone-500">DeepSeek</span>
              <SofiaModeBadge label="dry-run fuera del QR" tone="dryRun" />
            </div>
            <SofiaTechnicalDetailsAccordion
              title="Estado técnico QR"
              description="Reason codes, session name y ultimo update sin exponer QR raw."
              data-testid="sofia-qr-technical-details"
            >
              <div className="space-y-2 text-xs font-semibold text-stone-600">
                <p>Mensaje operador: {statusOperatorMessage}</p>
                <p>Reason: {data?.reason ?? 'sin reason activo'}</p>
                <p>Session: {data?.sessionName ?? 'sofia-main'}</p>
                <p>Last update: {data?.lastConnectionUpdateAt ?? data?.updatedAt ?? 'sin update'}</p>
                <p>QR raw: oculto por seguridad</p>
              </div>
            </SofiaTechnicalDetailsAccordion>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              size="sm"
              className="bg-stone-900 text-white hover:bg-stone-800"
              onClick={() => connect.mutate()}
              disabled={connect.isPending}
              data-testid="sofia-qr-connect"
            >
              <Plug className="mr-2 h-4 w-4" />
              Solicitar QR real
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => disconnect.mutate()}
              disabled={disconnect.isPending}
              data-testid="sofia-qr-disconnect"
            >
              <Power className="mr-2 h-4 w-4" />
              Desconectar
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="bg-red-50 text-red-700 ring-red-200 hover:bg-red-100"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              data-testid="sofia-qr-logout"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </Button>
          </div>
        </div>

        {/* QR Code card — premium glass treatment */}
        <div
          className="relative overflow-hidden rounded-2xl border border-sofia-200/40 bg-white p-5 shadow-sm md:p-6"
          data-testid="sofia-qr-code-card"
        >
          {/* Subtle purple glow behind QR when real */}
          {hasRealQr && (
            <div className="pointer-events-none absolute -inset-10 opacity-10 blur-3xl" style={{ background: 'radial-gradient(circle, #8B5CF6 0%, transparent 70%)' }} />
          )}
          <div className="relative">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-sofia-500">
              {qrPanelTitle}
            </p>

          {hasRealQr ? (
            <div>
              <div className="relative mt-5 inline-block rounded-3xl bg-gradient-to-br from-white to-sofia-50/30 p-4 shadow-lg ring-1 ring-sofia-100/50">
                {qrRevealed ? (
                  <img
                    src={data?.qrImageDataUrl ?? ''}
                    alt="QR real de WhatsApp — escanea con WhatsApp Business"
                    className="h-52 w-52 rounded-2xl"
                    data-testid="sofia-qr-image"
                  />
                ) : (
                  <div
                    className="flex h-52 w-52 flex-col items-center justify-center gap-3 rounded-2xl bg-stone-100 text-center"
                    data-testid="sofia-qr-image-hidden"
                  >
                    <QrCode className="h-9 w-9 text-stone-400" />
                    <p className="max-w-[9rem] text-[11px] font-bold text-stone-500">
                      QR listo, oculto por seguridad
                    </p>
                  </div>
                )}
              </div>
              <div className="mt-3">
                <Button
                  variant="secondary"
                  size="sm"
                  className="bg-sofia-50 text-sofia-800 ring-sofia-200 hover:bg-sofia-100"
                  onClick={() => setQrRevealed((value) => !value)}
                  data-testid="sofia-qr-reveal-toggle"
                >
                  {qrRevealed ? (
                    <>
                      <EyeOff className="mr-2 h-4 w-4" /> Ocultar QR
                    </>
                  ) : (
                    <>
                      <Eye className="mr-2 h-4 w-4" /> Revelar QR para escanear
                    </>
                  )}
                </Button>
              </div>
              {qrRevealed && (
                <p className="mt-3 text-[11px] font-bold text-red-700">
                  Quien vea esta pantalla puede vincular WhatsApp Business. Ocúltalo después de escanear.
                </p>
              )}
              <p className="mt-4 text-sm font-extrabold text-emerald-700">
                Escaneable por WhatsApp Business
              </p>
              {data?.qrExpiresAt && (
                <p className="mt-1 text-xs font-medium text-stone-500">
                  Expira: {new Date(data.qrExpiresAt).toLocaleTimeString('es-CO')}
                </p>
              )}
            </div>
          ) : (
            <div
              className="mt-5 flex h-56 w-56 items-center justify-center rounded-3xl border border-dashed border-sofia-200 bg-sofia-50/30 text-center"
              data-testid="sofia-qr-placeholder"
            >
              <div>
                <QrCode className="mx-auto h-10 w-10 text-sofia-300" />
                <p className="mt-3 text-sm font-extrabold text-stone-600">
                  Sin QR activo
                </p>
                <p className="mt-1 text-xs font-medium text-stone-500">
                  {data?.adapterReal
                    ? 'Esperando QR real emitido por WhatsApp.'
                    : 'Adapter real no disponible. No hay QR escaneable.'}
                </p>
              </div>
            </div>
          )}

          <p
            className="mt-4 rounded-xl bg-stone-50 px-4 py-3 text-[11px] font-medium text-stone-500"
            data-testid="sofia-qr-string"
          >
            {hasRealQr
              ? 'QR raw oculto por seguridad. Usa la imagen escaneable de WhatsApp Business.'
              : statusOperatorMessage}
          </p>
          </div>
        </div>
      </section>

      {/* ---- Guía paso a paso ---- */}
      <SofiaSectionCard
        eyebrow="Guía de conexión"
        title="Escaneo físico en 6 pasos"
        description="Pensado para operador: corto, verificable y sin activar producción."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { step: '1', title: 'Generar QR', desc: 'Prepara el código QR desde el panel.' },
            { step: '2', title: 'Escanear con WhatsApp', desc: 'Usa WhatsApp Business para vincular el dispositivo.' },
            { step: '3', title: 'Validar CONNECTED', desc: 'Confirma que el estado cambie a CONNECTED.' },
            { step: '4', title: 'Enviar desde allowlist', desc: 'Un número autorizado envía un mensaje de prueba.' },
            { step: '5', title: 'Confirmar inbound', desc: 'Verifica que el mensaje aparezca en Conversations.' },
            { step: '6', title: 'Mantener sin envío real', desc: 'El envío permanece bloqueado por diseño.' },
          ].map((item) => (
            <div
              key={item.step}
              className="flex gap-3 rounded-xl border border-sofia-100 bg-sofia-50/30 p-4"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sofia-600 text-xs font-extrabold text-white">
                {item.step}
              </span>
              <div>
                <p className="text-sm font-extrabold text-stone-900">{item.title}</p>
                <p className="mt-0.5 text-xs font-medium text-stone-500">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </SofiaSectionCard>

      {/* ---- Test inbound / Test send ---- */}
      <section className="grid gap-6 lg:grid-cols-2">
        {/* Test inbound */}
        <SofiaSectionCard data-testid="sofia-qr-test-inbound">
          <SofiaSectionHeader
            eyebrow="Prueba de recepción"
            title="Registrar mensaje entrante"
            icon={<MessageCircle className="h-4 w-4" />}
          />

          <div className="mt-5 space-y-3">
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className="w-full rounded-xl border border-stone-200 px-4 py-3 text-sm font-semibold focus:border-sofia-300 focus:outline-none focus:ring-2 focus:ring-sofia-100"
              data-testid="sofia-qr-test-phone"
            />
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="min-h-28 w-full rounded-xl border border-stone-200 px-4 py-3 text-sm font-semibold focus:border-sofia-300 focus:outline-none focus:ring-2 focus:ring-sofia-100"
              data-testid="sofia-qr-test-text"
            />
            <Button
              size="sm"
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => testInbound.mutate()}
              disabled={testInbound.isPending}
              data-testid="sofia-qr-test-inbound-submit"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Registrar inbound
            </Button>
          </div>
          <p className="mt-3 text-[11px] font-semibold text-stone-500">
            Esta prueba escribe en el mismo inbox de Conversations. Úsala solo con datos de ejemplo.
          </p>
          {lastInbound && (
            <SofiaTechnicalDetailsAccordion
              title="Resultado técnico del inbound"
              description="Respuesta cruda del backend para esta prueba."
              data-testid="sofia-qr-last-inbound-details"
            >
              <pre
                className="max-h-64 overflow-auto rounded-2xl bg-stone-950 p-4 text-[11px] font-semibold text-stone-100"
                data-testid="sofia-qr-last-inbound"
              >
                {JSON.stringify(lastInbound, null, 2)}
              </pre>
            </SofiaTechnicalDetailsAccordion>
          )}
        </SofiaSectionCard>

        {/* Test send (blocked) */}
        <SofiaSectionCard data-testid="sofia-qr-test-send">
          <SofiaSectionHeader
            eyebrow="Verificación de seguridad"
            title="Confirmar bloqueo de envío"
            icon={<Send className="h-4 w-4" />}
            description="El envío real está bloqueado por diseño. Esta verificación confirma que el bloqueo funciona."
          />

          <Button
            size="sm"
            className="mt-5 bg-red-600 text-white hover:bg-red-700"
            onClick={() => testSend.mutate()}
            disabled={testSend.isPending}
            data-testid="sofia-qr-test-send-submit"
          >
            Probar bloqueo de envío
          </Button>

          {lastSend && (
            <SofiaTechnicalDetailsAccordion
              title="Resultado técnico del bloqueo"
              description="Respuesta cruda del backend para esta verificación."
              data-testid="sofia-qr-last-send-details"
            >
              <pre
                className="max-h-64 overflow-auto rounded-2xl bg-stone-950 p-4 text-[11px] font-semibold text-stone-100"
                data-testid="sofia-qr-last-send"
              >
                {JSON.stringify(lastSend, null, 2)}
              </pre>
            </SofiaTechnicalDetailsAccordion>
          )}

          <div className="mt-4 rounded-xl bg-red-50 px-4 py-3">
            <p className="text-xs font-medium text-red-700">
              El envío real está bloqueado por diseño. Esta fase solo recibe y analiza mensajes; el envío se habilitará en una fase piloto controlada posterior.
            </p>
          </div>
        </SofiaSectionCard>
      </section>
    </SofiaPageShell>
  );
}
