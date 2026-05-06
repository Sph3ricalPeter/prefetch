import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { highlightLines, detectLang } from "@/lib/shiki";
import { useThemeStore } from "@/stores/theme-store";
import {
  computeDiffRegions,
  buildOutputWithSources,
  selectAllOurs,
  selectAllTheirs,
  type ChunkSelection,
  type DiffRegion,
} from "@/lib/conflict-regions";
import { useRepoStore } from "@/stores/repo-store";
import { Check, ChevronDown, ChevronRight, GitCompare, Minus, Plus, RotateCcw, Save } from "lucide-react";
import type { ThemedToken } from "shiki";

// ── Source icons ────────────────────────────────────────────

function OursIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      className="shrink-0"
      style={{ display: "block" }}
    >
      <path
        d="M4 2.5L8 6l-4 3.5"
        stroke="rgba(59, 130, 246, 0.8)"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TheirsIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      className="shrink-0"
      style={{ display: "block" }}
    >
      <path
        d="M8 2.5L4 6l4 3.5"
        stroke="rgba(168, 85, 247, 0.8)"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Component ────────────────────────────────────────────────

interface ConflictEditorProps {
  filePath: string;
}

/** Wrapper that resets state when the file changes by re-keying. */
export function ConflictEditor({ filePath }: ConflictEditorProps) {
  return <ConflictEditorInner key={filePath} filePath={filePath} />;
}

function ConflictEditorInner({ filePath }: ConflictEditorProps) {
  const conflictContents = useRepoStore((s) => s.conflictContents);
  const resolveConflictManual = useRepoStore((s) => s.resolveConflictManual);
  const loadConflictContents = useRepoStore((s) => s.loadConflictContents);
  const rebaseProgress = useRepoStore((s) => s.rebaseProgress);
  const conflictState = useRepoStore((s) => s.conflictState);
  const codeTheme = useThemeStore((s) => s.codeTheme);
  const shikiThemeId = codeTheme.shikiTheme.name;

  const [saving, setSaving] = useState(false);
  const [selections, setSelections] = useState<Map<number, ChunkSelection>>(
    new Map(),
  );
  const outputScrollRef = useRef<HTMLDivElement>(null);

  // ── Resizable split state ──────────────────────────────────
  const [hSplit, setHSplit] = useState(50); // ours/theirs horizontal %
  const [vSplit, setVSplit] = useState(50); // reference/output vertical %
  const refPanesRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // ── Synchronized scrolling ─────────────────────────────────
  const oursScrollRef = useRef<HTMLDivElement>(null);
  const theirsScrollRef = useRef<HTMLDivElement>(null);
  const scrollLockRef = useRef<string | null>(null);

  const syncScroll = useCallback((source: "ours" | "theirs" | "output") => {
    if (scrollLockRef.current && scrollLockRef.current !== source) return;
    scrollLockRef.current = source;

    const oursEl = oursScrollRef.current;
    const theirsEl = theirsScrollRef.current;
    const outputEl = outputScrollRef.current;

    const sourceEl =
      source === "ours" ? oursEl
        : source === "theirs" ? theirsEl
          : outputEl;
    if (!sourceEl) { scrollLockRef.current = null; return; }

    const maxScroll = sourceEl.scrollHeight - sourceEl.clientHeight;
    const ratio = maxScroll > 0 ? sourceEl.scrollTop / maxScroll : 0;

    const targets = [oursEl, theirsEl, outputEl].filter((el) => el && el !== sourceEl) as HTMLDivElement[];
    for (const el of targets) {
      const tMax = el.scrollHeight - el.clientHeight;
      el.scrollTop = ratio * tMax;
    }

    requestAnimationFrame(() => {
      scrollLockRef.current = null;
    });
  }, []);

  useEffect(() => {
    loadConflictContents(filePath);
  }, [filePath, loadConflictContents]);

  // ── Diff regions ───────────────────────────────────────────

  const regions = useMemo(() => {
    if (!conflictContents) return [];
    return computeDiffRegions(
      conflictContents.ours,
      conflictContents.theirs,
      conflictContents.base ?? undefined,
    );
  }, [conflictContents]);

  const changedChunkIndices = useMemo(
    () =>
      regions
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => r.type === "changed")
        .map(({ i }) => i),
    [regions],
  );

  // ── Output assembly ────────────────────────────────────────

  const {
    text: outputText,
    lines: outputLines,
    sources: outputSources,
  } = useMemo(
    () => buildOutputWithSources(regions, selections),
    [regions, selections],
  );

  const outputRuns = useMemo(() => {
    const runs: { source: "unchanged" | "ours" | "theirs"; startIdx: number; count: number }[] = [];
    for (let i = 0; i < outputSources.length; i++) {
      const src = outputSources[i];
      const last = runs[runs.length - 1];
      if (last && last.source === src) {
        last.count++;
      } else {
        runs.push({ source: src, startIdx: i, count: 1 });
      }
    }
    return runs;
  }, [outputSources]);

  // ── Syntax highlighting ────────────────────────────────────

  const lang = useMemo(() => detectLang(filePath), [filePath]);
  const [oursTokens, setOursTokens] = useState<ThemedToken[][] | null>(null);
  const [theirsTokens, setTheirsTokens] = useState<ThemedToken[][] | null>(
    null,
  );
  const [baseTokens, setBaseTokens] = useState<ThemedToken[][] | null>(null);

  useEffect(() => {
    if (!conflictContents) return;
    let cancelled = false;
    async function highlight() {
      try {
        const promises: Promise<ThemedToken[][]>[] = [
          highlightLines(conflictContents!.ours, lang, shikiThemeId),
          highlightLines(conflictContents!.theirs, lang, shikiThemeId),
        ];
        if (conflictContents!.base) {
          promises.push(highlightLines(conflictContents!.base, lang, shikiThemeId));
        }
        const results = await Promise.all(promises);
        if (!cancelled) {
          setOursTokens(results[0]);
          setTheirsTokens(results[1]);
          setBaseTokens(results[2] ?? null);
        }
      } catch {
        /* fallback */
      }
    }
    highlight();
    return () => {
      cancelled = true;
    };
  }, [conflictContents, lang, shikiThemeId]);

  const [outputTokens, setOutputTokens] = useState<ThemedToken[][] | null>(null);
  useEffect(() => {
    if (!outputText) return;
    let cancelled = false;
    highlightLines(outputText, lang, shikiThemeId)
      .then((tokens) => { if (!cancelled) setOutputTokens(tokens); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [outputText, lang, shikiThemeId]);

  // ── Selection handlers ─────────────────────────────────────

  /**
   * Toggle a chunk's ours checkbox.
   * Non-exclusive: both ours and theirs can be selected.
   * Order is determined by which side was selected first.
   *
   * When manually edited: surgically insert/remove lines, preserving manual edits.
   * When NOT manually edited: update selections → sync effect does full replacement.
   */
  const toggleChunkOurs = useCallback(
    (regionIndex: number) => {
      const region = regions[regionIndex];
      if (!region || region.type !== "changed") return;

      const cur = selections.get(regionIndex);
      const hasOurs = cur
        ? cur.oursLines.size === region.aLines.length
        : true;

      // Compute the new selection for this region
      const newSel: ChunkSelection = hasOurs
        ? {
            oursLines: new Set<number>(),
            theirsLines: cur?.theirsLines ?? new Set<number>(),
            order: cur?.order ?? "ours-first",
          }
        : {
            oursLines: new Set(region.aLines.map((_, i) => i)),
            theirsLines: cur?.theirsLines ?? new Set<number>(),
            order:
              cur && cur.theirsLines.size > 0
                ? (cur.order ?? "theirs-first")
                : "ours-first",
          };

      setSelections((prev) => {
        const next = new Map(prev);
        next.set(regionIndex, newSel);
        return next;
      });
    },
    [regions, selections],
  );

  const toggleChunkTheirs = useCallback(
    (regionIndex: number) => {
      const region = regions[regionIndex];
      if (!region || region.type !== "changed") return;

      const cur = selections.get(regionIndex);
      const hasTheirs = cur
        ? cur.theirsLines.size === region.bLines.length
        : false;

      const newSel: ChunkSelection = hasTheirs
        ? {
            oursLines:
              cur?.oursLines ?? new Set(region.aLines.map((_, i) => i)),
            theirsLines: new Set<number>(),
            order: cur?.order ?? "ours-first",
          }
        : {
            oursLines:
              cur?.oursLines ?? new Set(region.aLines.map((_, i) => i)),
            theirsLines: new Set(region.bLines.map((_, i) => i)),
            order:
              (cur ? cur.oursLines.size > 0 : true)
                ? (cur?.order ?? "ours-first")
                : "theirs-first",
          };

      setSelections((prev) => {
        const next = new Map(prev);
        next.set(regionIndex, newSel);
        return next;
      });
    },
    [regions, selections],
  );

  const toggleLine = useCallback(
    (regionIndex: number, side: "ours" | "theirs", lineIndex: number) => {
      const region = regions[regionIndex];
      if (!region || region.type !== "changed") return;

      const cur = selections.get(regionIndex) ?? {
        oursLines: new Set(region.aLines.map((_, i) => i)),
        theirsLines: new Set<number>(),
        order: "ours-first" as const,
      };
      const target =
        side === "ours"
          ? new Set(cur.oursLines)
          : new Set(cur.theirsLines);
      const wasSelected = target.has(lineIndex);
      if (wasSelected) {
        target.delete(lineIndex);
      } else {
        target.add(lineIndex);
      }

      let { order } = cur;
      if (side === "theirs" && wasSelected) {
        // removing a theirs line doesn't change order
      } else if (side === "theirs" && cur.theirsLines.size === 0) {
        order = cur.oursLines.size > 0 ? "ours-first" : "theirs-first";
      } else if (side === "ours" && cur.oursLines.size === 0) {
        order = cur.theirsLines.size > 0 ? "theirs-first" : "ours-first";
      }

      const newSel: ChunkSelection = {
        oursLines: side === "ours" ? target : new Set(cur.oursLines),
        theirsLines: side === "theirs" ? target : new Set(cur.theirsLines),
        order,
      };

      setSelections((prev) => {
        const next = new Map(prev);
        next.set(regionIndex, newSel);
        return next;
      });
    },
    [regions, selections],
  );

  // Master checkbox state — derived from current selections, not stored
  const masterSide = useMemo((): "ours" | "theirs" | null => {
    if (changedChunkIndices.length === 0) return null;
    const allOurs = changedChunkIndices.every((idx) => {
      const sel = selections.get(idx);
      const region = regions[idx];
      return (
        (!sel && region.aLines.length > 0) ||
        (sel &&
          sel.oursLines.size === region.aLines.length &&
          sel.theirsLines.size === 0)
      );
    });
    if (allOurs) return "ours";
    const allTheirs = changedChunkIndices.every((idx) => {
      const sel = selections.get(idx);
      const region = regions[idx];
      return (
        sel &&
        sel.theirsLines.size === region.bLines.length &&
        sel.oursLines.size === 0
      );
    });
    if (allTheirs) return "theirs";
    return null;
  }, [selections, changedChunkIndices, regions]);

  const handleMasterOurs = useCallback(() => {
    const next = new Map<number, ChunkSelection>();
    for (const idx of changedChunkIndices) {
      next.set(idx, selectAllOurs(regions[idx]));
    }
    setSelections(next);
  }, [regions, changedChunkIndices]);

  const handleMasterTheirs = useCallback(() => {
    const next = new Map<number, ChunkSelection>();
    for (const idx of changedChunkIndices) {
      next.set(idx, selectAllTheirs(regions[idx]));
    }
    setSelections(next);
  }, [regions, changedChunkIndices]);

  // Accept Ours/Theirs buttons: select all + save immediately
  const handleAcceptOurs = useCallback(async () => {
    const next = new Map<number, ChunkSelection>();
    for (const idx of changedChunkIndices) {
      next.set(idx, selectAllOurs(regions[idx]));
    }
    const { text } = buildOutputWithSources(regions, next);
    setSaving(true);
    try {
      await resolveConflictManual(filePath, text);
    } finally {
      setSaving(false);
    }
  }, [regions, changedChunkIndices, filePath, resolveConflictManual]);

  const handleAcceptTheirs = useCallback(async () => {
    const next = new Map<number, ChunkSelection>();
    for (const idx of changedChunkIndices) {
      next.set(idx, selectAllTheirs(regions[idx]));
    }
    const { text } = buildOutputWithSources(regions, next);
    setSaving(true);
    try {
      await resolveConflictManual(filePath, text);
    } finally {
      setSaving(false);
    }
  }, [regions, changedChunkIndices, filePath, resolveConflictManual]);

  const resetSelections = useCallback(() => {
    setSelections(new Map());
  }, []);

  // ── Resize drag handlers ────────────────────────────────────

  const onHDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = refPanesRef.current;
    if (!container) return;
    const startX = e.clientX;
    const totalWidth = container.getBoundingClientRect().width;
    const oursEl = container.firstElementChild as HTMLElement | null;
    const startPct = oursEl
      ? (oursEl.getBoundingClientRect().width / totalWidth) * 100
      : 50;

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const pct = startPct + (delta / totalWidth) * 100;
      setHSplit(Math.max(20, Math.min(80, pct)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const onVDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = contentRef.current;
    if (!container) return;
    const startY = e.clientY;
    const totalHeight = container.getBoundingClientRect().height;
    const refEl = refPanesRef.current;
    const startPct = refEl
      ? (refEl.getBoundingClientRect().height / totalHeight) * 100
      : 60;

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientY - startY;
      const pct = startPct + (delta / totalHeight) * 100;
      setVSplit(Math.max(20, Math.min(80, pct)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await resolveConflictManual(filePath, outputText);
    } finally {
      setSaving(false);
    }
  }, [filePath, resolveConflictManual, outputText]);

  // ── Precompute line offsets ────────────────────────────────

  const regionLineInfo = useMemo(() => {
    const result: { oursStart: number; theirsStart: number }[] = [];
    let aLine = 0;
    let bLine = 0;
    for (const region of regions) {
      result.push({ oursStart: aLine, theirsStart: bLine });
      aLine += region.aLines.length;
      bLine += region.bLines.length;
    }
    return result;
  }, [regions]);

  // ── Height equalization (ours ↔ theirs) ────────────────────
  // Measures actual rendered heights and forces both sides to match.
  // Uses ResizeObserver to re-equalize when content changes (e.g. base expand).

  useEffect(() => {
    const oursEl = oursScrollRef.current;
    const theirsEl = theirsScrollRef.current;
    if (!oursEl || !theirsEl) return;

    let equalizing = false;
    let rafId = 0;

    const equalize = () => {
      equalizing = true;
      const oursRegions = oursEl.querySelectorAll<HTMLElement>("[data-region-idx]");
      const theirsRegions = theirsEl.querySelectorAll<HTMLElement>("[data-region-idx]");
      const count = Math.min(oursRegions.length, theirsRegions.length);

      for (let i = 0; i < count; i++) {
        oursRegions[i].style.minHeight = "";
        theirsRegions[i].style.minHeight = "";
      }

      for (let i = 0; i < count; i++) {
        const maxH = Math.max(oursRegions[i].offsetHeight, theirsRegions[i].offsetHeight);
        oursRegions[i].style.minHeight = `${maxH}px`;
        theirsRegions[i].style.minHeight = `${maxH}px`;
      }

      requestAnimationFrame(() => { equalizing = false; });
    };

    const onResize = () => {
      if (equalizing) return;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(equalize);
    };

    const observer = new ResizeObserver(onResize);
    const oursRegions = oursEl.querySelectorAll("[data-region-idx]");
    const theirsRegions = theirsEl.querySelectorAll("[data-region-idx]");
    for (const el of oursRegions) observer.observe(el);
    for (const el of theirsRegions) observer.observe(el);

    equalize();

    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, [regions]);

  // ── Render ─────────────────────────────────────────────────

  if (!conflictContents) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Loading conflict contents...
      </div>
    );
  }

  const oursLabel = conflictContents.ours_branch || "current";
  const theirsLabel = conflictContents.theirs_branch || "incoming";
  const oursHash = conflictContents.ours_commit_id;
  const theirsHash = conflictContents.theirs_commit_id;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card shrink-0">
        <GitCompare className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          {changedChunkIndices.length} conflict
          {changedChunkIndices.length !== 1 ? "s" : ""}
        </span>
        {rebaseProgress && conflictState?.operation === "rebase" && (
          <span className="text-xs text-muted-foreground/60">
            · Step {rebaseProgress.step}/{rebaseProgress.total}
            {rebaseProgress.commit_id && (
              <span className="font-mono ml-1">{rebaseProgress.commit_id}</span>
            )}
            {conflictContents?.rebase_commit_message && (
              <span className="ml-1.5 italic truncate max-w-[300px] inline-block align-bottom" title={conflictContents.rebase_commit_message}>
                {conflictContents.rebase_commit_message}
              </span>
            )}
          </span>
        )}
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={resetSelections}
            className="flex items-center gap-1 rounded-md bg-zinc-500/20 px-2.5 py-1 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-500/30"
          >
            <RotateCcw className="w-3 h-3" />
            Reset
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-md bg-green-500/20 px-3 py-1 text-xs font-medium text-green-400 transition-colors hover:bg-green-500/30 disabled:opacity-40"
          >
            <Save className="w-3 h-3" />
            {saving ? "Saving..." : "Save Resolution"}
          </button>
        </div>
      </div>

      {/* Resizable content area */}
      <div ref={contentRef} className="flex flex-col min-h-0 flex-1">
        {/* Reference panes */}
        <div ref={refPanesRef} className="flex min-h-0" style={{ flex: vSplit }}>
          {/* Ours pane */}
          <div className="flex flex-col overflow-hidden" style={{ flex: hSplit }}>
            {/* Header with master checkbox + icon + accept-all button */}
            <div className="shrink-0 px-3 py-1.5 border-b border-border bg-blue-500/5 flex items-center gap-1.5">
              {/* Master checkbox */}
              <button
                onClick={handleMasterOurs}
                className={`w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors ${
                  masterSide === "ours"
                    ? "bg-blue-500 text-white"
                    : "border border-muted-foreground/30 hover:border-blue-400/50"
                }`}
                title="Accept all from ours"
              >
                {masterSide === "ours" && <Check className="w-2.5 h-2.5" />}
              </button>
              <OursIcon />
              <div className="flex-1 min-w-0 flex items-center">
                <span className="text-xs font-medium text-blue-400">
                  Ours ({oursLabel})
                </span>
                {oursHash && (
                  <span className="text-[10px] text-muted-foreground/50 ml-1.5 font-mono">
                    {oursHash}
                  </span>
                )}
              </div>
              <button
                onClick={handleAcceptOurs}
                disabled={saving}
                className="shrink-0 flex items-center gap-1.5 rounded-md bg-blue-500/20 px-3 py-1 text-xs font-medium text-blue-400 transition-colors hover:bg-blue-500/30 disabled:opacity-40"
              >
                <Save className="w-3 h-3" />
                Accept Ours
              </button>
            </div>
            <div className="relative flex-1 min-h-0">
              <div
                ref={oursScrollRef}
                onScroll={() => syncScroll("ours")}
                className="absolute inset-0 overflow-auto text-xs font-mono leading-5"
              >
                {regions.map((region, ri) => {
                  const lineStart = regionLineInfo[ri].oursStart;
                  if (region.type === "unchanged") {
                    return (
                      <div key={ri} data-region-idx={ri}>
                        <UnchangedBlock
                          lines={region.aLines}
                          tokens={oursTokens}
                          startTokenLine={lineStart}
                          startLineNo={region.aStartLine}
                        />
                      </div>
                    );
                  }
                  const sel = selections.get(ri);
                  const isChecked =
                    region.aLines.length > 0 &&
                    (sel ? sel.oursLines.size === region.aLines.length : true);
                  return (
                    <div key={ri} data-region-idx={ri}>
                      <ChangedBlock
                        lines={region.aLines}
                        tokens={oursTokens}
                        startTokenLine={lineStart}
                        startLineNo={region.aStartLine}
                        side="ours"
                        isChunkSelected={isChecked}
                        selectedLines={
                          sel?.oursLines ??
                          new Set(region.aLines.map((_, i) => i))
                        }
                        onToggleChunk={() => toggleChunkOurs(ri)}
                        onToggleLine={(li) => toggleLine(ri, "ours", li)}
                        baseLines={region.baseLines}
                        baseTokens={baseTokens}
                        baseStartLine={region.baseStartLine}
                      />
                    </div>
                  );
                })}
              </div>
              <ScrollMinimap regions={regions} side="ours" />
            </div>
          </div>

          {/* Vertical resize handle (between ours/theirs) */}
          <div
            onMouseDown={onHDragStart}
            className="relative w-px shrink-0 cursor-col-resize bg-border hover:bg-accent transition-colors before:absolute before:inset-y-0 before:-left-1.5 before:w-3 before:cursor-col-resize"
          />

          {/* Theirs pane */}
          <div className="flex flex-col overflow-hidden" style={{ flex: 100 - hSplit }}>
            <div className="shrink-0 px-3 py-1.5 border-b border-border bg-purple-500/5 flex items-center gap-1.5">
              <button
                onClick={handleMasterTheirs}
                className={`w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors ${
                  masterSide === "theirs"
                    ? "bg-purple-500 text-white"
                    : "border border-muted-foreground/30 hover:border-purple-400/50"
                }`}
                title="Accept all from theirs"
              >
                {masterSide === "theirs" && <Check className="w-2.5 h-2.5" />}
              </button>
              <TheirsIcon />
              <div className="flex-1 min-w-0 flex items-center">
                <span className="text-xs font-medium text-purple-400">
                  Theirs ({theirsLabel})
                </span>
                {theirsHash && (
                  <span className="text-[10px] text-muted-foreground/50 ml-1.5 font-mono">
                    {theirsHash}
                  </span>
                )}
              </div>
              <button
                onClick={handleAcceptTheirs}
                disabled={saving}
                className="shrink-0 flex items-center gap-1.5 rounded-md bg-purple-500/20 px-3 py-1 text-xs font-medium text-purple-400 transition-colors hover:bg-purple-500/30 disabled:opacity-40"
              >
                <Save className="w-3 h-3" />
                Accept Theirs
              </button>
            </div>
            <div className="relative flex-1 min-h-0">
              <div
                ref={theirsScrollRef}
                onScroll={() => syncScroll("theirs")}
                className="absolute inset-0 overflow-auto text-xs font-mono leading-5"
              >
                {regions.map((region, ri) => {
                  const lineStart = regionLineInfo[ri].theirsStart;
                  if (region.type === "unchanged") {
                    return (
                      <div key={ri} data-region-idx={ri}>
                        <UnchangedBlock
                          lines={region.bLines}
                          tokens={theirsTokens}
                          startTokenLine={lineStart}
                          startLineNo={region.bStartLine}
                        />
                      </div>
                    );
                  }
                  const sel = selections.get(ri);
                  const isChecked =
                    region.bLines.length > 0 &&
                    (sel ? sel.theirsLines.size === region.bLines.length : false);
                  return (
                    <div key={ri} data-region-idx={ri}>
                      <ChangedBlock
                        lines={region.bLines}
                        tokens={theirsTokens}
                        startTokenLine={lineStart}
                        startLineNo={region.bStartLine}
                        side="theirs"
                        isChunkSelected={isChecked}
                        selectedLines={sel?.theirsLines ?? new Set<number>()}
                        onToggleChunk={() => toggleChunkTheirs(ri)}
                        onToggleLine={(li) => toggleLine(ri, "theirs", li)}
                        baseLines={region.baseLines}
                        baseTokens={baseTokens}
                        baseStartLine={region.baseStartLine}
                      />
                    </div>
                  );
                })}
              </div>
              <ScrollMinimap regions={regions} side="theirs" />
            </div>
          </div>
        </div>

        {/* Horizontal resize handle (between reference/output) */}
        <div
          onMouseDown={onVDragStart}
          className="relative h-px shrink-0 cursor-row-resize bg-border hover:bg-accent transition-colors before:absolute before:inset-x-0 before:-top-1.5 before:h-3 before:cursor-row-resize"
        />

        {/* Output pane */}
        <div
          className="flex flex-col min-h-0"
          style={{ flex: 100 - vSplit }}
        >
          <div className="shrink-0 px-3 py-1.5 text-xs font-medium text-green-400 bg-green-500/5 border-b border-border flex items-center gap-2">
            <span>Output</span>
            <div className="flex items-center gap-3 ml-auto">
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60 font-normal">
                <OursIcon size={10} />
                ours
              </span>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60 font-normal">
                <TheirsIcon size={10} />
                theirs
              </span>
            </div>
          </div>
          <div className="relative flex-1 min-h-0">
            <div
              ref={outputScrollRef}
              onScroll={() => syncScroll("output")}
              className="absolute inset-0 overflow-auto text-xs font-mono leading-5"
            >
              {outputRuns.map((run) =>
                run.source === "unchanged" ? (
                  <OutputUnchangedBlock
                    key={run.startIdx}
                    lines={outputLines}
                    tokens={outputTokens}
                    startIdx={run.startIdx}
                    count={run.count}
                  />
                ) : (
                  outputLines.slice(run.startIdx, run.startIdx + run.count).map((line, j) => (
                    <OutputLine
                      key={run.startIdx + j}
                      content={line}
                      lineNo={run.startIdx + j + 1}
                      source={run.source}
                      tokens={outputTokens?.[run.startIdx + j]}
                    />
                  ))
                ),
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

function OutputUnchangedBlock({
  lines,
  tokens,
  startIdx,
  count,
}: {
  lines: string[];
  tokens: ThemedToken[][] | null;
  startIdx: number;
  count: number;
}) {
  return (
    <UnchangedBlock
      lines={lines.slice(startIdx, startIdx + count)}
      tokens={tokens}
      startTokenLine={startIdx}
      startLineNo={startIdx + 1}
    />
  );
}

function OutputLine({
  content,
  lineNo,
  source,
  tokens,
}: {
  content: string;
  lineNo: number;
  source: "unchanged" | "ours" | "theirs";
  tokens?: ThemedToken[];
}) {
  const bgClass =
    source === "ours"
      ? "bg-blue-500/8"
      : source === "theirs"
        ? "bg-purple-500/8"
        : "";
  const iconEl =
    source === "ours" ? (
      <OursIcon size={10} />
    ) : source === "theirs" ? (
      <TheirsIcon size={10} />
    ) : null;

  return (
    <div className={`flex ${bgClass} ${source === "unchanged" ? "opacity-50" : ""}`}>
      <span className="w-5 shrink-0 flex items-center justify-center">
        {iconEl}
      </span>
      <span className="w-9 shrink-0 text-right pr-2 select-none text-muted-foreground/30 text-[10px]">
        {lineNo}
      </span>
      <pre className="flex-1 px-2 whitespace-pre-wrap break-all">
        {tokens && tokens.length > 0 ? (
          tokens.map((token, i) => (
            <span key={i} style={{ color: token.color }}>
              {token.content}
            </span>
          ))
        ) : (
          <span className="text-muted-foreground">
            {content || <span className="text-muted-foreground/20">{"↵"}</span>}
          </span>
        )}
      </pre>
    </div>
  );
}

interface UnchangedBlockProps {
  lines: string[];
  tokens: ThemedToken[][] | null;
  startTokenLine: number;
  startLineNo: number;
}

function UnchangedBlock({
  lines,
  tokens,
  startTokenLine,
  startLineNo,
}: UnchangedBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse = lines.length > 8;

  if (shouldCollapse && !expanded) {
    const topLines = lines.slice(0, 3);
    const bottomLines = lines.slice(-3);
    const hiddenCount = lines.length - 6;
    return (
      <div>
        {topLines.map((line, li) => (
          <UnchangedLine
            key={li}
            content={line}
            lineNo={startLineNo + li}
            tokens={tokens?.[startTokenLine + li]}
          />
        ))}
        <button
          onClick={() => setExpanded(true)}
          className="w-full px-2 py-0.5 text-[10px] text-muted-foreground/50 bg-secondary/50 hover:bg-secondary transition-colors text-center"
        >
          {"⋯ "}
          {hiddenCount} unchanged line{hiddenCount !== 1 ? "s" : ""}
          {" ⋯"}
        </button>
        {bottomLines.map((line, li) => {
          const actualIdx = lines.length - 3 + li;
          return (
            <UnchangedLine
              key={`b-${li}`}
              content={line}
              lineNo={startLineNo + actualIdx}
              tokens={tokens?.[startTokenLine + actualIdx]}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div
      style={{
        contentVisibility: "auto",
        containIntrinsicSize: `auto ${lines.length * 20}px`,
      }}
    >
      {lines.map((line, li) => (
        <UnchangedLine
          key={li}
          content={line}
          lineNo={startLineNo + li}
          tokens={tokens?.[startTokenLine + li]}
        />
      ))}
    </div>
  );
}

function UnchangedLine({
  content,
  lineNo,
  tokens,
}: {
  content: string;
  lineNo: number;
  tokens?: ThemedToken[];
}) {
  return (
    <div className="flex opacity-50">
      <span className="w-5 shrink-0" />
      <span className="w-9 shrink-0 text-right pr-2 select-none text-muted-foreground/30 text-[10px]">
        {lineNo}
      </span>
      <pre className="flex-1 px-2 whitespace-pre-wrap break-all">
        {tokens && tokens.length > 0 ? (
          tokens.map((token, i) => (
            <span key={i} style={{ color: token.color }}>
              {token.content}
            </span>
          ))
        ) : (
          <span className="text-muted-foreground">{content || <span className="text-muted-foreground/20">{"↵"}</span>}</span>
        )}
      </pre>
    </div>
  );
}

interface ChangedBlockProps {
  lines: string[];
  tokens: ThemedToken[][] | null;
  startTokenLine: number;
  startLineNo: number;
  side: "ours" | "theirs";
  isChunkSelected: boolean;
  selectedLines: Set<number>;
  onToggleChunk: () => void;
  onToggleLine: (lineIndex: number) => void;
  baseLines?: string[];
  baseTokens?: ThemedToken[][] | null;
  baseStartLine?: number;
}

function ChangedBlock({
  lines,
  tokens,
  startTokenLine,
  startLineNo,
  side,
  isChunkSelected,
  selectedLines,
  onToggleChunk,
  onToggleLine,
  baseLines,
  baseTokens,
  baseStartLine,
}: ChangedBlockProps) {
  const [baseExpanded, setBaseExpanded] = useState(false);
  const borderClass =
    side === "ours" ? "border-l-blue-500/50" : "border-l-purple-500/50";

  const hasBase = baseLines && baseLines.length > 0;

  return (
    <div className={`border-l-2 ${borderClass}`}>
      {/* Collapsible base (ancestor) section — always rendered so both sides match */}
      {hasBase && (
        <div className="bg-zinc-500/[0.06] border-b border-border/30">
          <button
            onClick={() => setBaseExpanded((v) => !v)}
            className="flex items-center gap-1 w-full px-2 py-0.5 text-[10px] text-muted-foreground/60 hover:text-muted-foreground/80 transition-colors"
          >
            {baseExpanded ? (
              <ChevronDown className="w-3 h-3 shrink-0" />
            ) : (
              <ChevronRight className="w-3 h-3 shrink-0" />
            )}
            <span>
              Base · {baseLines.length} line{baseLines.length !== 1 ? "s" : ""}
            </span>
          </button>
          {baseExpanded && (
            <div className="opacity-60">
              {baseLines.map((line, li) => {
                const tokenLine = baseStartLine ? baseStartLine - 1 + li : -1;
                return (
                  <div key={li} className="flex">
                    <span className="w-5 shrink-0" />
                    <span className="w-9 shrink-0 text-right pr-2 select-none text-muted-foreground/30 text-[10px]">
                      {baseStartLine ? baseStartLine + li : ""}
                    </span>
                    <pre className="flex-1 px-2 whitespace-pre-wrap break-all">
                      {baseTokens?.[tokenLine]?.length ? (
                        baseTokens[tokenLine].map(
                          (token: ThemedToken, i: number) => (
                            <span key={i} style={{ color: token.color }}>
                              {token.content}
                            </span>
                          ),
                        )
                      ) : (
                        <span className="text-muted-foreground">
                          {line || <span className="text-muted-foreground/20">{"↵"}</span>}
                        </span>
                      )}
                    </pre>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="flex">
        {/* Side column: checkbox centered vertically */}
        {lines.length > 0 ? (
          <div
            className={`shrink-0 w-7 flex flex-col items-center justify-center cursor-pointer select-none transition-colors ${
              side === "ours"
                ? "bg-blue-500/[0.06] hover:bg-blue-500/10"
                : "bg-purple-500/[0.06] hover:bg-purple-500/10"
            }`}
            onClick={onToggleChunk}
            title={`${isChunkSelected ? "Deselect" : "Select"} all ${side} lines`}
          >
            <span
              className={`w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors ${
                isChunkSelected
                  ? side === "ours"
                    ? "bg-blue-500 text-white"
                    : "bg-purple-500 text-white"
                  : "border border-muted-foreground/30"
              }`}
            >
              {isChunkSelected && <Check className="w-2.5 h-2.5" />}
            </span>
          </div>
        ) : (
          <div className="shrink-0 w-7" />
        )}

        {/* Lines or deleted label */}
        <div className="flex-1 min-w-0">
          {lines.length > 0 ? (
            lines.map((line, li) => {
              const isSelected = selectedLines.has(li);
              return (
                <div
                  key={li}
                  className={`flex group/cline cursor-pointer transition-colors ${
                    isSelected
                      ? side === "ours"
                        ? "bg-blue-500/10"
                        : "bg-purple-500/10"
                      : side === "ours"
                        ? "bg-blue-500/[0.04]"
                        : "bg-purple-500/[0.04]"
                  }`}
                  onClick={() => onToggleLine(li)}
                >
                  <span className="w-5 shrink-0 flex items-center justify-center select-none">
                    <span
                      className={`w-3.5 h-3.5 rounded-sm flex items-center justify-center opacity-0 group-hover/cline:opacity-100 transition-opacity ${
                        side === "ours" ? "text-blue-400" : "text-purple-400"
                      }`}
                    >
                      {isSelected ? (
                        <Minus className="w-2.5 h-2.5" />
                      ) : (
                        <Plus className="w-2.5 h-2.5" />
                      )}
                    </span>
                  </span>
                  <span className="w-9 shrink-0 text-right pr-2 select-none text-muted-foreground/30 text-[10px]">
                    {startLineNo + li}
                  </span>
                  <pre className="flex-1 px-2 whitespace-pre-wrap break-all">
                    {tokens?.[startTokenLine + li]?.length ? (
                      tokens[startTokenLine + li].map(
                        (token: ThemedToken, i: number) => (
                          <span key={i} style={{ color: token.color }}>
                            {token.content}
                          </span>
                        ),
                      )
                    ) : (
                      <span className="text-muted-foreground">
                        {line || <span className="text-muted-foreground/20">{"↵"}</span>}
                      </span>
                    )}
                  </pre>
                </div>
              );
            })
          ) : (
            <div className="px-2 py-0.5">
              <span
                className={`text-[10px] italic ${
                  side === "ours" ? "text-blue-400/30" : "text-purple-400/30"
                }`}
              >
                — deleted —
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Scrollbar minimap ───────────────────────────────────────

function ScrollMinimap({
  regions,
  side,
}: {
  regions: DiffRegion[];
  side: "ours" | "theirs";
}) {
  const markers = useMemo(() => {
    let totalLines = 0;
    const positions: { top: number; lines: number }[] = [];

    for (const region of regions) {
      const lines =
        side === "ours" ? region.aLines.length : region.bLines.length;
      if (region.type === "changed") {
        positions.push({ top: totalLines, lines: Math.max(lines, 1) });
      }
      totalLines += lines;
    }

    if (totalLines === 0 || positions.length === 0) return [];

    return positions.map((p) => ({
      topPct: (p.top / totalLines) * 100,
      heightPct: Math.max(0.4, (p.lines / totalLines) * 100),
    }));
  }, [regions, side]);

  if (markers.length === 0) return null;

  return (
    <div className="absolute top-0 right-0 bottom-0 w-[6px] z-10 pointer-events-none">
      {markers.map((m, i) => (
        <div
          key={i}
          className="absolute right-[1px] w-[4px] rounded-full bg-amber-500/70"
          style={{
            top: `${m.topPct}%`,
            height: `${m.heightPct}%`,
            minHeight: 3,
          }}
        />
      ))}
    </div>
  );
}
