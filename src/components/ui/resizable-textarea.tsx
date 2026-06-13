import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

interface ResizableTextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Grow the textarea to fit its content (in addition to manual resizing). */
  autoGrow?: boolean;
  /** Minimum height in px (the collapsed/default size). */
  minHeight: number;
  /** Maximum height in px the box can grow/be dragged to. */
  maxHeight: number;
  /** Which corner the custom drag-to-resize grip sits in. */
  gripPosition?: "top-right" | "bottom-right";
  /** Extra classes for the relative wrapper. */
  wrapperClassName?: string;
  /** Optional absolutely-positioned overlay (e.g. a character counter). */
  overlay?: ReactNode;
  /** Forwarded ref to the underlying textarea. */
  textareaRef?: Ref<HTMLTextAreaElement>;
}

/**
 * Textarea with a custom drag-to-resize grip (positionable in any corner —
 * the native resize handle is locked to the bottom-right) and optional
 * auto-grow that expands the box to fit its content.
 *
 * Heights are applied directly to the DOM node rather than via React state so
 * dragging stays smooth and never fights a controlled `value` re-render.
 */
export function ResizableTextarea({
  autoGrow = false,
  minHeight,
  maxHeight,
  gripPosition = "bottom-right",
  wrapperClassName,
  overlay,
  textareaRef,
  className,
  value,
  ...props
}: ResizableTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(textareaRef, () => ref.current as HTMLTextAreaElement);

  // Height the user has explicitly dragged to. Acts as a floor: auto-grow can
  // still expand past it for long content, but never shrinks below it.
  const manualHeight = useRef<number | null>(null);

  const apply = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    let target = manualHeight.current ?? minHeight;
    if (autoGrow) {
      el.style.height = "auto";
      const border = el.offsetHeight - el.clientHeight; // border-box borders
      target = Math.max(target, el.scrollHeight + border);
    }
    el.style.height = `${Math.min(maxHeight, Math.max(minHeight, target))}px`;
  }, [autoGrow, minHeight, maxHeight]);

  // Size on mount and whenever the controlled value changes externally.
  useLayoutEffect(() => {
    apply();
  }, [apply, value]);

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const el = ref.current;
      if (!el) return;
      const startY = e.clientY;
      const startH = el.getBoundingClientRect().height;
      const grows = gripPosition === "top-right" ? -1 : 1; // drag direction

      const onMove = (ev: MouseEvent) => {
        const delta = (ev.clientY - startY) * grows;
        manualHeight.current = Math.max(
          minHeight,
          Math.min(maxHeight, startH + delta),
        );
        apply();
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [apply, gripPosition, minHeight, maxHeight],
  );

  return (
    <div className={cn("relative", wrapperClassName)}>
      <textarea
        ref={ref}
        value={value}
        className={cn(
          "w-full resize-none rounded-md bg-background border px-3 py-2 text-xs text-foreground placeholder:text-faint outline-none focus:ring-1 focus:ring-ring transition-colors",
          // Auto-grow hides its own overflow (height tracks content); a fixed/
          // manually-sized box scrolls instead of clipping.
          autoGrow ? "overflow-hidden" : "overflow-auto",
          className,
        )}
        {...props}
      />
      {overlay}
      {/* Custom resize grip — the native handle can only sit bottom-right. */}
      <div
        onMouseDown={onResizeStart}
        className={cn(
          "group absolute flex h-4 w-6 cursor-ns-resize items-center justify-center",
          gripPosition === "top-right" ? "right-1 top-1" : "bottom-1 right-1",
        )}
      >
        <div className="h-1 w-4 rounded-full bg-muted-foreground/30 transition-colors group-hover:bg-muted-foreground/60" />
      </div>
    </div>
  );
}
