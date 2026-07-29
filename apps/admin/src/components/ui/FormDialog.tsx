'use client';

import { type ReactNode } from 'react';

interface FormDialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Dialog width, e.g. '440px'. Defaults to 480px. */
  width?: string;
}

/**
 * Shared modal shell replacing the hand-rolled `fixed inset-0` overlays
 * duplicated across feature clients. Closes on backdrop click and ✕.
 */
export function FormDialog({ open, title, onClose, children, width = '480px' }: FormDialogProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="rounded-xl border border-[var(--rim1)] bg-[var(--surface)] p-5"
        style={{ width, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-bold text-[var(--t1)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer border-none bg-transparent text-lg text-[var(--t2)]"
            aria-label="إغلاق"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
