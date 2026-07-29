'use client';

import { ReactNode, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface ConfirmDialogProps {
  /** The trigger element (e.g. a button). Clicking it opens the confirmation. */
  children: ReactNode;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true, the confirm button uses the destructive (crimson) style. */
  destructive?: boolean;
  /** Disables the confirm button and shows a pending label while an action runs. */
  pending?: boolean;
  onConfirm: () => void;
}

/**
 * Reusable confirmation dialog for destructive/irreversible actions.
 * Replaces native `confirm()` with an RTL, themed Radix dialog.
 */
export function ConfirmDialog({
  children,
  title,
  description,
  confirmLabel = 'تأكيد',
  cancelLabel = 'إلغاء',
  destructive = true,
  pending = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [open, setOpen] = useState(false);

  const handleConfirm = () => {
    onConfirm();
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div onClick={() => setOpen(true)} className="contents">
        {children}
      </div>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="text-right text-[var(--t1)]">{title}</DialogTitle>
          {description && (
            <DialogDescription className="text-right text-[var(--t2)]">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter className="sm:justify-start gap-2">
          <Button
            onClick={handleConfirm}
            disabled={pending}
            className={
              destructive
                ? 'bg-[var(--crimson)] text-white hover:opacity-90'
                : 'bg-[var(--emerald)] text-white hover:opacity-90'
            }
          >
            {pending ? '...' : confirmLabel}
          </Button>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {cancelLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
