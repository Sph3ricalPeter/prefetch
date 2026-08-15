import { ArrowLeft, FileWarning, Save } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useRepoStore } from "@/stores/repo-store";
import { isImageFile } from "@/lib/utils";
import type { ConflictContents } from "@/types/git";

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  ico: "image/x-icon",
  avif: "image/avif",
};

function mimeFor(filePath: string): string {
  const ext = filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

const CHECKER_BG =
  "bg-[length:16px_16px] [background-image:linear-gradient(45deg,hsl(var(--muted))_25%,transparent_25%,transparent_75%,hsl(var(--muted))_75%),linear-gradient(45deg,hsl(var(--muted))_25%,transparent_25%,transparent_75%,hsl(var(--muted))_75%)] [background-position:0_0,8px_8px]";

interface SidePanelProps {
  label: string;
  hash: string;
  imageUri: string | null;
  tone: "ours" | "theirs";
  onAccept: () => void;
  disabled: boolean;
}

function SidePanel({ label, hash, imageUri, tone, onAccept, disabled }: SidePanelProps) {
  const v = tone === "ours" ? "--conflict-ours" : "--conflict-theirs";
  const textVar = tone === "ours" ? "--conflict-ours-text" : "--conflict-theirs-text";
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div
        className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5"
        style={{ backgroundColor: `rgba(var(${v}), 0.05)` }}
      >
        <div className="flex min-w-0 flex-1 items-center">
          <span className="truncate text-xs font-medium" style={{ color: `var(${textVar})` }}>
            {tone === "ours" ? "Ours" : "Theirs"} ({label})
          </span>
          {hash && (
            <span className="ml-1.5 font-mono text-caption text-muted-foreground/50">{hash}</span>
          )}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onAccept}
              disabled={disabled}
              className="flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40"
              style={{ borderColor: `rgba(var(${v}), 0.3)`, color: `var(${textVar})` }}
            >
              <Save className="h-3 w-3" />
              Accept {tone === "ours" ? "Ours" : "Theirs"}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            Keep the {tone === "ours" ? "ours" : "theirs"} version of this file and resolve the conflict
          </TooltipContent>
        </Tooltip>
      </div>
      <div className={`flex flex-1 items-center justify-center overflow-auto p-4 ${CHECKER_BG}`}>
        {imageUri ? (
          <img
            src={imageUri}
            alt={`${tone} version`}
            className="block max-h-full max-w-full object-contain"
          />
        ) : (
          <span className="text-xs text-muted-foreground">No preview available</span>
        )}
      </div>
    </div>
  );
}

interface BinaryConflictResolverProps {
  filePath: string;
  contents: ConflictContents;
}

/**
 * Resolution UI for conflicted binary files (images, archives, fonts, …).
 *
 * Binary files cannot be merged line-by-line, so we never feed them to the
 * text conflict editor — that would diff lossy-decoded bytes and hang the UI.
 * Instead the user picks a whole side: "Accept Ours" / "Accept Theirs" maps to
 * `git checkout --ours/--theirs`, which works on any blob.
 */
export function BinaryConflictResolver({ filePath, contents }: BinaryConflictResolverProps) {
  const resolveOurs = useRepoStore((s) => s.resolveOurs);
  const resolveTheirs = useRepoStore((s) => s.resolveTheirs);
  const isLoading = useRepoStore((s) => s.isLoading);
  const clearDiff = useRepoStore((s) => s.clearDiff);

  const isImage = isImageFile(filePath);
  const mime = mimeFor(filePath);
  const oursUri =
    isImage && contents.ours_image ? `data:${mime};base64,${contents.ours_image}` : null;
  const theirsUri =
    isImage && contents.theirs_image ? `data:${mime};base64,${contents.theirs_image}` : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton onClick={clearDiff} className="shrink-0">
              <ArrowLeft className="h-3.5 w-3.5" />
            </IconButton>
          </TooltipTrigger>
          <TooltipContent>Back to graph</TooltipContent>
        </Tooltip>
        <span className="truncate text-xs font-medium text-foreground min-w-0" title={filePath}>
          {filePath}
        </span>
        <span className="w-px h-4 bg-border shrink-0" />
        <FileWarning className="h-3.5 w-3.5 shrink-0 text-yellow-400" />
        <span className="text-xs text-muted-foreground">
          Binary file conflict — choose which version to keep
        </span>
      </div>
      <div className="flex min-h-0 flex-1">
        <SidePanel
          label={contents.ours_branch || "current"}
          hash={contents.ours_commit_id}
          imageUri={oursUri}
          tone="ours"
          onAccept={() => resolveOurs(filePath)}
          disabled={isLoading}
        />
        <div className="w-px shrink-0 bg-border" />
        <SidePanel
          label={contents.theirs_branch || "incoming"}
          hash={contents.theirs_commit_id}
          imageUri={theirsUri}
          tone="theirs"
          onAccept={() => resolveTheirs(filePath)}
          disabled={isLoading}
        />
      </div>
    </div>
  );
}
