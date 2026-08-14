import { useEffect, useRef, useState } from "react";

/**
 * Gates a loading flag so skeletons never flash. Stays false until `active` has
 * held for `delayMs` — fast loads (the local-git common case) therefore never
 * show a skeleton at all, the card just appears fully populated. Once true it
 * stays true for at least `minMs`, so a skeleton that does appear is readable
 * instead of blinking out 10ms later.
 */
export function useDelayedFlag(active: boolean, delayMs = 150, minMs = 300): boolean {
  const [shown, setShown] = useState(false);
  const shownAt = useRef(0);

  useEffect(() => {
    if (active) {
      if (shown) return;
      const id = setTimeout(() => {
        shownAt.current = Date.now();
        setShown(true);
      }, delayMs);
      return () => clearTimeout(id);
    }
    if (!shown) return;
    const remaining = minMs - (Date.now() - shownAt.current);
    if (remaining <= 0) {
      setShown(false);
      return;
    }
    const id = setTimeout(() => setShown(false), remaining);
    return () => clearTimeout(id);
  }, [active, shown, delayMs, minMs]);

  return shown;
}
