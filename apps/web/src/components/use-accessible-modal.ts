'use client';

import { useEffect, useRef, type KeyboardEvent } from 'react';

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useAccessibleModal<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const panelRef = useRef<T>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    const inerted = new Map<HTMLElement, boolean>();
    let modalRoot = panelRef.current?.closest<HTMLElement>('[data-modal-root]') ?? null;
    while (modalRoot?.parentElement) {
      for (const sibling of Array.from(modalRoot.parentElement.children)) {
        if (sibling instanceof HTMLElement && sibling !== modalRoot && !inerted.has(sibling)) {
          inerted.set(sibling, sibling.inert);
          sibling.inert = true;
        }
      }
      modalRoot = modalRoot.parentElement;
      if (modalRoot === document.body) break;
    }

    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => {
      const first = panelRef.current?.querySelector<HTMLElement>(focusableSelector);
      (first ?? panelRef.current)?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      for (const [element, wasInert] of inerted) element.inert = wasInert;
      previousFocusRef.current?.focus();
    };
  }, [open]);

  const handleKeyDown = (event: KeyboardEvent<T>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !panelRef.current) return;

    const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(focusableSelector));
    if (focusable.length === 0) {
      event.preventDefault();
      panelRef.current.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return { panelRef, handleKeyDown };
}
