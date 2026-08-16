import { cn } from '@/lib/utils';
import {
  SOFIA_STATUS_TONE_BADGE_CLASS,
  SOFIA_STATUS_TONE_CONSOLE_BADGE_CLASS,
  SOFIA_STATUS_TONE_CONSOLE_DOT_CLASS,
  SOFIA_STATUS_TONE_DOT_CLASS,
  SOFIA_STATUS_TONE_LABEL,
  type SofiaStatusTone,
} from './status-tone';

export function StatusBadge({
  tone,
  label,
  withDot = true,
  live = false,
  variant = 'light',
  className,
  'data-testid': testId,
}: {
  tone: SofiaStatusTone;
  label?: string;
  withDot?: boolean;
  /** Añade un halo `animate-ping` al punto — reservado a estados que representan el pulso operativo actual (ej. canal conectado). */
  live?: boolean;
  variant?: 'light' | 'console';
  className?: string;
  'data-testid'?: string;
}) {
  const isConsole = variant === 'console';
  const dotColor = isConsole ? SOFIA_STATUS_TONE_CONSOLE_DOT_CLASS[tone] : SOFIA_STATUS_TONE_DOT_CLASS[tone];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none',
        isConsole ? SOFIA_STATUS_TONE_CONSOLE_BADGE_CLASS[tone] : SOFIA_STATUS_TONE_BADGE_CLASS[tone],
        className,
      )}
      data-testid={testId}
    >
      {withDot && (
        <span className="relative inline-flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
          {live && <span className={cn('absolute inline-flex h-1.5 w-1.5 animate-ping rounded-full opacity-60', dotColor)} />}
          <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', dotColor)} />
        </span>
      )}
      {label ?? SOFIA_STATUS_TONE_LABEL[tone]}
    </span>
  );
}
