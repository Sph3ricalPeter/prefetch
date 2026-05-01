import { useCallback, useMemo, useRef } from "react";
import type { FileDiff, DiffHunk } from "@/types/git";
import { useRepoStore } from "@/stores/repo-store";

interface DiffMinimapProps {
  diff: FileDiff;
  /** Reference to the scrollable container so we can scroll to position */
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

interface Region {
  /** Fractional position [0, 1] in the file */
  start: number;
  /** Fractional end [0, 1] */
  end: number;
  /** "add" or "del" */
  type: "add" | "del";
}

/**
 * Thin vertical minimap showing green (addition) and red (deletion) regions
 * proportional to their position in the diff. Clicking jumps to that position.
 *
 * In split view the minimap mirrors the two-column layout: deletions on the
 * left half, additions on the right half. Paired edits (a deletion block
 * immediately followed by an addition block) share the same vertical rows,
 * matching the actual side-by-side diff rendering.
 */
export function DiffMinimap({ diff, scrollRef }: DiffMinimapProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const diffViewMode = useRepoStore((s) => s.diffViewMode);
  const isSplit = diffViewMode === "side-by-side";

  const regions = useMemo(
    () => (isSplit ? computeSplitRegions(diff.hunks) : computeUnifiedRegions(diff.hunks)),
    [diff.hunks, isSplit],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!barRef.current || !scrollRef.current) return;
      const rect = barRef.current.getBoundingClientRect();
      const fraction = (e.clientY - rect.top) / rect.height;
      const scrollTarget = fraction * scrollRef.current.scrollHeight;
      scrollRef.current.scrollTo({ top: scrollTarget, behavior: "smooth" });
    },
    [scrollRef],
  );

  if (regions.length === 0) return null;

  return (
    <div
      ref={barRef}
      onClick={handleClick}
      className="w-2 shrink-0 relative cursor-pointer bg-secondary/30"
      title="Click to jump to changes"
    >
      {/* Faint center divider in split mode */}
      {isSplit && (
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-border/30" />
      )}

      {regions.map((region, i) => {
        const positionStyle: React.CSSProperties = isSplit
          ? region.type === "del"
            ? { left: 0, width: "50%" }
            : { left: "50%", width: "50%" }
          : { left: 0, right: 0 };

        return (
          <div
            key={i}
            className={`absolute rounded-sm ${
              region.type === "add" ? "bg-[var(--diff-added-line-bg)]" : "bg-[var(--diff-removed-line-bg)]"
            }`}
            style={{
              top: `${region.start * 100}%`,
              height: `${Math.max((region.end - region.start) * 100, 0.5)}%`,
              ...positionStyle,
            }}
          />
        );
      })}
    </div>
  );
}

// ── Unified mode: sequential line positions ─────────────────────────────────

function computeUnifiedRegions(hunks: DiffHunk[]): Region[] {
  const result: Region[] = [];
  let totalLines = 0;
  for (const hunk of hunks) totalLines += hunk.lines.length + 1;
  if (totalLines === 0) return result;

  let lineOffset = 0;
  for (const hunk of hunks) {
    lineOffset++; // hunk header
    let regionStart: number | null = null;
    let regionType: "add" | "del" | null = null;

    for (let li = 0; li < hunk.lines.length; li++) {
      const currentType = hunk.lines[li].origin === "+" ? "add" as const
        : hunk.lines[li].origin === "-" ? "del" as const : null;

      if (currentType && currentType === regionType && regionStart !== null) {
        // Continue
      } else {
        if (regionStart !== null && regionType) {
          result.push({ start: regionStart / totalLines, end: (lineOffset + li) / totalLines, type: regionType });
        }
        if (currentType) {
          regionStart = lineOffset + li;
          regionType = currentType;
        } else {
          regionStart = null;
          regionType = null;
        }
      }
    }

    if (regionStart !== null && regionType) {
      result.push({ start: regionStart / totalLines, end: (lineOffset + hunk.lines.length) / totalLines, type: regionType });
    }
    lineOffset += hunk.lines.length;
  }

  return result;
}

// ── Split mode: row-paired positions ────────────────────────────────────────
//
// Uses the same pairing logic as the side-by-side diff viewer: a block of N
// deletions followed by M additions occupies max(N,M) visual rows. This way
// a single-line edit (1 del + 1 add) produces a red and green region at the
// exact same vertical position instead of being stacked sequentially.

function computeSplitRegions(hunks: DiffHunk[]): Region[] {
  // First pass: count total visual rows across all hunks
  let totalRows = 0;
  for (const hunk of hunks) {
    totalRows++; // hunk header
    totalRows += countSideBySideRows(hunk);
  }
  if (totalRows === 0) return [];

  // Second pass: emit regions using row offsets
  const result: Region[] = [];
  let rowOffset = 0;

  for (const hunk of hunks) {
    rowOffset++; // hunk header
    const lines = hunk.lines;
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (line.origin === " ") {
        // Context — 1 row, no region
        rowOffset++;
        i++;
      } else if (line.origin === "-") {
        // Collect consecutive deletions
        let delCount = 0;
        while (i < lines.length && lines[i].origin === "-") { delCount++; i++; }
        // Collect consecutive additions that follow
        let addCount = 0;
        while (i < lines.length && lines[i].origin === "+") { addCount++; i++; }
        // Paired block occupies max(del, add) rows
        const blockRows = Math.max(delCount, addCount);
        const blockStart = rowOffset;
        rowOffset += blockRows;

        // Deletion region spans the rows its lines occupy (top-aligned in block)
        if (delCount > 0) {
          result.push({
            start: blockStart / totalRows,
            end: (blockStart + delCount) / totalRows,
            type: "del",
          });
        }
        // Addition region at the same starting row
        if (addCount > 0) {
          result.push({
            start: blockStart / totalRows,
            end: (blockStart + addCount) / totalRows,
            type: "add",
          });
        }
      } else if (line.origin === "+") {
        // Orphan addition (no preceding deletion)
        let addCount = 0;
        while (i < lines.length && lines[i].origin === "+") { addCount++; i++; }
        result.push({
          start: rowOffset / totalRows,
          end: (rowOffset + addCount) / totalRows,
          type: "add",
        });
        rowOffset += addCount;
      } else {
        rowOffset++;
        i++;
      }
    }
  }

  return result;
}

/** Count visual rows a hunk occupies in side-by-side mode. */
function countSideBySideRows(hunk: DiffHunk): number {
  let rows = 0;
  const lines = hunk.lines;
  let i = 0;

  while (i < lines.length) {
    if (lines[i].origin === " ") {
      rows++;
      i++;
    } else if (lines[i].origin === "-") {
      let dels = 0;
      while (i < lines.length && lines[i].origin === "-") { dels++; i++; }
      let adds = 0;
      while (i < lines.length && lines[i].origin === "+") { adds++; i++; }
      rows += Math.max(dels, adds);
    } else if (lines[i].origin === "+") {
      while (i < lines.length && lines[i].origin === "+") { rows++; i++; }
    } else {
      rows++;
      i++;
    }
  }

  return rows;
}
