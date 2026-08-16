import { redirect } from 'next/navigation';

/** Ruta legacy — el directorio de clientes del CRM vive ahora en /sofia/crm. */
export default function LegacySofiaCustomersPage() {
  redirect('/sofia/crm');
}
