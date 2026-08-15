import { redirect } from 'next/navigation';

export default async function SofiaCustomerDetailRedirectPage({ params }: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await params;
  redirect(`/sofia/crm/customers/${encodeURIComponent(customerId)}`);
}
