import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";

export type ContextMenuItem =
  | {
      label: string;
      onClick: () => void;
      destructive?: boolean;
      disabled?: boolean;
      icon?: LucideIcon;
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
      className="fixed z-50 min-w-44 rounded-md border border-border bg-card py-1 shadow-lg animate-enter-up"
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
            disabled={item.disabled}
            className={`flex w-full items-center gap-3 px-3 py-1.5 text-xs transition-colors disabled:opacity-40 ${
              item.destructive
                ? "text-red-400 hover:bg-destructive/20"
                : "text-foreground hover:bg-secondary"
            }`}
          >
            <span className="flex-1 text-left">{item.label}</span>
            {item.icon && (
              <item.icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
            )}
          </button>
        ),
      )}
    </div>
  );
}
