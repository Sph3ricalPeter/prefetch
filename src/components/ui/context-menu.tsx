import { useEffect, useRef } from "react";

export type ContextMenuItem =
  | { label: string; onClick: () => void; destructive?: boolean; disabled?: boolean }
  | { separator: true };

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Adjust position to stay within viewport
  const style: React.CSSProperties = {
    left: `${x}px`,
    top: `${y}px`,
  };

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-44 rounded-md border border-border bg-card py-1 shadow-lg"
      style={style}
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
            className={`flex w-full items-center px-3 py-1.5 text-xs transition-colors disabled:opacity-40 ${
              item.destructive
                ? "text-red-400 hover:bg-destructive/20"
                : "text-foreground hover:bg-secondary"
            }`}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
