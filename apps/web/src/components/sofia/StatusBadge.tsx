import { cn } from '@/lib/utils';
import {
  SOFIA_STATUS_TONE_BADGE_CLASS,
  SOFIA_STATUS_TONE_DOT_CLASS,
  SOFIA_STATUS_TONE_LABEL,
  type SofiaStatusTone,
} from './status-tone';

export function StatusBadge({
  tone,
  label,
  withDot = true,
  className,
  'data-testid': testId,
}: {
  tone: SofiaStatusTone;
  label?: string;
  withDot?: boolean;
  className?: string;
  'data-testid'?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none',
        SOFIA_STATUS_TONE_BADGE_CLASS[tone],
        className,
      )}
      data-testid={testId}
    >
      {withDot && <span className={cn('h-1.5 w-1.5 rounded-full', SOFIA_STATUS_TONE_DOT_CLASS[tone])} aria-hidden="true" />}
      {label ?? SOFIA_STATUS_TONE_LABEL[tone]}
    </span>
  );
}
