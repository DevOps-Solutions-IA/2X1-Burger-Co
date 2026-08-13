import { Suspense } from 'react';
import { CustomerServiceScreen } from '@/features/support-operations/customer-service-screen';

export default function CustomerServicePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted" role="status">Cargando casos de servicio…</div>}>
      <CustomerServiceScreen />
    </Suspense>
  );
}
