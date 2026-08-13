import { Suspense } from 'react';
import { PaymentsScreen } from '@/features/financial-operations/payments-screen';

export default function PaymentsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted" role="status">Cargando evidencia financiera…</div>}>
      <PaymentsScreen />
    </Suspense>
  );
}
