import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export function CommandSearch({
  onOpen,
  label = 'Buscar clientes, pedidos y conversaciones',
  shortcut = 'Ctrl K',
  className,
}: {
  onOpen: () => void;
  label?: string;
  shortcut?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className={cn(
        'flex min-h-11 w-full items-center gap-3 rounded-xl border border-line bg-panel px-3 text-left text-sm text-muted shadow-sm transition',
        'hover:border-brand-300 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
        className,
      )}
    >
      <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <kbd className="hidden rounded-md border border-line bg-canvas px-2 py-1 font-sans text-[11px] font-semibold text-muted sm:inline-flex">
        {shortcut}
      </kbd>
    </button>
  );
}
