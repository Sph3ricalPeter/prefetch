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
  /** Extra classes on the handle (e.g. margins to space it off neighbours) */
  className?: string;
}

export function ResizeHandle({
  side,
  panelRef,
  minWidth = 192,
  maxWidth = 480,
  onResizeEnd,
  ghost = false,
  className,
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
        // Hit zone: never extends into a panel's right edge, where its 6px
        // vertical scrollbar lives (sidebar list left of the left handle,
        // commit graph left of the right one). The two handles have different
        // slack around them, so they can't share one zone:
        //   left  — nothing to its left but the sidebar scrollbar, so the zone
        //           runs right, over the card's ml-1 gap and border.
        //   right — carries ml-1 itself, so 4px of dead gap sits to its left,
        //           past the graph's scrollbar. Claim that plus the detail
        //           column's own pl-1, and stop: the cards (and the RowDragHandle
        //           between Unstaged and Staged) start at 4px, and this handle's
        //           z-10 would otherwise win every press on their left edge.
        side === "left"
          ? "before:absolute before:inset-y-0 before:left-0 before:w-3 before:cursor-col-resize"
          : "before:absolute before:inset-y-0 before:-left-1 before:w-[9px] before:cursor-col-resize",
        isDragging
          ? "bg-accent"
          : ghost
            ? "bg-transparent hover:bg-accent"
            : "bg-border hover:bg-accent",
        className,
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
