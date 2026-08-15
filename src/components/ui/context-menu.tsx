import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePausedOperation } from "@/hooks/use-paused-operation";

export type ContextMenuItem =
  | {
      label: string;
      onClick: () => void;
      destructive?: boolean;
      disabled?: boolean;
      icon?: LucideIcon;
      /** Overrides the icon's default muted styling (e.g. ours/theirs colors). */
      iconClassName?: string;
      /** Moves HEAD, rewrites the index, or touches the working tree. Such items
       *  are disabled automatically while a rebase/merge/cherry-pick/revert is
       *  paused, so builders only have to tag them — no `blocked` parameter has
       *  to be threaded through their (already long) signatures. */
      writesRepo?: boolean;
    }
  | { separator: true };

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  // A paused operation disables every repo-writing item. Read-only entries
  // (copy, open in browser) stay live so the menu keeps its useful half.
  const pausedOperation = usePausedOperation();
  const suppressedByOperation =
    pausedOperation !== null && items.some((i) => !("separator" in i) && i.writesRepo);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 4;
    let left = x;
    let top = y;
    if (left + rect.width > vw - pad) left = vw - rect.width - pad;
    if (top + rect.height > vh - pad) top = vh - rect.height - pad;
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Stop the global Escape stack (App.tsx) from also acting when a menu closes.
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-44 rounded-md border border-foreground/15 bg-card py-1 shadow-xl animate-enter-up"
      style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
    >
      {items.map((item, i) =>
        "separator" in item ? (
          <div key={i} className="mx-2 my-1 border-t border-border" />
        ) : (
          <button
            key={i}
            onClick={() => {
              item.onClick();
              onClose();
            }}
            disabled={item.disabled || (pausedOperation !== null && item.writesRepo)}
            className={`flex w-full items-center gap-3 px-3 py-1.5 text-xs transition-colors disabled:pointer-events-none disabled:opacity-40 ${
              item.destructive
                ? "text-red-400 hover:bg-destructive/20"
                : "text-foreground hover:bg-secondary"
            }`}
          >
            <span className="flex-1 text-left">{item.label}</span>
            {item.icon && (
              <item.icon className={cn("h-3.5 w-3.5 shrink-0 opacity-70", item.iconClassName)} />
            )}
          </button>
        ),
      )}
      {suppressedByOperation && (
        <>
          <div className="mx-2 my-1 border-t border-border" />
          <p className="px-3 py-1 text-label text-faint">
            {pausedOperation} in progress — some actions disabled
          </p>
        </>
      )}
    </div>
  );
}
