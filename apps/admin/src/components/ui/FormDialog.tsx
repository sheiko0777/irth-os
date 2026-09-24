"use client";

import { type CSSProperties, type ReactNode, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface FormDialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Dialog width, e.g. '440px'. Defaults to 480px. */
  width?: string;
}

function hasPendingSubmit(content: HTMLDivElement | null): boolean {
  if (!content) return false;

  return Boolean(
    content.querySelector(
      'button[type="submit"]:disabled, input[type="submit"]:disabled, [aria-busy="true"]',
    ),
  );
}

/** Accessible form shell: a full-height mobile sheet and a centered desktop dialog. */
export function FormDialog({
  open,
  title,
  onClose,
  children,
  width = "480px",
}: FormDialogProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const preventCloseWhileSubmitting = (event: Event) => {
    if (hasPendingSubmit(contentRef.current)) event.preventDefault();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !hasPendingSubmit(contentRef.current)) onClose();
      }}
    >
      <DialogContent
        ref={contentRef}
        className="bottom-0 left-0 top-auto h-[100dvh] max-h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-none border-x-0 border-b-0 bg-[var(--surface)] p-5 text-[var(--text-primary)] sm:bottom-auto sm:left-[50%] sm:top-[50%] sm:h-auto sm:max-h-[90vh] sm:w-[var(--form-dialog-width)] sm:max-w-[calc(100vw-2rem)] sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-xl sm:border"
        style={{ "--form-dialog-width": width } as CSSProperties}
        onEscapeKeyDown={preventCloseWhileSubmitting}
        onPointerDownOutside={preventCloseWhileSubmitting}
      >
        <DialogHeader className="mb-1 pe-10 text-start">
          <DialogTitle className="text-base font-bold text-[var(--text-primary)]">
            {title}
          </DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
