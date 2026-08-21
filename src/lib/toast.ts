import { createElement } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { IconButton } from "@/components/ui/icon-button";
import { CopyButton } from "@/components/ui/copy-button";
import { actionIcon, type ActionName } from "@/lib/action-icons";

/** Safely extract an error message string from an unknown catch value. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

let errorSeq = 0;

/** The action's own icon at toast size, tinted for the outcome. */
function outcomeIcon(action: string, tint: string) {
  const Icon = actionIcon(action);
  return Icon ? createElement(Icon, { className: `h-4 w-4 ${tint}` }) : undefined;
}

/**
 * Report a finished operation.
 *
 * The icon slot carries status while an operation is in flight — that's what
 * the spinner on a `toast.loading` is for — and switches to the action's own
 * icon the moment it settles, so a toast that lingers still says which action
 * it belongs to. `message` is the toast text ("Checked out feat/x"); `action`
 * only picks the icon.
 */
/** Success tint of an action's icon, for the few toasts that can't use showSuccess. */
export function successIcon(action: ActionName | (string & {})) {
  return outcomeIcon(action, "text-green-500");
}

export function showSuccess(
  action: ActionName | (string & {}),
  message: string,
  opts?: { id?: string | number },
): string | number {
  return toast.success(message, {
    id: opts?.id,
    icon: outcomeIcon(action, "text-green-500"),
  });
}

/**
 * Report a failed operation.
 *
 * Differs from a plain `toast.error` on three counts, all of which only make
 * sense when something actually threw: it names the action that failed (a bare
 * git error like "fatal: refusing to merge unrelated histories" doesn't say
 * which button caused it), it stays up until dismissed, and it carries a copy
 * button — git and hook output runs long and the toast clamps it to four lines.
 *
 * Validation messages ("Commit message cannot be empty") keep using
 * `toast.error` — they must not sit on screen until clicked.
 *
 * `action` is typed loosely so dynamic titles (a hook name, a merge-like
 * operation label) still pass, while the known names autocomplete and pull
 * their icon from the app-wide registry.
 */
export function showError(
  action: ActionName | (string & {}),
  detail: unknown,
  opts?: { id?: string | number },
): string | number {
  const message = errorMessage(detail);
  // Actions absent from ACTION_ICONS are internal loaders ("Load Status",
  // "Load Diff") rather than something the user invoked — and some of them are
  // polled every few seconds. Giving those a stable id keyed on the action
  // collapses a repeating failure into one toast instead of spawning a new
  // undismissable one per tick, and a finite duration lets it clear once the
  // underlying problem goes away. User-invoked failures keep the sticky toast.
  const isInternal = actionIcon(action) === undefined;
  const id = opts?.id ?? (isInternal ? `error-${action}` : `error-${errorSeq++}`);
  return toast.error(action, {
    id,
    icon: outcomeIcon(action, "text-destructive"),
    description: message,
    duration: isInternal ? 8000 : Infinity,
    // Copy and dismiss go in sonner's action slot rather than using its
    // `closeButton`, which floats an X outside the top-left corner — the
    // multi-step toast puts both inline at the top right, and one toast
    // shouldn't disagree with the other about where its controls live.
    action: createElement(
      "div",
      { className: "ml-auto flex shrink-0 items-center gap-0.5 self-start" },
      createElement(CopyButton, { key: "copy", text: `${action}\n\n${message}`, title: "Copy full error" }),
      createElement(
        IconButton,
        { key: "close", size: "sm", variant: "subtle", title: "Dismiss", onClick: () => toast.dismiss(id) },
        createElement(X, { className: "h-3.5 w-3.5" }),
      ),
    ),
  });
}
