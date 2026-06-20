/** Plain-text search helpers for the in-view (diff / CI-log) search. */

// ANSI SGR/CSI escape sequence matcher — kept in sync with the strip used in
// `ci-log-parse.ts`. eslint-disable: matching the ESC byte is intentional.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** Strip ANSI escape sequences so log lines can be matched as plain text. */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

/** Upper bound on matches per recompute — guards against pathological queries
 *  (e.g. a single space) hanging the UI on a huge diff/log. */
const MAX_MATCHES = 2000;

/**
 * Find every case-insensitive occurrence of `query` within the rendered text of
 * `root` and return a DOM `Range` for each, in document order.
 *
 * A single match can span multiple text nodes (the diff splits lines into
 * per-syntax-token spans; the log into per-ANSI-color spans), so we concatenate
 * all text nodes into one string, locate hits there, then map each hit's
 * start/end character offsets back to `(node, offset)` Range boundaries.
 *
 * An empty/whitespace query, or a root with no text, returns `[]`.
 */
export function findMatchRanges(root: HTMLElement, query: string): Range[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  const starts: number[] = []; // global start offset of each node's text
  let combined = "";
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n as Text;
    starts.push(combined.length);
    combined += text.data;
    nodes.push(text);
  }
  if (combined.length === 0) return [];

  const haystack = combined.toLowerCase();
  const ranges: Range[] = [];

  // Index of the (last) node whose text covers a given global offset.
  const nodeIndexAt = (offset: number): number => {
    let lo = 0;
    let hi = nodes.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= offset) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  };

  let from = 0;
  while (ranges.length < MAX_MATCHES) {
    const idx = haystack.indexOf(q, from);
    if (idx === -1) break;
    const end = idx + q.length;

    const startNode = nodeIndexAt(idx);
    const endNode = nodeIndexAt(end - 1);
    const range = document.createRange();
    range.setStart(nodes[startNode], idx - starts[startNode]);
    range.setEnd(nodes[endNode], end - starts[endNode]);
    ranges.push(range);

    from = end;
  }

  return ranges;
}
