import { Button } from '@/components/ui/button';

export function Pager({
  page,
  limit,
  total,
  onPageChange,
  'data-testid': testId,
}: {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
  'data-testid'?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const canPrev = page > 1;
  const canNext = page < totalPages;

  if (total === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-1" data-testid={testId}>
      <p className="text-[12px] font-medium text-stone-600">
        Página {page} de {totalPages} · {total} {total === 1 ? 'registro' : 'registros'}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!canPrev}
          onClick={() => onPageChange(page - 1)}
          data-testid={testId ? `${testId}-prev` : undefined}
        >
          Anterior
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!canNext}
          onClick={() => onPageChange(page + 1)}
          data-testid={testId ? `${testId}-next` : undefined}
        >
          Siguiente
        </Button>
      </div>
    </div>
  );
}
