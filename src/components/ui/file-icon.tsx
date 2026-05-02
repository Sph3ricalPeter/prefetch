import { getClassWithColor } from "file-icons-js";

const FALLBACK_CLASS = "text-icon";

export function FileIcon({
  filename,
  className,
}: {
  filename: string;
  className?: string;
}) {
  const iconClass = getClassWithColor(filename) ?? FALLBACK_CLASS;
  return (
    <span
      className={`file-icon icon ${iconClass} ${className ?? ""}`}
    />
  );
}
