import { CrmFrame, PageHeader } from '@/components/sofia';
import { TasksView } from '@/features/sofia/crm/tasks/TasksView';

export default function SofiaCrmTasksPage() {
  return (
    <CrmFrame>
      <div className="space-y-4" data-testid="sofia-crm-tasks-page">
        <PageHeader
          eyebrow="CRM SOFIA"
          title="Tareas"
          description="Tareas y seguimientos vinculados a leads, clientes o casos de servicio, con vencimientos y cambios de estado auditados."
          data-testid="sofia-crm-tasks-header"
        />
        <TasksView />
      </div>
    </CrmFrame>
  );
}
