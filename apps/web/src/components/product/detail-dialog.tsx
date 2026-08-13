'use client';

import { useId, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAccessibleModal } from '@/components/use-accessible-modal';

export function DetailDialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  mode = 'drawer',
  closeLabel = 'Cerrar panel',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  mode?: 'drawer' | 'dialog';
  closeLabel?: string;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const { panelRef, handleKeyDown } = useAccessibleModal<HTMLDivElement>(open, onClose);

  if (!open) return null;

  return (
    <div data-modal-root className="fixed inset-0 z-[100] flex items-end justify-center bg-ink/45 p-0 backdrop-blur-[2px] motion-reduce:backdrop-blur-none sm:items-center sm:p-4">
      <button type="button" className="absolute inset-0 cursor-default" aria-label={closeLabel} onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={cn(
          'relative flex max-h-[92dvh] w-full flex-col border border-line bg-panel shadow-2xl outline-none',
          'motion-safe:transition motion-safe:duration-200',
          mode === 'drawer'
            ? 'rounded-t-3xl sm:ml-auto sm:h-full sm:max-h-none sm:max-w-xl sm:rounded-none sm:border-y-0 sm:border-r-0'
            : 'rounded-t-3xl sm:max-w-2xl sm:rounded-3xl',
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id={titleId} className="font-heading text-xl font-bold tracking-tight text-ink">{title}</h2>
            {description ? <p id={descriptionId} className="mt-1 text-sm leading-6 text-muted">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line text-muted transition hover:bg-canvas hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
        {footer ? <footer className="border-t border-line bg-canvas/70 px-5 py-4 sm:px-6">{footer}</footer> : null}
      </div>
    </div>
  );
}
