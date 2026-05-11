/**
 * Shared inline-style constants for diff/conflict line rendering.
 *
 * `LINE_CONTAINMENT` (CSS `contain: content`) keeps layout/paint changes
 * inside one line from affecting siblings — big help when scrolling a long
 * diff. `SCROLL_CONTAINER_STYLE` (CSS `will-change: scroll-position`) hints
 * the browser to use GPU compositing for the scrollable diff pane.
 */
export const LINE_CONTAINMENT: React.CSSProperties = { contain: "content" };

export const SCROLL_CONTAINER_STYLE: React.CSSProperties = { willChange: "scroll-position" };
