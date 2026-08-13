import type { Key, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface DataTableColumn<Row> {
  id: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  className?: string;
  mobileLabel?: string;
  numeric?: boolean;
}

export function DataTableShell<Row>({
  rows,
  columns,
  rowKey,
  caption,
  rowActions,
  className,
  density = 'comfortable',
}: {
  rows: readonly Row[];
  columns: readonly DataTableColumn<Row>[];
  rowKey: (row: Row) => Key;
  caption: string;
  rowActions?: (row: Row) => ReactNode;
  className?: string;
  density?: 'comfortable' | 'compact';
}) {
  return (
    <div className={cn('overflow-hidden rounded-2xl border border-line bg-panel shadow-sm', className)}>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="border-b border-line bg-canvas/80 text-xs uppercase tracking-[0.08em] text-muted">
            <tr>
              {columns.map((column) => (
                <th key={column.id} scope="col" className={cn('font-semibold', density === 'compact' ? 'px-3 py-2' : 'px-4 py-3', column.className)}>
                  {column.header}
                </th>
              ))}
              {rowActions ? <th scope="col" className={cn('w-14', density === 'compact' ? 'px-3 py-2' : 'px-4 py-3')}><span className="sr-only">Acciones</span></th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={rowKey(row)} className="transition-colors hover:bg-canvas/55 focus-within:bg-canvas/55">
                {columns.map((column) => (
                  <td
                    key={column.id}
                    className={cn('align-middle text-ink', density === 'compact' ? 'px-3 py-2.5' : 'px-4 py-3.5', column.numeric && 'tabular-nums', column.className)}
                  >
                    {column.cell(row)}
                  </td>
                ))}
                {rowActions ? <td className={cn('text-right', density === 'compact' ? 'px-3 py-1.5' : 'px-4 py-2')}>{rowActions(row)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-line md:hidden" aria-label={caption}>
        {rows.map((row) => (
          <li key={rowKey(row)} className={cn(density === 'compact' ? 'p-3' : 'p-4')}>
            <dl className="grid gap-3">
              {columns.map((column) => (
                <div key={column.id} className="grid grid-cols-[minmax(6.5rem,0.8fr)_minmax(0,1.2fr)] gap-3">
                  <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
                    {column.mobileLabel ?? column.header}
                  </dt>
                  <dd className={cn('min-w-0 text-sm text-ink', column.numeric && 'tabular-nums')}>{column.cell(row)}</dd>
                </div>
              ))}
            </dl>
            {rowActions ? <div className="mt-4 flex min-h-11 justify-end border-t border-line pt-3">{rowActions(row)}</div> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
