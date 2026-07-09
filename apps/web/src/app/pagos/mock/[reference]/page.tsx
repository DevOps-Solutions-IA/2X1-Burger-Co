import Link from 'next/link';
import { CheckCircle2, ShieldCheck, TriangleAlert } from 'lucide-react';

export default async function MockPaymentCheckoutPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;

  return (
    <main
      className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(124,58,237,0.25),transparent_34%),linear-gradient(135deg,#130f1f_0%,#24123f_45%,#fff7ed_45%,#fff7ed_100%)] px-4 py-6 text-stone-950"
      data-testid="mock-payment-checkout-page"
    >
      <section className="mx-auto grid max-w-3xl gap-5 rounded-[2rem] border border-white/50 bg-white/90 p-5 shadow-[0_30px_90px_rgba(40,20,80,0.28)] backdrop-blur sm:p-8">
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-violet-200 bg-violet-100 px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-violet-800">
          <ShieldCheck className="h-4 w-4" />
          Mock provider
        </div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-stone-400">Referencia provider</p>
          <h1 className="mt-2 break-all text-3xl font-black tracking-tight" data-testid="mock-payment-reference">
            {decodeURIComponent(reference)}
          </h1>
          <p className="mt-3 max-w-xl text-sm font-semibold leading-6 text-stone-600">
            Checkout visual para desarrollo y E2E. No procesa dinero real y no puede marcar pagos como pagados desde el cliente.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4" data-testid="mock-payment-approved-info">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <p className="mt-2 text-sm font-black text-emerald-950">Simular aprobado</p>
            <p className="mt-1 text-xs font-semibold leading-5 text-emerald-700">
              Disponible solo por endpoint dev autenticado.
            </p>
          </div>
          <div className="rounded-2xl border border-red-100 bg-red-50 p-4" data-testid="mock-payment-failed-info">
            <TriangleAlert className="h-5 w-5 text-red-600" />
            <p className="mt-2 text-sm font-black text-red-950">Simular fallido</p>
            <p className="mt-1 text-xs font-semibold leading-5 text-red-700">
              Disponible solo por endpoint dev autenticado.
            </p>
          </div>
        </div>
        <Link
          href="/"
          className="inline-flex w-fit rounded-2xl bg-stone-950 px-4 py-3 text-sm font-black text-white"
          data-testid="mock-payment-back-home"
        >
          Volver
        </Link>
      </section>
    </main>
  );
}
