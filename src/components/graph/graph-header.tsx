import { useCallback, useEffect, useRef, useState } from "react";
import { Settings, Check } from "lucide-react";
import { SCROLLBAR_PAD_RIGHT } from "./commit-graph-canvas";
import type { GraphColumnWidths, GraphColumnVisibility } from "./commit-graph-canvas";
import { GRAPH_DENSITY_OPTIONS, type GraphDensity } from "@/lib/graph-density";

const HEADER_HEIGHT = 24;
const HANDLE_HIT = 6;

const COL_AUTHOR_MIN = 80;
const COL_AUTHOR_MAX = 400;

interface GraphHeaderProps {
  widths: GraphColumnWidths;
  containerWidth: number;
  badgeMin: number;
  badgeMax: number;
  graphMin: number;
  graphMax: number;
  /** Effective visibility (post responsive collapse) — drives which column
   *  labels, dividers and resize handles are laid out. */
  visibility: GraphColumnVisibility;
  /** User's chosen visibility — drives the settings dropdown checkmarks so an
   *  auto-collapsed column still reads as "on". */
  userVisibility: GraphColumnVisibility;
  density: GraphDensity;
  dotNodes: boolean;
  onResize: (widths: GraphColumnWidths) => void;
  onResizeEnd: (widths: GraphColumnWidths) => void;
  onVisibilityChange: (visibility: GraphColumnVisibility) => void;
  onDensityChange: (density: GraphDensity) => void;
  onDotNodesChange: (on: boolean) => void;
}

type DragKind = "badge" | "graph" | "author";

export function GraphHeader({
  widths,
  containerWidth,
  badgeMin,
  badgeMax,
  graphMin,
  graphMax,
  visibility,
  userVisibility,
  density,
  dotNodes,
  onResize,
  onResizeEnd,
  onVisibilityChange,
  onDensityChange,
  onDotNodesChange,
}: GraphHeaderProps) {
  const [dragging, setDragging] = useState<DragKind | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; widths: GraphColumnWidths }>({
    x: 0,
    widths: widths,
  });
  const widthsRef = useRef(widths);
  const onResizeRef = useRef(onResize);
  const onResizeEndRef = useRef(onResizeEnd);
  useEffect(() => { widthsRef.current = widths; }, [widths]);
  useEffect(() => { onResizeRef.current = onResize; }, [onResize]);
  useEffect(() => { onResizeEndRef.current = onResizeEnd; }, [onResizeEnd]);

  const startDrag = useCallback(
    (kind: DragKind) => (e: React.MouseEvent) => {
      e.preventDefault();
      dragStart.current = { x: e.clientX, widths: { ...widths } };
      setDragging(kind);
    },
    [widths],
  );

  useEffect(() => {
    if (!dragging) return;
    const clamp = (v: number, min: number, max: number) =>
      Math.max(min, Math.min(max, v));

    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - dragStart.current.x;
      const current = widthsRef.current;
      const start = dragStart.current.widths;

      if (dragging === "badge") {
        onResizeRef.current({ ...current, badge: clamp(start.badge + delta, badgeMin, badgeMax) });
      } else if (dragging === "graph") {
        onResizeRef.current({ ...current, graph: clamp(start.graph + delta, graphMin, graphMax) });
      } else if (dragging === "author") {
        onResizeRef.current({ ...current, author: clamp(start.author - delta, COL_AUTHOR_MIN, COL_AUTHOR_MAX) });
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

  // Click outside to close settings dropdown
  useEffect(() => {
    if (!settingsOpen) return;
    const onClick = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [settingsOpen]);

  // Column positions. Right-anchored group order: author, date, sha (rightmost).
  const badgeRight = widths.badge;
  const graphRight = badgeRight + widths.graph;
  const shaWidth = visibility.sha ? widths.sha : 0;
  const dateWidth = visibility.date ? widths.date : 0;
  const authorWidth = visibility.author ? widths.author : 0;
  const rightColsWidth = authorWidth + dateWidth + shaWidth;
  const authorLeft = Math.max(graphRight, containerWidth - SCROLLBAR_PAD_RIGHT - rightColsWidth);
  const dateLeft = authorLeft + authorWidth;
  const shaLeft = dateLeft + dateWidth;

  const labelClasses =
    "text-caption tracking-widest text-faint select-none";
  const dividerClasses = "absolute top-1/2 -translate-y-1/2 h-4 w-px bg-border";

  const toggleVis = (key: keyof GraphColumnVisibility) => {
    onVisibilityChange({ ...userVisibility, [key]: !userVisibility[key] });
  };

  return (
    <div
      className="relative shrink-0 border-border bg-background"
      style={{ height: HEADER_HEIGHT }}
    >
      {/* Column labels */}
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
        className={`absolute inset-y-0 flex items-center pl-3 overflow-hidden whitespace-nowrap ${labelClasses}`}
        style={{
          left: graphRight,
          right: rightColsWidth > 0
            ? Math.max(28, containerWidth - authorLeft + 4)
            : 28,
        }}
      >
        Commit Message
      </div>
      {visibility.author && (
        <div
          className={`absolute inset-y-0 flex items-center pl-3 ${labelClasses}`}
          style={{ left: authorLeft, width: authorWidth }}
        >
          Author
        </div>
      )}
      {visibility.date && (
        <div
          className={`absolute inset-y-0 flex items-center pl-3 ${labelClasses}`}
          style={{ left: dateLeft, width: dateWidth }}
        >
          Date
        </div>
      )}
      {visibility.sha && (
        <div
          className={`absolute inset-y-0 flex items-center pl-3 ${labelClasses}`}
          style={{ left: shaLeft, width: shaWidth }}
        >
          Sha
        </div>
      )}

      {/* Static dividers for right-anchored columns */}
      {visibility.author && (
        <div className={dividerClasses} style={{ left: authorLeft }} aria-hidden="true" />
      )}
      {visibility.date && (
        <div className={dividerClasses} style={{ left: dateLeft }} aria-hidden="true" />
      )}
      {visibility.sha && (
        <div className={dividerClasses} style={{ left: shaLeft }} aria-hidden="true" />
      )}

      {/* Resize handles */}
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
      {visibility.author && (
        <ResizeDivider
          x={authorLeft}
          active={dragging === "author"}
          onMouseDown={startDrag("author")}
          ariaLabel="Resize author column"
        />
      )}

      {/* Settings gear */}
      <div ref={settingsRef} className="absolute right-0 inset-y-0 z-20 flex items-center">
        <button
          onClick={() => setSettingsOpen((p) => !p)}
          className="flex h-full w-7 items-center justify-center text-faint transition-colors hover:text-foreground"
          aria-label="Column settings"
        >
          <Settings className="h-3 w-3" />
        </button>
        {settingsOpen && (
          <div className="absolute right-0 top-full mt-1 min-w-[160px] rounded-md border border-border bg-card shadow-lg py-1 animate-enter-down">
            <div className="px-3 pb-1 pt-0.5 text-caption uppercase tracking-widest text-faint select-none">
              Columns
            </div>
            <SettingsToggle label="Sha" checked={userVisibility.sha} onChange={() => toggleVis("sha")} />
            <SettingsToggle label="Author" checked={userVisibility.author} onChange={() => toggleVis("author")} />
            <SettingsToggle label="Date" checked={userVisibility.date} onChange={() => toggleVis("date")} />
            <div className="my-1 border-t border-border" />
            <div className="px-3 pb-1 pt-0.5 text-caption uppercase tracking-widest text-faint select-none">
              Density
            </div>
            {GRAPH_DENSITY_OPTIONS.map((opt) => (
              <SettingsToggle
                key={opt.id}
                label={opt.label}
                checked={density === opt.id}
                onChange={() => onDensityChange(opt.id)}
              />
            ))}
            <div className="my-1 border-t border-border" />
            <div className="px-3 pb-1 pt-0.5 text-caption uppercase tracking-widest text-faint select-none">
              Nodes
            </div>
            <SettingsToggle label="Dots" checked={dotNodes} onChange={() => onDotNodesChange(!dotNodes)} />
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      onClick={onChange}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-secondary"
    >
      <span className="flex h-3.5 w-3.5 items-center justify-center">
        {checked && <Check className="h-3 w-3" />}
      </span>
      {label}
    </button>
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
      <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 h-4 w-px bg-border" />
      <div
        className={`absolute inset-y-0 left-1/2 -translate-x-1/2 w-px transition-colors ${
          active ? "bg-accent" : "bg-transparent group-hover:bg-accent"
        }`}
      />
    </div>
  );
}
