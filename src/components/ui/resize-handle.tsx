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
  /** Render with no resting line (transparent until hover). Used for the
   *  sidebar handle in the mat so the sidebar blends into the shell. */
  ghost?: boolean;
}

export function ResizeHandle({
  side,
  panelRef,
  minWidth = 192,
  maxWidth = 480,
  onResizeEnd,
  ghost = false,
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
        // z-10 keeps the handle (and its grab strip) painted above the center
        // graph panel regardless of DOM order — otherwise the left handle's
        // strip, which sits before the graph in the DOM, gets covered by it.
        "group relative z-10 w-px shrink-0 cursor-col-resize transition-colors",
        // Hit zone positioning: both handles extend OUTWARD into the center
        // graph panel, never inward into the side panels — otherwise the grab
        // area overlaps the side panel's vertical scrollbar.
        side === "left"
          ? "before:absolute before:inset-y-0 before:left-0 before:w-3 before:cursor-col-resize"
          : "before:absolute before:inset-y-0 before:right-0 before:w-3 before:cursor-col-resize",
        isDragging
          ? "bg-accent"
          : ghost
            ? "bg-transparent hover:bg-accent"
            : "bg-border hover:bg-accent",
      )}
    >
      {/* Grip: a thicker rounded bar centered vertically that signals the
          line is a draggable resize handle. */}
      <div
        className={cn(
          "pointer-events-none absolute left-1/2 top-1/2 h-10 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors",
          isDragging
            ? "bg-primary"
            : ghost
              ? "bg-transparent group-hover:bg-muted-foreground/50"
              : "bg-muted-foreground/30 group-hover:bg-muted-foreground/60",
        )}
      />
    </div>
  );
}
