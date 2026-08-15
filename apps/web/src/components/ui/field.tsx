'use client';

import React, { useId } from 'react';

type FieldControlAriaProps = {
  'aria-describedby'?: string;
  'aria-invalid'?: React.AriaAttributes['aria-invalid'];
  'aria-required'?: React.AriaAttributes['aria-required'];
  required?: boolean;
};

function mergeDescriptionIds(current: string | undefined, fieldDescription: string | undefined) {
  return Array.from(
    new Set(
      `${current ?? ''} ${fieldDescription ?? ''}`
        .trim()
        .split(/\s+/)
        .filter(Boolean),
    ),
  ).join(' ') || undefined;
}

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

  const childWithAria = React.isValidElement<FieldControlAriaProps>(children)
    ? React.cloneElement(children, {
        'aria-describedby': mergeDescriptionIds(
          children.props['aria-describedby'],
          error ? errorId : hint ? hintId : undefined,
        ),
        'aria-invalid': error ? true : children.props['aria-invalid'],
        'aria-required': required ? true : children.props['aria-required'],
        required: required ? true : children.props.required,
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
