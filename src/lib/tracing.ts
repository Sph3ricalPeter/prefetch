/**
 * Lightweight frontend tracing using the built-in Performance API.
 *
 * In development, IPC spans are logged to the console and visible in
 * Chrome DevTools → Performance → Timings. In production, the overhead
 * is a single `performance.mark()` + `performance.measure()` call per
 * IPC round-trip — sub-microsecond, no console output.
 *
 * Usage:
 *   const end = traceIpc("get_commits");
 *   const data = await invoke<GraphData>("get_commits");
 *   end();
 */

const isDev = import.meta.env.DEV;

/**
 * Start tracing an IPC call. Returns a function that ends the span.
 *
 * The span shows up in:
 * - Chrome DevTools → Performance → Timings (always)
 * - Console (dev builds only)
 */
export function traceIpc(command: string): () => void {
  const markName = `ipc:${command}`;
  performance.mark(markName);

  return () => {
    const measureName = `⚡ ${command}`;
    try {
      performance.measure(measureName, markName);
      if (isDev) {
        const entries = performance.getEntriesByName(measureName, "measure");
        const last = entries[entries.length - 1];
        if (last) {
          console.debug(`[ipc] ${command}: ${last.duration.toFixed(1)}ms`);
        }
      }
    } catch {
      // mark may have been cleared — ignore
    }
  };
}
