import { useState, useCallback, useMemo, useRef } from "react";
import { getFileBlob } from "@/lib/commands";
import type { DiffHunk, DiffLine } from "@/types/git";
import {
  computeGaps,
  getGapForHunk,
  buildContextLines,
  expandStep,
  expandAll,
  type DiffGap,
  type ExpandState,
} from "@/lib/diff-expand";

export interface DiffSource {
  commitId?: string | null;
  stashIndex?: number | null;
  staged?: boolean;
}

interface GapRender {
  gap: DiffGap;
  topLines: DiffLine[];
  bottomLines: DiffLine[];
  remainingCount: number;
  onExpandDown: () => void;
  onExpandUp: () => void;
  onExpandAll: () => void;
}

// All cached state is keyed by the source identity (filePath + revision).
// On source change, the derived getters below return null / empty without
// any state mutation — no discard-retry render, no flash of stale data
// applied to the new diff structure.
interface KeyedLines {
  key: string;
  lines: string[];
}

interface KeyedExpandStates {
  key: string;
  states: Map<number, ExpandState>;
}

const EMPTY_EXPAND_STATES = new Map<number, ExpandState>();

// djb2 hash over hunk line content. Used to detect when a working-tree file's
// content changes underneath an open diff: filePath + revision alone can't —
// an uncommitted file keeps the same source identity while its bytes change.
function hashHunks(hunks: DiffHunk[]): string {
  let h = 5381;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      const s = line.origin + line.content;
      for (let i = 0; i < s.length; i++) {
        h = ((h << 5) + h) ^ s.charCodeAt(i);
      }
    }
  }
  return (h >>> 0).toString(36);
}

export function useExpandableContext(
  hunks: DiffHunk[],
  filePath: string,
  source: DiffSource,
) {
  const [fileLinesEntry, setFileLinesEntry] = useState<KeyedLines | null>(null);
  const [oldFileLinesEntry, setOldFileLinesEntry] = useState<KeyedLines | null>(null);
  const [expandStatesEntry, setExpandStatesEntry] = useState<KeyedExpandStates | null>(null);
  const [loading, setLoading] = useState(false);
  const fileLinesRef = useRef<KeyedLines | null>(null);
  const oldFileLinesRef = useRef<KeyedLines | null>(null);

  // Content signature, recomputed only when the hunks array identity changes
  // (refreshActiveDiff produces a new array only on a real content change).
  // Folded into sourceKey so an edit to an uncommitted file — which leaves
  // filePath + revision unchanged — still invalidates the cached full-file
  // lines, forcing a re-fetch + re-highlight instead of painting stale tokens.
  const contentSig = useMemo(() => hashHunks(hunks), [hunks]);

  const sourceKey = `${filePath}|${source.commitId ?? ""}|${source.stashIndex ?? ""}|${source.staged ?? false}|${contentSig}`;

  // Derive current-source values during render. If the stored entry was cached
  // for a different source, the getter returns null and any downstream effects
  // (highlighting, expansion) will treat it as "no data yet" rather than rendering
  // the previous file's content over the new diff.
  const fileLines = fileLinesEntry?.key === sourceKey ? fileLinesEntry.lines : null;
  const oldFileLines = oldFileLinesEntry?.key === sourceKey ? oldFileLinesEntry.lines : null;
  const expandStates = expandStatesEntry?.key === sourceKey ? expandStatesEntry.states : EMPTY_EXPAND_STATES;

  // The trailing gap (after the last hunk) needs the file's real length, so it
  // only materialises once fileLines has been fetched.
  const gaps = useMemo(() => computeGaps(hunks, fileLines?.length), [hunks, fileLines]);

  const fetchFileLines = useCallback(async (): Promise<string[] | null> => {
    if (fileLinesRef.current?.key === sourceKey) return fileLinesRef.current.lines;
    setLoading(true);
    try {
      let rev: string | null;
      if (source.commitId) {
        rev = source.commitId;
      } else if (source.stashIndex != null) {
        rev = `stash@{${source.stashIndex}}`;
      } else if (source.staged) {
        rev = "";
      } else {
        rev = null;
      }
      const lines = await getFileBlob(filePath, rev);
      fileLinesRef.current = { key: sourceKey, lines };
      setFileLinesEntry({ key: sourceKey, lines });
      return lines;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, [sourceKey, filePath, source.commitId, source.stashIndex, source.staged]);

  // Fetches the "old" side of the diff (parent commit / HEAD / index, depending on source).
  // Used for syntax highlighting of deletion lines with full file context.
  const fetchOldFileLines = useCallback(async (): Promise<string[] | null> => {
    if (oldFileLinesRef.current?.key === sourceKey) return oldFileLinesRef.current.lines;
    try {
      let oldRev: string;
      if (source.commitId) {
        oldRev = `${source.commitId}~1`;
      } else if (source.stashIndex != null) {
        oldRev = `stash@{${source.stashIndex}}^`;
      } else if (source.staged) {
        oldRev = "HEAD";
      } else {
        oldRev = "";
      }
      const lines = await getFileBlob(filePath, oldRev);
      oldFileLinesRef.current = { key: sourceKey, lines };
      setOldFileLinesEntry({ key: sourceKey, lines });
      return lines;
    } catch {
      return null;
    }
  }, [sourceKey, filePath, source.commitId, source.stashIndex, source.staged]);

  const updateExpandStates = useCallback(
    (updater: (prev: Map<number, ExpandState>) => Map<number, ExpandState>) => {
      setExpandStatesEntry((entry) => {
        const prevStates = entry?.key === sourceKey ? entry.states : EMPTY_EXPAND_STATES;
        return { key: sourceKey, states: updater(prevStates) };
      });
    },
    [sourceKey],
  );

  const expand = useCallback(
    async (gapIndex: number, direction: "up" | "down") => {
      const gap = getGapForHunk(gaps, gapIndex);
      if (!gap) return;
      await fetchFileLines();
      updateExpandStates((prev) => {
        const next = new Map(prev);
        const current = next.get(gapIndex) ?? { top: 0, bottom: 0 };
        next.set(gapIndex, expandStep(current, direction, gap.count));
        return next;
      });
    },
    [gaps, fetchFileLines, updateExpandStates],
  );

  const expandGap = useCallback(
    async (gapIndex: number) => {
      const gap = getGapForHunk(gaps, gapIndex);
      if (!gap) return;
      await fetchFileLines();
      updateExpandStates((prev) => {
        const next = new Map(prev);
        next.set(gapIndex, expandAll(gap.count));
        return next;
      });
    },
    [gaps, fetchFileLines, updateExpandStates],
  );

  const expandAllGaps = useCallback(async () => {
    await fetchFileLines();
    updateExpandStates(() => {
      const next = new Map<number, ExpandState>();
      for (const gap of gaps) {
        next.set(gap.index, expandAll(gap.count));
      }
      return next;
    });
  }, [gaps, fetchFileLines, updateExpandStates]);

  const collapseAll = useCallback(() => {
    updateExpandStates(() => new Map());
  }, [updateExpandStates]);

  const getGapRender = useCallback(
    (hunkIndex: number): GapRender | null => {
      const gap = getGapForHunk(gaps, hunkIndex);
      if (!gap) return null;
      const state = expandStates.get(hunkIndex) ?? { top: 0, bottom: 0 };
      const lines = fileLines ?? [];
      const { topLines, bottomLines, remainingCount } = buildContextLines(
        lines,
        gap,
        state,
      );
      return {
        gap,
        topLines,
        bottomLines,
        remainingCount,
        onExpandDown: () => expand(hunkIndex, "down"),
        onExpandUp: () => expand(hunkIndex, "up"),
        onExpandAll: () => expandGap(hunkIndex),
      };
    },
    [gaps, expandStates, fileLines, expand, expandGap],
  );

  const isExpanded = expandStates.size > 0;

  return {
    getGapRender,
    expandAllGaps,
    collapseAll,
    isExpanded,
    loading,
    fileLines,
    oldFileLines,
    fetchFileLines,
    fetchOldFileLines,
  };
}

export type ExpandableContext = ReturnType<typeof useExpandableContext>;
