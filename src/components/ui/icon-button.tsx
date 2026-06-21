import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * The single, consistent icon-only button used across the app — toolbars,
 * sidebar section actions, dialog close/back buttons, copy/open affordances and
 * the reveal-on-hover row controls. Wraps a lucide icon (passed as children);
 * the icon keeps its own size class, this owns the box: padding, rounding,
 * hover/disabled chrome and the optional hover-reveal animation.
 *
 * Axes:
 *  - `size`    — `sm` (p-0.5, dense rows) · `md` (p-1, default — everything else).
 *  - `variant` — `ghost` (tints + secondary bg on hover, default) · `subtle`
 *                (text only, no bg) · `faint` (dimmer idle, for tertiary controls)
 *                · `outline` (bordered).
 *  - `reveal`  — `fade`/`slide` hide the button until the parent `.group` is
 *                hovered/focused (slide also expands its width). Needs a parent
 *                with the `group` class.
 *
 * Surface-specific hover backgrounds (e.g. `hover:bg-accent`, `hover:bg-card-hover`)
 * and layout utilities (`shrink-0`, `ml-auto`, …) pass through `className` — they
 * override the defaults via tailwind-merge.
 */
const iconButtonVariants = cva(
  "inline-flex items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        ghost: "text-muted-foreground hover:bg-secondary hover:text-foreground",
        subtle: "text-muted-foreground hover:text-foreground",
        faint: "text-faint hover:text-muted-foreground",
        outline:
          "border border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
      },
      size: {
        sm: "p-0.5",
        md: "p-1",
      },
      reveal: {
        none: "",
        fade: "opacity-0 transition-all group-hover:opacity-100 group-focus-visible:opacity-100",
        slide:
          "max-w-0 overflow-hidden opacity-0 transition-all group-hover:max-w-6 group-hover:opacity-100 group-focus-visible:max-w-6 group-focus-visible:opacity-100",
      },
    },
    defaultVariants: {
      variant: "ghost",
      size: "md",
      reveal: "none",
    },
  },
);

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButtonVariants> {}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ className, variant, size, reveal, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(iconButtonVariants({ variant, size, reveal }), className)}
      {...props}
    />
  ),
);
IconButton.displayName = "IconButton";

// eslint-disable-next-line react-refresh/only-export-components -- cva variants are colocated with the component (shadcn convention); consumed by the few icon "buttons" that must render as a <span> (nested inside another button).
export { IconButton, iconButtonVariants };
