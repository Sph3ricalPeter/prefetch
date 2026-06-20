import { useEffect, useRef } from "react";

/**
 * Calls `onEscape` when Escape is pressed while `active` is true — used by modal
 * confirm dialogs so Escape cancels them.
 *
 * Registered on `window` in the capture phase so it runs before (and stops, via
 * stopPropagation) the global Escape stack in App.tsx — the topmost open dialog
 * owns Escape, not the filter/diff underneath it.
 */
export function useEscapeKey(active: boolean, onEscape: () => void) {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onEscapeRef.current();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [active]);
}
