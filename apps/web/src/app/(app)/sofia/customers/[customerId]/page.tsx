import { redirect } from 'next/navigation';

export default async function LegacySofiaCustomerDetailPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  redirect(`/customers/${encodeURIComponent(customerId)}`);
}
