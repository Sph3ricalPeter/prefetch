import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Draggable vertical split between two stacked cards. `ratio` is the top card's
 * share (0..1) of the container; the bottom card gets the rest. Attach
 * `containerRef` to the flex column and `onDragStart` to the handle between the
 * two cards.
 */
export function useSplitRatio(initial = 0.5) {
  const [ratio, setRatio] = useState(initial);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startRatio: number; avail: number } | null>(null);

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const el = containerRef.current;
      if (!el) return;
      dragRef.current = { startY: e.clientY, startRatio: ratio, avail: el.clientHeight };
      setDragging(true);
    },
    [ratio],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d || d.avail <= 0) return;
      setRatio(Math.max(0.15, Math.min(0.85, d.startRatio + (e.clientY - d.startY) / d.avail)));
    };
    const onUp = () => setDragging(false);
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [dragging]);

  return { ratio, containerRef, onDragStart };
}

/**
 * Flex sizing for one side of a split: a card only claims resizable space when
 * it's open and non-empty, otherwise it shrinks to just its header.
 */
export function splitGrowStyle(expands: boolean, grow: number): React.CSSProperties {
  return expands
    ? { flexGrow: grow, flexShrink: 1, flexBasis: 0, minHeight: 0 }
    : { flexShrink: 0 };
}

/**
 * Drag-to-resize for an element that sizes itself in discrete steps. Returns a
 * raw `height` in px (undefined until dragged), the ref to measure from, and
 * whether a drag is live — clamping and snapping are the caller's, since only
 * it knows what its content is worth (and `dragging` tells it when snapping
 * would be felt as a stutter). Nothing here writes to the DOM, so a drag can't
 * fight the cursor.
 */
export function useDragHeight() {
  const [height, setHeight] = useState<number | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  const elRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const el = elRef.current;
    if (!el) return;
    dragRef.current = { startY: e.clientY, startHeight: el.getBoundingClientRect().height };
    setDragging(true);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setHeight(Math.max(0, d.startHeight + (e.clientY - d.startY)));
    };
    const onUp = () => setDragging(false);
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [dragging]);

  return { elRef, height, dragging, onDragStart };
}
