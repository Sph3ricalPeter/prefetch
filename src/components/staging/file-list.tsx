import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  Trash2,
  Folder,
  FolderOpen,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { FileStatus } from "@/types/git";
import { useRepoStore } from "@/stores/repo-store";
import { FileIcon } from "@/components/ui/file-icon";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { buildFileTree, collectFilePaths } from "@/lib/file-tree";
import type { FileTreeNode } from "@/lib/file-tree";

/** Returns true if the file path matches an LFS glob pattern (e.g. "*.psd"). */
function matchesLfsPattern(filePath: string, pattern: string): boolean {
  const regex = new RegExp(
    "^" + pattern.replace(/\./g, "\\.").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*") + "$"
  );
  const fileName = filePath.split("/").pop() ?? filePath;
  return regex.test(fileName) || regex.test(filePath);
}

export function FileList() {
  const fileStatuses = useRepoStore((s) => s.fileStatuses);
  const selectedFilePath = useRepoStore((s) => s.selectedFilePath);
  const lfsInfo = useRepoStore((s) => s.lfsInfo);
  const stage = useRepoStore((s) => s.stage);
  const unstage = useRepoStore((s) => s.unstage);
  const discard = useRepoStore((s) => s.discard);
  const resolveOurs = useRepoStore((s) => s.resolveOurs);
  const resolveTheirs = useRepoStore((s) => s.resolveTheirs);
  const selectFile = useRepoStore((s) => s.selectFile);
  const isLoading = useRepoStore((s) => s.isLoading);

  const fileViewMode = useRepoStore((s) => s.fileViewMode);

  const isLfsFile = (filePath: string) =>
    lfsInfo?.initialized &&
    lfsInfo.tracked_patterns.some((p) => matchesLfsPattern(filePath, p.pattern));
  const [confirmDiscard, setConfirmDiscard] = useState<string[] | null>(null);
  const [conflictsOpen, setConflictsOpen] = useState(true);
  const [stagedOpen, setStagedOpen] = useState(true);
  const [unstagedOpen, setUnstagedOpen] = useState(true);
  const viewMode = fileViewMode;

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
        {viewMode === "tree" ? (
          <FileTreeView
            files={unstaged}
            selectedFilePath={selectedFilePath}
            isLfsFile={isLfsFile}
            onSelect={(path) => selectFile(path, false)}
            onToggle={(path) => stage([path])}
            toggleIcon={<Plus className="h-3 w-3" />}
            toggleTitle="Stage"
            onDiscard={(path) => setConfirmDiscard([path])}
            onToggleBatch={(paths) => stage(paths)}
            onDiscardBatch={(paths) => setConfirmDiscard(paths)}
            disabled={isLoading}
          />
        ) : (
          unstaged.map((file) => (
            <FileRow
              key={`unstaged-${file.path}`}
              file={file}
              isSelected={selectedFilePath === file.path}
              isLfs={!!isLfsFile(file.path)}
              onSelect={() => selectFile(file.path, false)}
              onToggle={() => stage([file.path])}
              toggleIcon={<Plus className="h-3 w-3" />}
              toggleTitle="Stage"
              onDiscard={() => setConfirmDiscard([file.path])}
              disabled={isLoading}
            />
          ))
        )}
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
        {viewMode === "tree" ? (
          <FileTreeView
            files={staged}
            selectedFilePath={selectedFilePath}
            isLfsFile={isLfsFile}
            onSelect={(path) => selectFile(path, true)}
            onToggle={(path) => unstage([path])}
            toggleIcon={<Minus className="h-3 w-3" />}
            toggleTitle="Unstage"
            onDiscard={(path) => setConfirmDiscard([path])}
            onToggleBatch={(paths) => unstage(paths)}
            onDiscardBatch={(paths) => setConfirmDiscard(paths)}
            disabled={isLoading}
          />
        ) : (
          staged.map((file) => (
            <FileRow
              key={`staged-${file.path}`}
              file={file}
              isSelected={selectedFilePath === file.path}
              isLfs={!!isLfsFile(file.path)}
              onSelect={() => selectFile(file.path, true)}
              onToggle={() => unstage([file.path])}
              toggleIcon={<Minus className="h-3 w-3" />}
              toggleTitle="Unstage"
              onDiscard={() => setConfirmDiscard([file.path])}
              disabled={isLoading}
            />
          ))
        )}
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
          className={`flex items-center gap-1 text-label font-semibold uppercase tracking-[0.06em] transition-colors ${labelClassName ?? "text-muted-foreground hover:text-foreground"}`}
        >
          {isOpen ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          {label}
          <span className="ml-1 normal-case tracking-normal text-faint">
            {count}
          </span>
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          {onAction && count > 0 && (
            <button
              onClick={onAction}
              disabled={actionDisabled}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
            >
              {actionLabel}
            </button>
          )}
        </div>
      </div>
      {isOpen && <div>{children}</div>}
    </div>
  );
}

// --- Tree view ---

function FileTreeView({
  files,
  selectedFilePath,
  isLfsFile,
  onSelect,
  onToggle,
  toggleIcon,
  toggleTitle,
  onDiscard,
  onToggleBatch,
  onDiscardBatch,
  disabled,
}: {
  files: FileStatus[];
  selectedFilePath: string | null;
  isLfsFile: (path: string) => boolean | undefined;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
  toggleIcon: React.ReactNode;
  toggleTitle: string;
  onDiscard: (path: string) => void;
  onToggleBatch: (paths: string[]) => void;
  onDiscardBatch: (paths: string[]) => void;
  disabled: boolean;
}) {
  const tree = useMemo(() => buildFileTree(files), [files]);

  return (
    <div>
      {tree.map((node) => (
        <TreeNodeView
          key={node.path}
          node={node}
          depth={0}
          selectedFilePath={selectedFilePath}
          isLfsFile={isLfsFile}
          onSelect={onSelect}
          onToggle={onToggle}
          toggleIcon={toggleIcon}
          toggleTitle={toggleTitle}
          onDiscard={onDiscard}
          onToggleBatch={onToggleBatch}
          onDiscardBatch={onDiscardBatch}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

function TreeNodeView({
  node,
  depth,
  selectedFilePath,
  isLfsFile,
  onSelect,
  onToggle,
  toggleIcon,
  toggleTitle,
  onDiscard,
  onToggleBatch,
  onDiscardBatch,
  disabled,
}: {
  node: FileTreeNode;
  depth: number;
  selectedFilePath: string | null;
  isLfsFile: (path: string) => boolean | undefined;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
  toggleIcon: React.ReactNode;
  toggleTitle: string;
  onDiscard: (path: string) => void;
  onToggleBatch: (paths: string[]) => void;
  onDiscardBatch: (paths: string[]) => void;
  disabled: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const indent = depth * 16;

  if (node.type === "directory") {
    const fileCount = collectFilePaths(node).length;
    return (
      <div>
        <div
          className="group flex w-full items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors cursor-pointer"
          style={{ paddingLeft: `${12 + indent}px` }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )}
          {expanded ? (
            <FolderOpen className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <Folder className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{node.name}</span>
          <span className="text-faint">{fileCount}</span>
          <span className="ml-auto shrink-0 flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDiscardBatch(collectFilePaths(node));
                  }}
                  disabled={disabled}
                  className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-destructive/20 text-muted-foreground hover:text-red-400 transition-all disabled:opacity-40"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Discard folder changes</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleBatch(collectFilePaths(node));
                  }}
                  disabled={disabled}
                  className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-secondary text-muted-foreground hover:text-foreground transition-all disabled:opacity-40"
                >
                  {toggleIcon}
                </button>
              </TooltipTrigger>
              <TooltipContent>{toggleTitle} folder</TooltipContent>
            </Tooltip>
          </span>
        </div>
        {expanded && node.children.map((child) => (
          <TreeNodeView
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedFilePath={selectedFilePath}
            isLfsFile={isLfsFile}
            onSelect={onSelect}
            onToggle={onToggle}
            toggleIcon={toggleIcon}
            toggleTitle={toggleTitle}
            onDiscard={onDiscard}
            onToggleBatch={onToggleBatch}
            onDiscardBatch={onDiscardBatch}
            disabled={disabled}
          />
        ))}
      </div>
    );
  }

  // File node
  const file = node.file!;
  const statusColor = statusTypeColor(file.status_type);
  const statusLabel = statusTypeLabel(file.status_type);
  const isSelected = selectedFilePath === file.path;
  const isLfs = !!isLfsFile(file.path);

  return (
    <div
      className={`group flex items-center gap-1.5 px-3 py-1.5 cursor-pointer transition-colors ${
        isSelected
          ? "bg-accent text-accent-foreground"
          : "hover:bg-secondary"
      }`}
      style={{ paddingLeft: `${12 + indent + 16}px` }}
      onClick={() => onSelect(file.path)}
    >
      <FileIcon filename={node.name} className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className={`w-4 shrink-0 text-center text-xs font-medium ${statusColor}`}>
        {statusLabel}
      </span>
      <span className="truncate text-xs text-foreground">{node.name}</span>
      {isLfs && (
        <span className="shrink-0 rounded px-1 py-px text-caption font-medium leading-none bg-blue-500/20 text-blue-400">
          LFS
        </span>
      )}
      <span className="ml-auto shrink-0 flex items-center gap-1 tabular-nums text-right">
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
              onDiscard(file.path);
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
              onToggle(file.path);
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

function FileRow({
  file,
  isSelected,
  isLfs,
  onSelect,
  onToggle,
  toggleIcon,
  toggleTitle,
  onDiscard,
  disabled,
}: {
  file: FileStatus;
  isSelected: boolean;
  isLfs: boolean;
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
      className={`group flex items-center gap-1.5 px-3 py-1.5 cursor-pointer transition-colors ${
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
        {isLfs && (
          <span className="shrink-0 rounded px-1 py-px text-caption font-medium leading-none bg-blue-500/20 text-blue-400">
            LFS
          </span>
        )}
        {dirPath && (
          <span className="truncate text-xs text-faint">
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
      className={`group flex items-center gap-1.5 px-3 py-1.5 cursor-pointer transition-colors ${
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
          <span className="truncate text-xs text-faint">
            {dirPath}
          </span>
        )}
      </div>
      <span className="shrink-0 text-xs text-red-400">
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
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={(e) => { e.stopPropagation(); onSelect(); }}
            disabled={disabled}
            className="shrink-0 rounded px-1.5 py-0.5 opacity-0 group-hover:opacity-100 text-xs font-medium text-purple-400 hover:bg-purple-500/20 transition-all disabled:opacity-40"
          >
            Edit
          </button>
        </TooltipTrigger>
        <TooltipContent>Open merge editor</TooltipContent>
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
