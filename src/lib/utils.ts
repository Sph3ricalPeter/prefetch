import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

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
