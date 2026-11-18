import { useEffect, useState } from "react";
import type { ThemedToken } from "shiki";
import type { DiffHunk } from "@/types/git";
import { highlightLines, yieldToMacrotask } from "@/lib/shiki";
import { useThemeStore } from "@/stores/theme-store";

/** Minimum gap between syntax-highlight state flushes. One frame's worth: short
 *  enough that highlighting still appears to stream in, long enough that a
 *  many-hunk diff doesn't re-render the row list once per hunk. */
const HIGHLIGHT_FLUSH_MS = 16;

/**
 * Shiki tokens per hunk index, filled in progressively. `hunks` must be
 * referentially stable.
 *
 * Highlights hunk by hunk, yielding between them so clicks/renders can
 * interrupt long highlighting runs.
 *
 * Flushes are time-batched rather than per-hunk: every flush re-renders the
 * whole hunk list, and even with DiffLine memoized that costs ~20 ms of element
 * creation plus memo compares per 14k rows (and re-allocates hunkChangeKeys for
 * every hunk). A Unity .prefab diff is many small hunks — at 300 of them, 350 ms
 * of tokenization turned into ~12 s of reconciliation churn, quadratic in hunk
 * count. Batching makes it linear again and still paints long before the last
 * hunk lands.
 */
export function useHunkTokens(
  hunks: DiffHunk[],
  lang: string | undefined,
): Map<number, ThemedToken[][]> {
  const shikiThemeId = useThemeStore((s) => s.codeTheme.shikiTheme.name);
  const [tokensByHunk, setTokensByHunk] = useState<Map<number, ThemedToken[][]>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const tokenMap = new Map<number, ThemedToken[][]>();
    async function highlight() {
      let dirty = false;
      let lastFlush = performance.now();
      const flush = () => {
        dirty = false;
        lastFlush = performance.now();
        setTokensByHunk(new Map(tokenMap));
      };
      for (let hi = 0; hi < hunks.length; hi++) {
        if (cancelled) return;
        const hunk = hunks[hi];
        if (hunk.lines.length > 5000 || !lang) continue;
        const code = hunk.lines.map((l) => l.content).join("\n");
        try {
          const tokens = await highlightLines(code, lang, shikiThemeId);
          if (!cancelled) {
            tokenMap.set(hi, tokens);
            dirty = true;
            if (performance.now() - lastFlush >= HIGHLIGHT_FLUSH_MS) flush();
          }
        } catch { /* fallback: no highlighting */ }
        await yieldToMacrotask();
      }
      if (!cancelled && dirty) flush();
    }
    highlight();
    return () => {
      cancelled = true;
      setTokensByHunk(new Map());
    };
  }, [hunks, lang, shikiThemeId]);

  return tokensByHunk;
}
