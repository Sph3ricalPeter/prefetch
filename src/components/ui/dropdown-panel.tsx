import { cn } from "@/lib/utils";

/** Popover panel for dropdowns that open downward from their trigger.
 *  Keeps positioning, surface and the enter animation identical everywhere. */
export function DropdownPanel({
  align = "left",
  className,
  children,
}: {
  align?: "left" | "right";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "absolute top-full z-50 mt-1 rounded-md border border-border bg-popover py-1 shadow-lg animate-enter-down",
        align === "right" ? "right-0" : "left-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
