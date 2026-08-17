import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Register the project's custom font-size tokens (see index.css @theme) so
// tailwind-merge classifies `text-caption` / `text-label` / `text-heading` as
// font sizes rather than text colors. Without this it groups them with
// `text-dim`/`text-faint` and silently drops the size whenever both appear in
// one cn() call — which is what was nuking the size on the Kbd badge.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["caption", "label", "heading"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getDataAttrFromEvent(
  e: React.MouseEvent | MouseEvent,
  attr: string,
  boundary?: HTMLElement | null,
): string | null {
  let el = e.target as HTMLElement | null;
  while (el && el !== boundary) {
    const val = el.getAttribute(attr);
    if (val) return val;
    el = el.parentElement;
  }
  return null;
}

/** Coarse relative time — "just now" / "5m ago" / "3h ago" / "2d ago". */
export function formatTimeAgo(when: string | number): string {
  const ts = typeof when === "number" ? when : new Date(when).getTime();
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".ico", ".avif",
]);

export function isImageFile(filePath: string): boolean {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return false;
  return IMAGE_EXTENSIONS.has(filePath.slice(dot).toLowerCase());
}
