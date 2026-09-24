"use client";

import { type ReactNode, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ConfirmDialogProps {
  /** The trigger element (e.g. a button). Clicking it opens the confirmation. */
  children: ReactNode;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true, the confirm button uses the destructive style. */
  destructive?: boolean;
  /** Disables the confirm button and shows a pending label while an action runs. */
  pending?: boolean;
  onConfirm: () => void | Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "تعذر إتمام الإجراء";
}

/** Reusable confirmation dialog for destructive or irreversible actions. */
export function ConfirmDialog({
  children,
  title,
  description,
  confirmLabel = "تأكيد",
  cancelLabel = "إلغاء",
  destructive = true,
  pending = false,
  onConfirm,
}: ConfirmDialogProps) {
  const [open, setOpen] = useState(false);
  const [internalPending, setInternalPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPending = pending || internalPending;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isPending) return;
    if (nextOpen) setError(null);
    setOpen(nextOpen);
  };

  const handleConfirm = async () => {
    setInternalPending(true);
    setError(null);

    try {
      await onConfirm();
      setOpen(false);
    } catch (cause: unknown) {
      setError(errorMessage(cause));
    } finally {
      setInternalPending(false);
    }
  };

  const preventCloseWhilePending = (event: Event) => {
    if (isPending) event.preventDefault();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        className="bg-[var(--surface)] text-[var(--text-primary)] sm:max-w-[400px]"
        onEscapeKeyDown={preventCloseWhilePending}
        onPointerDownOutside={preventCloseWhilePending}
      >
        <DialogHeader>
          <DialogTitle className="text-start text-[var(--text-primary)]">
            {title}
          </DialogTitle>
          {description && (
            <DialogDescription className="text-start text-[var(--text-secondary)]">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>
        {error && (
          <p
            role="alert"
            className="rounded-md bg-[var(--critical-bg)] p-3 text-sm text-[var(--critical)]"
          >
            {error}
          </p>
        )}
        <DialogFooter className="gap-2 sm:justify-start">
          <Button
            onClick={handleConfirm}
            disabled={isPending}
            aria-busy={isPending}
            className={
              destructive
                ? "border border-[var(--critical)] bg-[var(--critical-bg)] text-[var(--critical)] hover:opacity-90"
                : "border border-[var(--success)] bg-[var(--success-bg)] text-[var(--success)] hover:opacity-90"
            }
          >
            {isPending ? "..." : confirmLabel}
          </Button>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isPending}
          >
            {cancelLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
