import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import type { FileStatus } from "@/types/git";
import { useRepoStore } from "@/stores/repo-store";
import { FileIcon } from "@/components/ui/file-icon";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

export function FileList() {
  const fileStatuses = useRepoStore((s) => s.fileStatuses);
  const selectedFilePath = useRepoStore((s) => s.selectedFilePath);
  const stage = useRepoStore((s) => s.stage);
  const unstage = useRepoStore((s) => s.unstage);
  const discard = useRepoStore((s) => s.discard);
  const resolveOurs = useRepoStore((s) => s.resolveOurs);
  const resolveTheirs = useRepoStore((s) => s.resolveTheirs);
  const selectFile = useRepoStore((s) => s.selectFile);
  const isLoading = useRepoStore((s) => s.isLoading);
  const [confirmDiscard, setConfirmDiscard] = useState<string[] | null>(null);
  const [conflictsOpen, setConflictsOpen] = useState(true);
  const [stagedOpen, setStagedOpen] = useState(true);
  const [unstagedOpen, setUnstagedOpen] = useState(true);

  const conflicted = fileStatuses.filter((f) => f.is_conflicted);
  const staged = fileStatuses.filter((f) => f.is_staged && !f.is_conflicted);
  const unstaged = fileStatuses.filter((f) => !f.is_staged && !f.is_conflicted);

  if (fileStatuses.length === 0) {
    return (
      <div className="flex items-center justify-center p-4 text-xs text-muted-foreground">
        No changes
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-y-auto">
      {/* Conflicts section */}
      {conflicted.length > 0 && (
        <FileSection
          label="Conflicts"
          count={conflicted.length}
          isOpen={conflictsOpen}
          onToggle={() => setConflictsOpen(!conflictsOpen)}
          actionLabel=""
          actionDisabled={true}
          labelClassName="text-red-400 hover:text-red-300"
        >
          {conflicted.map((file) => (
            <ConflictRow
              key={`conflict-${file.path}`}
              file={file}
              isSelected={selectedFilePath === file.path}
              onSelect={() => selectFile(file.path, false)}
              onResolveOurs={() => resolveOurs(file.path)}
              onResolveTheirs={() => resolveTheirs(file.path)}
              disabled={isLoading}
            />
          ))}
        </FileSection>
      )}

      {/* Unstaged section */}
      <FileSection
        label="Unstaged"
        count={unstaged.length}
        isOpen={unstagedOpen}
        onToggle={() => setUnstagedOpen(!unstagedOpen)}
        actionLabel="Stage All"
        onAction={
          unstaged.length > 0
            ? () => stage(unstaged.map((f) => f.path))
            : undefined
        }
        actionDisabled={isLoading}
      >
        {unstaged.map((file) => (
          <FileRow
            key={`unstaged-${file.path}`}
            file={file}
            isSelected={selectedFilePath === file.path}
            onSelect={() => selectFile(file.path, false)}
            onToggle={() => stage([file.path])}
            toggleIcon={<Plus className="h-3 w-3" />}
            toggleTitle="Stage"
            onDiscard={() => setConfirmDiscard([file.path])}
            disabled={isLoading}
          />
        ))}
      </FileSection>

      {/* Staged section */}
      <FileSection
        label="Staged"
        count={staged.length}
        isOpen={stagedOpen}
        onToggle={() => setStagedOpen(!stagedOpen)}
        actionLabel="Unstage All"
        onAction={
          staged.length > 0
            ? () => unstage(staged.map((f) => f.path))
            : undefined
        }
        actionDisabled={isLoading}
      >
        {staged.map((file) => (
          <FileRow
            key={`staged-${file.path}`}
            file={file}
            isSelected={selectedFilePath === file.path}
            onSelect={() => selectFile(file.path, true)}
            onToggle={() => unstage([file.path])}
            toggleIcon={<Minus className="h-3 w-3" />}
            toggleTitle="Unstage"
            onDiscard={() => setConfirmDiscard([file.path])}
            disabled={isLoading}
          />
        ))}
      </FileSection>

      {/* Discard confirmation dialog */}
      {confirmDiscard && (
        <DiscardDialog
          paths={confirmDiscard}
          onConfirm={() => {
            discard(confirmDiscard);
            setConfirmDiscard(null);
          }}
          onCancel={() => setConfirmDiscard(null)}
        />
      )}
    </div>
  );
}

function FileSection({
  label,
  count,
  isOpen,
  onToggle,
  actionLabel,
  onAction,
  actionDisabled,
  labelClassName,
  children,
}: {
  label: string;
  count: number;
  isOpen: boolean;
  onToggle: () => void;
  actionLabel: string;
  onAction?: () => void;
  actionDisabled: boolean;
  labelClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center px-3 py-1.5">
        <button
          onClick={onToggle}
          className={`flex items-center gap-1 text-xs font-medium uppercase tracking-wider transition-colors ${labelClassName ?? "text-muted-foreground hover:text-foreground"}`}
        >
          {isOpen ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          {label}
          <span className="ml-1 normal-case tracking-normal text-muted-foreground/50">
            {count}
          </span>
        </button>
        {onAction && count > 0 && (
          <button
            onClick={onAction}
            disabled={actionDisabled}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            {actionLabel}
          </button>
        )}
      </div>
      {isOpen && <div>{children}</div>}
    </div>
  );
}

function FileRow({
  file,
  isSelected,
  onSelect,
  onToggle,
  toggleIcon,
  toggleTitle,
  onDiscard,
  disabled,
}: {
  file: FileStatus;
  isSelected: boolean;
  onSelect: () => void;
  onToggle: () => void;
  toggleIcon: React.ReactNode;
  toggleTitle: string;
  onDiscard: () => void;
  disabled: boolean;
}) {
  const statusColor = statusTypeColor(file.status_type);
  const statusLabel = statusTypeLabel(file.status_type);
  const fileName = file.path.split("/").pop() ?? file.path;
  const dirPath = file.path.includes("/")
    ? file.path.slice(0, file.path.lastIndexOf("/"))
    : "";

  return (
    <div
      className={`group flex items-center gap-1.5 px-3 py-0.5 cursor-pointer transition-colors ${
        isSelected
          ? "bg-accent text-accent-foreground"
          : "hover:bg-secondary"
      }`}
      onClick={onSelect}
    >
      <FileIcon filename={fileName} className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className={`w-4 shrink-0 text-center text-xs font-medium ${statusColor}`}>
        {statusLabel}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <span className="truncate text-xs text-foreground">{fileName}</span>
        {dirPath && (
          <span className="truncate text-xs text-muted-foreground/50">
            {dirPath}
          </span>
        )}
      </div>
      <span className="shrink-0 flex items-center gap-1 tabular-nums text-right min-w-[4rem] justify-end">
        {file.additions != null && (
          <span className="text-xs text-green-400">+{file.additions}</span>
        )}
        {file.deletions != null && file.deletions > 0 && (
          <span className="text-xs text-red-400">-{file.deletions}</span>
        )}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDiscard();
            }}
            disabled={disabled}
            className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-destructive/20 text-muted-foreground hover:text-red-400 transition-all disabled:opacity-40"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Discard changes</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            disabled={disabled}
            className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-secondary text-muted-foreground hover:text-foreground transition-all disabled:opacity-40"
          >
            {toggleIcon}
          </button>
        </TooltipTrigger>
        <TooltipContent>{toggleTitle}</TooltipContent>
      </Tooltip>
    </div>
  );
}

function ConflictRow({
  file,
  isSelected,
  onSelect,
  onResolveOurs,
  onResolveTheirs,
  disabled,
}: {
  file: FileStatus;
  isSelected: boolean;
  onSelect: () => void;
  onResolveOurs: () => void;
  onResolveTheirs: () => void;
  disabled: boolean;
}) {
  const fileName = file.path.split("/").pop() ?? file.path;
  const dirPath = file.path.includes("/")
    ? file.path.slice(0, file.path.lastIndexOf("/"))
    : "";

  const conflictLabel = (() => {
    switch (file.conflict_type) {
      case "both_modified": return "Both modified";
      case "both_added": return "Both added";
      case "both_deleted": return "Both deleted";
      case "added_by_us": return "We added";
      case "added_by_them": return "They added";
      case "deleted_by_us": return "We deleted";
      case "deleted_by_them": return "They deleted";
      default: return "Conflicted";
    }
  })();

  return (
    <div
      className={`group flex items-center gap-1.5 px-3 py-0.5 cursor-pointer transition-colors ${
        isSelected
          ? "bg-accent text-accent-foreground"
          : "hover:bg-secondary"
      }`}
      onClick={onSelect}
    >
      <AlertTriangle className="h-3 w-3 shrink-0 text-red-400" />
      <FileIcon filename={fileName} className="h-3 w-3 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <span className="truncate text-xs text-foreground">{fileName}</span>
        {dirPath && (
          <span className="truncate text-xs text-muted-foreground/50">
            {dirPath}
          </span>
        )}
      </div>
      <span className="shrink-0 text-xs text-red-400/70">
        {conflictLabel}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={(e) => { e.stopPropagation(); onResolveOurs(); }}
            disabled={disabled}
            className="shrink-0 rounded px-1.5 py-0.5 opacity-0 group-hover:opacity-100 text-xs font-medium text-blue-400 hover:bg-blue-500/20 transition-all disabled:opacity-40"
          >
            Ours
          </button>
        </TooltipTrigger>
        <TooltipContent>Keep your version</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={(e) => { e.stopPropagation(); onResolveTheirs(); }}
            disabled={disabled}
            className="shrink-0 rounded px-1.5 py-0.5 opacity-0 group-hover:opacity-100 text-xs font-medium text-green-400 hover:bg-green-500/20 transition-all disabled:opacity-40"
          >
            Theirs
          </button>
        </TooltipTrigger>
        <TooltipContent>Keep their version</TooltipContent>
      </Tooltip>
    </div>
  );
}

function statusTypeColor(type: string): string {
  switch (type) {
    case "added":
    case "untracked":
      return "text-green-400";
    case "modified":
      return "text-yellow-400";
    case "deleted":
      return "text-red-400";
    case "renamed":
      return "text-blue-400";
    default:
      return "text-muted-foreground";
  }
}

function statusTypeLabel(type: string): string {
  switch (type) {
    case "added":
      return "A";
    case "untracked":
      return "?";
    case "modified":
      return "M";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    default:
      return "?";
  }
}

function DiscardDialog({
  paths,
  onConfirm,
  onCancel,
}: {
  paths: string[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const fileName = paths.length === 1 ? paths[0].split("/").pop() : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="rounded-lg border border-border bg-popover p-4 shadow-lg max-w-xs">
        <p className="text-sm text-foreground mb-1">Discard changes?</p>
        <p className="text-xs text-muted-foreground mb-4">
          {fileName
            ? `Revert "${fileName}" to its last committed state. This cannot be undone.`
            : `Revert ${paths.length} files to their last committed state. This cannot be undone.`}
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
