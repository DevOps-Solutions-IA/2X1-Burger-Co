'use client';

import { usePathname } from 'next/navigation';
import { Activity, BriefcaseBusiness, Contact, LayoutDashboard, ListTodo, RotateCcw, Tags, Workflow } from 'lucide-react';
import { ModuleTabs, PageHeader } from '@/components/product';

const tabs = [
  { id: 'overview', label: 'Resumen', href: '/crm', icon: <LayoutDashboard className="h-4 w-4" /> },
  { id: 'leads', label: 'Leads', href: '/crm/leads', icon: <Contact className="h-4 w-4" /> },
  { id: 'pipelines', label: 'Pipelines', href: '/crm/pipelines', icon: <Workflow className="h-4 w-4" /> },
  { id: 'tasks', label: 'Tareas', href: '/crm/tasks', icon: <ListTodo className="h-4 w-4" /> },
  { id: 'follow-ups', label: 'Seguimientos', href: '/crm/follow-ups', icon: <BriefcaseBusiness className="h-4 w-4" /> },
  { id: 'segments', label: 'Segmentos', href: '/crm/segments', icon: <Tags className="h-4 w-4" /> },
  { id: 'activity', label: 'Actividad', href: '/crm/activity', icon: <Activity className="h-4 w-4" /> },
  { id: 'recovery', label: 'Recuperación', href: '/crm/recovery', icon: <RotateCcw className="h-4 w-4" /> },
] as const;

export function CrmModule({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const currentPath = pathname ?? '/crm';
  const activeId = currentPath === '/crm' ? 'overview' : currentPath.split('/')[2] ?? 'overview';

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
      <PageHeader
        eyebrow="Relaciones comerciales"
        title="CRM"
        description="Leads, tareas y actividad construidos sobre el cliente canónico, con historial auditable y sin automatización de campañas."
      />
      <ModuleTabs
        label="Navegación CRM"
        items={tabs.map((tab) => ({ ...tab, active: tab.id === activeId }))}
        density="compact"
      />
      {children}
    </main>
  );
}
