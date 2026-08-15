import { Button } from '@/components/ui/button';

export function PaginationBar({
  page,
  limit,
  total,
  itemsLabel,
  onPrev,
  onNext,
  'data-testid': testId,
}: {
  page: number;
  limit: number;
  total: number;
  itemsLabel: string;
  onPrev: () => void;
  onNext: () => void;
  'data-testid'?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;

  return (
    <div className="flex items-center justify-between gap-3 pt-1" data-testid={testId}>
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={onPrev}>
        Anterior
      </Button>
      <span className="text-[12px] font-medium text-stone-600">
        Página {page} de {pages} · {total} {itemsLabel}
      </span>
      <Button variant="secondary" size="sm" disabled={page >= pages} onClick={onNext}>
        Siguiente
      </Button>
    </div>
  );
}
