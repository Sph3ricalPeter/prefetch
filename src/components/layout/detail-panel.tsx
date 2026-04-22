import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Tag,
  Trash2,
  List,
  FolderTree,
  Folder,
  FolderOpen,
} from "lucide-react";
import { FileIcon } from "@/components/ui/file-icon";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useRepoStore } from "@/stores/repo-store";
import { FileList } from "@/components/staging/file-list";
import { buildFileTree } from "@/lib/file-tree";
import type { FileTreeNode } from "@/lib/file-tree";
import { CommitBox } from "@/components/staging/commit-box";
import { gravatarUrl } from "@/lib/gravatar";
import type { FileStatus } from "@/types/git";

// Claude Code orange — used for CC co-author avatar
const CLAUDE_ORANGE = "#E8734A";

function isClaudeCoAuthor(email: string): boolean {
  return email.includes("anthropic.com") || email.includes("claude");
}

/** Avatar with gravatar fetch + initial fallback. Shares the same URL scheme as the canvas graph. */
function AuthorAvatar({ name, email, size = 20 }: { name: string; email: string; size?: number }) {
  const url = useMemo(() => gravatarUrl(email, size * 2), [email, size]); // 2x for retina
  const [imgSrc, setImgSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    img.onload = () => { if (!cancelled) setImgSrc(url); };
    img.onerror = () => {}; // stays null → shows initials
    return () => { cancelled = true; };
  }, [url]);

  if (imgSrc && imgSrc === url) {
    return (
      <img
        src={imgSrc}
        alt={name}
        className="shrink-0 rounded-full"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className="shrink-0 rounded-full bg-secondary flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <span className="text-xs font-medium text-foreground">
        {name.charAt(0).toUpperCase()}
      </span>
    </div>
  );
}

export function DetailPanel() {
  const commits = useRepoStore((s) => s.commits);
  const selectedCommitId = useRepoStore((s) => s.selectedCommitId);
  const selectedStashIndex = useRepoStore((s) => s.selectedStashIndex);
  const stashes = useRepoStore((s) => s.stashes);
  const selectedFilePath = useRepoStore((s) => s.selectedFilePath);
  const fileStatuses = useRepoStore((s) => s.fileStatuses);
  const commitFiles = useRepoStore((s) => s.commitFiles);
  const tags = useRepoStore((s) => s.tags);
  const selectCommitFile = useRepoStore((s) => s.selectCommitFile);
  const selectStashFile = useRepoStore((s) => s.selectStashFile);
  const discardAll = useRepoStore((s) => s.discardAll);

  const [showDiscardAll, setShowDiscardAll] = useState(false);

  // Mode: Stash selected
  if (selectedStashIndex !== null) {
    const stash = stashes.find((s) => s.index === selectedStashIndex);
    if (stash) {
      return (
        <StashDetailView
          stash={stash}
          stashFiles={commitFiles}
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
          commitTags={tags.filter((t) => commit.id.startsWith(t.commit_id))}
          selectedFilePath={selectedFilePath}
          onFileClick={(path) => selectCommitFile(selectedCommitId, path)}
        />
      );
    }
  }

  if (fileStatuses.length > 0) {
    return (
      <div className="relative flex h-full flex-col bg-sidebar-background">
        <div className="shrink-0">
          <div className="flex h-10 items-center px-4">
            <h2 className="text-label font-semibold text-muted-foreground uppercase tracking-[0.06em]">
              Changes
            </h2>
            <span className="ml-2 text-xs text-faint">
              {fileStatuses.length}
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setShowDiscardAll(true)}
                  className="ml-auto rounded p-1 text-faint hover:bg-destructive/20 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Discard all changes</TooltipContent>
            </Tooltip>
          </div>
          <div className="mx-3 my-1 border-t border-border" />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <FileList />
        </div>
        <CommitBox />

        {/* Discard all confirmation */}
        {showDiscardAll && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="rounded-lg border border-border bg-card p-4 shadow-lg max-w-xs">
              <p className="text-sm text-foreground mb-1">Discard all changes?</p>
              <p className="text-xs text-muted-foreground mb-4">
                This will revert all {fileStatuses.length} file{fileStatuses.length !== 1 ? "s" : ""} to their last committed state. This cannot be undone.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowDiscardAll(false)}
                  className="rounded px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    discardAll();
                    setShowDiscardAll(false);
                  }}
                  className="rounded bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
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

function CommitDetailView({
  commit,
  commitFiles,
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
  commitTags: { name: string; message: string | null }[];
  selectedFilePath: string | null;
  onFileClick: (path: string) => void;
}) {
  const [commitOpen, setCommitOpen] = useState(true);
  const [filesOpen, setFilesOpen] = useState(true);
  const viewMode = useRepoStore((s) => s.fileViewMode);
  const setFileViewMode = useRepoStore((s) => s.setFileViewMode);

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

          {/* Message */}
          <p className="text-sm text-foreground mb-1">{commit.message}</p>

          {/* Body (description) */}
          {commit.body && (
            <p className="text-sm text-dim whitespace-pre-wrap leading-relaxed mb-2">
              {commit.body}
            </p>
          )}

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
            {commit.co_authors.map((ca, i) => {
              const isClaude = isClaudeCoAuthor(ca.email);
              return (
                <Tooltip key={i}>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1.5 cursor-default">
                      {isClaude ? (
                        <div
                          className="h-5 w-5 rounded-full flex items-center justify-center shrink-0"
                          style={{ backgroundColor: CLAUDE_ORANGE }}
                        >
                          <ClaudeIcon />
                        </div>
                      ) : (
                        <AuthorAvatar name={ca.name} email={ca.email} size={20} />
                      )}
                      <p className="text-xs text-foreground">{ca.name}</p>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>{ca.email || ca.name}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>

          {/* Date */}
          <p className="text-xs text-dim mt-3">
            Authored {dateStr}
          </p>
        </div>
      </CollapsibleSection>

      {/* Changed files section */}
      {commitFiles.length > 0 && (
        <CollapsibleSection
          label={`Changed Files (${commitFiles.length})`}
          isOpen={filesOpen}
          onToggle={() => setFilesOpen(!filesOpen)}
          action={
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setFileViewMode(viewMode === "flat" ? "tree" : "flat")}
                  className="rounded p-0.5 text-faint hover:text-muted-foreground transition-colors"
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
          {viewMode === "tree" ? (
            <CommitFileTreeView
              files={commitFiles}
              selectedFilePath={selectedFilePath}
              onFileClick={onFileClick}
            />
          ) : (
            <div className="pb-3">
              {commitFiles.map((file) => (
                <CommitFileRow
                  key={file.path}
                  file={file}
                  isSelected={selectedFilePath === file.path}
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
  selectedFilePath,
  onFileClick,
}: {
  stash: { index: number; message: string };
  stashFiles: FileStatus[];
  selectedFilePath: string | null;
  onFileClick: (path: string) => void;
}) {
  const [infoOpen, setInfoOpen] = useState(true);
  const [filesOpen, setFilesOpen] = useState(true);
  const viewMode = useRepoStore((s) => s.fileViewMode);
  const setFileViewMode = useRepoStore((s) => s.setFileViewMode);

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
      {stashFiles.length > 0 && (
        <CollapsibleSection
          label={`Changed Files (${stashFiles.length})`}
          isOpen={filesOpen}
          onToggle={() => setFilesOpen(!filesOpen)}
          action={
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setFileViewMode(viewMode === "flat" ? "tree" : "flat")}
                  className="rounded p-0.5 text-faint hover:text-muted-foreground transition-colors"
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
          {viewMode === "tree" ? (
            <CommitFileTreeView
              files={stashFiles}
              selectedFilePath={selectedFilePath}
              onFileClick={onFileClick}
            />
          ) : (
            <div className="pb-3">
              {stashFiles.map((file) => (
                <CommitFileRow
                  key={file.path}
                  file={file}
                  isSelected={selectedFilePath === file.path}
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

function CollapsibleSection({
  label,
  isOpen,
  onToggle,
  action,
  children,
}: {
  label: string;
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

function commitFileStatusLabel(type: string): string {
  switch (type) {
    case "added": return "A";
    case "untracked": return "?";
    case "modified": return "M";
    case "deleted": return "D";
    case "renamed": return "R";
    default: return "?";
  }
}

function CommitFileRow({
  file,
  isSelected,
  onClick,
}: {
  file: FileStatus;
  isSelected: boolean;
  onClick: () => void;
}) {
  const statusColor = commitFileStatusColor(file.status_type);
  const statusLabel = commitFileStatusLabel(file.status_type);

  const fileName = file.path.split("/").pop() ?? file.path;
  const dirPath = file.path.includes("/")
    ? file.path.slice(0, file.path.lastIndexOf("/"))
    : "";

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-1.5 px-4 py-1.5 text-left transition-colors ${
        isSelected
          ? "bg-accent text-accent-foreground"
          : "hover:bg-secondary"
      }`}
    >
      <FileIcon filename={fileName} className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span
        className={`w-4 shrink-0 text-center text-xs font-medium ${statusColor}`}
      >
        {statusLabel}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <span className="truncate text-xs text-foreground">{fileName}</span>
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
    </button>
  );
}

function CommitFileTreeView({
  files,
  selectedFilePath,
  onFileClick,
}: {
  files: FileStatus[];
  selectedFilePath: string | null;
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
  onFileClick,
}: {
  node: FileTreeNode;
  depth: number;
  selectedFilePath: string | null;
  onFileClick: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const indent = depth * 16;

  if (node.type === "directory") {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-1.5 px-4 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          style={{ paddingLeft: `${16 + indent}px` }}
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
        </button>
        {expanded &&
          node.children.map((child) => (
            <CommitTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedFilePath={selectedFilePath}
              onFileClick={onFileClick}
            />
          ))}
      </div>
    );
  }

  // File node
  const file = node.file!;
  const statusColor = commitFileStatusColor(file.status_type);
  const statusLabel = commitFileStatusLabel(file.status_type);
  const isSelected = selectedFilePath === file.path;

  return (
    <button
      onClick={() => onFileClick(file.path)}
      className={`flex w-full items-center gap-1.5 px-4 py-1.5 text-left transition-colors ${
        isSelected
          ? "bg-accent text-accent-foreground"
          : "hover:bg-secondary"
      }`}
      style={{ paddingLeft: `${16 + indent + 16}px` }}
    >
      <FileIcon
        filename={node.name}
        className="h-3 w-3 shrink-0 text-muted-foreground"
      />
      <span
        className={`w-4 shrink-0 text-center text-xs font-medium ${statusColor}`}
      >
        {statusLabel}
      </span>
      <span className="truncate text-xs text-foreground">{node.name}</span>
      <span className="ml-auto shrink-0 flex items-center gap-1 tabular-nums">
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

/** Claude logomark — the Anthropic calligraphy asterisk */
function ClaudeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 256 256"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M166.04 86.272L128.854 180.096H153.174L190.232 86.272H166.04ZM89.954 86.272L52.768 180.096H77.088L114.274 86.272H89.954Z"
        fill="white"
      />
    </svg>
  );
}
