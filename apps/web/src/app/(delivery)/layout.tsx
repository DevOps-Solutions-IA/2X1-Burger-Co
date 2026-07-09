import DeliveryLayoutClient from './delivery-layout.client';

export default function DeliveryLayout({ children }: { children: React.ReactNode }) {
  return <DeliveryLayoutClient>{children}</DeliveryLayoutClient>;
}
