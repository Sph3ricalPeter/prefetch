import { useState, useEffect, useCallback, useReducer } from "react";
import { getBinaryBlobBase64 } from "@/lib/commands";
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

export function ImageDiffViewer({ filePath, source, staged }: ImageDiffViewerProps) {
  const [state, dispatch] = useReducer(fetchReducer, { loading: true, oldImg: null, newImg: null });
  const [viewMode, setViewMode] = useState<ViewMode>("side-by-side");
  const [swipePos, setSwipePos] = useState(50);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const { oldRev, newRev } = resolveRevs(source, staged);
    const mime = getMimeType(filePath);

    dispatch({ type: "start" });

    Promise.all([
      getBinaryBlobBase64(filePath, oldRev).then((b64) =>
        b64 ? loadImageState(b64, mime) : null,
      ).catch(() => null),
      getBinaryBlobBase64(filePath, newRev).then((b64) =>
        b64 ? loadImageState(b64, mime) : null,
      ).catch(() => null),
    ]).then(([oldImg, newImg]) => {
      if (!cancelled) dispatch({ type: "done", oldImg, newImg });
    });

    return () => { cancelled = true; };
  }, [filePath, source, staged]);

  const handleSwipeMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setSwipePos(Math.max(0, Math.min(100, pct)));
  }, [dragging]);

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
      <div className="flex items-center gap-2 shrink-0 border-b border-border px-3 py-1.5">
        <span className="text-xs text-muted-foreground mr-auto">Image Preview</span>
        <div className="flex items-center rounded-md border border-border overflow-hidden text-caption">
          <button
            className={`px-2 py-0.5 ${viewMode === "side-by-side" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setViewMode("side-by-side")}
          >
            Side by Side
          </button>
          {state.oldImg && state.newImg && (
            <button
              className={`px-2 py-0.5 border-l border-border ${viewMode === "swipe" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => setViewMode("swipe")}
            >
              Swipe
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        {viewMode === "side-by-side" ? (
          <SideBySide oldImg={state.oldImg} newImg={state.newImg} />
        ) : (
          <SwipeView
            oldImg={state.oldImg!}
            newImg={state.newImg!}
            swipePos={swipePos}
            dragging={dragging}
            onMouseDown={() => setDragging(true)}
            onMouseUp={() => setDragging(false)}
            onMouseLeave={() => setDragging(false)}
            onMouseMove={handleSwipeMove}
          />
        )}
      </div>
    </div>
  );
}

function ImageMeta({ label, img, accent }: { label: string; img: ImageState; accent?: "red" | "green" }) {
  const accentClass = accent === "red" ? "text-red-400" : accent === "green" ? "text-green-400" : "text-muted-foreground";
  return (
    <div className="flex items-center gap-2 text-caption text-muted-foreground">
      <span className={accentClass}>{label}</span>
      <span>{img.width} × {img.height}</span>
      <span>{formatBytes(img.sizeBytes)}</span>
    </div>
  );
}

function ImagePanel({ img, label, accent }: { img: ImageState | null; label: string; accent?: "red" | "green" }) {
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

  return (
    <div className="flex-1 flex flex-col items-center gap-2 p-4 min-w-0">
      <ImageMeta label={label} img={img} accent={accent} />
      <div className={`rounded border border-border overflow-hidden ${CHECKER_BG}`}>
        <img src={img.dataUri} alt={label} className="max-w-full max-h-[60vh] object-contain" />
      </div>
    </div>
  );
}

function SideBySide({ oldImg, newImg }: { oldImg: ImageState | null; newImg: ImageState | null }) {
  return (
    <div className="flex h-full gap-px">
      <ImagePanel img={oldImg} label="Before" accent="red" />
      <div className="w-px shrink-0 bg-border" />
      <ImagePanel img={newImg} label="After" accent="green" />
    </div>
  );
}

interface SwipeViewProps {
  oldImg: ImageState;
  newImg: ImageState;
  swipePos: number;
  dragging: boolean;
  onMouseDown: () => void;
  onMouseUp: () => void;
  onMouseLeave: () => void;
  onMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
}

function SwipeView({ oldImg, newImg, swipePos, dragging, onMouseDown, onMouseUp, onMouseLeave, onMouseMove }: SwipeViewProps) {
  return (
    <div className="flex flex-col items-center gap-2 p-4">
      <div className="flex items-center gap-4 text-caption text-muted-foreground">
        <ImageMeta label="Before" img={oldImg} accent="red" />
        <span>→</span>
        <ImageMeta label="After" img={newImg} accent="green" />
      </div>
      <div
        className={`relative rounded border border-border overflow-hidden select-none ${CHECKER_BG}`}
        style={{ cursor: dragging ? "ew-resize" : "default" }}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onMouseMove={onMouseMove}
      >
        <img src={newImg.dataUri} alt="After" className="max-w-full max-h-[60vh] object-contain block" />
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ width: `${swipePos}%` }}
        >
          <img src={oldImg.dataUri} alt="Before" className="max-w-full max-h-[60vh] object-contain block" />
        </div>
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-foreground/60 cursor-ew-resize"
          style={{ left: `${swipePos}%` }}
          onMouseDown={(e) => { e.stopPropagation(); onMouseDown(); }}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-foreground/80 flex items-center justify-center text-background text-[10px]">
            ⇔
          </div>
        </div>
      </div>
    </div>
  );
}
