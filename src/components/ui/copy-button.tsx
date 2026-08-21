import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
import { IconButton } from "./icon-button";

/**
 * Copy-to-clipboard icon button that flips to a checkmark for a moment.
 *
 * Used where a success toast would be the wrong feedback — inside a toast that
 * is itself the thing being copied (error toasts, failed multi-step runs), where
 * stacking another toast on top would just be noise.
 */
export function CopyButton({
  text,
  title = "Copy",
  className,
}: {
  text: string;
  title?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      size="sm"
      variant="subtle"
      title={title}
      className={className}
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => toast.error("Failed to copy to clipboard"),
        );
      }}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </IconButton>
  );
}
