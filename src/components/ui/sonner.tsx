import type { CSSProperties } from "react";
import { Toaster as SonnerToaster } from "sonner";
import { CheckCircle2, XCircle, Loader2, AlertTriangle, Info } from "lucide-react";
import { useThemeStore } from "@/stores/theme-store";

/**
 * Toasts render on the same surface as tooltips (tooltip.tsx) and dropdowns
 * (dropdown-panel.tsx): `rounded-md border-foreground/15 bg-card shadow-xl`.
 *
 * Sonner injects its own stylesheet at runtime (`__insertCSS` in its bundle),
 * so it lands after Tailwind's and wins the cascade — and its surface rule
 * `[data-sonner-toast][data-styled='true']` outranks a single utility class
 * anyway. Colours and radius therefore go through sonner's own CSS variables
 * rather than classes; only the shadow, padding and font size, which have no
 * variable, need `!` to override.
 *
 * `richColors` is deliberately off: one surface for every toast, with severity
 * carried by the icon (the same lucide set multi-step-toast.tsx uses).
 */
const TOASTER_VARS = {
  "--width": "360px",
  "--border-radius": "var(--radius-md)",
  "--normal-bg": "var(--color-card)",
  "--normal-border": "color-mix(in oklab, var(--color-foreground) 15%, transparent)",
  "--normal-text": "var(--color-foreground)",
  fontFamily: '"Inter", system-ui, sans-serif',
} as CSSProperties;

export function Toaster({ offsetRight = 12 }: { offsetRight?: number }) {
  const themeType = useThemeStore((s) => s.appTheme.type);
  return (
    <SonnerToaster
      theme={themeType}
      position="bottom-right"
      // Pinned to the card (app-layout.tsx) instead of the viewport, so toasts
      // sit above the status bar and clear of the right detail column.
      className="absolute!"
      offset={{ bottom: 12, right: offsetRight }}
      // Right edge is `offsetRight` and stays there; the width is what gives.
      // At a 1280px window with the sidebar and detail panels both at their
      // maximum the center pane is only ~226px, and a flat 360px toast would
      // overhang it and lose 143px to the card's overflow-hidden. Setting
      // `left` instead would over-constrain the box — CSS then drops `right`
      // and the toast walks away from the panel edge it should be hugging.
      style={{ ...TOASTER_VARS, width: `min(var(--width), calc(100% - ${offsetRight + 12}px))` }}
      icons={{
        success: <CheckCircle2 className="h-4 w-4 text-green-500" />,
        error: <XCircle className="h-4 w-4 text-destructive" />,
        warning: <AlertTriangle className="h-4 w-4 text-amber-500" />,
        info: <Info className="h-4 w-4 text-muted-foreground" />,
        loading: <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />,
      }}
      toastOptions={{
        classNames: {
          // `data-styled=false` is sonner's marker for toast.custom() content,
          // which brings its own surface (multi-step-toast.tsx). Padding it
          // again insets it from the rest of the stack.
          toast:
            "w-full! shadow-xl! p-3! text-xs! items-start! gap-2! data-[styled=false]:p-0! data-[styled=false]:shadow-none!",
          // `!` on both sizes is load-bearing: sonner sets its own line-height
          // on [data-title] and [data-description], and its runtime-injected
          // stylesheet outranks a plain utility. Without it the title's line
          // box is 21px while the description's is 18px, and the icon — offset
          // for an 18px line — sits 1.5px above the title it should align to.
          icon: "mt-px",
          title: "text-xs! font-medium",
          description:
            "text-label! text-muted-foreground line-clamp-4 whitespace-pre-wrap break-words",
        },
      }}
    />
  );
}
