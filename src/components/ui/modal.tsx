import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { useEscapeKey } from "@/hooks/use-escape-key";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /**
   * Classes for the centered panel. The shell guarantees an opaque surface
   * (`bg-card shadow-lg`) plus the rounded border and enter animation, so a
   * panel can never render transparent. Callers supply sizing and padding, and
   * may override the surface (e.g. `shadow-xl`) via the usual last-wins merge.
   */
  className?: string;
  /** Close when the backdrop (not the panel) is clicked. Default true. */
  closeOnBackdrop?: boolean;
}

/**
 * Shared modal shell: a fixed full-screen backdrop with a centered, animated
 * panel. Owns Escape-to-close (via {@link useEscapeKey}, which stops the global
 * Escape stack in App.tsx) and click-outside-to-close.
 *
 * The backdrop keeps the `inset-0 z-50` classes the EscapeStack in App.tsx
 * looks for to know a modal is open — don't drop them.
 */
export function Modal({
  open,
  onClose,
  children,
  className,
  closeOnBackdrop = true,
}: ModalProps) {
  useEscapeKey(open, onClose);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in"
      onMouseDown={
        closeOnBackdrop
          ? (e) => {
              if (e.target === e.currentTarget) onClose();
            }
          : undefined
      }
    >
      <div
        className={cn(
          "rounded-lg border border-border bg-card shadow-lg animate-enter-up",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Extra body content (e.g. an input) rendered between description and footer. */
  children?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  /** Style the confirm button as a destructive action. */
  destructive?: boolean;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  /** Sizing classes for the panel. Defaults to `max-w-xs`. */
  className?: string;
}

const CANCEL_BUTTON =
  "rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors whitespace-nowrap";

const PRIMARY_BUTTON =
  "rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap";

const DESTRUCTIVE_BUTTON =
  "rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 hover:-translate-y-px transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 whitespace-nowrap";

/**
 * Standard confirm/prompt dialog built on {@link Modal}: title, optional
 * description, optional body (e.g. an input passed as children), and a
 * Cancel / confirm button row. Confirm can be styled destructive.
 */
export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  children,
  confirmLabel,
  onConfirm,
  destructive = false,
  cancelLabel = "Cancel",
  confirmDisabled = false,
  className,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      className={cn("p-4", className ?? "max-w-xs")}
    >
      <p className="text-sm text-foreground mb-1">{title}</p>
      {description && (
        <p className="text-xs text-muted-foreground mb-4">{description}</p>
      )}
      {children}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className={CANCEL_BUTTON}>
          {cancelLabel}
        </button>
        <button
          onClick={onConfirm}
          disabled={confirmDisabled}
          className={destructive ? DESTRUCTIVE_BUTTON : PRIMARY_BUTTON}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
