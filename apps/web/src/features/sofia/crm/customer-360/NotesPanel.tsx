'use client';

import { useState, type FormEvent } from 'react';
import { StickyNote } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Textarea } from '@/components/ui/textarea';
import { Pager, QueryStateBoundary } from '@/components/sofia';
import { ApiError } from '@/lib/api';
import { useSofiaCrmCreateNote, useSofiaCrmNotes } from '@/features/sofia/queries';
import { formatDateTime } from '@/lib/format';

const PAGE_SIZE = 10;

export function NotesPanel({ customerId }: { customerId: string }) {
  const [page, setPage] = useState(1);
  const [body, setBody] = useState('');
  const notes = useSofiaCrmNotes({ customerId, page, limit: PAGE_SIZE });
  const createNote = useSofiaCrmCreateNote();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;

    createNote.mutate(
      {
        customerId,
        source: 'CRM_CUSTOMER_360',
        sourceReference: customerId,
        body: trimmed,
      },
      {
        onSuccess: () => {
          toast.success('Nota agregada');
          setBody('');
          setPage(1);
        },
        onError: (error) => {
          toast.error(error instanceof ApiError ? error.message : 'No se pudo guardar la nota.');
        },
      },
    );
  }

  return (
    <div className="space-y-3" data-testid="sofia-customer360-notes-panel">
      <Card>
        <h3 className="text-[13.5px] font-extrabold text-ink">Nueva nota</h3>
        <p className="mt-0.5 text-[12px] text-stone-600">Información interna del equipo sobre este cliente.</p>
        <form className="mt-3 space-y-2.5" onSubmit={handleSubmit}>
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Escribe una nota sobre este cliente…"
            className="min-h-[5rem]"
            data-testid="sofia-customer360-note-input"
          />
          {createNote.isError && (
            <p className="text-[12px] font-semibold text-red-700" role="alert">
              {createNote.error instanceof ApiError ? createNote.error.message : 'No se pudo guardar la nota.'}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={createNote.isPending || !body.trim()} data-testid="sofia-customer360-note-submit">
              {createNote.isPending ? 'Guardando…' : 'Agregar nota'}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <h3 className="text-[13.5px] font-extrabold text-ink">Notas registradas</h3>

        <QueryStateBoundary
          isLoading={notes.isLoading}
          isError={notes.isError}
          error={notes.error}
          data={notes.data}
          loadingLabel="Cargando notas del cliente…"
          errorTitle="No se pudo cargar las notas"
        >
          {(result) => (
            <>
              {result.data.length === 0 ? (
                <div className="mt-3">
                  <EmptyState icon={<StickyNote className="h-5 w-5" aria-hidden="true" />} title="Sin notas" description="Este cliente no tiene notas registradas." />
                </div>
              ) : (
                <ul className="mt-3 space-y-2">
                  {result.data.map((note) => (
                    <li key={note.id} className="rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5">
                      <div className="flex items-start gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-stone-600 shadow-sm" aria-hidden="true">
                          <StickyNote className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[12.5px] leading-5 text-ink">{note.sanitizedBody ?? note.body ?? ''}</p>
                          <p className="mt-1 text-[11px] text-stone-600">
                            {note.author ? note.author.fullName : 'Autor no disponible'} &middot; {formatDateTime(note.createdAt)}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3">
                <Pager
                  page={result.pagination.page}
                  limit={result.pagination.limit}
                  total={result.pagination.total}
                  pages={result.pagination.pages}
                  itemsLabel="notas"
                  onPrev={() => setPage((current) => Math.max(1, current - 1))}
                  onNext={() => setPage((current) => Math.min(Math.max(1, result.pagination.pages), current + 1))}
                  data-testid="sofia-customer360-notes-pagination"
                />
              </div>
            </>
          )}
        </QueryStateBoundary>
      </Card>
    </div>
  );
}
