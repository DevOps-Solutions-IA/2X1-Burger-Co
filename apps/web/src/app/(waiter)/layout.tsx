import WaiterLayoutClient from './waiter-layout.client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function WaiterLayout({ children }: { children: React.ReactNode }) {
  return <WaiterLayoutClient>{children}</WaiterLayoutClient>;
}
