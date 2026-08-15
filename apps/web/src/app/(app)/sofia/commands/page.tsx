import { PendingPhasePage } from '@/components/sofia/workspace';

export default function SofiaCommandsPage() {
  return (
    <PendingPhasePage
      eyebrow="Comandos"
      title="Comandos"
      description="Ejecución gobernada de comandos sensibles vía SecureCommand."
      pendingPhase="Fase E — SecureCommand"
      noticeTitle="Comandos disponibles en una fase posterior"
      noticeDescription="El flujo de aprobación, ejecución y evidencia de SecureCommand se conecta en la Fase E del programa."
      data-testid="sofia-commands-page"
    />
  );
}
