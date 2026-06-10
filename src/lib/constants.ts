/** Shared UI constants. */

/** Debounce delay (ms) applied to the global filter input before it is pushed
 *  to the store and applied to the sidebar, commit graph, and file lists.
 *  Tune here in one place. */
export const FILTER_DEBOUNCE_MS = 100;

/** Class applied to DOM rows that don't match the active filter. The filter
 *  dims non-matching rows rather than hiding them, consistent with the commit
 *  graph. Kept clickable — only the appearance changes. */
export const FILTER_DIM_CLASS = "opacity-40 transition-opacity";
