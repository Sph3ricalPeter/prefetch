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
}

export function useExpandableContext(
  hunks: DiffHunk[],
  filePath: string,
  source: DiffSource,
) {
  const [fileLines, setFileLines] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandStates, setExpandStates] = useState<Map<number, ExpandState>>(
    new Map(),
  );
  const fileLinesRef = useRef<string[] | null>(null);

  const gaps = useMemo(() => computeGaps(hunks), [hunks]);

  const fetchFileLines = useCallback(async (): Promise<string[] | null> => {
    if (fileLinesRef.current) return fileLinesRef.current;
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
      fileLinesRef.current = lines;
      setFileLines(lines);
      return lines;
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, [filePath, source.commitId, source.stashIndex, source.staged]);

  const expand = useCallback(
    async (gapIndex: number, direction: "up" | "down") => {
      const gap = getGapForHunk(gaps, gapIndex);
      if (!gap) return;
      await fetchFileLines();
      setExpandStates((prev) => {
        const next = new Map(prev);
        const current = next.get(gapIndex) ?? { top: 0, bottom: 0 };
        next.set(gapIndex, expandStep(current, direction, gap.count));
        return next;
      });
    },
    [gaps, fetchFileLines],
  );

  const expandAllGaps = useCallback(async () => {
    await fetchFileLines();
    setExpandStates(() => {
      const next = new Map<number, ExpandState>();
      for (const gap of gaps) {
        next.set(gap.index, expandAll(gap.count));
      }
      return next;
    });
  }, [gaps, fetchFileLines]);

  const collapseAll = useCallback(() => {
    setExpandStates(new Map());
  }, []);

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
      };
    },
    [gaps, expandStates, fileLines, expand],
  );

  const isExpanded = expandStates.size > 0;

  return {
    getGapRender,
    expandAllGaps,
    collapseAll,
    isExpanded,
    loading,
    fileLines,
  };
}

export type ExpandableContext = ReturnType<typeof useExpandableContext>;
