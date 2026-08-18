import { useCallback, useEffect, useMemo, useRef, useState, memo } from "react";
import { highlightLines, detectLang } from "@/lib/shiki";
import { useThemeStore } from "@/stores/theme-store";
import {
  computeDiffRegions,
  buildOutputWithSources,
  selectAllOurs,
  selectAllTheirs,
  type ChunkSelection,
  isEditableRegion,
  type DiffRegion,
} from "@/lib/conflict-regions";
import { useRepoStore } from "@/stores/repo-store";
import { BinaryConflictResolver } from "@/components/staging/binary-conflict-resolver";
import { getUiState } from "@/lib/database";
import { getDataAttrFromEvent } from "@/lib/utils";
import { isHeavyConflict } from "@/lib/diff-size";
import { AlertTriangle, ArrowLeft, Check, ChevronDown, ChevronRight, ExternalLink, Eye, EyeOff, FoldVertical, GitCompare, Minus, Plus, RotateCcw, Save, UnfoldVertical } from "lucide-react";
import { AbortButton } from "@/components/ui/abort-button";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import type { ThemedToken } from "shiki";
import { LINE_CONTAINMENT, SCROLL_CONTAINER_STYLE } from "@/lib/diff-styles";

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
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ stroke: "rgba(var(--conflict-ours), 0.8)" }}
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
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ stroke: "rgba(var(--conflict-theirs), 0.8)" }}
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
  const openInEditor = useRepoStore((s) => s.openInEditor);
  const resolveConflictManual = useRepoStore((s) => s.resolveConflictManual);
  const loadConflictContents = useRepoStore((s) => s.loadConflictContents);
  const rebaseProgress = useRepoStore((s) => s.rebaseProgress);
  const clearDiff = useRepoStore((s) => s.clearDiff);
  const conflictState = useRepoStore((s) => s.conflictState);
  const diffExpandContext = useRepoStore((s) => s.diffExpandContext);
  const setDiffExpandContext = useRepoStore((s) => s.setDiffExpandContext);
  const conflictShowBase = useRepoStore((s) => s.conflictShowBase);
  const setConflictShowBase = useRepoStore((s) => s.setConflictShowBase);
  const fileStatuses = useRepoStore((s) => s.fileStatuses);
  const selectFile = useRepoStore((s) => s.selectFile);
  const codeTheme = useThemeStore((s) => s.codeTheme);
  const shikiThemeId = codeTheme.shikiTheme.name;

  const [saving, setSaving] = useState(false);
  const [loadHeavy, setLoadHeavy] = useState(false);
  // Three panes of a 4 MB file with 2 MB lines lock the app up, and a rebase
  // opens the first conflicted file on its own — so gate the work, not just
  // the render: regions, highlighting and DOM all wait for "Load anyway".
  const heavy = useMemo(
    () => conflictContents != null && isHeavyConflict(conflictContents),
    [conflictContents],
  );
  const oversized = heavy && !loadHeavy;
  const [selections, setSelections] = useState<Map<number, ChunkSelection>>(
    new Map(),
  );
  const outputScrollRef = useRef<HTMLDivElement>(null);

  // ── Synchronized expand/collapse (ours ↔ theirs) ───────────
  // null = untouched for this conflict, so the sticky "Expand" preference decides.
  // Derived sets and the toggles live below, once the expandable keys are known.
  const [expandedRegionsState, setExpandedRegions] = useState<Set<number> | null>(null);
  const [expandedBasesState, setExpandedBases] = useState<Set<number> | null>(null);
  const [showAutoResolved, setShowAutoResolved] = useState(false);
  const [autoResolveEnabled, setAutoResolveEnabled] = useState(false);
  const didAutoResolve = useRef(false);

  useEffect(() => {
    getUiState("conflict_auto_resolve").then((v) => {
      if (v === "true") setAutoResolveEnabled(true);
    }).catch(() => {});
  }, []);

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
    if (!conflictContents || oversized) return [];
    return computeDiffRegions(
      conflictContents.ours,
      conflictContents.theirs,
      conflictContents.base ?? undefined,
    );
  }, [conflictContents, oversized]);

  // Suspicious auto-resolves are treated as changed (editable) regions
  const suspiciousIndices = useMemo(
    () => regions.reduce<number[]>((acc, r, i) => {
      if (r.type === "auto-resolved" && r.suspiciousGroup != null) acc.push(i);
      return acc;
    }, []),
    [regions],
  );

  const changedChunkIndices = useMemo(
    () =>
      regions
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => isEditableRegion(r))
        .map(({ i }) => i),
    [regions],
  );

  const autoResolvedCount = useMemo(
    () => regions.filter((r) => r.type === "auto-resolved" && r.suspiciousGroup == null).length,
    [regions],
  );

  const baseRegionIndices = useMemo(
    () => regions.reduce<number[]>((acc, r, i) => {
      if (isEditableRegion(r) && r.baseLines && r.baseLines.length > 0) acc.push(i);
      return acc;
    }, []),
    [regions],
  );


  // Default selections for suspicious regions: pre-check the auto-resolved side.
  // Computed once from regions, merged into selections at read time.
  const suspiciousDefaults = useMemo(() => {
    const defaults = new Map<number, ChunkSelection>();
    for (const idx of suspiciousIndices) {
      const region = regions[idx];
      if (region.autoSide === "ours") {
        defaults.set(idx, {
          oursLines: new Set(region.aLines.map((_, i) => i)),
          theirsLines: new Set<number>(),
          order: "ours-first",
        });
      } else {
        defaults.set(idx, {
          oursLines: new Set<number>(),
          theirsLines: new Set(region.bLines.map((_, i) => i)),
          order: "theirs-first",
        });
      }
    }
    return defaults;
  }, [suspiciousIndices, regions]);

  // Effective selections: user selections override suspicious defaults
  const effectiveSelections = useMemo(() => {
    if (suspiciousDefaults.size === 0) return selections;
    const merged = new Map(suspiciousDefaults);
    for (const [k, v] of selections) merged.set(k, v);
    return merged;
  }, [selections, suspiciousDefaults]);

  // Auto-show auto-resolved regions only when there are no real conflicts.
  /* eslint-disable react-hooks/set-state-in-effect -- intentional one-time sync when conflict data loads */
  useEffect(() => {
    if (changedChunkIndices.length === 0 && autoResolvedCount > 0) {
      setShowAutoResolved(true);
    } else if (changedChunkIndices.length > 0) {
      setShowAutoResolved(false);
    }
  }, [changedChunkIndices.length, autoResolvedCount]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Reconstruct display texts from processed regions so syntax highlighting
  // tokens align with the actual rendered content (3-way auto-resolution can
  // change line counts vs the raw ours/theirs text).
  const oursDisplayText = useMemo(
    () => regions.flatMap((r) =>
      r.type === "auto-resolved" && r.suspiciousGroup == null
        ? (r.autoSide === "theirs" ? r.bLines : r.aLines)
        : r.aLines
    ).join("\n"),
    [regions],
  );
  const theirsDisplayText = useMemo(
    () => regions.flatMap((r) =>
      r.type === "auto-resolved" && r.suspiciousGroup == null
        ? (r.autoSide === "theirs" ? r.bLines : r.aLines)
        : r.bLines
    ).join("\n"),
    [regions],
  );

  // ── Output assembly ────────────────────────────────────────

  const {
    text: outputText,
    lines: outputLines,
    sources: outputSources,
    mappings: outputMappings,
  } = useMemo(
    () => buildOutputWithSources(regions, effectiveSelections),
    [regions, effectiveSelections],
  );

  // Keep store in sync so file-list context menu can "Save Resolution"
  useEffect(() => {
    useRepoStore.setState({ conflictOutputText: outputText });
  }, [outputText]);

  // Experimental: auto-save when all conflicts are auto-resolved (skip if suspicious)
  useEffect(() => {
    if (didAutoResolve.current) return;
    if (autoResolveEnabled && changedChunkIndices.length === 0 && autoResolvedCount > 0 && suspiciousIndices.length === 0 && outputText) {
      didAutoResolve.current = true;
      resolveConflictManual(filePath, outputText).catch(() => {});
    }
  }, [autoResolveEnabled, changedChunkIndices.length, autoResolvedCount, suspiciousIndices.length, outputText, filePath, resolveConflictManual]);

  // ── Syntax highlighting ────────────────────────────────────

  const lang = useMemo(() => detectLang(filePath), [filePath]);
  const [oursTokens, setOursTokens] = useState<ThemedToken[][] | null>(null);
  const [theirsTokens, setTheirsTokens] = useState<ThemedToken[][] | null>(
    null,
  );
  const [baseTokens, setBaseTokens] = useState<ThemedToken[][] | null>(null);

  useEffect(() => {
    if (!conflictContents || oversized) return;
    let cancelled = false;
    async function highlight() {
      try {
        const promises: Promise<ThemedToken[][]>[] = [
          highlightLines(oursDisplayText, lang, shikiThemeId),
          highlightLines(theirsDisplayText, lang, shikiThemeId),
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
  }, [conflictContents, oversized, lang, shikiThemeId, oursDisplayText, theirsDisplayText]);

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
      if (!region) return;
      if (!isEditableRegion(region)) return;

      const cur = effectiveSelections.get(regionIndex);
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
    [regions, effectiveSelections],
  );

  const toggleChunkTheirs = useCallback(
    (regionIndex: number) => {
      const region = regions[regionIndex];
      if (!region) return;
      if (!isEditableRegion(region)) return;

      const cur = effectiveSelections.get(regionIndex);
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
    [regions, effectiveSelections],
  );

  const toggleLine = useCallback(
    (regionIndex: number, side: "ours" | "theirs", lineIndex: number) => {
      const region = regions[regionIndex];
      if (!region) return;
      if (!isEditableRegion(region)) return;

      const cur = effectiveSelections.get(regionIndex) ?? {
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
    [regions, effectiveSelections],
  );

  // Master checkbox state — derived from current selections, not stored
  const masterSide = useMemo((): "ours" | "theirs" | null => {
    if (changedChunkIndices.length === 0) return null;
    const allOurs = changedChunkIndices.every((idx) => {
      const sel = effectiveSelections.get(idx);
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
      const sel = effectiveSelections.get(idx);
      const region = regions[idx];
      return (
        sel &&
        sel.theirsLines.size === region.bLines.length &&
        sel.oursLines.size === 0
      );
    });
    if (allTheirs) return "theirs";
    return null;
  }, [effectiveSelections, changedChunkIndices, regions]);

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

  // ── Line drag selection ────────────────────────────────────

  const conflictDragRef = useRef<{
    active: boolean;
    addMode: boolean;
    regionIndex: number;
    side: "ours" | "theirs";
    startLine: number;
    lastLine: number;
    baseSel: ChunkSelection;
  } | null>(null);

  const getConflictKeyFromEvent = useCallback((e: React.MouseEvent | MouseEvent) => {
    const raw = getDataAttrFromEvent(e, "data-conflict-key");
    if (!raw) return null;
    const parts = raw.split(":");
    return { regionIndex: parseInt(parts[0]), side: parts[1] as "ours" | "theirs", lineIndex: parseInt(parts[2]) };
  }, []);

  const handlePaneMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const info = getConflictKeyFromEvent(e);
    if (!info) return;

    const { regionIndex, side, lineIndex } = info;
    const region = regions[regionIndex];
    if (!region || !isEditableRegion(region)) return;

    e.preventDefault();

    const cur = effectiveSelections.get(regionIndex);
    const isSelected = cur
      ? (side === "ours" ? cur.oursLines : cur.theirsLines).has(lineIndex)
      : side === "ours";
    const willSelect = !isSelected;

    const baseSel: ChunkSelection = cur
      ? { oursLines: new Set(cur.oursLines), theirsLines: new Set(cur.theirsLines), order: cur.order }
      : { oursLines: new Set(region.aLines.map((_, i) => i)), theirsLines: new Set<number>(), order: "ours-first" };

    conflictDragRef.current = {
      active: true,
      addMode: willSelect,
      regionIndex,
      side,
      startLine: lineIndex,
      lastLine: lineIndex,
      baseSel,
    };

    toggleLine(regionIndex, side, lineIndex);
  }, [getConflictKeyFromEvent, regions, effectiveSelections, toggleLine]);

  const handlePaneMouseMove = useCallback((e: React.MouseEvent) => {
    if (!conflictDragRef.current?.active) return;
    const info = getConflictKeyFromEvent(e);
    if (!info) return;

    const { regionIndex, side, lineIndex } = info;
    const drag = conflictDragRef.current;
    if (regionIndex !== drag.regionIndex || side !== drag.side) return;
    if (lineIndex === drag.lastLine) return;

    drag.lastLine = lineIndex;

    const start = Math.min(drag.startLine, lineIndex);
    const end = Math.max(drag.startLine, lineIndex);

    const newOurs = new Set(drag.baseSel.oursLines);
    const newTheirs = new Set(drag.baseSel.theirsLines);
    const target = side === "ours" ? newOurs : newTheirs;

    for (let i = start; i <= end; i++) {
      if (drag.addMode) target.add(i); else target.delete(i);
    }

    setSelections((prev) => {
      const next = new Map(prev);
      next.set(regionIndex, { oursLines: newOurs, theirsLines: newTheirs, order: drag.baseSel.order });
      return next;
    });
  }, [getConflictKeyFromEvent]);

  useEffect(() => {
    const handleMouseUp = () => {
      if (conflictDragRef.current?.active) conflictDragRef.current.active = false;
    };
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
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
    for (let i = 0; i < regions.length; i++) {
      const region = regions[i];
      result.push({ oursStart: aLine, theirsStart: bLine });
      if (!isEditableRegion(region) && region.type === "auto-resolved") {
        const winLen = (region.autoSide === "theirs" ? region.bLines : region.aLines).length;
        aLine += winLen;
        bLine += winLen;
      } else {
        aLine += region.aLines.length;
        bLine += region.bLines.length;
      }
    }
    return result;
  }, [regions]);

  // ── Display items (merge consecutive unchanged + hidden auto-resolved) ──

  const displayItems = useMemo((): DisplayItem[] => {
    const items: DisplayItem[] = [];

    for (let ri = 0; ri < regions.length; ri++) {
      const region = regions[ri];
      if (isEditableRegion(region)) {
        items.push({ type: "changed", regionIndex: ri });
        continue;
      }

      if (region.type === "auto-resolved" && showAutoResolved) {
        items.push({ type: "auto-resolved", regionIndex: ri });
        continue;
      }

      const info = regionLineInfo[ri];
      const winLines = region.type === "auto-resolved"
        ? (region.autoSide === "theirs" ? region.bLines : region.aLines)
        : null;
      const oLines = winLines ?? region.aLines;
      const tLines = winLines ?? region.bLines;
      const oStartLine = winLines
        ? (region.autoSide === "theirs" ? region.bStartLine : region.aStartLine)
        : region.aStartLine;
      const tStartLine = winLines
        ? (region.autoSide === "theirs" ? region.bStartLine : region.aStartLine)
        : region.bStartLine;

      const prev = items[items.length - 1];
      if (prev && prev.type === "unchanged") {
        prev.oursLines.push(...oLines);
        prev.theirsLines.push(...tLines);
      } else {
        items.push({
          type: "unchanged",
          expandKey: ri,
          oursLines: [...oLines],
          oursStartLineNo: oStartLine,
          oursTokenStart: info.oursStart,
          theirsLines: [...tLines],
          theirsStartLineNo: tStartLine,
          theirsTokenStart: info.theirsStart,
        });
      }
    }

    return items;
  }, [regions, regionLineInfo, showAutoResolved]);

  const unchangedExpandKeys = useMemo(
    () => displayItems.filter((d) => d.type === "unchanged").map((d) => d.expandKey),
    [displayItems],
  );

  const expandedRegions = useMemo(
    () => expandedRegionsState ?? new Set(diffExpandContext ? unchangedExpandKeys : []),
    [expandedRegionsState, diffExpandContext, unchangedExpandKeys],
  );
  const expandedBases = useMemo(
    () => expandedBasesState ?? new Set(conflictShowBase ? baseRegionIndices : []),
    [expandedBasesState, conflictShowBase, baseRegionIndices],
  );

  const toggleRegionExpanded = useCallback((regionIndex: number) => {
    const next = new Set(expandedRegions);
    if (next.has(regionIndex)) next.delete(regionIndex);
    else next.add(regionIndex);
    setExpandedRegions(next);
  }, [expandedRegions]);

  const toggleBaseExpanded = useCallback((regionIndex: number) => {
    const next = new Set(expandedBases);
    if (next.has(regionIndex)) next.delete(regionIndex);
    else next.add(regionIndex);
    setExpandedBases(next);
  }, [expandedBases]);

  // Two independent toggles: unchanged context (shared with the diff pane) and
  // the per-conflict base sections. Toggling one must never move the other.
  const allContextExpanded = useMemo(
    () => unchangedExpandKeys.length > 0 && unchangedExpandKeys.every((k) => expandedRegions.has(k)),
    [unchangedExpandKeys, expandedRegions],
  );
  const allBasesExpanded = useMemo(
    () => baseRegionIndices.length > 0 && baseRegionIndices.every((i) => expandedBases.has(i)),
    [baseRegionIndices, expandedBases],
  );

  const toggleExpandAll = useCallback(() => {
    setDiffExpandContext(!allContextExpanded);
    setExpandedRegions(allContextExpanded ? new Set() : new Set(unchangedExpandKeys));
  }, [allContextExpanded, unchangedExpandKeys, setDiffExpandContext]);

  const toggleAllBases = useCallback(() => {
    setConflictShowBase(!allBasesExpanded);
    setExpandedBases(allBasesExpanded ? new Set() : new Set(baseRegionIndices));
  }, [allBasesExpanded, baseRegionIndices, setConflictShowBase]);

  const conflictNumberMap = useMemo(() => {
    const map = new Map<number, number>();
    let n = 1;
    for (const item of displayItems) {
      if (item.type === "changed") {
        map.set(item.regionIndex, n++);
      }
    }
    return map;
  }, [displayItems]);

  const outputDisplayRanges = useMemo(() => {
    const ranges: { startIdx: number; count: number }[] = [];
    let idx = 0;
    for (const item of displayItems) {
      if (item.type === "unchanged") {
        const count = item.oursLines.length;
        ranges.push({ startIdx: idx, count });
        idx += count;
      } else if (item.type === "auto-resolved") {
        const region = regions[item.regionIndex];
        const count = (region.autoSide === "theirs" ? region.bLines : region.aLines).length;
        ranges.push({ startIdx: idx, count });
        idx += count;
      } else {
        const sel = effectiveSelections.get(item.regionIndex);
        const region = regions[item.regionIndex];
        const count = sel ? sel.oursLines.size + sel.theirsLines.size : region.aLines.length;
        ranges.push({ startIdx: idx, count });
        idx += count;
      }
    }
    return ranges;
  }, [displayItems, regions, effectiveSelections]);

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
        oursRegions[i].style.minHeight = "0";
        theirsRegions[i].style.minHeight = "0";
      }

      const heights: number[] = [];
      for (let i = 0; i < count; i++) {
        heights.push(Math.max(oursRegions[i].offsetHeight, theirsRegions[i].offsetHeight));
      }

      for (let i = 0; i < count; i++) {
        oursRegions[i].style.minHeight = `${heights[i]}px`;
        theirsRegions[i].style.minHeight = `${heights[i]}px`;
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
  }, [regions, expandedRegions, expandedBases, showAutoResolved]);

  // ── Open on the first conflict ─────────────────────────────
  // With unchanged context expanded the first conflict can be thousands of
  // lines down. Runs after the equalizer above, so the offset is final; the
  // pane's own onScroll drags the other two along.
  const didScrollToFirstConflict = useRef(false);
  useEffect(() => {
    if (didScrollToFirstConflict.current) return;
    const pane = oursScrollRef.current;
    const first = changedChunkIndices[0];
    if (!pane || first == null) return;
    const el = pane.querySelector<HTMLElement>(`[data-region-idx="${first}"]`);
    if (!el) return;
    didScrollToFirstConflict.current = true;
    requestAnimationFrame(() => {
      pane.scrollTop +=
        el.getBoundingClientRect().top - pane.getBoundingClientRect().top - pane.clientHeight / 2;
    });
  }, [changedChunkIndices, expandedRegions, expandedBases, showAutoResolved]);

  // ── Cross-pane hover highlight ─────────────────────────────
  // Delegated mouseover on the panes container: read `data-hover-key` off the
  // hovered line and toggle a CSS class on every element with the same key
  // (including the corresponding line in the other panes). Done with direct
  // DOM mutation rather than React state so hovering doesn't re-render the
  // hundreds of memoized line components in the viewport.
  const hoverKeyRef = useRef<string | null>(null);
  const highlightedRef = useRef<Element[]>([]);
  const applyHover = useCallback((key: string | null) => {
    for (const el of highlightedRef.current) {
      el.classList.remove("conflict-line-hover");
    }
    highlightedRef.current = [];
    hoverKeyRef.current = key;
    const root = contentRef.current;
    if (!key || !root) return;
    const escaped = (window.CSS && CSS.escape) ? CSS.escape(key) : key.replace(/"/g, '\\"');
    const nodes = root.querySelectorAll(`[data-hover-key="${escaped}"]`);
    for (const el of nodes) el.classList.add("conflict-line-hover");
    highlightedRef.current = Array.from(nodes);
  }, []);

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const onOver = (e: MouseEvent) => {
      const key = getDataAttrFromEvent(e, "data-hover-key", root);
      if (key !== hoverKeyRef.current) applyHover(key);
    };
    const onLeave = () => applyHover(null);
    root.addEventListener("mouseover", onOver);
    root.addEventListener("mouseleave", onLeave);
    return () => {
      root.removeEventListener("mouseover", onOver);
      root.removeEventListener("mouseleave", onLeave);
      applyHover(null);
    };
  }, [applyHover]);

  // Re-apply after the output pane rebuilds: toggling a chunk inserts new
  // output rows that share the hovered key, and they'd stay unhighlighted
  // until the next mouse move otherwise.
  useEffect(() => {
    if (hoverKeyRef.current) applyHover(hoverKeyRef.current);
  }, [outputLines, applyHover]);

  // ── Render ─────────────────────────────────────────────────

  if (!conflictContents) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Loading conflict contents...
      </div>
    );
  }

  // Binary files (images, etc.) can't be merged line-by-line — show a
  // whole-side picker instead of the text diff editor, which would otherwise
  // choke on lossy-decoded binary content and hang the UI.
  if (conflictContents.is_binary) {
    return <BinaryConflictResolver filePath={filePath} contents={conflictContents} />;
  }

  if (oversized) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">
          Large file — rendering the conflict may freeze the app
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setLoadHeavy(true)}
            className="rounded-md bg-secondary px-4 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-accent"
          >
            Load anyway
          </button>
          <button
            onClick={() => openInEditor(filePath)}
            className="rounded-md px-4 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Open in editor
          </button>
        </div>
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
      <div className="flex items-center gap-2 pl-2 pr-3 py-1 border-b border-border bg-background shrink-0">
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton onClick={clearDiff} className="shrink-0">
              <ArrowLeft className="h-3.5 w-3.5" />
            </IconButton>
          </TooltipTrigger>
          <TooltipContent>Back to graph</TooltipContent>
        </Tooltip>
        <span className="truncate text-xs font-medium text-foreground min-w-0" title={filePath}>
          {filePath}
        </span>
        <span className="w-px h-4 bg-border shrink-0" />
        <GitCompare className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground shrink-0">
          {rebaseProgress && conflictState?.operation === "rebase" && (
            <span>Step {rebaseProgress.step}/{rebaseProgress.total} · </span>
          )}
          {changedChunkIndices.length} conflict
          {changedChunkIndices.length !== 1 ? "s" : ""}
        </span>
        {rebaseProgress && conflictState?.operation === "rebase" && (rebaseProgress.commit_id || conflictContents?.rebase_commit_message) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs text-muted-foreground/50 truncate min-w-0">
                {rebaseProgress.commit_id && (
                  <span className="font-mono">{rebaseProgress.commit_id}</span>
                )}
                {conflictContents?.rebase_commit_message && (
                  <span className="ml-1 italic">{conflictContents.rebase_commit_message}</span>
                )}
              </span>
            </TooltipTrigger>
            {conflictContents?.rebase_commit_message && (
              <TooltipContent className="max-w-md">{conflictContents.rebase_commit_message}</TooltipContent>
            )}
          </Tooltip>
        )}
        {autoResolvedCount > 0 && (
          <div className="flex items-center rounded-md bg-secondary p-0.5 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setShowAutoResolved((v) => !v)}
                  className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-colors ${
                    showAutoResolved
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {showAutoResolved ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  <span>{autoResolvedCount} auto-resolved</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>{showAutoResolved ? "Hide auto-resolved" : "Show auto-resolved"}</TooltipContent>
            </Tooltip>
          </div>
        )}
        {baseRegionIndices.length > 0 && (
          <div className="flex items-center rounded-md bg-secondary p-0.5 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleAllBases}
                  className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-colors ${
                    allBasesExpanded
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {allBasesExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  <span>Base</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>{allBasesExpanded ? "Hide all base sections" : "Show all base sections"}</TooltipContent>
            </Tooltip>
          </div>
        )}
        {unchangedExpandKeys.length > 0 && (
          <div className="flex items-center rounded-md bg-secondary p-0.5 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleExpandAll}
                  className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-colors ${
                    allContextExpanded
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {allContextExpanded ? <FoldVertical className="w-3.5 h-3.5" /> : <UnfoldVertical className="w-3.5 h-3.5" />}
                  <span>{allContextExpanded ? "Fold" : "Expand"}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>{allContextExpanded ? "Collapse all context" : "Expand all context"}</TooltipContent>
            </Tooltip>
          </div>
        )}
        <div className="flex items-center gap-1 ml-auto shrink-0">
          {(() => {
            const otherConflicts = fileStatuses.filter(
              (f) => f.is_conflicted && f.path !== filePath,
            );
            if (otherConflicts.length === 0) return null;
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => selectFile(otherConflicts[0].path, false)}
                    className="flex items-center gap-1 rounded-md border border-orange-500/30 px-2.5 py-1 text-xs font-medium text-orange-100 transition-colors hover:bg-orange-500/20 hover:border-orange-500/40"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />
                    {otherConflicts.length} more conflict{otherConflicts.length !== 1 ? "s" : ""}
                  </button>
                </TooltipTrigger>
                <TooltipContent>Go to next conflict</TooltipContent>
              </Tooltip>
            );
          })()}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={resetSelections}
                className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground hover:border-border-hover"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset
              </button>
            </TooltipTrigger>
            <TooltipContent>Discard all choices and start over</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-md border border-[rgba(var(--conflict-output),0.3)] px-3 py-1 text-xs font-medium text-[var(--conflict-output-text)] transition-colors hover:bg-[rgba(var(--conflict-output),0.1)] hover:border-[rgba(var(--conflict-output),0.4)] disabled:opacity-40"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? "Saving..." : "Save Resolution"}
              </button>
            </TooltipTrigger>
            <TooltipContent>Write the output file and mark the conflict resolved</TooltipContent>
          </Tooltip>
          <AbortButton />
        </div>
      </div>

      {/* Resizable content area */}
      <div ref={contentRef} className="flex flex-col min-h-0 flex-1">
        {/* Reference panes */}
        <div ref={refPanesRef} className="flex min-h-0" style={{ flex: vSplit }}>
          {/* Ours pane */}
          <div className="flex flex-col overflow-hidden" style={{ flex: hSplit }}>
            {/* Header with master checkbox + icon + accept-all button */}
            <div className="shrink-0 px-3 py-0.5 border-b border-border bg-[rgba(var(--conflict-ours),0.05)] flex items-center gap-1.5">
              {/* Master checkbox */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleMasterOurs}
                    className={`w-4 h-4 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                      masterSide === "ours"
                        ? "bg-[rgb(var(--conflict-ours))] text-white"
                        : "border border-muted-foreground/30 hover:border-[rgba(var(--conflict-ours),0.5)]"
                    }`}
                  >
                    {masterSide === "ours" && <Check className="w-2.5 h-2.5" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent>Accept all from ours</TooltipContent>
              </Tooltip>
              <OursIcon />
              <div className="flex-1 min-w-0 flex items-center">
                <span className="text-xs font-medium text-[var(--conflict-ours-text)]">
                  Ours ({oursLabel})
                </span>
                {oursHash && (
                  <span className="text-caption text-muted-foreground/50 ml-1.5 font-mono">
                    {oursHash}
                  </span>
                )}
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleAcceptOurs}
                    disabled={saving}
                    className="shrink-0 flex items-center gap-1.5 rounded-md border border-[rgba(var(--conflict-ours),0.3)] px-3 py-1 text-xs font-medium text-[var(--conflict-ours-text)] transition-colors hover:bg-[rgba(var(--conflict-ours),0.1)] hover:border-[rgba(var(--conflict-ours),0.4)] disabled:opacity-40"
                  >
                    <Save className="w-3 h-3" />
                    Accept Ours
                  </button>
                </TooltipTrigger>
                <TooltipContent>Take every change from ours and resolve the file</TooltipContent>
              </Tooltip>
            </div>
            <div className="relative flex-1 min-h-0">
              <div
                ref={oursScrollRef}
                onScroll={() => syncScroll("ours")}
                onMouseDown={handlePaneMouseDown}
                onMouseMove={handlePaneMouseMove}
                className="absolute inset-0 overflow-auto text-xs font-mono leading-5"
                style={SCROLL_CONTAINER_STYLE}
              >
                {displayItems.map((item) => {
                  if (item.type === "unchanged") {
                    return (
                      <div key={`u-${item.expandKey}`} data-region-idx={item.expandKey}>
                        <UnchangedBlock
                          lines={item.oursLines}
                          tokens={oursTokens}
                          startTokenLine={item.oursTokenStart}
                          startLineNo={item.oursStartLineNo}
                          conflictGutter
                          expanded={expandedRegions.has(item.expandKey)}
                          onToggleExpand={() => toggleRegionExpanded(item.expandKey)}
                          hoverKeyPrefix={item.expandKey}
                        />
                      </div>
                    );
                  }
                  if (item.type === "auto-resolved") {
                    const ri = item.regionIndex;
                    return (
                      <div key={ri} data-region-idx={ri}>
                        <AutoResolvedBlock
                          side="ours"
                          region={regions[ri]}
                          tokens={oursTokens}
                          startTokenLine={regionLineInfo[ri].oursStart}
                          hoverKeyPrefix={ri}
                        />
                      </div>
                    );
                  }
                  const ri = item.regionIndex;
                  const region = regions[ri];
                  const sel = effectiveSelections.get(ri);
                  const isChecked =
                    region.aLines.length > 0 &&
                    (sel ? sel.oursLines.size === region.aLines.length : true);
                  return (
                    <div key={ri} data-region-idx={ri}>
                      <ChangedBlock
                        lines={region.aLines}
                        tokens={oursTokens}
                        startTokenLine={regionLineInfo[ri].oursStart}
                        startLineNo={region.aStartLine}
                        side="ours"
                        regionIndex={ri}
                        isChunkSelected={isChecked}
                        selectedLines={
                          sel?.oursLines ??
                          new Set(region.aLines.map((_, i) => i))
                        }
                        onToggleChunk={() => toggleChunkOurs(ri)}
                        conflictNumber={conflictNumberMap.get(ri)}
                        suspiciousGroup={region.suspiciousGroup}
                        baseLines={region.baseLines}
                        baseTokens={baseTokens}
                        baseStartLine={region.baseStartLine}
                        baseExpanded={expandedBases.has(ri)}
                        onToggleBaseExpand={() => toggleBaseExpanded(ri)}
                      />
                    </div>
                  );
                })}
              </div>
              <ScrollMinimap displayItems={displayItems} regions={regions} expandedRegions={expandedRegions} side="ours" />
            </div>
          </div>

          {/* Vertical resize handle (between ours/theirs) */}
          <div
            onMouseDown={onHDragStart}
            className="relative w-px shrink-0 cursor-col-resize bg-border hover:bg-accent transition-colors before:absolute before:inset-y-0 before:-left-1.5 before:w-3 before:cursor-col-resize"
          />

          {/* Theirs pane */}
          <div className="flex flex-col overflow-hidden" style={{ flex: 100 - hSplit }}>
            <div className="shrink-0 px-3 py-0.5 border-b border-border bg-[rgba(var(--conflict-theirs),0.05)] flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleMasterTheirs}
                    className={`w-4 h-4 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                      masterSide === "theirs"
                        ? "bg-[rgb(var(--conflict-theirs))] text-white"
                        : "border border-muted-foreground/30 hover:border-[rgba(var(--conflict-theirs),0.5)]"
                    }`}
                  >
                    {masterSide === "theirs" && <Check className="w-2.5 h-2.5" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent>Accept all from theirs</TooltipContent>
              </Tooltip>
              <TheirsIcon />
              <div className="flex-1 min-w-0 flex items-center">
                <span className="text-xs font-medium text-[var(--conflict-theirs-text)]">
                  Theirs ({theirsLabel})
                </span>
                {theirsHash && (
                  <span className="text-caption text-muted-foreground/50 ml-1.5 font-mono">
                    {theirsHash}
                  </span>
                )}
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleAcceptTheirs}
                    disabled={saving}
                    className="shrink-0 flex items-center gap-1.5 rounded-md border border-[rgba(var(--conflict-theirs),0.3)] px-3 py-1 text-xs font-medium text-[var(--conflict-theirs-text)] transition-colors hover:bg-[rgba(var(--conflict-theirs),0.1)] hover:border-[rgba(var(--conflict-theirs),0.4)] disabled:opacity-40"
                  >
                    <Save className="w-3 h-3" />
                    Accept Theirs
                  </button>
                </TooltipTrigger>
                <TooltipContent>Take every change from theirs and resolve the file</TooltipContent>
              </Tooltip>
            </div>
            <div className="relative flex-1 min-h-0">
              <div
                ref={theirsScrollRef}
                onScroll={() => syncScroll("theirs")}
                onMouseDown={handlePaneMouseDown}
                onMouseMove={handlePaneMouseMove}
                className="absolute inset-0 overflow-auto text-xs font-mono leading-5"
                style={SCROLL_CONTAINER_STYLE}
              >
                {displayItems.map((item) => {
                  if (item.type === "unchanged") {
                    return (
                      <div key={`u-${item.expandKey}`} data-region-idx={item.expandKey}>
                        <UnchangedBlock
                          lines={item.theirsLines}
                          tokens={theirsTokens}
                          startTokenLine={item.theirsTokenStart}
                          startLineNo={item.theirsStartLineNo}
                          conflictGutter
                          expanded={expandedRegions.has(item.expandKey)}
                          onToggleExpand={() => toggleRegionExpanded(item.expandKey)}
                          hoverKeyPrefix={item.expandKey}
                        />
                      </div>
                    );
                  }
                  if (item.type === "auto-resolved") {
                    const ri = item.regionIndex;
                    return (
                      <div key={ri} data-region-idx={ri}>
                        <AutoResolvedBlock
                          side="theirs"
                          region={regions[ri]}
                          tokens={theirsTokens}
                          startTokenLine={regionLineInfo[ri].theirsStart}
                          hoverKeyPrefix={ri}
                        />
                      </div>
                    );
                  }
                  const ri = item.regionIndex;
                  const region = regions[ri];
                  const sel = effectiveSelections.get(ri);
                  const isChecked =
                    region.bLines.length > 0 &&
                    (sel ? sel.theirsLines.size === region.bLines.length : false);
                  return (
                    <div key={ri} data-region-idx={ri}>
                      <ChangedBlock
                        lines={region.bLines}
                        tokens={theirsTokens}
                        startTokenLine={regionLineInfo[ri].theirsStart}
                        startLineNo={region.bStartLine}
                        side="theirs"
                        regionIndex={ri}
                        isChunkSelected={isChecked}
                        selectedLines={sel?.theirsLines ?? new Set<number>()}
                        onToggleChunk={() => toggleChunkTheirs(ri)}
                        conflictNumber={conflictNumberMap.get(ri)}
                        suspiciousGroup={region.suspiciousGroup}
                        baseLines={region.baseLines}
                        baseTokens={baseTokens}
                        baseStartLine={region.baseStartLine}
                        baseExpanded={expandedBases.has(ri)}
                        onToggleBaseExpand={() => toggleBaseExpanded(ri)}
                      />
                    </div>
                  );
                })}
              </div>
              <ScrollMinimap displayItems={displayItems} regions={regions} expandedRegions={expandedRegions} side="theirs" />
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
          <div className="shrink-0 px-3 py-0.5 text-xs font-medium text-[var(--conflict-output-text)] bg-[rgba(var(--conflict-output),0.05)] border-b border-border flex items-center gap-2">
            <span>Output</span>
            <div className="flex items-center gap-3 ml-auto">
              <span className="flex items-center gap-1 text-caption text-muted-foreground/60 font-normal">
                <OursIcon size={10} />
                ours
              </span>
              <span className="flex items-center gap-1 text-caption text-muted-foreground/60 font-normal">
                <TheirsIcon size={10} />
                theirs
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => openInEditor(filePath)}
                    className="shrink-0 flex items-center gap-1.5 rounded-md border border-[rgba(var(--conflict-output),0.3)] px-3 py-1 text-xs font-medium text-[var(--conflict-output-text)] transition-colors hover:bg-[rgba(var(--conflict-output),0.1)] hover:border-[rgba(var(--conflict-output),0.4)]"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Open in Editor
                  </button>
                </TooltipTrigger>
                <TooltipContent>Edit the conflicted file in your external editor</TooltipContent>
              </Tooltip>
            </div>
          </div>
          <div className="relative flex-1 min-h-0">
            <div
              ref={outputScrollRef}
              onScroll={() => syncScroll("output")}
              className="absolute inset-0 overflow-auto text-xs font-mono leading-5"
              style={SCROLL_CONTAINER_STYLE}
            >
              {displayItems.map((item, di) => {
                const range = outputDisplayRanges[di];
                if (!range) return null;
                const { startIdx, count } = range;

                if (item.type === "unchanged") {
                  return (
                    <UnchangedBlock
                      key={`ou-${item.expandKey}`}
                      lines={outputLines.slice(startIdx, startIdx + count)}
                      tokens={outputTokens}
                      startTokenLine={startIdx}
                      startLineNo={startIdx + 1}
                      expanded={expandedRegions.has(item.expandKey)}
                      hoverKeyPrefix={item.expandKey}
                      onToggleExpand={() => toggleRegionExpanded(item.expandKey)}
                    />
                  );
                }

                // Auto-resolved output lines come from the winner side in
                // positional order, so `a:{regionIndex}:{j}` matches the same
                // row in the winning pane. Changed items rearrange lines by
                // user selection, so use the origin recorded during output
                // assembly to point back at the source row
                // (`r:{ri}:{side}:{li}` — the side is part of the key because
                // ours and theirs both number their lines from 0).
                const autoPrefix = item.type === "auto-resolved" ? `a:${item.regionIndex}` : null;
                const outputHoverKey = (j: number) => {
                  if (autoPrefix) return `${autoPrefix}:${j}`;
                  const m = outputMappings[startIdx + j];
                  return m ? `r:${m.regionIndex}:${m.side}:${m.lineIndex}` : undefined;
                };
                return outputLines.slice(startIdx, startIdx + count).map((line, j) => (
                  <OutputLine
                    key={startIdx + j}
                    content={line}
                    lineNo={startIdx + j + 1}
                    source={outputSources[startIdx + j] === "auto-resolved" ? "auto-resolved" : outputSources[startIdx + j]}
                    tokens={outputTokens?.[startIdx + j]}
                    hoverKey={outputHoverKey(j)}
                  />
                ));
              })}
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

const OUTPUT_LINE_BG: Record<string, string> = {
  ours: "bg-[rgba(var(--conflict-ours),0.08)]",
  theirs: "bg-[rgba(var(--conflict-theirs),0.08)]",
  "auto-resolved": "bg-[rgba(var(--conflict-auto),0.08)]",
};

const OutputLine = memo(OutputLineImpl);

function OutputLineImpl({
  content,
  lineNo,
  source,
  tokens,
  hoverKey,
}: {
  content: string;
  lineNo: number;
  source: "unchanged" | "ours" | "theirs" | "auto-resolved";
  tokens?: ThemedToken[];
  hoverKey?: string;
}) {
  const bgClass = OUTPUT_LINE_BG[source] ?? "";
  const iconEl =
    source === "ours" ? (
      <OursIcon size={10} />
    ) : source === "theirs" ? (
      <TheirsIcon size={10} />
    ) : source === "auto-resolved" ? (
      <Check className="w-2.5 h-2.5" style={{ color: "var(--conflict-auto-text)" }} />
    ) : null;

  return (
    <div
      className={`flex ${bgClass} ${source === "unchanged" ? "opacity-80" : ""}`}
      style={LINE_CONTAINMENT}
      data-hover-key={hoverKey}
    >
      <span className="w-5 shrink-0 flex items-center justify-center">
        {iconEl}
      </span>
      <span className="w-9 shrink-0 text-right pr-2 select-none text-muted-foreground/30 text-caption">
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
  conflictGutter?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  /** Stable key prefix for cross-pane hover correspondence — same value in
   *  every pane that renders this unchanged block, combined with the local
   *  row index to produce `u:{prefix}:{rowIdx}`. Omit to disable hover. */
  hoverKeyPrefix?: string | number;
}

function UnchangedBlock({
  lines,
  tokens,
  startTokenLine,
  startLineNo,
  conflictGutter,
  expanded: controlledExpanded,
  onToggleExpand,
  hoverKeyPrefix,
}: UnchangedBlockProps) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = controlledExpanded ?? localExpanded;
  const toggleExpand = onToggleExpand ?? (() => setLocalExpanded((v) => !v));
  const shouldCollapse = lines.length > 8;
  const lineHoverKey = (idx: number) =>
    hoverKeyPrefix !== undefined ? `u:${hoverKeyPrefix}:${idx}` : undefined;

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
            conflictGutter={conflictGutter}
            hoverKey={lineHoverKey(li)}
          />
        ))}
        <button
          onClick={toggleExpand}
          className="w-full px-2 py-0.5 text-caption text-muted-foreground/50 bg-secondary/50 hover:bg-secondary transition-colors text-center"
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
              conflictGutter={conflictGutter}
              hoverKey={lineHoverKey(actualIdx)}
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
          conflictGutter={conflictGutter}
          hoverKey={lineHoverKey(li)}
        />
      ))}
    </div>
  );
}

const UnchangedLine = memo(UnchangedLineImpl);

function UnchangedLineImpl({
  content,
  lineNo,
  tokens,
  conflictGutter,
  hoverKey,
}: {
  content: string;
  lineNo: number;
  tokens?: ThemedToken[];
  conflictGutter?: boolean;
  hoverKey?: string;
}) {
  return (
    <div
      className={`flex opacity-50${conflictGutter ? " border-l-2 border-transparent" : ""}`}
      style={LINE_CONTAINMENT}
      data-hover-key={hoverKey}
    >
      <span className={`${conflictGutter ? "w-12" : "w-5"} shrink-0`} />
      <span className="w-9 shrink-0 text-right pr-2 select-none text-muted-foreground/30 text-caption">
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
  regionIndex: number;
  isChunkSelected: boolean;
  selectedLines: Set<number>;
  onToggleChunk: () => void;
  conflictNumber?: number;
  suspiciousGroup?: number;
  baseLines?: string[];
  baseTokens?: ThemedToken[][] | null;
  baseStartLine?: number;
  baseExpanded?: boolean;
  onToggleBaseExpand?: () => void;
}

function ChangedBlock({
  lines,
  tokens,
  startTokenLine,
  startLineNo,
  side,
  regionIndex,
  isChunkSelected,
  selectedLines,
  onToggleChunk,
  conflictNumber,
  suspiciousGroup,
  baseLines,
  baseTokens,
  baseStartLine,
  baseExpanded = false,
  onToggleBaseExpand,
}: ChangedBlockProps) {
  const isSuspicious = suspiciousGroup != null;
  const borderColor = isSuspicious
    ? "rgba(var(--conflict-suspicious), 0.5)"
    : side === "ours" ? "rgba(59, 130, 246, 0.5)" : "rgba(20, 184, 166, 0.5)";

  const hasBase = baseLines && baseLines.length > 0;

  const numberBadge = conflictNumber != null ? (
    <span className="text-caption font-medium text-muted-foreground/50 select-none">
      #{conflictNumber}
    </span>
  ) : null;

  const renameBadge = isSuspicious ? (
    <span
      className="flex items-center gap-0.5 text-caption font-medium select-none"
      style={{ color: "var(--conflict-suspicious-text)" }}
    >
      <AlertTriangle className="w-2.5 h-2.5" />
      Suspicious #{suspiciousGroup}
    </span>
  ) : null;

  return (
    <div className="border-l-2" style={{ borderLeftColor: borderColor }}>
      {/* Collapsible base (ancestor) section — always rendered so both sides match */}
      {hasBase && (
        <div className="bg-zinc-500/[0.06] border-b border-border/30">
          <button
            onClick={onToggleBaseExpand}
            className="flex items-center gap-1 w-full px-2 py-0.5 text-caption text-muted-foreground/60 hover:text-muted-foreground/80 transition-colors"
          >
            {numberBadge}
            {renameBadge}
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
                  <div key={li} className="flex" style={LINE_CONTAINMENT}>
                    <span className="w-12 shrink-0" />
                    <span className="w-9 shrink-0 text-right pr-2 select-none text-muted-foreground/30 text-caption">
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

      {!hasBase && (numberBadge || renameBadge) && (
        <div className="flex items-center gap-1 px-2 py-px text-caption text-muted-foreground/40 border-b border-border/20"
          style={{ backgroundColor: side === "ours" ? "rgba(var(--conflict-ours), 0.03)" : "rgba(var(--conflict-theirs), 0.03)" }}
        >
          {numberBadge}
          {renameBadge}
        </div>
      )}

      <div className="relative">
        {/* Side column: checkbox centered vertically. Overlaid rather than a
            flex sibling so each line's background and hover outline run the
            full width underneath it. */}
        {(() => {
          const cv = side === "ours" ? "--conflict-ours" : "--conflict-theirs";
          return lines.length > 0 ? (
          <div
            className="absolute inset-y-0 left-0 z-10 w-7 flex flex-col items-center justify-center cursor-pointer select-none"
            onClick={onToggleChunk}
            title={`${isChunkSelected ? "Deselect" : "Select"} all ${side} lines`}
          >
            <span
              className="w-4 h-4 rounded-md flex items-center justify-center shrink-0 transition-colors"
              style={isChunkSelected
                ? { backgroundColor: `rgb(var(${cv}))`, color: "white" }
                : { border: `1.5px solid rgba(var(${cv}), 0.4)` }}
            >
              {isChunkSelected && <Check className="w-2.5 h-2.5" />}
            </span>
          </div>
        ) : null;
        })()}

        {/* Lines or deleted label */}
        <div className="min-w-0">
          {lines.length > 0 ? (
            lines.map((line, li) => {
              const isSelected = selectedLines.has(li);
              const cv = side === "ours" ? "--conflict-ours" : "--conflict-theirs";
              return (
                <div
                  key={li}
                  className="flex pl-7 group/cline cursor-pointer transition-colors"
                  style={{ backgroundColor: `rgba(var(${cv}), ${isSelected ? 0.1 : 0.06})`, contain: "content" }}
                  data-conflict-key={`${regionIndex}:${side}:${li}`}
                  data-hover-key={`r:${regionIndex}:${side}:${li}`}
                >
                  <span className="w-5 shrink-0 flex items-center justify-center select-none">
                    <span
                      className="w-3.5 h-3.5 rounded-xs flex items-center justify-center opacity-0 group-hover/cline:opacity-100 transition-opacity"
                      style={{ color: side === "ours" ? "var(--conflict-ours-text)" : "var(--conflict-theirs-text)" }}
                    >
                      {isSelected ? (
                        <Minus className="w-2.5 h-2.5" />
                      ) : (
                        <Plus className="w-2.5 h-2.5" />
                      )}
                    </span>
                  </span>
                  <span className="w-9 shrink-0 text-right pr-2 select-none text-muted-foreground/30 text-caption">
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
            <div className="pl-9 pr-2 py-0.5">
              <span
                className="text-caption italic"
                style={{ color: `rgba(var(${side === "ours" ? "--conflict-ours" : "--conflict-theirs"}), 0.3)` }}
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

// ── Auto-resolved block ─────────────────────────────────────

function AutoResolvedBlock({
  side,
  region,
  tokens,
  startTokenLine,
  hoverKeyPrefix,
}: {
  side: "ours" | "theirs";
  region: DiffRegion;
  tokens: ThemedToken[][] | null;
  startTokenLine: number;
  hoverKeyPrefix: string | number;
}) {
  const isWinner = region.autoSide === side;
  const winLines = region.autoSide === "theirs" ? region.bLines : region.aLines;
  const loseLines = side === "ours" ? region.aLines : region.bLines;
  const winStartLine = region.autoSide === "theirs" ? region.bStartLine : region.aStartLine;
  const loseStartLine = side === "ours" ? region.aStartLine : region.bStartLine;

  if (isWinner) {
    return (
      <div className="border-l-2" style={{ borderLeftColor: "rgba(var(--conflict-auto), 0.5)" }}>
        {winLines.map((line, li) => (
          <div
            key={li}
            className="flex"
            style={{ backgroundColor: "rgba(var(--conflict-auto), 0.06)", contain: "content" }}
            data-hover-key={`a:${hoverKeyPrefix}:${li}`}
          >
            <span className="shrink-0 w-12 flex items-center justify-center">
              <Check className="w-2.5 h-2.5" style={{ color: "var(--conflict-auto-text)" }} />
            </span>
            <span className="w-9 shrink-0 text-right pr-2 select-none text-muted-foreground/30 text-caption">
              {winStartLine + li}
            </span>
            <pre className="flex-1 px-2 whitespace-pre-wrap break-all">
              {tokens?.[startTokenLine + li]?.length ? (
                tokens[startTokenLine + li].map((token: ThemedToken, i: number) => (
                  <span key={i} style={{ color: token.color }}>{token.content}</span>
                ))
              ) : (
                <span className="text-muted-foreground">
                  {line || <span className="text-muted-foreground/20">{"↵"}</span>}
                </span>
              )}
            </pre>
          </div>
        ))}
      </div>
    );
  }

  if (loseLines.length === 0) {
    return (
      <div className="border-l-2" style={{ borderLeftColor: "rgba(var(--conflict-auto), 0.2)" }}>
        <div className="flex items-center" style={{ backgroundColor: "rgba(var(--conflict-auto), 0.03)" }}>
          <span className="shrink-0 w-12" />
          <span className="w-9 shrink-0" />
          <span className="flex-1 px-2 text-caption italic leading-5 text-muted-foreground">
            — no changes —
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="border-l-2 opacity-50" style={{ borderLeftColor: "rgba(var(--conflict-auto), 0.2)" }}>
      {loseLines.map((line, li) => (
        <div key={li} className="flex" style={LINE_CONTAINMENT}>
          <span className="shrink-0 w-12" />
          <span className="w-9 shrink-0 text-right pr-2 select-none text-muted-foreground/30 text-caption">
            {loseStartLine + li}
          </span>
          <pre className="flex-1 px-2 whitespace-pre-wrap break-all">
            <span className="text-muted-foreground">
              {line || <span className="text-muted-foreground/20">{"↵"}</span>}
            </span>
          </pre>
        </div>
      ))}
    </div>
  );
}

// ── Types ──────────────────────────────────────────────────

type DisplayItem =
  | {
      type: "unchanged";
      expandKey: number;
      oursLines: string[];
      oursStartLineNo: number;
      oursTokenStart: number;
      theirsLines: string[];
      theirsStartLineNo: number;
      theirsTokenStart: number;
    }
  | { type: "changed"; regionIndex: number }
  | { type: "auto-resolved"; regionIndex: number };

// ── Scrollbar minimap ───────────────────────────────────────

function ScrollMinimap({
  displayItems,
  regions,
  expandedRegions,
  side,
}: {
  displayItems: DisplayItem[];
  regions: DiffRegion[];
  expandedRegions: Set<number>;
  side: "ours" | "theirs";
}) {
  const markers = useMemo(() => {
    let totalLines = 0;
    const positions: { top: number; lines: number }[] = [];

    for (const item of displayItems) {
      if (item.type === "unchanged") {
        const lineCount = side === "ours" ? item.oursLines.length : item.theirsLines.length;
        const shouldCollapse = lineCount > 8;
        if (shouldCollapse && !expandedRegions.has(item.expandKey)) {
          totalLines += 7; // 3 top + 1 collapse row + 3 bottom
        } else {
          totalLines += lineCount;
        }
      } else if (item.type === "auto-resolved") {
        const region = regions[item.regionIndex];
        const isWinner = region.autoSide === side;
        if (isWinner) {
          const winLines = region.autoSide === "theirs" ? region.bLines : region.aLines;
          totalLines += winLines.length;
        } else {
          const loseLines = side === "ours" ? region.aLines : region.bLines;
          totalLines += Math.max(loseLines.length, 1);
        }
      } else {
        const region = regions[item.regionIndex];
        const lines = side === "ours" ? region.aLines : region.bLines;
        const visualLines = Math.max(lines.length, 1);
        positions.push({ top: totalLines, lines: visualLines });
        totalLines += visualLines;
      }
    }

    if (totalLines === 0 || positions.length === 0) return [];

    return positions.map((p) => ({
      topPct: (p.top / totalLines) * 100,
      heightPct: Math.max(0.4, (p.lines / totalLines) * 100),
    }));
  }, [displayItems, regions, expandedRegions, side]);

  if (markers.length === 0) return null;

  return (
    <div className="absolute top-0 right-0 bottom-0 w-[6px] z-10 pointer-events-none">
      {markers.map((m, i) => (
        <div
          key={i}
          className="absolute right-[1px] w-[4px] rounded-full bg-red-400/70"
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
