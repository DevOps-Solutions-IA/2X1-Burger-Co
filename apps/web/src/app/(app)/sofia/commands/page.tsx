import { PendingPhasePage } from '@/components/sofia/workspace';

export default function SofiaCommandsPage() {
  return (
    <PendingPhasePage
      eyebrow="Comandos"
      title="Comandos"
      description="Ejecución gobernada de comandos sensibles vía SecureCommand."
      pendingPhase="Fase E — SecureCommand"
      noticeTitle="Este panel no tiene ningún endpoint que consultar todavía"
      noticeDescription="La lógica de aprobación, auditoría e idempotencia de SecureCommand ya existe en el backend (command-approval.service.ts, command-audit.service.ts, command-idempotency.service.ts), pero el módulo no tiene ningún @Controller HTTP registrado — cero endpoints expuestos. No hay nada que este panel pueda consultar hasta que se construya ese controller en la Fase E."
      data-testid="sofia-commands-page"
    />
  );
}
