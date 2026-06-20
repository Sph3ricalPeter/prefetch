import { useCallback, useEffect, useRef, useState } from "react";
import { findMatchRanges } from "@/lib/text-search";

/**
 * Drives the in-view search for the diff viewer and the CI-log viewer: given a
 * scroll container and the global filter query, it highlights every match (CSS
 * Custom Highlight API), tracks an "active" match, and exposes next/prev
 * navigation that scrolls the active match into view.
 *
 * A MutationObserver on the container rebuilds the match ranges whenever the
 * rendered DOM changes underneath us — async syntax tokens swapping in, groups
 * expanding, or a running CI log streaming new lines. (Stale ranges would point
 * at detached text nodes, so the highlight would silently vanish.) DOM-driven
 * rebuilds preserve the active match; only a new query resets it.
 *
 * next/prev are also driven by the `prefetch:search-nav` window event so the
 * far-away global filter input can advance matches via Enter / Shift+Enter.
 */

const HL_ALL = "prefetch-search";
const HL_ACTIVE = "prefetch-search-active";

// The CSS Custom Highlight API is not in every TS dom-lib config and is only
// available in Chromium ≥105. Access it through guarded, narrowly-typed views so
// the rest of the app degrades gracefully (navigation still works without paint).
type HighlightCtor = new (...ranges: Range[]) => unknown;
interface HighlightsRegistry {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}
const highlightsRegistry = (CSS as unknown as { highlights?: HighlightsRegistry }).highlights;
const HighlightImpl = (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight;
const highlightsSupported = !!highlightsRegistry && !!HighlightImpl;

// Register the ::highlight() pseudo-element styles once, at runtime. They can't
// be expressed in Tailwind and trip the build's CSS minifier (lightningcss
// doesn't know the `highlight` pseudo), so we inject them here — and only when
// the API is actually supported. `prefetch-search` paints every match;
// `prefetch-search-active` paints the currently-focused one (next/prev nav).
let stylesInjected = false;
function ensureHighlightStyles() {
  if (stylesInjected || !highlightsSupported) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent =
    "::highlight(prefetch-search){background-color:rgba(250,204,21,0.28)}" +
    "::highlight(prefetch-search-active){background-color:rgba(250,204,21,0.85);color:#18181b}";
  document.head.appendChild(style);
}

export interface InViewSearch {
  matchCount: number;
  /** 0-based index of the active match, or -1 when there are no matches. */
  activeIndex: number;
  next: () => void;
  prev: () => void;
}

export function useInViewSearch(
  containerRef: React.RefObject<HTMLElement | null>,
  query: string,
): InViewSearch {
  const [matchCount, setMatchCount] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rangesRef = useRef<Range[]>([]);
  const activeIndexRef = useRef(-1);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  const paint = useCallback((ranges: Range[], active: number) => {
    if (!highlightsSupported || !highlightsRegistry || !HighlightImpl) return;
    ensureHighlightStyles();
    if (ranges.length > 0) {
      highlightsRegistry.set(HL_ALL, new HighlightImpl(...ranges));
    } else {
      highlightsRegistry.delete(HL_ALL);
    }
    const activeRange = ranges[active];
    if (activeRange) {
      highlightsRegistry.set(HL_ACTIVE, new HighlightImpl(activeRange));
    } else {
      highlightsRegistry.delete(HL_ACTIVE);
    }
  }, []);

  const clear = useCallback(() => {
    if (!highlightsSupported || !highlightsRegistry) return;
    highlightsRegistry.delete(HL_ALL);
    highlightsRegistry.delete(HL_ACTIVE);
  }, []);

  const scrollToActive = useCallback((ranges: Range[], active: number) => {
    // Scroll the nearest element (not the range rect): under `contentVisibility:
    // auto` a range's own rect is unreliable, but the parent element resolves.
    const el = ranges[active]?.startContainer.parentElement;
    el?.scrollIntoView({ block: "center", inline: "nearest" });
  }, []);

  // Rebuild ranges + repaint. `resetActive` true → jump to the first match (new
  // query); false → keep the current active match, clamped (DOM refresh).
  const recompute = useCallback(
    (resetActive: boolean): number => {
      const root = containerRef.current;
      const q = query.trim();
      if (!root || !q) {
        rangesRef.current = [];
        setMatchCount(0);
        setActiveIndex(-1);
        clear();
        return -1;
      }
      const ranges = findMatchRanges(root, q);
      rangesRef.current = ranges;
      setMatchCount(ranges.length);
      let active: number;
      if (ranges.length === 0) {
        active = -1;
      } else if (resetActive) {
        active = 0;
      } else {
        const cur = activeIndexRef.current;
        active = Math.min(cur < 0 ? 0 : cur, ranges.length - 1);
      }
      setActiveIndex(active);
      paint(ranges, active);
      return active;
    },
    [containerRef, query, clear, paint],
  );

  // New query (recompute identity changes with `query`): reset to the first
  // match and scroll it into view.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const active = recompute(true);
      if (active >= 0) scrollToActive(rangesRef.current, active);
    });
    return () => cancelAnimationFrame(raf);
  }, [recompute, scrollToActive]);

  // Re-highlight when the rendered DOM changes (tokens loading, groups
  // expanding, CI log streaming). Preserve the active match; don't scroll.
  // `characterData`/`childList` only — class toggles (e.g. line selection)
  // shouldn't trigger a rebuild.
  useEffect(() => {
    if (query.trim().length === 0) return;
    const root = containerRef.current;
    if (!root) return;
    let raf = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => recompute(false));
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [query, containerRef, recompute]);

  // Clear highlights on unmount.
  useEffect(() => () => clear(), [clear]);

  const move = useCallback(
    (dir: 1 | -1) => {
      const ranges = rangesRef.current;
      if (ranges.length === 0) return;
      const cur = activeIndexRef.current;
      const nextIdx = (((cur + dir) % ranges.length) + ranges.length) % ranges.length;
      setActiveIndex(nextIdx);
      paint(ranges, nextIdx);
      scrollToActive(ranges, nextIdx);
    },
    [paint, scrollToActive],
  );

  const next = useCallback(() => move(1), [move]);
  const prev = useCallback(() => move(-1), [move]);

  // Let the global filter input drive navigation via Enter / Shift+Enter.
  useEffect(() => {
    if (query.trim().length === 0) return;
    const handler = (e: Event) => {
      const dir = (e as CustomEvent<{ dir?: "next" | "prev" }>).detail?.dir;
      if (dir === "next") next();
      else if (dir === "prev") prev();
    };
    window.addEventListener("prefetch:search-nav", handler);
    return () => window.removeEventListener("prefetch:search-nav", handler);
  }, [query, next, prev]);

  return { matchCount, activeIndex, next, prev };
}
