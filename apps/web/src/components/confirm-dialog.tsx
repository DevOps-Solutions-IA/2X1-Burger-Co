'use client';

import { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (open) {
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onCancel();
      };
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
      return () => {
        document.removeEventListener('keydown', handleEscape);
        document.body.style.overflow = '';
      };
    }
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-message"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-stone-950/40 backdrop-blur-[1px]" onClick={onCancel} />
      <div className="relative w-full max-w-md rounded-[1.35rem] border border-stone-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-stone-100 px-5 py-4">
          <div className="flex items-start gap-3">
            {destructive ? (
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50" aria-hidden="true">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
            ) : null}
            <div>
              <h2 id="confirm-dialog-title" className="text-base font-semibold text-stone-900">{title}</h2>
            </div>
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-500 transition hover:border-stone-300 hover:text-stone-700"
            onClick={onCancel}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          <p id="confirm-dialog-message" className="text-sm leading-6 text-stone-600">{message}</p>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-stone-100 px-5 py-4">
          <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            size="sm"
            className={destructive ? 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-500 text-white' : ''}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
