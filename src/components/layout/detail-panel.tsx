import React, { useMemo, useState } from "react";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  FolderTree,
  List,
  Tag,
  Trash2,
  Folder,
  FolderOpen,
  Plus,
  Minus,
  Pencil,
  ArrowRightLeft,
  HelpCircle,
  Sparkles,
  Bug,
  BookText,
  Palette,
  Hammer,
  Zap,
  FlaskConical,
  Package,
  Workflow,
  Wrench,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { parseCommitType, COMMIT_TYPE_META, type CommitType } from "@/lib/commit-type";
import { FileIcon } from "@/components/ui/file-icon";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useRepoStore } from "@/stores/repo-store";
import { useEscapeKey } from "@/hooks/use-escape-key";
import { HighlightedText } from "@/components/ui/highlighted-text";
import { FileList } from "@/components/staging/file-list";
import {
  buildFileTree,
  fileMatchesFilter,
  treeNodeMatchesFilter,
} from "@/lib/file-tree";
import type { FileTreeNode } from "@/lib/file-tree";
import { FILTER_DIM_CLASS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { CommitBox } from "@/components/staging/commit-box";
import { AuthorAvatar } from "@/components/ui/avatar";
import type { FileStatus } from "@/types/git";

const COMMIT_TYPE_ICONS: Record<CommitType, LucideIcon> = {
  feat: Sparkles,
  fix: Bug,
  docs: BookText,
  style: Palette,
  refactor: Hammer,
  perf: Zap,
  test: FlaskConical,
  build: Package,
  ci: Workflow,
  chore: Wrench,
  revert: Undo2,
};

export function DetailPanel() {
  const commits = useRepoStore((s) => s.commits);
  const selectedCommitId = useRepoStore((s) => s.selectedCommitId);
  const selectedStashIndex = useRepoStore((s) => s.selectedStashIndex);
  const stashes = useRepoStore((s) => s.stashes);
  const selectedFilePath = useRepoStore((s) => s.selectedFilePath);
  const fileStatuses = useRepoStore((s) => s.fileStatuses);
  const commitFiles = useRepoStore((s) => s.commitFiles);
  const commitFilesLoading = useRepoStore((s) => s.commitFilesLoading);
  const tags = useRepoStore((s) => s.tags);
  const selectCommitFile = useRepoStore((s) => s.selectCommitFile);
  const selectStashFile = useRepoStore((s) => s.selectStashFile);
  const discardAll = useRepoStore((s) => s.discardAll);
  const conflictState = useRepoStore((s) => s.conflictState);
  const fileViewMode = useRepoStore((s) => s.fileViewMode);
  const setFileViewMode = useRepoStore((s) => s.setFileViewMode);

  const [showDiscardAll, setShowDiscardAll] = useState(false);
  useEscapeKey(showDiscardAll, () => setShowDiscardAll(false));

  const operationInProgress = conflictState?.in_progress ?? false;

  // Mode: Stash selected
  if (selectedStashIndex !== null) {
    const stash = stashes.find((s) => s.index === selectedStashIndex);
    if (stash) {
      return (
        <StashDetailView
          stash={stash}
          stashFiles={commitFiles}
          stashFilesLoading={commitFilesLoading}
          selectedFilePath={selectedFilePath}
          onFileClick={(path) => selectStashFile(selectedStashIndex, path)}
        />
      );
    }
  }

  // Mode: Commit selected
  if (selectedCommitId) {
    const commit = commits.find((c) => c.id === selectedCommitId);
    if (commit) {
      return (
        <CommitDetailView
          commit={commit}
          commitFiles={commitFiles}
          commitFilesLoading={commitFilesLoading}
          commitTags={tags.filter((t) => commit.id.startsWith(t.commit_id))}
          selectedFilePath={selectedFilePath}
          onFileClick={(path) => selectCommitFile(selectedCommitId, path)}
        />
      );
    }
  }

  if (fileStatuses.length > 0 || operationInProgress) {
    return (
      <div className="relative flex h-full flex-col bg-sidebar-background">
        <div className="shrink-0">
          <div className="flex h-10 items-center px-4">
            <h2 className="text-label font-semibold text-muted-foreground uppercase tracking-[0.06em]">
              Changes
            </h2>
            <span className="ml-2 text-xs text-faint overflow-hidden min-w-0 shrink-[999]">
              {fileStatuses.length}
            </span>
            {(() => {
              const totals = fileStatuses.reduce(
                (acc, f) => ({
                  add: acc.add + (f.additions ?? 0),
                  del: acc.del + (f.deletions ?? 0),
                }),
                { add: 0, del: 0 },
              );
              return (totals.add > 0 || totals.del > 0) ? (
                <span className="ml-2 flex items-center gap-1.5 text-xs overflow-hidden min-w-0 shrink-[999]">
                  {totals.add > 0 && <span className="text-green-400">+{totals.add}</span>}
                  {totals.del > 0 && <span className="text-red-400">-{totals.del}</span>}
                </span>
              ) : null;
            })()}
            <div className="ml-auto flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setFileViewMode(fileViewMode === "flat" ? "tree" : "flat")}
                    className="rounded p-1 text-faint hover:text-muted-foreground transition-colors"
                  >
                    {fileViewMode === "flat" ? (
                      <FolderTree className="h-3.5 w-3.5" />
                    ) : (
                      <List className="h-3.5 w-3.5" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {fileViewMode === "flat" ? "Tree view" : "Flat view"}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setShowDiscardAll(true)}
                    className="rounded p-1 text-faint hover:bg-destructive/20 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Discard all changes</TooltipContent>
              </Tooltip>
            </div>
          </div>
          <div className="mx-3 my-1 border-t border-border" />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <FileList />
        </div>
        <CommitBox />

        {/* Discard all confirmation */}
        {showDiscardAll && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="rounded-lg border border-border bg-card p-4 shadow-lg max-w-xs">
              <p className="text-sm text-foreground mb-1">Discard all changes?</p>
              <p className="text-xs text-muted-foreground mb-4">
                This will revert all {fileStatuses.length} file{fileStatuses.length !== 1 ? "s" : ""} to their last committed state. This cannot be undone.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowDiscardAll(false)}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors whitespace-nowrap"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    discardAll();
                    setShowDiscardAll(false);
                  }}
                  className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 hover:-translate-y-px transition-all whitespace-nowrap"
                >
                  Discard All
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center bg-sidebar-background p-4">
      <p className="text-sm text-muted-foreground">
        Select a commit to view details
      </p>
    </div>
  );
}

function FileListSkeleton() {
  return (
    <div
      className="pb-3 space-y-1 px-4"
      style={{ animation: "skeleton-fade-in 0.3s ease both" }}
    >
      {[0.92, 0.68, 0.80, 0.55, 0.74].map((w, i) => (
        <div key={i} className="flex items-center gap-1.5 py-1.5 animate-pulse">
          <div className="h-3 w-3 rounded bg-secondary shrink-0" />
          <div className="h-3 w-4 rounded bg-secondary shrink-0" />
          <div className="h-3 rounded bg-secondary" style={{ width: `${w * 100}%` }} />
        </div>
      ))}
    </div>
  );
}

function CommitDetailView({
  commit,
  commitFiles,
  commitFilesLoading,
  commitTags,
  selectedFilePath,
  onFileClick,
}: {
  commit: {
    id: string;
    short_id: string;
    message: string;
    body: string;
    author_name: string;
    author_email: string;
    timestamp: number;
    co_authors: { name: string; email: string }[];
    parent_ids: string[];
  };
  commitFiles: FileStatus[];
  commitFilesLoading: boolean;
  commitTags: { name: string; message: string | null }[];
  selectedFilePath: string | null;
  onFileClick: (path: string) => void;
}) {
  const [commitOpen, setCommitOpen] = useState(true);
  const [filesOpen, setFilesOpen] = useState(true);
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const viewMode = useRepoStore((s) => s.fileViewMode);
  const setFileViewMode = useRepoStore((s) => s.setFileViewMode);
  // Filter dims non-matching files (by path) rather than hiding them.
  const filterQuery = useRepoStore((s) => s.filterQuery);
  const fileQuery = filterQuery.trim().toLowerCase();

  const date = new Date(commit.timestamp * 1000);
  const dateStr = date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="flex h-full flex-col bg-sidebar-background overflow-y-auto">
      {/* Commit section */}
      <CollapsibleSection
        label="Commit"
        isOpen={commitOpen}
        onToggle={() => setCommitOpen(!commitOpen)}
      >
        <div className="px-4 pb-4">
          {/* SHA + tag badges */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-xs text-muted-foreground">
              {commit.short_id}
            </span>
            {commitTags.map((t) => (
              <span
                key={t.name}
                className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground"
              >
                <Tag className="h-2.5 w-2.5" />
                {t.name}
              </span>
            ))}
          </div>

          {/* Message — tint the conventional-commit type prefix + leading icon */}
          {(() => {
            const parsed = parseCommitType(commit.message);
            if (!parsed) {
              return <p className="text-sm text-foreground mb-1">{commit.message}</p>;
            }
            const meta = COMMIT_TYPE_META[parsed.type];
            const TypeIcon = COMMIT_TYPE_ICONS[parsed.type];
            return (
              <p className="text-sm text-foreground mb-1 flex items-baseline gap-1.5">
                <TypeIcon
                  className="h-3 w-3 shrink-0 translate-y-0.5"
                  style={{ color: meta.color }}
                  aria-hidden
                />
                <span>
                  <span className="font-medium" style={{ color: meta.color }}>
                    {parsed.prefix}
                  </span>
                  {commit.message.slice(parsed.prefix.length)}
                </span>
              </p>
            );
          })()}

          {/* Body (description) */}
          {commit.body && (() => {
            const bodyLines = commit.body.split("\n").length;
            const needsClamp = bodyLines > 10;
            return (
              <div className="mb-2">
                <p className={`text-xs text-dim whitespace-pre-wrap leading-relaxed ${!bodyExpanded && needsClamp ? "line-clamp-[10]" : ""}`}>
                  {commit.body}
                </p>
                {needsClamp && (
                  <button
                    onClick={() => setBodyExpanded(!bodyExpanded)}
                    className="mt-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {bodyExpanded ? "Show less" : "Show more"}
                  </button>
                )}
              </div>
            );
          })()}

          {/* Authors — inline row */}
          <p className="text-label font-medium text-faint uppercase tracking-[0.08em] mt-3 mb-1">
            {commit.co_authors.length > 0 ? "Authors" : "Author"}
          </p>
          <div className="flex flex-wrap gap-3">
            {/* Primary author */}
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1.5 cursor-default">
                  <AuthorAvatar name={commit.author_name} email={commit.author_email} size={20} />
                  <p className="text-xs text-foreground">
                    {commit.author_name}
                  </p>
                </div>
              </TooltipTrigger>
              <TooltipContent>{commit.author_email}</TooltipContent>
            </Tooltip>

            {/* Co-authors inline */}
            {commit.co_authors.map((ca, i) => (
              <Tooltip key={i}>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1.5 cursor-default">
                    <AuthorAvatar name={ca.name} email={ca.email} size={20} />
                    <p className="text-xs text-foreground">{ca.name}</p>
                  </div>
                </TooltipTrigger>
                <TooltipContent>{ca.email || ca.name}</TooltipContent>
              </Tooltip>
            ))}
          </div>

          {/* Date */}
          <p className="text-xs text-dim mt-3">
            Authored {dateStr}
          </p>
        </div>
      </CollapsibleSection>

      {/* Changed files section */}
      {(commitFilesLoading || commitFiles.length > 0) && (
        <CollapsibleSection
          label={changedFilesLabel(commitFiles, commitFilesLoading)}
          isOpen={filesOpen}
          onToggle={() => setFilesOpen(!filesOpen)}
          action={
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setFileViewMode(viewMode === "flat" ? "tree" : "flat")}
                  className={`rounded p-0.5 text-faint hover:text-muted-foreground transition-colors ${commitFilesLoading ? "invisible" : ""}`}
                >
                  {viewMode === "flat" ? (
                    <FolderTree className="h-3 w-3" />
                  ) : (
                    <List className="h-3 w-3" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {viewMode === "flat" ? "Tree view" : "Flat view"}
              </TooltipContent>
            </Tooltip>
          }
        >
          {commitFilesLoading ? (
            <FileListSkeleton />
          ) : viewMode === "tree" ? (
            <CommitFileTreeView
              files={commitFiles}
              selectedFilePath={selectedFilePath}
              fileQuery={fileQuery}
              onFileClick={onFileClick}
            />
          ) : (
            <div className="pb-3">
              {commitFiles.map((file) => (
                <CommitFileRow
                  key={file.path}
                  file={file}
                  isSelected={selectedFilePath === file.path}
                  dimmed={fileQuery !== "" && !fileMatchesFilter(file.path, fileQuery)}
                  onClick={() => onFileClick(file.path)}
                />
              ))}
            </div>
          )}
        </CollapsibleSection>
      )}
    </div>
  );
}

function StashDetailView({
  stash,
  stashFiles,
  stashFilesLoading,
  selectedFilePath,
  onFileClick,
}: {
  stash: { index: number; message: string };
  stashFiles: FileStatus[];
  stashFilesLoading: boolean;
  selectedFilePath: string | null;
  onFileClick: (path: string) => void;
}) {
  const [infoOpen, setInfoOpen] = useState(true);
  const [filesOpen, setFilesOpen] = useState(true);
  const viewMode = useRepoStore((s) => s.fileViewMode);
  const setFileViewMode = useRepoStore((s) => s.setFileViewMode);
  const fileQuery = useRepoStore((s) => s.filterQuery).trim().toLowerCase();

  return (
    <div className="flex h-full flex-col bg-sidebar-background overflow-y-auto">
      {/* Stash info */}
      <CollapsibleSection
        label="Stash"
        isOpen={infoOpen}
        onToggle={() => setInfoOpen(!infoOpen)}
      >
        <div className="px-4 pb-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Archive className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              stash@{"{"}
              {stash.index}
              {"}"}
            </span>
          </div>
          <p className="text-sm text-foreground">{stash.message}</p>
        </div>
      </CollapsibleSection>

      {/* Changed files */}
      {(stashFilesLoading || stashFiles.length > 0) && (
        <CollapsibleSection
          label={changedFilesLabel(stashFiles, stashFilesLoading)}
          isOpen={filesOpen}
          onToggle={() => setFilesOpen(!filesOpen)}
          action={
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setFileViewMode(viewMode === "flat" ? "tree" : "flat")}
                  className={`rounded p-0.5 text-faint hover:text-muted-foreground transition-colors ${stashFilesLoading ? "invisible" : ""}`}
                >
                  {viewMode === "flat" ? (
                    <FolderTree className="h-3 w-3" />
                  ) : (
                    <List className="h-3 w-3" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {viewMode === "flat" ? "Tree view" : "Flat view"}
              </TooltipContent>
            </Tooltip>
          }
        >
          {stashFilesLoading ? (
            <FileListSkeleton />
          ) : viewMode === "tree" ? (
            <CommitFileTreeView
              files={stashFiles}
              selectedFilePath={selectedFilePath}
              fileQuery={fileQuery}
              onFileClick={onFileClick}
            />
          ) : (
            <div className="pb-3">
              {stashFiles.map((file) => (
                <CommitFileRow
                  key={file.path}
                  file={file}
                  isSelected={selectedFilePath === file.path}
                  dimmed={fileQuery !== "" && !fileMatchesFilter(file.path, fileQuery)}
                  onClick={() => onFileClick(file.path)}
                />
              ))}
            </div>
          )}
        </CollapsibleSection>
      )}
    </div>
  );
}

function changedFilesLabel(files: FileStatus[], loading: boolean): React.ReactNode {
  if (loading) return "Changed Files";
  const add = files.reduce((s, f) => s + (f.additions ?? 0), 0);
  const del = files.reduce((s, f) => s + (f.deletions ?? 0), 0);
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      <span className="shrink-0 whitespace-nowrap">Changed Files ({files.length})</span>
      {(add > 0 || del > 0) && (
        <span className="flex items-center gap-1 text-xs font-normal normal-case tracking-normal overflow-hidden min-w-0 shrink-[999]">
          {add > 0 && <span className="text-green-400">+{add}</span>}
          {del > 0 && <span className="text-red-400">-{del}</span>}
        </span>
      )}
    </span>
  );
}

function CollapsibleSection({
  label,
  isOpen,
  onToggle,
  action,
  children,
}: {
  label: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center px-4 py-2">
        <button
          onClick={onToggle}
          className="flex items-center gap-1.5 text-label font-semibold text-muted-foreground uppercase tracking-[0.06em] hover:text-foreground transition-colors"
        >
          {isOpen ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          {label}
        </button>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {isOpen && children}
      <div className="mx-3 my-1 border-t border-border" />
    </div>
  );
}

function commitFileStatusColor(type: string): string {
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

function commitFileStatusIcon(type: string): React.ReactNode {
  const cls = "h-[13px] w-[13px]";
  switch (type) {
    case "added": return <Plus className={cls} />;
    case "untracked": return <HelpCircle className={cls} />;
    case "modified": return <Pencil className={cls} />;
    case "deleted": return <Minus className={cls} />;
    case "renamed": return <ArrowRightLeft className={cls} />;
    default: return <HelpCircle className={cls} />;
  }
}

function CommitFileRow({
  file,
  isSelected,
  dimmed,
  onClick,
}: {
  file: FileStatus;
  isSelected: boolean;
  dimmed?: boolean;
  onClick: () => void;
}) {
  const statusColor = commitFileStatusColor(file.status_type);
  const statusLabel = commitFileStatusIcon(file.status_type);

  const fileName = file.path.split("/").pop() ?? file.path;
  const dirPath = file.path.includes("/")
    ? file.path.slice(0, file.path.lastIndexOf("/"))
    : "";

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-1.5 px-4 py-1.5 text-left transition-colors",
        isSelected ? "bg-accent text-accent-foreground" : "hover:bg-secondary",
        dimmed && FILTER_DIM_CLASS,
      )}
    >
      <span
        className={`w-4 shrink-0 text-center text-xs font-medium ${statusColor}`}
      >
        {statusLabel}
      </span>
      <FileIcon filename={fileName} className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <span className="truncate text-xs text-foreground"><HighlightedText text={fileName} /></span>
        {dirPath && (
          <span className="truncate text-xs text-faint">
            <HighlightedText text={dirPath} />
          </span>
        )}
      </div>
      <span className="flex items-center gap-1 tabular-nums text-right justify-end overflow-hidden min-w-0 shrink-[999]">
        {file.additions != null && (
          <span className="text-xs text-green-400">+{file.additions}</span>
        )}
        {file.deletions != null && file.deletions > 0 && (
          <span className="text-xs text-red-400">-{file.deletions}</span>
        )}
      </span>
    </button>
  );
}

function CommitFileTreeView({
  files,
  selectedFilePath,
  fileQuery,
  onFileClick,
}: {
  files: FileStatus[];
  selectedFilePath: string | null;
  fileQuery: string;
  onFileClick: (path: string) => void;
}) {
  const tree = useMemo(() => buildFileTree(files), [files]);

  return (
    <div className="pb-3">
      {tree.map((node) => (
        <CommitTreeNode
          key={node.path}
          node={node}
          depth={0}
          selectedFilePath={selectedFilePath}
          fileQuery={fileQuery}
          onFileClick={onFileClick}
        />
      ))}
    </div>
  );
}

function CommitTreeNode({
  node,
  depth,
  selectedFilePath,
  fileQuery,
  onFileClick,
}: {
  node: FileTreeNode;
  depth: number;
  selectedFilePath: string | null;
  fileQuery: string;
  onFileClick: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const indent = depth * 16;
  // Dim a node when filtering and neither it nor any descendant matches.
  const dimmed =
    fileQuery !== "" && !treeNodeMatchesFilter(node, fileQuery);

  if (node.type === "directory") {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className={cn(
            "relative flex w-full items-center gap-1.5 px-4 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors",
            dimmed && FILTER_DIM_CLASS,
          )}
          style={{ paddingLeft: `${16 + indent}px` }}
        >
          {Array.from({ length: depth }, (_, i) => (
            <div
              key={i}
              className="absolute top-0 bottom-0 w-px bg-border"
              style={{ left: `${22 + i * 16}px` }}
            />
          ))}
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
          <span className="truncate"><HighlightedText text={node.name} /></span>
        </button>
        {expanded &&
          node.children.map((child) => (
            <CommitTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedFilePath={selectedFilePath}
              fileQuery={fileQuery}
              onFileClick={onFileClick}
            />
          ))}
      </div>
    );
  }

  // File node
  const file = node.file!;
  const statusColor = commitFileStatusColor(file.status_type);
  const statusLabel = commitFileStatusIcon(file.status_type);
  const isSelected = selectedFilePath === file.path;

  return (
    <button
      onClick={() => onFileClick(file.path)}
      className={cn(
        "relative flex w-full items-center gap-1.5 px-4 py-1.5 text-left transition-colors",
        isSelected ? "bg-accent text-accent-foreground" : "hover:bg-secondary",
        dimmed && FILTER_DIM_CLASS,
      )}
      style={{ paddingLeft: `${16 + indent + 16}px` }}
    >
      {Array.from({ length: depth }, (_, i) => (
        <div
          key={i}
          className="absolute top-0 bottom-0 w-px bg-border"
          style={{ left: `${22 + i * 16}px` }}
        />
      ))}
      <span
        className={`w-4 shrink-0 text-center text-xs font-medium ${statusColor}`}
      >
        {statusLabel}
      </span>
      <FileIcon
        filename={node.name}
        className="h-4 w-4 shrink-0 text-muted-foreground"
      />
      <span className="truncate text-xs text-foreground"><HighlightedText text={node.name} /></span>
      <span className="ml-auto flex items-center gap-1 tabular-nums overflow-hidden min-w-0 shrink-[999]">
        {file.additions != null && (
          <span className="text-xs text-green-400">+{file.additions}</span>
        )}
        {file.deletions != null && file.deletions > 0 && (
          <span className="text-xs text-red-400">-{file.deletions}</span>
        )}
      </span>
    </button>
  );
}
