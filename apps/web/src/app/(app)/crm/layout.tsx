import { CrmModule } from '@/features/crm/crm-module';

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return <CrmModule>{children}</CrmModule>;
}
