import fastDiff from "fast-diff";
import type { DiffHunk } from "@/types/git";

/**
 * Character-level "is this part of the line actually changed?" marker.
 * The renderer dims `changed:false` spans and highlights `changed:true` spans
 * with a brighter background so indentation-only / typo-fix changes are
 * visually distinguishable from real content edits.
 */
export interface CharRange {
  start: number;
  end: number;
  changed: boolean;
}

// Pathologically long lines (minified bundles, generated code) — skip the
// intra-line diff. The diff viewer renders fine without it and a 100k-char
// Myers diff isn't worth the millisecond.
const MAX_LINE_LENGTH = 2000;
// Lines that share less than this fraction of characters in common are
// treated as unrelated. Pairing row-by-row inside a hunk can match a deletion
// with an entirely different addition, and Myers diff on two unrelated strings
// produces speckled single-char highlights rather than anything meaningful.
const MIN_COMMON_RATIO = 0.3;

type DiffOp = [number, string];

/**
 * Splits a line into "words" (identifier runs, whitespace runs, and individual
 * punctuation characters). Diffing at this granularity instead of character-by-
 * character avoids the classic Myers pitfall where a stray letter that happens
 * to appear in both lines (e.g. the `r` in `resolve` matching the `r` in `row`)
 * gets used as a common anchor — fragmenting an otherwise clean highlight.
 */
function tokenize(line: string): string[] {
  return line.match(/\s+|[A-Za-z_$][\w$]*|[^\s\w]/g) ?? [];
}

function rangesFor(oldLine: string, newLine: string): { oldRanges: CharRange[]; newRanges: CharRange[] } | null {
  if (oldLine.length > MAX_LINE_LENGTH || newLine.length > MAX_LINE_LENGTH) return null;

  const oldTokens = tokenize(oldLine);
  const newTokens = tokenize(newLine);

  // Map each unique token to a single Unicode code point in the BMP private-use
  // area so fast-diff (a byte-oriented LCS) sees one "char" per token. With
  // ~6400 slots available and typical lines having <50 tokens, overflow is
  // a non-issue, but we fall back to a sentinel if we ever hit it.
  const tokenToChar = new Map<string, string>();
  let nextCode = 0xe000;
  const codeOverflow = "�";
  const encode = (t: string): string => {
    let ch = tokenToChar.get(t);
    if (ch === undefined) {
      ch = nextCode <= 0xf8ff ? String.fromCharCode(nextCode++) : codeOverflow;
      tokenToChar.set(t, ch);
    }
    return ch;
  };
  const oldSynth = oldTokens.map(encode).join("");
  const newSynth = newTokens.map(encode).join("");

  const ops = fastDiff(oldSynth, newSynth) as DiffOp[];

  // Common-ratio gate (using char counts of the real tokens, not synth chars):
  // if the lines barely overlap we treat them as unrelated and skip highlighting
  // entirely — same rationale as before, just measured at the token mapping.
  let commonChars = 0;
  {
    let oti = 0;
    for (const [op, text] of ops) {
      if (op === 0) {
        for (let i = 0; i < text.length; i++) commonChars += oldTokens[oti + i].length;
        oti += text.length;
      } else if (op === -1) {
        oti += text.length;
      }
    }
  }
  const maxLen = Math.max(oldLine.length, newLine.length);
  if (maxLen === 0 || commonChars / maxLen < MIN_COMMON_RATIO) return null;

  // Map token-level ops back to character ranges in the original strings.
  const oldRanges: CharRange[] = [];
  const newRanges: CharRange[] = [];
  let oldTokenIdx = 0;
  let newTokenIdx = 0;
  let oldCharPos = 0;
  let newCharPos = 0;
  for (const [op, text] of ops) {
    const tokenCount = text.length;
    if (op === 0) {
      let oldLen = 0;
      let newLen = 0;
      for (let i = 0; i < tokenCount; i++) {
        oldLen += oldTokens[oldTokenIdx + i].length;
        newLen += newTokens[newTokenIdx + i].length;
      }
      oldRanges.push({ start: oldCharPos, end: oldCharPos + oldLen, changed: false });
      newRanges.push({ start: newCharPos, end: newCharPos + newLen, changed: false });
      oldCharPos += oldLen;
      newCharPos += newLen;
      oldTokenIdx += tokenCount;
      newTokenIdx += tokenCount;
    } else if (op === -1) {
      let oldLen = 0;
      for (let i = 0; i < tokenCount; i++) oldLen += oldTokens[oldTokenIdx + i].length;
      oldRanges.push({ start: oldCharPos, end: oldCharPos + oldLen, changed: true });
      oldCharPos += oldLen;
      oldTokenIdx += tokenCount;
    } else {
      let newLen = 0;
      for (let i = 0; i < tokenCount; i++) newLen += newTokens[newTokenIdx + i].length;
      newRanges.push({ start: newCharPos, end: newCharPos + newLen, changed: true });
      newCharPos += newLen;
      newTokenIdx += tokenCount;
    }
  }
  return { oldRanges, newRanges };
}

/**
 * Walks a hunk, pairs each consecutive `-` block with its following `+` block
 * row-by-row, and computes char-level diff ranges for every paired line.
 * Returns a map from line index in the hunk to that line's char ranges; lines
 * without a pair (additions/deletions in unbalanced blocks, or context lines)
 * are absent from the map.
 */
export function computeHunkIntraLineRanges(hunk: DiffHunk): Map<number, CharRange[]> {
  const result = new Map<number, CharRange[]>();
  const lines = hunk.lines;
  let i = 0;
  while (i < lines.length) {
    if (lines[i].origin !== "-") {
      i++;
      continue;
    }
    const dels: number[] = [];
    while (i < lines.length && lines[i].origin === "-") {
      dels.push(i);
      i++;
    }
    const adds: number[] = [];
    while (i < lines.length && lines[i].origin === "+") {
      adds.push(i);
      i++;
    }
    const pairLen = Math.min(dels.length, adds.length);
    for (let j = 0; j < pairLen; j++) {
      const ranges = rangesFor(lines[dels[j]].content, lines[adds[j]].content);
      if (ranges) {
        result.set(dels[j], ranges.oldRanges);
        result.set(adds[j], ranges.newRanges);
      }
    }
  }
  return result;
}
