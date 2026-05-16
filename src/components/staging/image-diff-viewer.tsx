import { useState, useEffect, useCallback, useReducer, useRef } from "react";
import { Columns2, SwatchBook } from "lucide-react";
import { getBinaryBlobBase64 } from "@/lib/commands";
import { useRepoStore } from "@/stores/repo-store";
import type { DiffSource } from "@/hooks/use-expandable-context";

interface ImageDiffViewerProps {
  filePath: string;
  source: DiffSource;
  staged: boolean;
}

interface ImageState {
  dataUri: string;
  sizeBytes: number;
  width: number;
  height: number;
}

type ViewMode = "side-by-side" | "swipe";

interface FetchState {
  loading: boolean;
  oldImg: ImageState | null;
  newImg: ImageState | null;
}

type FetchAction =
  | { type: "start" }
  | { type: "done"; oldImg: ImageState | null; newImg: ImageState | null };

function fetchReducer(_state: FetchState, action: FetchAction): FetchState {
  switch (action.type) {
    case "start":
      return { loading: true, oldImg: null, newImg: null };
    case "done":
      return { loading: false, oldImg: action.oldImg, newImg: action.newImg };
  }
}

function resolveRevs(source: DiffSource, staged: boolean): { oldRev: string | null; newRev: string | null } {
  if (source.commitId) {
    return { oldRev: `${source.commitId}^`, newRev: source.commitId };
  }
  if (source.stashIndex != null) {
    const ref = `stash@{${source.stashIndex}}`;
    return { oldRev: `${ref}^`, newRev: ref };
  }
  if (staged) {
    return { oldRev: "HEAD", newRev: "" };
  }
  return { oldRev: "", newRev: null };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getMimeType(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".avif": "image/avif",
  };
  return map[ext] ?? "image/png";
}

function loadImageState(base64: string, mime: string): Promise<ImageState> {
  return new Promise((resolve) => {
    const raw = atob(base64);
    const sizeBytes = raw.length;
    const dataUri = `data:${mime};base64,${base64}`;
    const img = new Image();
    img.onload = () => resolve({ dataUri, sizeBytes, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ dataUri, sizeBytes, width: 0, height: 0 });
    img.src = dataUri;
  });
}

const CHECKER_BG = "bg-[length:16px_16px] [background-image:linear-gradient(45deg,hsl(var(--muted))_25%,transparent_25%,transparent_75%,hsl(var(--muted))_75%),linear-gradient(45deg,hsl(var(--muted))_25%,transparent_25%,transparent_75%,hsl(var(--muted))_75%)] [background-position:0_0,8px_8px]";

const IMG_CONSTRAINT = "block max-w-[calc(100cqw-2rem)] max-h-[calc(100cqh-1rem)]";

const ZOOM_MIN = 1;
const ZOOM_MAX = 20;
const ZOOM_STEP = 1.15;

interface ZoomState {
  scale: number;
  tx: number;
  ty: number;
}

const INITIAL_ZOOM: ZoomState = { scale: 1, tx: 0, ty: 0 };

function useZoomAndPan(
  containerRef: React.RefObject<HTMLDivElement | null>,
  zoom: ZoomState,
  onZoomChange: React.Dispatch<React.SetStateAction<ZoomState>>,
) {
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const rafId = useRef<number>(0);
  const lastMouse = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const dx = e.clientX - rect.left - rect.width / 2;
      const dy = e.clientY - rect.top - rect.height / 2;
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      onZoomChange((prev) => {
        const newScale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev.scale * factor));
        if (newScale === prev.scale) return prev;
        if (newScale <= 1) return INITIAL_ZOOM;
        const ratio = newScale / prev.scale;
        return {
          scale: newScale,
          tx: dx * (1 - ratio) + prev.tx * ratio,
          ty: dy * (1 - ratio) + prev.ty * ratio,
        };
      });
    };

    const onDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-swipe-handle]")) return;
      const z = zoomRef.current;
      if (z.scale <= 1) return;
      e.preventDefault();
      panStart.current = { x: e.clientX, y: e.clientY, tx: z.tx, ty: z.ty };
    };

    const applyPan = () => {
      rafId.current = 0;
      const ps = panStart.current;
      if (!ps) return;
      const { x, y } = lastMouse.current;
      onZoomChange((prev) => ({
        ...prev,
        tx: ps.tx + (x - ps.x),
        ty: ps.ty + (y - ps.y),
      }));
    };

    const onMove = (e: MouseEvent) => {
      if (!panStart.current) return;
      lastMouse.current = { x: e.clientX, y: e.clientY };
      if (!rafId.current) {
        rafId.current = requestAnimationFrame(applyPan);
      }
    };

    const onUp = () => {
      panStart.current = null;
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
        rafId.current = 0;
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, [containerRef, onZoomChange]);
}

export function ImageDiffViewer({ filePath, source, staged }: ImageDiffViewerProps) {
  const [state, dispatch] = useReducer(fetchReducer, { loading: true, oldImg: null, newImg: null });
  const viewMode = useRepoStore((s) => s.imageDiffViewMode);
  const setImageDiffViewMode = useRepoStore((s) => s.setImageDiffViewMode);
  const [swipePos, setSwipePos] = useState(50);
  const [zoom, setZoom] = useState<ZoomState>(INITIAL_ZOOM);

  const handleSetViewMode = useCallback((mode: ViewMode) => {
    setImageDiffViewMode(mode);
    setZoom(INITIAL_ZOOM);
  }, [setImageDiffViewMode]);

  useEffect(() => {
    setZoom(INITIAL_ZOOM);
    setSwipePos(50);
  }, [filePath]);

  const sourceCommitId = source.commitId;
  const sourceStashIndex = source.stashIndex;

  useEffect(() => {
    let cancelled = false;
    const { oldRev, newRev } = resolveRevs(
      { commitId: sourceCommitId, stashIndex: sourceStashIndex },
      staged,
    );
    const mime = getMimeType(filePath);

    dispatch({ type: "start" });

    Promise.all([
      getBinaryBlobBase64(filePath, oldRev)
        .then((b64) => (b64 ? loadImageState(b64, mime) : null))
        .catch(() => null),
      getBinaryBlobBase64(filePath, newRev)
        .then((b64) => (b64 ? loadImageState(b64, mime) : null))
        .catch(() => null),
    ]).then(([oldImg, newImg]) => {
      if (!cancelled) dispatch({ type: "done", oldImg, newImg });
    });

    return () => {
      cancelled = true;
    };
  }, [filePath, sourceCommitId, sourceStashIndex, staged]);

  if (state.loading) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
        Loading image preview…
      </div>
    );
  }

  if (!state.oldImg && !state.newImg) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
        Binary file — cannot display preview
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card shrink-0">
        <div className="w-0 overflow-hidden border border-transparent py-1 text-xs font-medium leading-normal shrink-0" aria-hidden>{"​"}</div>
        <span className="truncate text-xs font-medium text-foreground min-w-0" title={filePath}>
          {filePath}
        </span>
        <span className="w-px h-4 bg-border shrink-0" />

        <div className="flex items-center rounded-md bg-secondary p-0.5 shrink-0">
          <button
            onClick={() => handleSetViewMode("side-by-side")}
            title="Side-by-side"
            className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${
              viewMode === "side-by-side"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Columns2 className="w-3.5 h-3.5" />
            <span>Side by Side</span>
          </button>
          {state.oldImg && state.newImg && (
            <button
              onClick={() => handleSetViewMode("swipe")}
              title="Swipe overlay"
              className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${
                viewMode === "swipe"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <SwatchBook className="w-3.5 h-3.5" />
              <span>Swipe</span>
            </button>
          )}
        </div>

        {zoom.scale > 1 && (
          <div className="ml-auto flex items-center rounded-md bg-secondary p-0.5 shrink-0">
            <button
              className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setZoom(INITIAL_ZOOM)}
            >
              {Math.round(zoom.scale * 100)}% — Reset
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden min-h-0">
        {viewMode === "side-by-side" ? (
          <SideBySide oldImg={state.oldImg} newImg={state.newImg} zoom={zoom} onZoomChange={setZoom} />
        ) : (
          <SwipeView
            oldImg={state.oldImg!}
            newImg={state.newImg!}
            swipePos={swipePos}
            onSwipePosChange={setSwipePos}
            zoom={zoom}
            onZoomChange={setZoom}
          />
        )}
      </div>
    </div>
  );
}

function ImageMeta({ label, img, accent }: { label: string; img: ImageState; accent?: "red" | "green" }) {
  const accentClass = accent === "red" ? "text-red-400" : accent === "green" ? "text-green-400" : "text-muted-foreground";
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className={`text-caption uppercase tracking-widest ${accentClass}`}>{label}</span>
      <span>
        {img.width} × {img.height}
      </span>
      <span>{formatBytes(img.sizeBytes)}</span>
    </div>
  );
}

function ImagePanel({
  img,
  label,
  accent,
  zoom,
  onZoomChange,
}: {
  img: ImageState | null;
  label: string;
  accent?: "red" | "green";
  zoom: ZoomState;
  onZoomChange: React.Dispatch<React.SetStateAction<ZoomState>>;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  useZoomAndPan(viewportRef, zoom, onZoomChange);

  if (!img) {
    const text = label === "Before" ? "File added" : "File deleted";
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-4 min-w-0">
        <span className="text-caption text-muted-foreground">{label}</span>
        <div className="flex items-center justify-center rounded border border-dashed border-border p-8 text-xs text-muted-foreground">
          {text}
        </div>
      </div>
    );
  }

  const wrapperStyle: React.CSSProperties = {
    transform: `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})`,
  };

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="px-3 py-1.5 border-b border-border shrink-0">
        <ImageMeta label={label} img={img} accent={accent} />
      </div>
      <div
        ref={viewportRef}
        className="flex-1 min-h-0 flex items-center justify-center overflow-hidden [container-type:size]"
        style={{ cursor: zoom.scale > 1 ? "grab" : "default" }}
        onDoubleClick={() => onZoomChange(INITIAL_ZOOM)}
      >
        <div className={`rounded border border-border ${CHECKER_BG}`} style={wrapperStyle}>
          <img
            src={img.dataUri}
            alt={label}
            className={`${IMG_CONSTRAINT} pointer-events-none`}
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
}

function SideBySide({
  oldImg,
  newImg,
  zoom,
  onZoomChange,
}: {
  oldImg: ImageState | null;
  newImg: ImageState | null;
  zoom: ZoomState;
  onZoomChange: React.Dispatch<React.SetStateAction<ZoomState>>;
}) {
  return (
    <div className="flex h-full gap-px">
      <ImagePanel img={oldImg} label="Before" accent="red" zoom={zoom} onZoomChange={onZoomChange} />
      <div className="w-px shrink-0 bg-border" />
      <ImagePanel img={newImg} label="After" accent="green" zoom={zoom} onZoomChange={onZoomChange} />
    </div>
  );
}

interface SwipeViewProps {
  oldImg: ImageState;
  newImg: ImageState;
  swipePos: number;
  onSwipePosChange: React.Dispatch<React.SetStateAction<number>>;
  zoom: ZoomState;
  onZoomChange: React.Dispatch<React.SetStateAction<ZoomState>>;
}

function SwipeView({ oldImg, newImg, swipePos, onSwipePosChange, zoom, onZoomChange }: SwipeViewProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const swipeDragging = useRef(false);

  useZoomAndPan(viewportRef, zoom, onZoomChange);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!swipeDragging.current || !wrapperRef.current) return;
      const rect = wrapperRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      onSwipePosChange(Math.max(0, Math.min(100, pct)));
    };

    const onUp = () => {
      swipeDragging.current = false;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onSwipePosChange]);

  const wrapperStyle: React.CSSProperties = {
    transform: `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})`,
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-1.5 border-b border-border flex items-center justify-center gap-4 text-caption text-muted-foreground shrink-0">
        <ImageMeta label="Before" img={oldImg} accent="red" />
        <span>→</span>
        <ImageMeta label="After" img={newImg} accent="green" />
      </div>
      <div
        ref={viewportRef}
        className="flex-1 min-h-0 flex items-center justify-center overflow-hidden select-none [container-type:size]"
        style={{ cursor: zoom.scale > 1 ? "grab" : "default" }}
        onDoubleClick={() => onZoomChange(INITIAL_ZOOM)}
      >
        <div ref={wrapperRef} className="relative" style={wrapperStyle}>
          <div className={`rounded border border-border ${CHECKER_BG} relative overflow-hidden`}>
            <img
              src={newImg.dataUri}
              alt="After"
              className={`${IMG_CONSTRAINT} pointer-events-none`}
              draggable={false}
            />
            <div
              className={`absolute inset-0 ${CHECKER_BG} pointer-events-none`}
              style={{ clipPath: `inset(0 ${100 - swipePos}% 0 0)` }}
            >
              <img
                src={oldImg.dataUri}
                alt="Before"
                className={IMG_CONSTRAINT}
                draggable={false}
              />
            </div>
          </div>
          <div
            data-swipe-handle
            className="absolute top-0 bottom-0 z-10"
            style={{ left: `${swipePos}%`, width: "24px", marginLeft: "-12px", cursor: "ew-resize" }}
            onMouseDown={(e) => {
              e.preventDefault();
              swipeDragging.current = true;
            }}
          >
            <div className="absolute left-1/2 top-0 bottom-0 w-0.5 -translate-x-1/2 bg-foreground/60" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-foreground/80 flex items-center justify-center text-background text-[10px]">
              ⇔
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
