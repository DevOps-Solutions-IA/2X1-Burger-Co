'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PiggyBank, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { MetricCard } from '@/components/ui/metric-card';
import { SectionTitle } from '@/components/ui/section-title';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { apiFetch } from '@/lib/api';
import { formatCurrency, formatDate, matchesSearch } from '@/lib/format';

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
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [form, setForm] = useState(blankExpenseForm);
  const [selectedExpense, setSelectedExpense] = useState<any>(null);
  const [showModal, setShowModal] = useState(false);

  const expenses = useQuery({
    queryKey: ['expenses'],
    queryFn: () => apiFetch<any[]>('/expenses'),
  });
  const paymentMethods = useQuery({
    queryKey: ['payment-methods'],
    queryFn: () => apiFetch<any[]>('/payment-methods'),
  });
  const dailySummary = useQuery({
    queryKey: ['daily-summary'],
    queryFn: () => apiFetch<any>('/reports/daily'),
  });

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
    mutationFn: () =>
      apiFetch('/expenses', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          amount: Number(form.amount),
        }),
      }),
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
    <div className="space-y-5 p-6 lg:p-8">
      <SectionTitle
        eyebrow="Operación diaria"
        title="Gastos"
        description="Registra egresos y mantén el control del día."
        status={<Badge tone="warning">{dailySummary.data?.expenses?.count ?? 0} hoy</Badge>}
      />

      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard compact label="Gastos del día" value={formatCurrency(dailySummary.data?.expenses?.total)} hint="Impacto directo" icon={<PiggyBank className="h-5 w-5" />} accent="danger" />
        <MetricCard compact label="Registros" value={String(dailySummary.data?.expenses?.count ?? 0)} hint="Egresos cargados" icon={<PiggyBank className="h-5 w-5" />} accent="ink" />
        <MetricCard compact label="Caja esperada" value={formatCurrency(dailySummary.data?.cash?.expectedAmount)} hint="Actualizado tras cada gasto" icon={<PiggyBank className="h-5 w-5" />} accent="success" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Card data-testid="expense-form">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-extrabold text-ink">Registrar gasto</h2>
              <p className="mt-0.5 text-[12px] text-stone-500">Cada egreso afecta el cierre diario.</p>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={resetForm}>Nuevo registro</Button>
          </div>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {commonConcepts.map((concept) => (
              <button
                key={concept}
                type="button"
                className={`rounded-lg px-3 py-1.5 text-[11px] font-bold transition ${form.concept === concept ? 'bg-ink text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
                onClick={() => setForm((c) => ({ ...c, concept, classification: concept }))}
                data-testid="expense-category-chip"
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
            <Button data-testid="expense-submit" type="submit" className="w-full" disabled={createExpense.isPending}>
              {createExpense.isPending ? 'Registrando...' : 'Guardar gasto'}
            </Button>
          </form>
        </Card>

        <Card className="overflow-hidden p-0" data-testid="expenses-history">
          <div className="space-y-3 border-b border-stone-100 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-extrabold text-ink">Historial de gastos</h2>
                <p className="mt-0.5 text-[12px] text-stone-500">Referencia operativa de egresos recientes.</p>
              </div>
              <Badge tone="neutral">{filteredExpenses.length} registros</Badge>
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por concepto, clasificación o metodo" className="pl-9" data-testid="expense-history-search" />
            </div>
          </div>
          <div className="hide-scrollbar max-h-[30rem] overflow-y-auto divide-y divide-stone-100">
            {expenses.isLoading
              ? Array.from({ length: 5 }).map((_, i) => (<div key={i} className="px-5 py-4"><Skeleton className="h-14 rounded-xl" /></div>))
              : null}

            {!expenses.isLoading && filteredExpenses.map((expense) => (
              <button
                key={expense.id}
                type="button"
                className="grid w-full gap-3 px-5 py-3 text-left transition hover:bg-stone-50 md:grid-cols-[0.7fr_1fr_0.5fr_0.55fr]"
                onClick={() => { setSelectedExpense(expense); setShowModal(true); }}
                data-testid="expense-history-item"
              >
                <div>
                  <p className="text-[12px] font-bold text-ink">{formatDate(expense.spentAt)}</p>
                  <p className="text-[11px] text-stone-500">{expense.paymentMethod?.name || '—'}</p>
                </div>
                <div>
                  <p className="text-[12px] font-bold text-ink">{expense.concept}</p>
                  <p className="text-[11px] text-stone-500 truncate">{expense.classification || '—'}</p>
                </div>
                <p className="text-[11px] text-stone-500">{expense.createdBy?.fullName || 'Sistema'}</p>
                <p className="text-[13px] font-extrabold text-ink tabular-nums text-right">{formatCurrency(expense.amount)}</p>
              </button>
            ))}

            {!expenses.isLoading && !filteredExpenses.length ? (
              <div className="p-8">
                <EmptyState title="Sin gastos registrados" description="Registra el primer egreso para verlo aqui." />
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      {/* Detail Modal */}
      {showModal && selectedExpense ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" data-testid="expense-detail-modal">
          <div className="absolute inset-0 bg-black/30" onClick={() => { setShowModal(false); setSelectedExpense(null); }} />
          <div className="relative w-full max-w-md rounded-[1.5rem] border border-stone-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3 className="text-[15px] font-extrabold text-ink">Detalle del gasto</h3>
                <p className="text-[11px] text-stone-500">{formatDate(selectedExpense.spentAt)}</p>
              </div>
              <button type="button" className="text-stone-400 hover:text-ink" onClick={() => { setShowModal(false); setSelectedExpense(null); }} data-testid="expense-detail-close">&times;</button>
            </div>
            <div className="space-y-3">
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-stone-400">Concepto</p>
                <p className="mt-0.5 text-[13px] font-bold text-ink">{selectedExpense.concept}</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-stone-400">Clasificación</p>
                  <p className="mt-0.5 text-[12px] font-bold text-ink">{selectedExpense.classification || '—'}</p>
                </div>
                <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-stone-400">Método</p>
                  <p className="mt-0.5 text-[12px] font-bold text-ink">{selectedExpense.paymentMethod?.name || '—'}</p>
                </div>
              </div>
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-center">
                <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-stone-400">Monto</p>
                <p className="mt-0.5 text-[1.4rem] font-black text-ink tabular-nums">{formatCurrency(selectedExpense.amount)}</p>
              </div>
              {selectedExpense.description ? (
                <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-stone-400">Descripción</p>
                  <p className="mt-1 text-[12px] text-stone-700 leading-5">{selectedExpense.description}</p>
                </div>
              ) : null}
              <p className="text-[10px] text-stone-400 text-center">{selectedExpense.createdBy?.fullName ? `Registrado por ${selectedExpense.createdBy.fullName}` : 'Sistema'}</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
