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
