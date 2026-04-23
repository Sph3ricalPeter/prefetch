import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface ResizeHandleProps {
  /** Which side of this handle has the panel being resized */
  side: "left" | "right";
  /** Ref to the panel element being resized */
  panelRef: React.RefObject<HTMLDivElement | null>;
  /** Min width in px */
  minWidth?: number;
  /** Max width in px */
  maxWidth?: number;
  /** Called with the final width when the user finishes dragging */
  onResizeEnd?: (width: number) => void;
}

export function ResizeHandle({
  side,
  panelRef,
  minWidth = 192,
  maxWidth = 480,
  onResizeEnd,
}: ResizeHandleProps) {
  const [isDragging, setIsDragging] = useState(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const panel = panelRef.current;
      if (!panel) return;

      startX.current = e.clientX;
      startWidth.current = panel.getBoundingClientRect().width;
      setIsDragging(true);
    },
    [panelRef],
  );

  useEffect(() => {
    if (!isDragging) return;

    const onMouseMove = (e: MouseEvent) => {
      const panel = panelRef.current;
      if (!panel) return;

      const delta = e.clientX - startX.current;
      const newWidth =
        side === "left"
          ? startWidth.current + delta
          : startWidth.current - delta;

      const clamped = Math.max(minWidth, Math.min(maxWidth, newWidth));
      panel.style.width = `${clamped}px`;
    };

    const onMouseUp = () => {
      setIsDragging(false);
      if (onResizeEnd) {
        const panel = panelRef.current;
        if (panel) {
          onResizeEnd(Math.round(panel.getBoundingClientRect().width));
        }
      }
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);

    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [isDragging, side, panelRef, minWidth, maxWidth, onResizeEnd]);

  return (
    <div
      onMouseDown={onMouseDown}
      className={cn(
        "relative w-px shrink-0 cursor-col-resize transition-colors",
        "before:absolute before:inset-y-0 before:-left-1.5 before:w-3 before:cursor-col-resize",
        isDragging ? "bg-accent" : "bg-border hover:bg-accent",
      )}
    />
  );
}
