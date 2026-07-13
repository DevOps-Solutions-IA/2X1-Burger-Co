'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import {
  ArrowRight,
  Bot,
  Brain,
  ImageIcon,
  MessageCircle,
  Mic2,
  PackageCheck,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api';
import { formatCurrency } from '@/lib/format';
import {
  SofiaPageHero,
  SofiaPageShell,
  SofiaStatusPill,
  SofiaSectionHeader,
  SofiaEmptyState,
  SofiaRiskBanner,
  SofiaSandboxCaseCard,
  humanizeReasonCode,
} from '@/components/sofia';
import type { SofiaPillStatus, SofiaSandboxCaseResult } from '@/components/sofia';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type AgentItem = {
  productId: string;
  code: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  imageUrl?: string | null;
  categoryName?: string | null;
};

type AgentResult = {
  conversationId: string;
  detectedIntent: string;
  confidence: number;
  extractedItems: AgentItem[];
  currentItems: AgentItem[];
  missingFields: string[];
  suggestedUpsell: { productId: string; name: string; price: number | null; message: string } | null;
  mediaSuggestion: {
    type: string;
    productId: string;
    productName: string;
    imageUrl: string | null;
    altText: string;
    offerSlug?: string;
    salesHint?: string;
  } | null;
  featuredOffers?: SofiaFeaturedOffer[];
  commercialCatalog?: SofiaCommercialCatalogItem[];
  matchedCatalogItem?: SofiaCommercialCatalogItem | null;
  matchedFeaturedOffer?: SofiaFeaturedOffer | null;
  promptVersion?: string;
  memory?: {
    customer?: { displayName?: string | null; lastKnownAddress?: string | null; memorySummary?: string | null; lastOrderSummary?: unknown };
    conversation?: { currentIntent?: string | null; lastProductDiscussed?: string | null; memorySummary?: string | null };
    repeatLastOrder?: { canRepeat: boolean; responseText: string } | null;
  };
  autoSafeDecision?: {
    status: 'AUTO_SAFE_APPROVED' | 'HUMAN_REQUIRED' | 'BLOCKED' | 'DRAFT_ONLY';
    approved: boolean;
    shouldSend: boolean;
    reasonCodes: string[];
    blockingReasons: string[];
    warnings: string[];
    finalReply: string | null;
    requiredHumanAction: string | null;
  };
  nextAction: string;
  responseText: string;
  shouldCreateDraft: boolean;
  shouldConfirmOrder: boolean;
  shouldHandoff: boolean;
  paymentLinkUrl: string | null;
  draft?: { id: string; status: string; total: number | string } | null;
  deliveryOrder?: { id: string; orderTicketId?: string | null; status?: string } | null;
  businessStatus: { isOpen: boolean; timezone: string; schedule: string };
  safeguards: Record<string, boolean>;
};

type SofiaFeaturedOffer = {
  id: string;
  slug: string;
  name: string;
  description: string;
  imageUrl: string;
  salesHint: string;
  sortOrder: number;
  isActive: boolean;
  linkedProductName: string | null;
  offerType: string;
};

type SofiaCommercialCatalogItem = {
  slug: string;
  name: string;
  type: string;
  price: number | null;
  priceSource: string;
  imageUrl: string | null;
  shortDescription: string | null;
  composition?: { requiredCopy?: string; items?: string[]; notes?: string[] } | null;
  aliases?: string[];
  upsellRules?: string[];
  prohibitedClaims?: string[];
};

type RecoveryResult = {
  conversationId?: string | null;
  draftId?: string;
  detectedIntent: string;
  currentItems?: AgentItem[];
  nextAction: string;
  responseText: string;
};

/* ------------------------------------------------------------------ */
/*  Fallback data                                                      */
/* ------------------------------------------------------------------ */

const featuredOffersFallback: SofiaFeaturedOffer[] = [
  {
    id: 'sofia-offer-maxi-family',
    slug: 'maxi-family',
    name: 'Maxy Family',
    description: '6 burgers + 1 porción personal de papitas + 1 Pepsi 1.5 L',
    imageUrl: '/uploads/sofia-offers/maxi-family.webp',
    salesHint:
      'Ideal para compartir en familia o grupo. Incluye una porción personal de papitas; si quieren acompañar mejor el combo, se pueden agregar papitas adicionales.',
    sortOrder: 1,
    isActive: true,
    linkedProductName: null,
    offerType: 'FAMILY',
  },
  {
    id: 'sofia-offer-2x1-hamburguesas',
    slug: '2x1-hamburguesas',
    name: '2x1 Hamburguesas',
    description: '2 burgers',
    imageUrl: '/uploads/sofia-offers/2x1-hamburguesas.webp',
    salesHint: 'Ideal para compartir o para dos personas. Se puede completar con papitas y bebida.',
    sortOrder: 2,
    isActive: true,
    linkedProductName: 'Hamburguesa 2x1',
    offerType: 'PROMO',
  },
  {
    id: 'sofia-offer-doble-todo',
    slug: 'doble-todo',
    name: 'Doble Todo',
    description: 'doble carne + doble tocineta + doble queso cheddar en lonjas',
    imageUrl: '/uploads/sofia-offers/doble-todo.webp',
    salesHint: 'Ideal para quien quiere una burger más cargada y completa. Se puede acompañar con papitas o bebida.',
    sortOrder: 3,
    isActive: true,
    linkedProductName: null,
    offerType: 'LOADED',
  },
  {
    id: 'sofia-offer-hamburguesa-sencilla',
    slug: 'hamburguesa-sencilla',
    name: 'Hamburguesa Sencilla',
    description: '1 burger sencilla',
    imageUrl: '/uploads/sofia-offers/hamburguesa-sencilla.webp',
    salesHint: 'Ideal para algo rápido y clásico. Se puede mejorar con queso, tocineta, carne extra, papitas o bebida.',
    sortOrder: 4,
    isActive: true,
    linkedProductName: null,
    offerType: 'CLASSIC',
  },
];

const exampleMessages = [
  'kiero una hamburgesa 2x1 con domisilio',
  'qué trae el Maxy Family',
  'Quiero lo mismo de ayer',
  'soy Cliente Sandbox',
  'mi direccion es Calle 9 # 12-34 barrio Centro',
  'agrega una gaseosa',
  'si confirmo',
  'Pago por Nequi',
  'quiero sushi galactico',
  'quiero hablar con alguien',
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function confidenceLabel(value: number) {
  return `${Math.round(value * 100)}%`;
}

function autoSafePill(status: AgentResult['autoSafeDecision']): SofiaPillStatus {
  if (!status) return 'NEUTRAL';
  if (status.status === 'AUTO_SAFE_APPROVED') return 'PASS';
  if (status.status === 'BLOCKED') return 'BLOCKED';
  return 'HUMAN_REQUIRED';
}

function caseResultFor(status: AgentResult['autoSafeDecision']): SofiaSandboxCaseResult {
  if (!status) return 'PENDING';
  if (status.status === 'AUTO_SAFE_APPROVED') return 'PASS';
  if (status.status === 'BLOCKED') return 'FAIL';
  return 'PENDING';
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function SofiaSandboxPage() {
  const [conversationId, setConversationId] = useState('');
  const [phone, setPhone] = useState('573001112233');
  const [customerName, setCustomerName] = useState('Cliente Sandbox');
  const [message, setMessage] = useState('kiero una hamburgesa 2x1 con domisilio');
  const [messageType, setMessageType] = useState<'TEXT' | 'AUDIO_TRANSCRIPT'>('TEXT');
  const [transcriptConfidence, setTranscriptConfidence] = useState('0.62');
  const [sandboxNow, setSandboxNow] = useState('2026-07-01T23:00:00.000Z');
  const [history, setHistory] = useState<AgentResult[]>([]);
  const [recovery, setRecovery] = useState<RecoveryResult | null>(null);

  const lastResult = history[0] ?? null;
  const activeItems = lastResult?.currentItems ?? [];
  const usingFallbackOffers = !lastResult?.featuredOffers?.length;
  const featuredOffers = usingFallbackOffers ? featuredOffersFallback : lastResult!.featuredOffers!;
  const activeTotal = useMemo(
    () => activeItems.reduce((sum, item) => sum + Number(item.totalPrice ?? 0), 0),
    [activeItems],
  );

  const processMessage = useMutation({
    mutationFn: () =>
      apiFetch<AgentResult>('/admin/sofia/sandbox/commercial-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conversationId || undefined,
          phone,
          customerName,
          message,
          messageType,
          transcriptConfidence: messageType === 'AUDIO_TRANSCRIPT' ? Number(transcriptConfidence || 0.7) : undefined,
          sandboxNow: sandboxNow || undefined,
        }),
      }),
    onSuccess: (result) => {
      setConversationId(result.conversationId);
      setHistory((current) => [result, ...current].slice(0, 8));
      setRecovery(null);
      toast.success('Sofía procesó el mensaje en sandbox');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No se pudo procesar el mensaje.'),
  });

  const recoverDraft = useMutation({
    mutationFn: () =>
      apiFetch<RecoveryResult>('/admin/sofia/agent/recover-abandoned', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: conversationId || lastResult?.conversationId,
        }),
      }),
    onSuccess: (result) => {
      setRecovery(result);
      toast.success('Recuperación sandbox generada');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No se pudo recuperar el pedido.'),
  });

  return (
    <SofiaPageShell data-testid="sofia-sandbox-agent">
      {/* ---- Hero ---- */}
      <SofiaPageHero
        eyebrow="Laboratorio Sofía"
        title="Sandbox Sofía"
        description="Laboratorio de pruebas para validar IA, SafetyGuard y reglas comerciales. Nada aquí representa operación real por sí sola — excepción: si confirmas un pedido de prueba hasta el final, eso sí crea una orden operativa real en Domicilios/POS. Usa siempre datos ficticios."
        statusChips={
          <>
            <SofiaStatusPill status="DRY_RUN" label="Entorno de laboratorio" />
            <SofiaStatusPill status="INFO" label="Sin envío WhatsApp real" />
            <SofiaStatusPill status="WARNING" label="Confirmar pedido crea orden real" />
          </>
        }
        data-testid="sofia-sandbox-hero"
      />

      <SofiaRiskBanner
        tone="warning"
        icon={ShieldAlert}
        title="Laboratorio, no operación real"
        description="Este sandbox no envía WhatsApp real, no marca pagos como PAID y no confirma pagos desde Sofía. Solo se convierte en operación real si confirmas explícitamente un pedido de prueba hasta el final, con el mismo flujo que un pedido real de Domicilios/POS."
        data-testid="sofia-sandbox-risk-banner"
      />

      {/* ---- Catálogo visual ---- */}
      <Card className="!border-sofia-100 !bg-gradient-to-br !from-white !to-sofia-50/40" data-testid="sofia-featured-offers">
        <SofiaSectionHeader
          eyebrow="Catálogo visual Sofía"
          title="Ofertas comerciales principales"
          description={
            usingFallbackOffers
              ? 'Catálogo de referencia mostrado antes de procesar un mensaje. No es resultado de un procesamiento real todavía.'
              : 'Catálogo devuelto por el último procesamiento real de Sofía.'
          }
          icon={<ImageIcon className="h-4 w-4" />}
          actions={
            <Badge tone={usingFallbackOffers ? 'warning' : 'success'}>
              {usingFallbackOffers ? 'Referencia, sin resultado aún' : 'Desde último resultado'}
            </Badge>
          }
        />

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {featuredOffers.map((offer) => (
            <div
              key={offer.slug}
              className="overflow-hidden rounded-2xl border border-sofia-100 bg-white shadow-sm transition-shadow hover:shadow-md"
              data-testid={`sofia-featured-offer-${offer.slug}`}
            >
              <div className="relative h-28 bg-gradient-to-br from-stone-950 via-sofia-950 to-stone-900">
                <img src={offer.imageUrl} alt={offer.name} className="h-full w-full object-cover opacity-75" />
                <div className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[0.10em] text-sofia-700">
                  {offer.isActive ? 'Activo' : 'Inactivo'}
                </div>
              </div>
              <div className="space-y-2 p-4">
                <p className="text-[13px] font-extrabold text-stone-900">{offer.name}</p>
                <p className="text-[11px] font-bold leading-relaxed text-stone-500">{offer.description}</p>
                <p
                  className="break-all rounded-xl bg-sofia-50 px-3 py-2 text-[10px] font-extrabold text-sofia-700"
                  data-testid={`sofia-featured-offer-image-${offer.slug}`}
                >
                  {offer.imageUrl}
                </p>
                <p className="text-[11px] font-semibold leading-relaxed text-stone-500">{offer.salesHint}</p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* ---- Input + Response ---- */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        {/* Input panel */}
        <Card className="!border-sofia-100">
          <SofiaSectionHeader
            title="Entrada simulada"
            description="Escribe como cliente o usa audio transcrito."
            actions={<Badge tone="info">Sandbox</Badge>}
          />

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <Field label="Teléfono">
              <Input value={phone} onChange={(event) => setPhone(event.target.value)} data-testid="sofia-sandbox-phone" />
            </Field>
            <Field label="Cliente">
              <Input value={customerName} onChange={(event) => setCustomerName(event.target.value)} data-testid="sofia-sandbox-customer" />
            </Field>
            <Field label="Tipo">
              <Select
                value={messageType}
                onChange={(event) => setMessageType(event.target.value as 'TEXT' | 'AUDIO_TRANSCRIPT')}
                data-testid="sofia-sandbox-message-type"
              >
                <option value="TEXT">Texto</option>
                <option value="AUDIO_TRANSCRIPT">Audio transcrito</option>
              </Select>
            </Field>
            <Field label="Confianza audio">
              <Input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={transcriptConfidence}
                onChange={(event) => setTranscriptConfidence(event.target.value)}
                disabled={messageType !== 'AUDIO_TRANSCRIPT'}
                data-testid="sofia-sandbox-confidence"
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Hora sandbox">
                <Input value={sandboxNow} onChange={(event) => setSandboxNow(event.target.value)} data-testid="sofia-sandbox-now" />
              </Field>
            </div>
          </div>

          <div className="mt-3">
            <Field label="Mensaje cliente">
              <Textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                className="min-h-[7rem]"
                data-testid="sofia-sandbox-message"
              />
            </Field>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {exampleMessages.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setMessage(example)}
                className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-[10px] font-bold text-stone-600 transition hover:border-sofia-200 hover:bg-sofia-50 hover:text-sofia-700"
              >
                {example}
              </button>
            ))}
          </div>

          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <Button
              onClick={() => processMessage.mutate()}
              disabled={processMessage.isPending || !message.trim()}
              data-testid="sofia-sandbox-process"
            >
              <Send className="h-4 w-4" />
              Procesar en Sandbox
            </Button>
            <Button
              variant="secondary"
              onClick={() => recoverDraft.mutate()}
              disabled={recoverDraft.isPending || (!conversationId && !lastResult?.conversationId)}
              data-testid="sofia-agent-recover-abandoned"
            >
              <RotateCcw className="h-4 w-4" />
              Recuperar abandonado
            </Button>
          </div>

          {/* Active summary */}
          <div className="mt-5 rounded-2xl border border-sofia-100 bg-sofia-50/50 p-4" data-testid="sofia-agent-summary">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-sofia-500">
              Resumen activo
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl bg-white p-3">
                <p className="text-[10px] font-bold text-stone-400">Conversación</p>
                <p className="mt-1 truncate text-xs font-extrabold text-stone-900">
                  {conversationId || 'Nueva'}
                </p>
              </div>
              <div className="rounded-xl bg-white p-3">
                <p className="text-[10px] font-bold text-stone-400">Items</p>
                <p className="mt-1 text-xs font-extrabold text-stone-900">{activeItems.length}</p>
              </div>
              <div className="rounded-xl bg-white p-3">
                <p className="text-[10px] font-bold text-stone-400">Total sandbox</p>
                <p className="mt-1 text-xs font-extrabold text-stone-900 tabular-nums">
                  {formatCurrency(activeTotal)}
                </p>
              </div>
              <div className="rounded-xl bg-white p-3">
                <p className="text-[10px] font-bold text-stone-400">Horario comercial simulado</p>
                <p className="mt-1 text-xs font-extrabold text-stone-900">
                  {lastResult?.businessStatus
                    ? lastResult.businessStatus.isOpen
                      ? 'Abierto'
                      : 'Cerrado'
                    : 'Sin procesar'}
                </p>
              </div>
              <div className="rounded-xl bg-white p-3 sm:col-span-3">
                <p className="text-[10px] font-bold text-stone-400">Prompt / memoria</p>
                <p className="mt-1 truncate text-xs font-extrabold text-stone-900">
                  {lastResult?.promptVersion ?? 'Sin prompt procesado'} ·{' '}
                  {lastResult?.memory?.customer?.memorySummary ?? 'sin memoria activa'}
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* Response panel */}
        <div className="space-y-5">
          <Card className="!border-sofia-100 !bg-sofia-50/25">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-extrabold text-stone-900">Respuesta estructurada</h2>
                <p className="mt-1 text-xs font-medium text-stone-500">
                  Lista para futura integración.
                </p>
              </div>
              <Badge
                tone={
                  lastResult?.shouldHandoff ? 'warning' : lastResult ? 'success' : 'neutral'
                }
              >
                {lastResult?.nextAction ?? 'Sin procesar'}
              </Badge>
            </div>

            {lastResult ? (
              <div className="mt-5 grid gap-4">
                {/* Intent + Confidence + Order */}
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-sofia-100 bg-white p-4" data-testid="sofia-agent-intent">
                    <Brain className="h-4 w-4 text-sofia-600" />
                    <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.10em] text-stone-400">
                      Intención
                    </p>
                    <p className="mt-1 text-[15px] font-extrabold text-sofia-800">
                      {lastResult.detectedIntent}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-sofia-100 bg-white p-4">
                    <ShieldCheck className="h-4 w-4 text-emerald-600" />
                    <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.10em] text-stone-400">
                      Confianza
                    </p>
                    <p className="mt-1 text-[15px] font-extrabold text-stone-900">
                      {confidenceLabel(lastResult.confidence)}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-sofia-100 bg-white p-4">
                    <PackageCheck className="h-4 w-4 text-sofia-600" />
                    <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.10em] text-stone-400">
                      Pedido
                    </p>
                    <p className="mt-1 text-[15px] font-extrabold text-stone-900">
                      {lastResult.deliveryOrder ? 'Creado' : lastResult.draft ? 'Draft' : 'Sin draft'}
                    </p>
                  </div>
                </div>

                {/* Response text */}
                <div className="rounded-2xl border border-sofia-200 bg-white p-4" data-testid="sofia-agent-response">
                  <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.12em] text-sofia-500">
                    <MessageCircle className="h-4 w-4" />
                    Respuesta Sofía
                  </div>
                  <p className="mt-3 text-sm font-bold leading-relaxed text-stone-900">
                    {lastResult.responseText}
                  </p>
                </div>

                {/* Commercial brain context */}
                <div className="rounded-2xl border border-sofia-100 bg-white p-4" data-testid="sofia-commercial-brain-context">
                  <p className="text-xs font-extrabold text-stone-900">Cerebro comercial usado</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-xl bg-sofia-50 px-3 py-2">
                      <p className="text-[10px] font-bold text-sofia-500">Prompt</p>
                      <p className="text-xs font-extrabold text-sofia-800">
                        {lastResult.promptVersion ?? 'N/D'}
                      </p>
                    </div>
                    <div className="rounded-xl bg-sofia-50 px-3 py-2">
                      <p className="text-[10px] font-bold text-sofia-500">Catálogo</p>
                      <p className="text-xs font-extrabold text-sofia-800">
                        {lastResult.matchedCatalogItem?.name ?? 'Sin match'}
                      </p>
                    </div>
                    <div className="rounded-xl bg-sofia-50 px-3 py-2">
                      <p className="text-[10px] font-bold text-sofia-500">Memoria</p>
                      <p className="truncate text-xs font-extrabold text-sofia-800">
                        {lastResult.memory?.conversation?.lastProductDiscussed ?? 'Sin contexto'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Auto Safe */}
                {lastResult.autoSafeDecision && (
                  <div className="rounded-2xl border border-emerald-200 bg-white p-4" data-testid="sofia-auto-safe-panel">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-extrabold text-stone-900">
                        <ShieldCheck className="h-4 w-4 text-emerald-600" />
                        Auto Safe Engine
                      </div>
                      <SofiaStatusPill
                        status={autoSafePill(lastResult.autoSafeDecision)}
                        label={lastResult.autoSafeDecision.status}
                        data-testid="sofia-auto-safe-status"
                      />
                    </div>
                    <p className="mt-2 text-xs font-semibold text-stone-500">
                      Approved: {lastResult.autoSafeDecision.approved ? 'sí' : 'no'} · Should
                      send: {lastResult.autoSafeDecision.shouldSend ? 'sí' : 'no'} · No WhatsApp
                      real enviado
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5" data-testid="sofia-auto-safe-reasons">
                      {lastResult.autoSafeDecision.reasonCodes.map((code) => (
                        <span
                          key={code}
                          title={code}
                          className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-extrabold text-emerald-700"
                        >
                          {humanizeReasonCode(code)}
                        </span>
                      ))}
                    </div>
                    {lastResult.autoSafeDecision.warnings.length > 0 && (
                      <p className="mt-2 text-[11px] font-bold text-amber-700">
                        {lastResult.autoSafeDecision.warnings.join(' · ')}
                      </p>
                    )}
                    {lastResult.autoSafeDecision.finalReply && (
                      <p
                        className="mt-3 rounded-xl bg-stone-50 px-3 py-2 text-xs font-bold text-stone-700"
                        data-testid="sofia-auto-safe-final-reply"
                      >
                        {lastResult.autoSafeDecision.finalReply}
                      </p>
                    )}
                  </div>
                )}

                {/* Items + missing fields */}
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl border border-stone-200 bg-white p-4" data-testid="sofia-agent-extracted-items">
                    <p className="text-xs font-extrabold text-stone-900">Productos reales detectados</p>
                    <div className="mt-3 space-y-2">
                      {lastResult.currentItems.length ? (
                        lastResult.currentItems.map((item) => (
                          <div
                            key={item.productId}
                            className="flex items-center justify-between gap-3 rounded-xl bg-stone-50 px-3 py-2"
                          >
                            <div>
                              <p className="text-xs font-extrabold text-stone-900">
                                {item.quantity} x {item.name}
                              </p>
                              <p className="text-[10px] font-bold text-stone-400">
                                {item.code || item.categoryName || 'Catálogo real'}
                              </p>
                            </div>
                            <p className="text-xs font-extrabold text-stone-900 tabular-nums">
                              {formatCurrency(item.totalPrice)}
                            </p>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs font-bold text-stone-400">Sin productos detectados.</p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-stone-200 bg-white p-4" data-testid="sofia-agent-missing-fields">
                    <p className="text-xs font-extrabold text-stone-900">Campos faltantes</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {lastResult.missingFields.length ? (
                        lastResult.missingFields.map((field) => (
                          <span
                            key={field}
                            className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-extrabold text-amber-700"
                          >
                            {field}
                          </span>
                        ))
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-extrabold text-emerald-700">
                          Listo para confirmar
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Upsell + Media */}
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl border border-sofia-100 bg-white p-4" data-testid="sofia-agent-upsell">
                    <div className="flex items-center gap-2 text-xs font-extrabold text-stone-900">
                      <Sparkles className="h-4 w-4 text-sofia-600" />
                      Upsell seguro
                    </div>
                    <p className="mt-2 text-xs font-semibold text-stone-500">
                      {lastResult.suggestedUpsell
                        ? `${lastResult.suggestedUpsell.message}${
                            lastResult.suggestedUpsell.price == null
                              ? ''
                              : ` (${formatCurrency(lastResult.suggestedUpsell.price)})`
                          }`
                        : 'Sin upsell activo o ya tiene bebida.'}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-sofia-100 bg-white p-4" data-testid="sofia-agent-media">
                    <div className="flex items-center gap-2 text-xs font-extrabold text-stone-900">
                      <ImageIcon className="h-4 w-4 text-sofia-600" />
                      Multimedia simulada
                    </div>
                    <p className="mt-2 text-xs font-semibold text-stone-500">
                      {lastResult.mediaSuggestion
                        ? `${lastResult.mediaSuggestion.productName} · ${lastResult.mediaSuggestion.altText}`
                        : 'Sin media sugerida.'}
                    </p>
                    {lastResult.mediaSuggestion?.imageUrl && (
                      <p
                        className="mt-2 break-all rounded-xl bg-sofia-50 px-3 py-2 text-[10px] font-extrabold text-sofia-700"
                        data-testid="sofia-agent-media-path"
                      >
                        {lastResult.mediaSuggestion.imageUrl}
                      </p>
                    )}
                  </div>
                </div>

                {/* Payment link */}
                {lastResult.paymentLinkUrl && (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4" data-testid="sofia-agent-payment-link">
                    <p className="text-xs font-extrabold text-emerald-800">Link de pago generado</p>
                    <a
                      href={lastResult.paymentLinkUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 block break-all text-xs font-bold text-emerald-700 underline"
                    >
                      {lastResult.paymentLinkUrl}
                    </a>
                  </div>
                )}

                {/* Delivery order created */}
                {lastResult.deliveryOrder && (
                  <div className="rounded-2xl border border-sofia-200 bg-sofia-50 p-4" data-testid="sofia-agent-confirmed-order">
                    <p className="text-xs font-extrabold text-sofia-800">
                      Pedido operativo real creado en Domicilios/POS
                    </p>
                    <p className="mt-1 text-[11px] font-semibold text-sofia-700">
                      Este pedido de prueba ya no es solo sandbox: quedó registrado igual que un pedido confirmado por un cliente real. Si usaste datos ficticios, cancélalo o márcalo desde Domicilios/POS.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button asChild size="sm">
                        <Link href="/deliveries">
                          Ver en Domicilios <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="secondary">
                        <Link href="/pos">
                          Ver en POS <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                )}

                {/* Handoff */}
                {lastResult.shouldHandoff && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4" data-testid="sofia-agent-handoff">
                    <p className="text-xs font-extrabold text-amber-800">Handoff humano requerido</p>
                    <p className="mt-1 text-xs font-semibold text-amber-700">
                      La conversación quedó pausada para revisión humana.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <SofiaEmptyState
                icon={Bot}
                title="Procesa un mensaje"
                description="Escribe un mensaje de cliente y haz clic en Procesar en Sandbox para ver la respuesta estructurada."
              />
            )}
          </Card>

          {/* Recovery result */}
          {recovery && (
            <Card className="!border-amber-200 !bg-amber-50/60" data-testid="sofia-agent-recovery-result">
              <h3 className="text-sm font-extrabold text-amber-900">
                Recuperación de pedido abandonado
              </h3>
              <p className="mt-2 text-[13px] font-bold text-amber-800">{recovery.responseText}</p>
            </Card>
          )}
        </div>
      </div>

      {/* ---- History ---- */}
      <Card>
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-sofia-100 text-sofia-600">
              <Mic2 className="h-4 w-4" />
            </span>
            <h2 className="text-sm font-extrabold text-stone-900">Matriz de casos</h2>
          </div>
          {history.length > 0 && (
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.08em]">
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">
                {history.filter((item) => caseResultFor(item.autoSafeDecision) === 'PASS').length} PASS
              </span>
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700">
                {history.filter((item) => caseResultFor(item.autoSafeDecision) === 'FAIL').length} FAIL
              </span>
              <span className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-500">
                {history.filter((item) => caseResultFor(item.autoSafeDecision) === 'PENDING').length} PENDIENTE
              </span>
            </div>
          )}
        </div>
        <div className="mt-4 grid gap-2.5 lg:grid-cols-2" data-testid="sofia-agent-events">
          {history.length ? (
            history.map((item, index) => (
              <SofiaSandboxCaseCard
                key={`${item.conversationId}-${index}`}
                title={`${item.detectedIntent} · ${confidenceLabel(item.confidence)}`}
                description={item.responseText || 'Sin respuesta estructurada.'}
                inputPreview={
                  item.currentItems.length
                    ? `${item.currentItems.length} producto(s) · total ${formatCurrency(
                        item.currentItems.reduce((sum, current) => sum + Number(current.totalPrice ?? 0), 0),
                      )}`
                    : undefined
                }
                result={caseResultFor(item.autoSafeDecision)}
                resultDetail={`Acción: ${item.nextAction}`}
                data-testid="sofia-sandbox-case-card"
              />
            ))
          ) : (
            <SofiaEmptyState
              title="Sin eventos sandbox"
              description="Procesa tu primer mensaje para ver el historial."
            />
          )}
        </div>
      </Card>
    </SofiaPageShell>
  );
}
