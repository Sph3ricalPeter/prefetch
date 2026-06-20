import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Register the project's custom font-size tokens (see index.css @theme) so
// tailwind-merge classifies `text-caption` / `text-label` as font sizes rather
// than text colors. Without this it groups them with `text-dim`/`text-faint`
// and silently drops the size whenever both appear in one cn() call — which is
// what was nuking the size on the Kbd badge.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["caption", "label"] }],
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

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".ico", ".avif",
]);

export function isImageFile(filePath: string): boolean {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return false;
  return IMAGE_EXTENSIONS.has(filePath.slice(dot).toLowerCase());
}
