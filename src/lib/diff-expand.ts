import type { DiffHunk, DiffLine } from "@/types/git";

export interface DiffGap {
  index: number;
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
  count: number;
}

export interface ExpandState {
  top: number;
  bottom: number;
}

const EXPAND_STEP = 20;

export function computeGaps(hunks: DiffHunk[]): DiffGap[] {
  if (hunks.length === 0) return [];
  const gaps: DiffGap[] = [];

  const first = hunks[0];
  if (first.new_start > 1) {
    gaps.push({
      index: 0,
      oldStart: 1,
      oldEnd: first.old_start - 1,
      newStart: 1,
      newEnd: first.new_start - 1,
      count: first.new_start - 1,
    });
  }

  for (let i = 0; i < hunks.length - 1; i++) {
    const curr = hunks[i];
    const next = hunks[i + 1];
    const newStart = curr.new_start + curr.new_lines;
    const newEnd = next.new_start - 1;
    const oldStart = curr.old_start + curr.old_lines;
    const oldEnd = next.old_start - 1;
    if (newEnd >= newStart) {
      gaps.push({
        index: i + 1,
        oldStart,
        oldEnd,
        newStart,
        newEnd,
        count: newEnd - newStart + 1,
      });
    }
  }

  return gaps;
}

export function getGapForHunk(
  gaps: DiffGap[],
  hunkIndex: number,
): DiffGap | undefined {
  return gaps.find((g) => g.index === hunkIndex);
}

export function buildContextLines(
  fileLines: string[],
  gap: DiffGap,
  expandState: ExpandState,
): { topLines: DiffLine[]; bottomLines: DiffLine[]; remainingCount: number } {
  const topCount = Math.min(expandState.top, gap.count);
  const bottomCount = Math.min(expandState.bottom, gap.count - topCount);
  const remaining = gap.count - topCount - bottomCount;

  const topLines: DiffLine[] = [];
  for (let i = 0; i < topCount; i++) {
    const newLineno = gap.newStart + i;
    const oldLineno = gap.oldStart + i;
    topLines.push({
      origin: " ",
      content: fileLines[newLineno - 1] ?? "",
      old_lineno: oldLineno,
      new_lineno: newLineno,
    });
  }

  const bottomLines: DiffLine[] = [];
  for (let i = 0; i < bottomCount; i++) {
    const offset = gap.count - bottomCount + i;
    const newLineno = gap.newStart + offset;
    const oldLineno = gap.oldStart + offset;
    bottomLines.push({
      origin: " ",
      content: fileLines[newLineno - 1] ?? "",
      old_lineno: oldLineno,
      new_lineno: newLineno,
    });
  }

  return { topLines, bottomLines, remainingCount: remaining };
}

export function expandStep(
  current: ExpandState,
  direction: "up" | "down",
  gapCount: number,
): ExpandState {
  if (direction === "down") {
    const maxTop = gapCount - current.bottom;
    return { ...current, top: Math.min(current.top + EXPAND_STEP, maxTop) };
  } else {
    const maxBottom = gapCount - current.top;
    return {
      ...current,
      bottom: Math.min(current.bottom + EXPAND_STEP, maxBottom),
    };
  }
}

export function expandAll(gapCount: number): ExpandState {
  return { top: gapCount, bottom: 0 };
}
