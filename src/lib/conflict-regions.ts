import { Text } from "@codemirror/state";
import { Chunk, diff } from "@codemirror/merge";

/**
 * A region of text that is either unchanged between ours/theirs or changed.
 */
export interface DiffRegion {
  type: "unchanged" | "changed" | "auto-resolved";
  /** Lines from document A (ours) */
  aLines: string[];
  /** Lines from document B (theirs) */
  bLines: string[];
  /** 1-based starting line number in document A */
  aStartLine: number;
  /** 1-based starting line number in document B */
  bStartLine: number;
  /**
   * For auto-resolved regions (one-sided changes reclassified as unchanged):
   * which side's content to use in the output. When unset, aLines is used
   * (standard unchanged behavior).
   */
  autoSide?: "ours" | "theirs";
  /** Common ancestor lines for this changed region (diff3-style context). */
  baseLines?: string[];
  /** 1-based starting line number in the base document. */
  baseStartLine?: number;
  /** Shared group ID when heuristics detect related auto-resolves (e.g. rename). */
  suspiciousGroup?: number;
}

/**
 * Per-chunk selection state: which lines from ours/theirs to include in output.
 * Both sides can be selected simultaneously — order controls concat direction.
 */
export interface ChunkSelection {
  oursLines: Set<number>;
  theirsLines: Set<number>;
  /** Which side was selected first determines concat order in output. */
  order: "ours-first" | "theirs-first";
}

/** A region that requires user action (true conflict or suspicious auto-resolve). */
export function isEditableRegion(r: DiffRegion): boolean {
  return r.type === "changed" || (r.type === "auto-resolved" && r.suspiciousGroup != null);
}

/** Identifies the source of each line in the assembled output. */
export type LineSource = "unchanged" | "ours" | "theirs" | "auto-resolved";

/** Reverse mapping from an output line back to its origin in a diff region. */
export interface OutputLineMapping {
  regionIndex: number;
  side: "ours" | "theirs";
  lineIndex: number;
}

/**
 * Compute diff regions between ours and theirs content.
 *
 * When `base` (common ancestor) is provided, runs a diff3 merge aligned on
 * base (see diff3Regions): changes made by only one side are auto-resolved,
 * only changes where both sides touched the same base lines are conflicts.
 * Without base, falls back to a 2-way ours/theirs diff via Chunk.build.
 */
export function computeDiffRegions(
  ours: string,
  theirs: string,
  base?: string,
): DiffRegion[] {
  const oursLines = ours.split("\n");
  const theirsLines = theirs.split("\n");

  // Fast path: identical content
  if (ours === theirs) {
    return [
      {
        type: "unchanged",
        aLines: oursLines,
        bLines: theirsLines,
        aStartLine: 1,
        bStartLine: 1,
      },
    ];
  }

  const merged = base !== undefined ? diff3Regions(base.split("\n"), oursLines, theirsLines) : null;
  if (merged) {
    const regions = mergeConsecutiveUnchanged(merged);
    flagSuspiciousAutoResolves(regions);
    return regions;
  }

  const oursText = Text.of(oursLines);
  const theirsText = Text.of(theirsLines);
  const chunks = Chunk.build(oursText, theirsText);

  let regions: DiffRegion[] = [];
  let aIdx = 0;
  let bIdx = 0;

  for (const chunk of chunks) {
    const hasA = chunk.fromA < chunk.toA;
    const hasB = chunk.fromB < chunk.toB;

    const aStart = oursText.lineAt(chunk.fromA).number - 1;
    const aEnd = hasA ? oursText.lineAt(chunk.endA).number : aStart;
    const bStart = theirsText.lineAt(chunk.fromB).number - 1;
    const bEnd = hasB ? theirsText.lineAt(chunk.endB).number : bStart;

    if (aIdx < aStart) {
      regions.push({
        type: "unchanged",
        aLines: oursLines.slice(aIdx, aStart),
        bLines: theirsLines.slice(bIdx, bStart),
        aStartLine: aIdx + 1,
        bStartLine: bIdx + 1,
      });
    }

    regions.push({
      type: "changed",
      aLines: oursLines.slice(aStart, aEnd),
      bLines: theirsLines.slice(bStart, bEnd),
      aStartLine: aStart + 1,
      bStartLine: bStart + 1,
    });

    aIdx = aEnd;
    bIdx = bEnd;
  }

  if (aIdx < oursLines.length || bIdx < theirsLines.length) {
    regions.push({
      type: "unchanged",
      aLines: oursLines.slice(aIdx),
      bLines: theirsLines.slice(bIdx),
      aStartLine: aIdx + 1,
      bStartLine: bIdx + 1,
    });
  }

  // ── Refine changed regions ───────────────────────────────────
  regions = refineChangedRegions(regions);
  regions = coalesceFragments(regions);
  return mergeConsecutiveUnchanged(regions);
}

/** A changed range of base lines [baseFrom, baseTo) replaced by side lines [from, to). */
interface Hunk {
  baseFrom: number;
  baseTo: number;
  from: number;
  to: number;
}

/**
 * Line-level diff. Each distinct line is mapped to one UTF-16 unit so the
 * character diff becomes a line diff. Returns null past ~63k distinct lines.
 */
function lineHunks(a: string[], b: string[]): Hunk[] | null {
  const ids = new Map<string, number>();
  const encode = (lines: string[]): string | null => {
    let s = "";
    for (const line of lines) {
      let id = ids.get(line);
      if (id === undefined) {
        id = ids.size;
        ids.set(line, id);
      }
      // Skip the surrogate range so every line stays exactly one unit.
      const code = id < 0xd800 ? id : id + 0x800;
      if (code > 0xffff) return null;
      s += String.fromCharCode(code);
    }
    return s;
  };
  const sa = encode(a);
  const sb = encode(b);
  if (sa === null || sb === null) return null;
  return diff(sa, sb).map((c) => ({ baseFrom: c.fromA, baseTo: c.toA, from: c.fromB, to: c.toB }));
}

/**
 * Three-way merge aligned on base, matching git's diff3 rules: a hunk only
 * one side changed takes that side, identical changes are kept once, and
 * hunks that overlap or touch in base are a conflict. Lines identical on
 * both sides are split out of conflicts (like git's zealous merge).
 * Returns null when the line diff can't run, so the caller falls back to 2-way.
 */
function diff3Regions(base: string[], ours: string[], theirs: string[]): DiffRegion[] | null {
  const oh = lineHunks(base, ours);
  const th = lineHunks(base, theirs);
  if (!oh || !th) return null;

  const regions: DiffRegion[] = [];
  // Side position = base position + delta, outside that side's hunks.
  let oDelta = 0;
  let tDelta = 0;
  let pos = 0;
  let i = 0;
  let j = 0;

  const pushStable = (to: number) => {
    if (to > pos) {
      regions.push({
        type: "unchanged",
        aLines: base.slice(pos, to),
        bLines: base.slice(pos, to),
        aStartLine: pos + oDelta + 1,
        bStartLine: pos + tDelta + 1,
      });
    }
  };

  while (i < oh.length || j < th.length) {
    const start = Math.min(oh[i]?.baseFrom ?? Infinity, th[j]?.baseFrom ?? Infinity);
    pushStable(start);

    // Grow the group while either side has a hunk overlapping or touching it.
    let end = start;
    const oStartDelta = oDelta;
    const tStartDelta = tDelta;
    let oursTouched = false;
    let theirsTouched = false;
    for (;;) {
      if (i < oh.length && oh[i].baseFrom <= end) {
        const h = oh[i++];
        end = Math.max(end, h.baseTo);
        oDelta += (h.to - h.from) - (h.baseTo - h.baseFrom);
        oursTouched = true;
      } else if (j < th.length && th[j].baseFrom <= end) {
        const h = th[j++];
        end = Math.max(end, h.baseTo);
        tDelta += (h.to - h.from) - (h.baseTo - h.baseFrom);
        theirsTouched = true;
      } else {
        break;
      }
    }

    const aFrom = start + oStartDelta;
    const bFrom = start + tStartDelta;
    const aLines = ours.slice(aFrom, end + oDelta);
    const bLines = theirs.slice(bFrom, end + tDelta);
    const baseLines = base.slice(start, end);
    const region: DiffRegion = {
      type: "changed", aLines, bLines, aStartLine: aFrom + 1, bStartLine: bFrom + 1,
      baseLines, baseStartLine: start + 1,
    };

    if (!theirsTouched) {
      regions.push({ ...region, type: "auto-resolved", autoSide: "ours" });
    } else if (!oursTouched) {
      regions.push({ ...region, type: "auto-resolved", autoSide: "theirs" });
    } else {
      regions.push(...splitConflict(region));
    }
    pos = end;
  }
  pushStable(base.length);
  return regions;
}

/**
 * Split lines identical on both sides out of a conflict. Each resulting
 * sub-conflict shows the whole overlapped base, as git's diff3 style does.
 */
function splitConflict(r: DiffRegion): DiffRegion[] {
  // Same change on both sides (incl. both deleting the same lines) is no conflict.
  if (r.aLines.length === r.bLines.length && r.aLines.every((l, k) => l === r.bLines[k])) {
    return r.aLines.length ? [{ ...r, type: "unchanged", baseLines: undefined, baseStartLine: undefined }] : [];
  }
  const parts = refineChangedRegions([r]);
  for (const p of parts) {
    if (p.type !== "changed") continue;
    p.baseLines = r.baseLines;
    p.baseStartLine = r.baseStartLine;
  }
  return parts;
}


/**
 * Split oversized changed regions by finding identical lines within them.
 * Runs an inner diff on each changed region's aLines vs bLines and extracts
 * matching lines as unchanged sub-regions. Then coalesces fragments where
 * one side has 0 lines back into the nearest real conflict group.
 */
function refineChangedRegions(regions: DiffRegion[]): DiffRegion[] {
  const result: DiffRegion[] = [];

  for (const region of regions) {
    if (region.type !== "changed" || region.aLines.length === 0 || region.bLines.length === 0) {
      result.push(region);
      continue;
    }

    const aText = Text.of(region.aLines);
    const bText = Text.of(region.bLines);
    const innerChunks = Chunk.build(aText, bText);

    if (innerChunks.length === 0) {
      result.push({
        type: "unchanged",
        aLines: region.aLines,
        bLines: region.bLines,
        aStartLine: region.aStartLine,
        bStartLine: region.bStartLine,
      });
      continue;
    }

    const subRegions: DiffRegion[] = [];
    let aIdx = 0;
    let bIdx = 0;

    for (const chunk of innerChunks) {
      const hasA = chunk.fromA < chunk.toA;
      const hasB = chunk.fromB < chunk.toB;
      const aStart = aText.lineAt(chunk.fromA).number - 1;
      const aEnd = hasA ? aText.lineAt(chunk.endA).number : aStart;
      const bStart = bText.lineAt(chunk.fromB).number - 1;
      const bEnd = hasB ? bText.lineAt(chunk.endB).number : bStart;

      if (aIdx < aStart) {
        subRegions.push({
          type: "unchanged",
          aLines: region.aLines.slice(aIdx, aStart),
          bLines: region.bLines.slice(bIdx, bStart),
          aStartLine: region.aStartLine + aIdx,
          bStartLine: region.bStartLine + bIdx,
        });
      }

      subRegions.push({
        type: "changed",
        aLines: region.aLines.slice(aStart, aEnd),
        bLines: region.bLines.slice(bStart, bEnd),
        aStartLine: region.aStartLine + aStart,
        bStartLine: region.bStartLine + bStart,
      });

      aIdx = aEnd;
      bIdx = bEnd;
    }

    if (aIdx < region.aLines.length || bIdx < region.bLines.length) {
      subRegions.push({
        type: "unchanged",
        aLines: region.aLines.slice(aIdx),
        bLines: region.bLines.slice(bIdx),
        aStartLine: region.aStartLine + aIdx,
        bStartLine: region.bStartLine + bIdx,
      });
    }

    result.push(...coalesceFragments(subRegions));
  }

  return result;
}

/**
 * Merge changed sub-regions that have 0 lines on one side (pure
 * insertion/deletion) into the nearest changed region that has content
 * on both sides, absorbing any small unchanged gaps in between.
 * Only keeps an unchanged separator when both adjacent changed regions
 * have content on both sides.
 */
function coalesceFragments(subRegions: DiffRegion[]): DiffRegion[] {
  const regions = [...subRegions];
  let merged = true;

  while (merged) {
    merged = false;
    for (let i = 0; i < regions.length; i++) {
      const r = regions[i];
      if (r.type !== "changed") continue;
      if (r.aLines.length > 0 && r.bLines.length > 0) continue;

      // Try merging forward: absorb unchanged gap + next changed
      if (
        i + 2 < regions.length &&
        regions[i + 1].type === "unchanged" &&
        regions[i + 2].type === "changed"
      ) {
        const gap = regions[i + 1];
        const next = regions[i + 2];
        r.aLines.push(...gap.aLines, ...next.aLines);
        r.bLines.push(...gap.bLines, ...next.bLines);
        regions.splice(i + 1, 2);
        merged = true;
        break;
      }

      // Try merging backward: absorb into prev changed + unchanged gap
      if (
        i >= 2 &&
        regions[i - 1].type === "unchanged" &&
        regions[i - 2].type === "changed"
      ) {
        const gap = regions[i - 1];
        const prev = regions[i - 2];
        prev.aLines.push(...gap.aLines, ...r.aLines);
        prev.bLines.push(...gap.bLines, ...r.bLines);
        regions.splice(i - 1, 2);
        merged = true;
        break;
      }

      // Adjacent changed without gap
      if (i + 1 < regions.length && regions[i + 1].type === "changed") {
        r.aLines.push(...regions[i + 1].aLines);
        r.bLines.push(...regions[i + 1].bLines);
        regions.splice(i + 1, 1);
        merged = true;
        break;
      }
      if (i > 0 && regions[i - 1].type === "changed") {
        regions[i - 1].aLines.push(...r.aLines);
        regions[i - 1].bLines.push(...r.bLines);
        regions.splice(i, 1);
        merged = true;
        break;
      }
    }
  }

  return regions;
}

/**
 * Merge consecutive unchanged regions into single larger regions.
 * Refining and splitting conflicts leaves adjacent unchanged regions that
 * should be a single block.
 */
function mergeConsecutiveUnchanged(regions: DiffRegion[]): DiffRegion[] {
  if (regions.length === 0) return regions;
  const result: DiffRegion[] = [];

  for (const region of regions) {
    const prev = result[result.length - 1];
    if (prev && prev.type === "unchanged" && region.type === "unchanged") {
      prev.aLines.push(...region.aLines);
      prev.bLines.push(...region.bLines);
    } else {
      result.push(region);
    }
  }

  return result;
}

// ── suspicious auto-resolve detection ───────────────────────

const IDENT_RE = /[A-Za-z_$][A-Za-z0-9_$]*/g;
const COMMON_PREFIXES = /^[sm]_|^_/;

function extractIdentifiers(lines: string[]): Set<string> {
  const ids = new Set<string>();
  for (const line of lines) {
    for (const m of line.matchAll(IDENT_RE)) {
      if (m[0].length >= 4) ids.add(m[0]);
    }
  }
  return ids;
}

function normalizeIdent(id: string): string {
  return id.replace(COMMON_PREFIXES, "").toLowerCase();
}

function flagSuspiciousAutoResolves(regions: DiffRegion[]): void {
  const autoRegions: { idx: number; region: DiffRegion }[] = [];
  for (let i = 0; i < regions.length; i++) {
    if (regions[i].type === "auto-resolved") {
      autoRegions.push({ idx: i, region: regions[i] });
    }
  }

  if (autoRegions.length < 2) return;

  const oursAutos = autoRegions.filter((a) => a.region.autoSide === "ours");
  const theirsAutos = autoRegions.filter((a) => a.region.autoSide === "theirs");
  let nextGroup = 1;

  for (const ours of oursAutos) {
    const oursIds = extractIdentifiers(ours.region.aLines);
    const oursNorm = new Map<string, string>();
    for (const id of oursIds) oursNorm.set(normalizeIdent(id), id);

    for (const theirs of theirsAutos) {
      const theirsIds = extractIdentifiers(theirs.region.bLines);

      for (const tid of theirsIds) {
        const tNorm = normalizeIdent(tid);
        const match = oursNorm.get(tNorm);
        if (match && match !== tid) {
          const group = ours.region.suspiciousGroup ?? theirs.region.suspiciousGroup ?? nextGroup++;
          ours.region.suspiciousGroup = group;
          theirs.region.suspiciousGroup = group;
          break;
        }
      }
    }
  }
}

// ── helpers for emitting lines in order ──────────────────────

function emitOursLines(
  region: DiffRegion,
  sel: ChunkSelection,
  regionIndex: number,
  out: string[],
  sources: LineSource[] | null,
  mappings: (OutputLineMapping | null)[] | null,
) {
  for (let j = 0; j < region.aLines.length; j++) {
    if (sel.oursLines.has(j)) {
      out.push(region.aLines[j]);
      sources?.push("ours");
      mappings?.push({ regionIndex, side: "ours", lineIndex: j });
    }
  }
}

function emitTheirsLines(
  region: DiffRegion,
  sel: ChunkSelection,
  regionIndex: number,
  out: string[],
  sources: LineSource[] | null,
  mappings: (OutputLineMapping | null)[] | null,
) {
  for (let j = 0; j < region.bLines.length; j++) {
    if (sel.theirsLines.has(j)) {
      out.push(region.bLines[j]);
      sources?.push("theirs");
      mappings?.push({ regionIndex, side: "theirs", lineIndex: j });
    }
  }
}

/**
 * Build output text from regions and per-chunk selections.
 * Respects the `order` field so the side selected first appears first.
 */
export function buildOutputFromSelections(
  regions: DiffRegion[],
  selections: Map<number, ChunkSelection>,
): string {
  return buildOutputWithSources(regions, selections).text;
}

/**
 * Build output text AND a per-line source map for coloring the output pane.
 * Also returns a reverse mapping from each output line to its origin.
 * Regions with a selection entry are treated as "changed" even if auto-resolved.
 */
export function buildOutputWithSources(
  regions: DiffRegion[],
  selections: Map<number, ChunkSelection>,
): { text: string; lines: string[]; sources: LineSource[]; mappings: (OutputLineMapping | null)[] } {
  const output: string[] = [];
  const sources: LineSource[] = [];
  const mappings: (OutputLineMapping | null)[] = [];

  for (let i = 0; i < regions.length; i++) {
    const region = regions[i];
    if (region.type === "unchanged") {
      for (const line of region.aLines) {
        output.push(line);
        sources.push("unchanged");
        mappings.push(null);
      }
    } else if (region.type === "auto-resolved" && !selections.has(i)) {
      const lines = region.autoSide === "theirs" ? region.bLines : region.aLines;
      for (const line of lines) {
        output.push(line);
        sources.push("auto-resolved");
        mappings.push(null);
      }
    } else {
      const sel = selections.get(i);
      if (!sel) {
        // Default: include all ours lines
        for (let j = 0; j < region.aLines.length; j++) {
          output.push(region.aLines[j]);
          sources.push("ours");
          mappings.push({ regionIndex: i, side: "ours", lineIndex: j });
        }
      } else if (sel.order === "ours-first") {
        emitOursLines(region, sel, i, output, sources, mappings);
        emitTheirsLines(region, sel, i, output, sources, mappings);
      } else {
        emitTheirsLines(region, sel, i, output, sources, mappings);
        emitOursLines(region, sel, i, output, sources, mappings);
      }
    }
  }

  return { text: output.join("\n"), lines: output, sources, mappings };
}

/** Create a selection with all ours lines selected. */
export function selectAllOurs(region: DiffRegion): ChunkSelection {
  return {
    oursLines: new Set(region.aLines.map((_, i) => i)),
    theirsLines: new Set(),
    order: "ours-first",
  };
}

/** Create a selection with all theirs lines selected. */
export function selectAllTheirs(region: DiffRegion): ChunkSelection {
  return {
    oursLines: new Set(),
    theirsLines: new Set(region.bLines.map((_, i) => i)),
    order: "theirs-first",
  };
}

/** Create a selection with both sides selected (ours first). */
export function selectBoth(region: DiffRegion): ChunkSelection {
  return {
    oursLines: new Set(region.aLines.map((_, i) => i)),
    theirsLines: new Set(region.bLines.map((_, i) => i)),
    order: "ours-first",
  };
}
