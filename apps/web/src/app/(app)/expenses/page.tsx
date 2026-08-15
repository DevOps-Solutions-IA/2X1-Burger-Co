'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PiggyBank, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { StatusBanner } from '@/components/ui/status-banner';
import { Textarea } from '@/components/ui/textarea';
import { DetailDialog, FilterBar, MetricSurface, PageHeader, QueryState, StatusBadge } from '@/components/product';
import { apiFetch } from '@/lib/api';
import { formatCurrency, formatDate, matchesSearch } from '@/lib/format';
import { useAuth } from '@/features/auth/auth-provider';
import { canPerformAction } from '@/features/auth/access-control';

const commonConcepts = [
  'Gas',
  'Transporte',
  'Arriendo',
  'Nómina',
  'Servicios',
  'Mantenimiento',
  'Bolsas',
  'Servilletas',
  'Caja menor',
];

const blankExpenseForm = {
  concept: '',
  classification: '',
  amount: '',
  paymentMethodId: '',
  description: '',
};

type Expense = {
  id: string;
  concept: string;
  classification: string | null;
  description: string | null;
  amount: number | string;
  spentAt: string;
  paymentMethod: {
    id: string;
    name: string;
  } | null;
  createdBy: {
    fullName: string;
  } | null;
};

type PaymentMethod = {
  id: string;
  name: string;
};

type DailySummary = {
  expenses?: {
    count?: number;
    total?: number | string;
  };
  cash?: {
    expectedAmount?: number | string;
  };
};

function getExpenseErrors(form: {
  concept: string;
  classification: string;
  amount: string;
  paymentMethodId: string;
}) {
  return {
    concept: !form.concept.trim() ? 'Ingresa un concepto.' : null,
    classification: !form.classification.trim() ? 'Ingresa una clasificación.' : null,
    amount: Number(form.amount) <= 0 ? 'El monto debe ser mayor a cero.' : null,
    paymentMethodId: !form.paymentMethodId ? 'Selecciona un método de pago.' : null,
  };
}

export default function ExpensesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [form, setForm] = useState(blankExpenseForm);
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [showModal, setShowModal] = useState(false);
  const canCreate = canPerformAction(user?.permissions, 'expenses.create', user?.roles, ['admin', 'cashier', 'supervisor']);

  const expenses = useQuery({
    queryKey: ['expenses'],
    queryFn: () => apiFetch<Expense[]>('/expenses'),
  });
  const paymentMethods = useQuery({
    queryKey: ['payment-methods'],
    queryFn: () => apiFetch<PaymentMethod[]>('/payment-methods'),
  });
  const dailySummary = useQuery({
    queryKey: ['daily-summary'],
    queryFn: () => apiFetch<DailySummary>('/reports/daily'),
  });
  const expenseSourcesReady = dailySummary.isSuccess && paymentMethods.isSuccess;

  const filteredExpenses = useMemo(
    () =>
      (expenses.data ?? []).filter((expense) =>
        matchesSearch(
          [expense.concept, expense.classification, expense.description, expense.paymentMethod?.name, expense.createdBy?.fullName],
          search,
        ),
      ),
    [expenses.data, search],
  );

  const rawErrors = getExpenseErrors(form);
  const formErrors = {
    concept: submitAttempted ? rawErrors.concept : null,
    classification: submitAttempted ? rawErrors.classification : null,
    amount: submitAttempted ? rawErrors.amount : null,
    paymentMethodId: submitAttempted ? rawErrors.paymentMethodId : null,
  };

  const createExpense = useMutation({
    mutationFn: () => {
      if (!canCreate) return Promise.reject(new Error('No tienes permiso para registrar gastos.'));
      if (!expenseSourcesReady) {
        return Promise.reject(new Error('No se puede registrar el gasto sin verificar las fuentes financieras requeridas.'));
      }

      return apiFetch('/expenses', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          amount: Number(form.amount),
        }),
      });
    },
    onSuccess: async () => {
      toast.success('Gasto registrado y aplicado al cierre del día');
      setForm(blankExpenseForm);
      setSubmitAttempted(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['expenses'] }),
        queryClient.invalidateQueries({ queryKey: ['daily-report'] }),
        queryClient.invalidateQueries({ queryKey: ['daily-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['cash-current'] }),
        queryClient.invalidateQueries({ queryKey: ['current-cash'] }),
      ]);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'No pudimos registrar el gasto. Intenta de nuevo.'),
  });

  const submitExpense = () => {
    setSubmitAttempted(true);

    if (!expenseSourcesReady) {
      toast.error('Reintenta las fuentes financieras antes de registrar el gasto.');
      return;
    }

    if (rawErrors.concept || rawErrors.classification || rawErrors.amount || rawErrors.paymentMethodId) {
      toast.error('Completa concepto, clasificación, monto y método de pago antes de guardar.');
      return;
    }

    createExpense.mutate();
  };

  const resetForm = () => {
    setForm(blankExpenseForm);
    setSubmitAttempted(false);
    toast.success('Formulario listo para un nuevo gasto');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Control financiero"
        title="Gastos"
        description="Registra egresos autorizados y conserva una lectura verificable del impacto diario."
        status={dailySummary.data && !dailySummary.isError
          ? <StatusBadge status="OPEN" label={`${dailySummary.data.expenses?.count ?? 0} hoy`} tone="warning" />
          : <StatusBadge status="UNKNOWN" label={dailySummary.data ? 'Resumen desactualizado' : 'Resumen sin verificar'} />}
      />

      {!canCreate ? <QueryState status="permission_denied" title="Modo consulta" description="Puedes revisar el historial financiero, pero no registrar gastos." /> : null}

      <div className="grid gap-3 md:grid-cols-3">
        <MetricSurface density="compact" label="Gastos del día" value={dailySummary.data ? formatCurrency(dailySummary.data.expenses?.total) : undefined} context="Impacto directo" icon={<PiggyBank className="h-5 w-5" />} unavailable={!dailySummary.data} />
        <MetricSurface density="compact" label="Registros" value={dailySummary.data ? String(dailySummary.data.expenses?.count ?? 0) : undefined} context="Egresos cargados" icon={<PiggyBank className="h-5 w-5" />} unavailable={!dailySummary.data} />
        <MetricSurface density="compact" label="Caja esperada" value={dailySummary.data ? formatCurrency(dailySummary.data.cash?.expectedAmount) : undefined} context="Actualizada tras cada gasto" icon={<PiggyBank className="h-5 w-5" />} unavailable={!dailySummary.data} />
      </div>

      {dailySummary.isError || paymentMethods.isError ? (
        <StatusBanner
          tone="danger"
          title="Parte de la operación financiera no está disponible"
          description="No se sustituyeron el resumen diario ni los métodos de pago por valores locales o estimados."
          action={<Button type="button" variant="secondary" onClick={() => { void Promise.all([dailySummary.refetch(), paymentMethods.refetch()]); }}>Reintentar</Button>}
        />
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Card data-testid="expense-form">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-extrabold text-ink">Registrar gasto</h2>
              <p className="mt-0.5 text-[12px] text-stone-600">Cada egreso afecta el cierre diario.</p>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={resetForm} disabled={!canCreate}>Nuevo registro</Button>
          </div>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {commonConcepts.map((concept) => (
              <button
                key={concept}
                type="button"
                className={`min-h-11 rounded-xl px-3 py-2 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${form.concept === concept ? 'bg-ink text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
                onClick={() => setForm((c) => ({ ...c, concept, classification: concept }))}
                data-testid="expense-category-chip"
                disabled={!canCreate}
              >
                {concept}
              </button>
            ))}
          </div>

          <form className="mt-5 space-y-4" onSubmit={(event) => { event.preventDefault(); submitExpense(); }}>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Concepto" error={formErrors.concept} required>
                <Input data-testid="expense-concept" value={form.concept} onChange={(e) => setForm((c) => ({ ...c, concept: e.target.value }))} placeholder="Ej. Gas, transporte" />
              </Field>
              <Field label="Clasificación" error={formErrors.classification} required>
                <Input data-testid="expense-classification" value={form.classification} onChange={(e) => setForm((c) => ({ ...c, classification: e.target.value }))} placeholder="Ej. Operación, logística" />
              </Field>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Monto (COP)" error={formErrors.amount} required>
                <Input data-testid="expense-amount" type="number" value={form.amount} onChange={(e) => setForm((c) => ({ ...c, amount: e.target.value }))} />
              </Field>
              <Field label="Método de pago" error={formErrors.paymentMethodId} required>
                <Select value={form.paymentMethodId} onChange={(e) => setForm((c) => ({ ...c, paymentMethodId: e.target.value }))} data-testid="expense-payment-method-select">
                  <option value="">Selecciona método</option>
                  {paymentMethods.data?.map((m) => (<option key={m.id} value={m.id}>{m.name}</option>))}
                </Select>
              </Field>
            </div>
            <Field label="Descripción" hint="Contexto operativo del egreso.">
              <Textarea value={form.description} onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))} className="min-h-[5rem]" placeholder="Ej. Compra urgente de servilletas turno noche" />
            </Field>
            <Button data-testid="expense-submit" type="submit" className="w-full" disabled={!canCreate || createExpense.isPending || !expenseSourcesReady}>
              {createExpense.isPending ? 'Registrando...' : 'Guardar gasto'}
            </Button>
          </form>
        </Card>

        <Card className="overflow-hidden p-0" data-testid="expenses-history">
          <div className="space-y-3 border-b border-line px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-extrabold text-ink">Historial de gastos</h2>
                <p className="mt-0.5 text-[12px] text-stone-600">Referencia operativa de egresos recientes.</p>
              </div>
              <Badge tone="neutral">{filteredExpenses.length} registros</Badge>
            </div>
            <FilterBar
              density="compact"
              activeCount={Number(Boolean(search.trim()))}
              search={<div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" /><Input aria-label="Buscar gastos" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Concepto, clasificación o método" className="pl-9" data-testid="expense-history-search" /></div>}
            />
          </div>
          <div className="hide-scrollbar max-h-[30rem] overflow-y-auto divide-y divide-stone-100">
            <QueryState
              status={expenses.isLoading ? 'loading' : expenses.isError ? 'error' : filteredExpenses.length ? 'ready' : 'empty'}
              title={expenses.isError ? 'No se pudo cargar el historial' : 'Sin gastos para esta búsqueda'}
              description={expenses.isError ? 'El historial no está disponible; no se sustituyó por información estimada.' : 'Registra el primer egreso o ajusta el término de búsqueda.'}
              onRetry={expenses.isError ? () => void expenses.refetch() : undefined}
              className="m-4"
            >
            {filteredExpenses.map((expense) => (
              <button
                key={expense.id}
                type="button"
                className="grid w-full gap-3 px-5 py-3 text-left transition hover:bg-stone-50 md:grid-cols-[0.7fr_1fr_0.5fr_0.55fr]"
                onClick={() => { setSelectedExpense(expense); setShowModal(true); }}
                data-testid="expense-history-item"
              >
                <div>
                  <p className="text-[12px] font-bold text-ink">{formatDate(expense.spentAt)}</p>
                  <p className="text-[12px] text-stone-600">{expense.paymentMethod?.name || '—'}</p>
                </div>
                <div>
                  <p className="text-[12px] font-bold text-ink">{expense.concept}</p>
                  <p className="text-[12px] text-stone-600 truncate">{expense.classification || '—'}</p>
                </div>
                <p className="text-[12px] text-stone-600">{expense.createdBy?.fullName || 'Sistema'}</p>
                <p className="text-[13px] font-extrabold text-ink tabular-nums text-right">{formatCurrency(expense.amount)}</p>
              </button>
            ))}
            </QueryState>
          </div>
        </Card>
      </div>

      <DetailDialog
        open={showModal && Boolean(selectedExpense)}
        onClose={() => { setShowModal(false); setSelectedExpense(null); }}
        title="Detalle del gasto"
        description={selectedExpense ? formatDate(selectedExpense.spentAt) : undefined}
        mode="dialog"
        footer={<Button type="button" variant="secondary" className="w-full" onClick={() => { setShowModal(false); setSelectedExpense(null); }} data-testid="expense-detail-close">Cerrar detalle</Button>}
      >
        {selectedExpense ? (
            <div className="space-y-3" data-testid="expense-detail-modal">
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-stone-600">Concepto</p>
                <p className="mt-0.5 text-[13px] font-bold text-ink">{selectedExpense.concept}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                  <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-stone-600">Clasificación</p>
                  <p className="mt-0.5 text-[12px] font-bold text-ink">{selectedExpense.classification || '—'}</p>
                </div>
                <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                  <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-stone-600">Método</p>
                  <p className="mt-0.5 text-[12px] font-bold text-ink">{selectedExpense.paymentMethod?.name || '—'}</p>
                </div>
              </div>
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-center">
                <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-stone-600">Monto</p>
                <p className="mt-0.5 text-[1.4rem] font-black text-ink tabular-nums">{formatCurrency(selectedExpense.amount)}</p>
              </div>
              {selectedExpense.description ? (
                <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                  <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-stone-600">Descripción</p>
                  <p className="mt-1 text-[12px] text-stone-700 leading-5">{selectedExpense.description}</p>
                </div>
              ) : null}
              <p className="text-center text-[12px] text-stone-600">{selectedExpense.createdBy?.fullName ? `Registrado por ${selectedExpense.createdBy.fullName}` : 'Sistema'}</p>
            </div>
        ) : null}
      </DetailDialog>
    </div>
  );
}
