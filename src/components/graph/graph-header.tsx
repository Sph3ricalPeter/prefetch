import { useCallback, useEffect, useRef, useState } from "react";
import type { GraphColumnWidths } from "./commit-graph-canvas";

/**
 * Sticky column header sitting above the commit graph canvas.
 * Lays out four columns — BRANCH/TAG · GRAPH · COMMIT MESSAGE · DATE — at the
 * same offsets the canvas draws into, with drag handles between badge/graph
 * and graph/message that adjust the same widths the canvas consumes.
 *
 * Date column width is fixed (no handle) for v0.14 — the canvas's time-group
 * labels already sit in that region.
 */

const HEADER_HEIGHT = 24;
const HANDLE_HIT = 6;

interface GraphHeaderProps {
  widths: GraphColumnWidths;
  containerWidth: number;
  /** Min badge column width in px */
  badgeMin: number;
  /** Max badge column width in px */
  badgeMax: number;
  /** Min graph column width in px (typically derived from totalLanes) */
  graphMin: number;
  /** Max graph column width in px */
  graphMax: number;
  /** Fires while dragging — emit new widths so the canvas redraws live. */
  onResize: (widths: GraphColumnWidths) => void;
  /** Fires on drag end — parent persists the final widths. */
  onResizeEnd: (widths: GraphColumnWidths) => void;
}

type DragKind = "badge" | "graph";

export function GraphHeader({
  widths,
  containerWidth,
  badgeMin,
  badgeMax,
  graphMin,
  graphMax,
  onResize,
  onResizeEnd,
}: GraphHeaderProps) {
  const [dragging, setDragging] = useState<DragKind | null>(null);
  const dragStart = useRef<{ x: number; badge: number; graph: number }>({
    x: 0,
    badge: 0,
    graph: 0,
  });
  // Stable refs so the global mouse listeners always read the latest values
  // without re-attaching on every render. Ref values are synced in an effect
  // rather than during render (react-hooks/refs).
  const widthsRef = useRef(widths);
  const onResizeRef = useRef(onResize);
  const onResizeEndRef = useRef(onResizeEnd);
  useEffect(() => {
    widthsRef.current = widths;
  }, [widths]);
  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);
  useEffect(() => {
    onResizeEndRef.current = onResizeEnd;
  }, [onResizeEnd]);

  const startDrag = useCallback(
    (kind: DragKind) => (e: React.MouseEvent) => {
      e.preventDefault();
      dragStart.current = {
        x: e.clientX,
        badge: widths.badge,
        graph: widths.graph,
      };
      setDragging(kind);
    },
    [widths.badge, widths.graph],
  );

  useEffect(() => {
    if (!dragging) return;

    const clamp = (v: number, min: number, max: number) =>
      Math.max(min, Math.min(max, v));

    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - dragStart.current.x;
      const current = widthsRef.current;
      if (dragging === "badge") {
        // Resize badge column — graph column stays the same width; message shrinks/grows.
        const newBadge = clamp(
          dragStart.current.badge + delta,
          badgeMin,
          badgeMax,
        );
        onResizeRef.current({ ...current, badge: newBadge });
      } else {
        // Resize graph column — badge stays; message shrinks/grows.
        const newGraph = clamp(
          dragStart.current.graph + delta,
          graphMin,
          graphMax,
        );
        onResizeRef.current({ ...current, graph: newGraph });
      }
    };

    const onUp = () => {
      onResizeEndRef.current(widthsRef.current);
      setDragging(null);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [dragging, badgeMin, badgeMax, graphMin, graphMax]);

  // Body cursor + selection lock during drag, otherwise text gets selected.
  useEffect(() => {
    if (!dragging) return;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [dragging]);

  const badgeRight = widths.badge;
  const graphRight = widths.badge + widths.graph;
  const dateLeft = Math.max(graphRight, containerWidth - widths.date);
  const labelClasses =
    "text-caption uppercase tracking-widest text-faint select-none";
  // Match the topbar's between-action divider: 1px wide, 16px tall, in border color.
  const dividerClasses = "absolute top-1/2 -translate-y-1/2 h-4 w-px bg-border";

  return (
    <div
      className="relative shrink-0 border-b border-border bg-background"
      style={{ height: HEADER_HEIGHT }}
    >
      {/* Column labels — positioned at the same offsets the canvas uses */}
      <div
        className={`absolute inset-y-0 flex items-center pl-3 ${labelClasses}`}
        style={{ left: 0, width: widths.badge }}
      >
        Branch / Tag
      </div>
      <div
        className={`absolute inset-y-0 flex items-center pl-2 ${labelClasses}`}
        style={{ left: badgeRight, width: widths.graph }}
      >
        Graph
      </div>
      <div
        className={`absolute inset-y-0 flex items-center pl-4 ${labelClasses}`}
        style={{ left: graphRight, right: widths.date }}
      >
        Commit Message
      </div>
      <div
        className={`absolute inset-y-0 flex items-center justify-end pr-4 ${labelClasses}`}
        style={{ left: dateLeft, right: 0 }}
      >
        Date
      </div>

      {/* Static divider before the (non-resizable) date column. */}
      <div className={dividerClasses} style={{ left: dateLeft }} aria-hidden="true" />

      {/* Resize handles — hit-zone is wider than the visual divider. */}
      <ResizeDivider
        x={badgeRight}
        active={dragging === "badge"}
        onMouseDown={startDrag("badge")}
        ariaLabel="Resize branch/tag column"
      />
      <ResizeDivider
        x={graphRight}
        active={dragging === "graph"}
        onMouseDown={startDrag("graph")}
        ariaLabel="Resize graph column"
      />
    </div>
  );
}

interface ResizeDividerProps {
  x: number;
  active: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  ariaLabel: string;
}

function ResizeDivider({
  x,
  active,
  onMouseDown,
  ariaLabel,
}: ResizeDividerProps) {
  return (
    <div
      role="separator"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      onMouseDown={onMouseDown}
      className="group absolute inset-y-0 z-10 cursor-col-resize"
      style={{
        left: x - HANDLE_HIT / 2,
        width: HANDLE_HIT,
      }}
    >
      {/* Static column divider — matches the topbar's between-action style. */}
      <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 h-4 w-px bg-border" />
      {/* Full-height accent overlay when hovered or actively dragging. */}
      <div
        className={`absolute inset-y-0 left-1/2 -translate-x-1/2 w-px transition-colors ${
          active ? "bg-accent" : "bg-transparent group-hover:bg-accent"
        }`}
      />
    </div>
  );
}
