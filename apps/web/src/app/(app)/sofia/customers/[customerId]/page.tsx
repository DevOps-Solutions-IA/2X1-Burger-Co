import { redirect } from 'next/navigation';

/** Ruta legacy — el Customer 360 vive ahora en /sofia/crm/customers/[customerId]. */
export default async function LegacySofiaCustomerDetailPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  redirect(`/sofia/crm/customers/${customerId}`);
}
