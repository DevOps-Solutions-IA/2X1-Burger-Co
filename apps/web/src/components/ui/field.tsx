'use client';

import React, { useId } from 'react';

type FieldControlAriaProps = {
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
};

export function Field({
  label,
  children,
  hint,
  error,
  required,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  error?: string | null;
  required?: boolean;
}) {
  const errorId = useId();
  const hintId = useId();

  const childWithAria = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<FieldControlAriaProps>, {
        'aria-describedby': error ? errorId : hint ? hintId : undefined,
        'aria-invalid': error ? true : undefined,
      })
    : children;

  return (
    <label className="block space-y-2">
      <span className="flex flex-wrap items-center gap-2 text-[12px] font-semibold tracking-[0.01em] text-stone-700">
        {label}
        {required ? (
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-brand-900">
            Obligatorio
          </span>
        ) : null}
      </span>
      {childWithAria}
      {error ? (
        <span id={errorId} role="alert" className="block text-[12px] font-medium leading-5 text-danger">
          {error}
        </span>
      ) : null}
      {!error && hint ? (
        <span id={hintId} className="block text-[11px] leading-5 text-stone-500">
          {hint}
        </span>
      ) : null}
    </label>
  );
}
