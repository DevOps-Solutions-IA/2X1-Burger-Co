import type { CSSProperties, Key, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface DataTableColumn<Row> {
  id: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  className?: string;
  mobileLabel?: string;
  numeric?: boolean;
}

export function boundRowsForRendering<Row>(rows: readonly Row[], renderLimit = 100) {
  const boundedLimit = Number.isFinite(renderLimit) ? Math.max(1, Math.floor(renderLimit)) : 100;
  const visibleRows = rows.slice(0, boundedLimit);
  return {
    visibleRows,
    hiddenRowCount: rows.length - visibleRows.length,
  };
}

export function DataTableShell<Row>({
  rows,
  columns,
  rowKey,
  caption,
  rowActions,
  className,
  density = 'comfortable',
  renderLimit = 100,
}: {
  rows: readonly Row[];
  columns: readonly DataTableColumn<Row>[];
  rowKey: (row: Row) => Key;
  caption: string;
  rowActions?: (row: Row) => ReactNode;
  className?: string;
  density?: 'comfortable' | 'compact';
  renderLimit?: number;
}) {
  const { visibleRows, hiddenRowCount } = boundRowsForRendering(rows, renderLimit);
  const gridTemplateColumns = [
    ...columns.map((column) => column.numeric ? 'minmax(8rem, 0.75fr)' : 'minmax(10rem, 1fr)'),
    ...(rowActions ? ['minmax(5.5rem, 0.45fr)'] : []),
  ].join(' ');
  const gridStyle = { '--data-table-columns': gridTemplateColumns } as CSSProperties;

  return (
    <div className={cn('min-w-0 max-w-full overflow-hidden rounded-2xl border border-line bg-panel shadow-sm', className)}>
      <div role="table" aria-label={caption} aria-rowcount={rows.length + 1} tabIndex={0} className="w-full max-w-full overflow-x-auto text-sm">
        <div role="rowgroup" className="hidden min-w-max border-b border-line bg-canvas/80 text-xs uppercase tracking-[0.08em] text-muted lg:block">
          <div role="row" style={gridStyle} className="grid grid-cols-[var(--data-table-columns)]">
            {columns.map((column) => (
              <div key={column.id} role="columnheader" className={cn('font-semibold', density === 'compact' ? 'px-3 py-2' : 'px-4 py-3', column.className)}>
                {column.header}
              </div>
            ))}
            {rowActions ? <div role="columnheader" className={cn(density === 'compact' ? 'px-3 py-2' : 'px-4 py-3')}><span className="sr-only">Acciones</span></div> : null}
          </div>
        </div>

        <div role="rowgroup" className="divide-y divide-line">
          {visibleRows.map((row, rowIndex) => (
            <div
              key={rowKey(row)}
              role="row"
              aria-rowindex={rowIndex + 2}
              style={gridStyle}
              className={cn(
                'grid min-w-0 gap-3 transition-colors hover:bg-canvas/55 focus-within:bg-canvas/55 lg:min-w-max lg:grid-cols-[var(--data-table-columns)] lg:gap-0',
                density === 'compact' ? 'p-3 lg:p-0' : 'p-4 lg:p-0',
              )}
            >
              {columns.map((column) => (
                <div
                  key={column.id}
                  role="cell"
                  className={cn(
                    'grid min-w-0 grid-cols-[minmax(6.5rem,0.8fr)_minmax(0,1.2fr)] gap-3 text-ink lg:block lg:align-middle',
                    density === 'compact' ? 'lg:px-3 lg:py-2.5' : 'lg:px-4 lg:py-3.5',
                    column.numeric && 'tabular-nums',
                    column.className,
                  )}
                >
                  <span className="text-xs font-semibold uppercase tracking-[0.06em] text-muted lg:hidden">
                    {column.mobileLabel ?? column.header}
                  </span>
                  <span className="min-w-0">{column.cell(row)}</span>
                </div>
              ))}
              {rowActions ? (
                <div role="cell" className={cn('flex min-h-11 justify-end border-t border-line pt-3 lg:block lg:border-0 lg:text-right', density === 'compact' ? 'lg:px-3 lg:py-1.5' : 'lg:px-4 lg:py-2')}>
                  <span className="sr-only">Acciones: </span>{rowActions(row)}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      {hiddenRowCount > 0 ? (
        <p role="status" className="border-t border-line bg-canvas px-4 py-3 text-sm text-muted">
          Se muestran {visibleRows.length} de {rows.length} filas. Ajusta los filtros o la paginación para consultar el resto.
        </p>
      ) : null}
    </div>
  );
}
