import React, { useLayoutEffect, useMemo, useState } from "react";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  FolderTree,
  List,
  Tag,
  Calendar,
  Trash2,
  Folder,
  FolderOpen,
  Plus,
  Minus,
  Pencil,
  ArrowRightLeft,
  HelpCircle,
} from "lucide-react";
import { CommitMessageText } from "@/components/ui/commit-message-text";
import { FileIcon } from "@/components/ui/file-icon";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useRepoStore } from "@/stores/repo-store";
import { ConfirmDialog } from "@/components/ui/modal";
import { HighlightedText } from "@/components/ui/highlighted-text";
import { SectionHeader } from "@/components/ui/section-header";
import { DiffStat } from "@/components/ui/diff-stat";
import { FileList } from "@/components/staging/file-list";
import {
  buildFileTree,
  collectDirPaths,
  fileMatchesFilter,
  treeNodeMatchesFilter,
} from "@/lib/file-tree";
import type { FileTreeNode } from "@/lib/file-tree";
import { TreeCollapseProvider, useTreeCollapse } from "@/hooks/use-tree-collapse";
import { useDelayedFlag } from "@/hooks/use-delayed-flag";
import { useDragHeight } from "@/hooks/use-split-ratio";
import { RowDragHandle } from "@/components/ui/row-drag-handle";
import { FILTER_DIM_CLASS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/ui/icon-button";
import { CommitBox } from "@/components/staging/commit-box";
import { AuthorAvatar } from "@/components/ui/avatar";
import type { FileStatus } from "@/types/git";

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
      <div className="relative flex h-full flex-col bg-background">
        {/* Extended topbar — continues the commit-graph header across the detail column */}
        <div className="flex h-6 shrink-0 items-center gap-2 border-border bg-background pl-3 pr-2">
          <span className="text-caption font-semibold tracking-widest text-faint">
            Working Changes
          </span>
          <span className="text-xs text-faint">{fileStatuses.length}</span>
          <DiffStat files={fileStatuses} />
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <IconButton
                    variant="faint"
                    onClick={() => setFileViewMode(fileViewMode === "flat" ? "tree" : "flat")}
                  >
                    {fileViewMode === "flat" ? (
                      <FolderTree className="h-3.5 w-3.5" />
                    ) : (
                      <List className="h-3.5 w-3.5" />
                    )}
                  </IconButton>
                </TooltipTrigger>
                <TooltipContent>
                  {fileViewMode === "flat" ? "Tree view" : "Flat view"}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <IconButton
                    variant="faint"
                    onClick={() => setShowDiscardAll(true)}
                    className="hover:bg-destructive/20 hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                </TooltipTrigger>
                <TooltipContent>Discard all changes</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>

        {/* Section cards (Unstaged / Staged) + commit box */}
        <div className="flex min-h-0 flex-1 flex-col pt-1 pr-1 pb-1 pl-1">
          <FileList />
          {/* CommitBox renders its own drag handle + card (the handle doubles
              as the gap, matching the unstaged/staged split). */}
          <CommitBox />
        </div>

        {/* Discard all confirmation */}
        {showDiscardAll && (
          <ConfirmDialog
            open
            onClose={() => setShowDiscardAll(false)}
            title="Discard all changes?"
            description={`This will revert all ${fileStatuses.length} file${fileStatuses.length !== 1 ? "s" : ""} to their last committed state. This cannot be undone.`}
            confirmLabel="Discard All"
            destructive
            onConfirm={() => {
              discardAll();
              setShowDiscardAll(false);
            }}
          />
        )}
      </div>
    );
  }

  // Nothing to show. The detail column collapses to zero width (see app-layout),
  // so the commit graph fills the whole card — no placeholder is rendered.
  return null;
}

/** Changed-files floor — this is what squeezes the details card. */
const FILES_MIN_HEIGHT = 96;

/** Description lines an undragged card opens with, when the body has that many. */
const DEFAULT_BODY_LINES = 3;

/**
 * Commit description, clamped with an ellipsis to however many lines it's been
 * given. It's the only elastic part of the details card — the card itself just
 * sizes to content — so the resize drag lands here, and `height` is the raw px
 * the drag asked for. It follows the cursor freely and only snaps to whole
 * lines once the drag ends, so it reads as smooth but never rests on a sliced
 * line. `max-height` caps it at the length of the description, so the card
 * can't show dead space or have to claw height back after the fact. The text is
 * absolutely positioned so it can't inflate the card's min-content height.
 */
function ClampedBody({
  text,
  boxRef,
  height,
  dragging,
}: {
  text: string;
  boxRef: React.RefObject<HTMLDivElement | null>;
  height?: number;
  dragging: boolean;
}) {
  const [{ lineHeight, totalLines, boxHeight }, setFit] = useState({
    lineHeight: 0,
    totalLines: 1,
    boxHeight: 0,
  });

  useLayoutEffect(() => {
    const box = boxRef.current;
    const p = box?.firstElementChild as HTMLElement | null;
    if (!box || !p) return;
    const measure = () => {
      const lh = parseFloat(getComputedStyle(box).lineHeight);
      if (!lh) return;
      // `scrollHeight` is the whole description whatever the clamp currently
      // says, so the line count can't lag the box mid-drag the way measuring
      // the clamped text does.
      setFit({
        lineHeight: lh,
        totalLines: Math.max(1, Math.round(p.scrollHeight / lh)),
        boxHeight: box.clientHeight,
      });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    // Re-runs on `text` too: a new commit can be a different length in a box
    // that never resized.
    measure();
    return () => ro.disconnect();
  }, [text, boxRef]);

  const asked = height ?? DEFAULT_BODY_LINES * lineHeight;
  const snapped = dragging ? asked : Math.round(asked / (lineHeight || 1)) * lineHeight;
  const boxSize = Math.min(totalLines * lineHeight, Math.max(lineHeight, snapped));
  // Rounded, so a line the box has mostly revealed is drawn rather than left as
  // a gap — and once the drag ends the box is a whole number of lines anyway.
  // Off the size being rendered, not the measured one, which lags it by a frame;
  // the measurement only counts when it's smaller, i.e. a short panel squeezing.
  const room = boxHeight > 0 ? Math.min(boxSize, boxHeight) : boxSize;
  const visible = Math.max(1, Math.min(totalLines, Math.round(room / (lineHeight || 1))));

  return (
    <div
      ref={boxRef}
      className="relative mt-1.5 flex-initial overflow-hidden text-xs leading-relaxed"
      style={
        lineHeight
          ? { height: boxSize, minHeight: lineHeight, maxHeight: totalLines * lineHeight }
          : undefined
      }
    >
      {/* Auto-height (no `bottom`), so `scrollHeight` measures the text, not the box. */}
      <p
        className="absolute left-0 right-0 top-0 line-clamp-1 text-dim whitespace-pre-wrap"
        style={{ WebkitLineClamp: visible }}
      >
        {text}
      </p>
    </div>
  );
}

function FileListSkeleton() {
  return (
    <div className="pb-3 space-y-1 px-2">
      {[0.92, 0.68, 0.80, 0.55, 0.74].map((w, i) => (
        <div key={i} className="flex items-center gap-1.5 py-1.5 animate-pulse">
          <div className="h-3 w-3 rounded-md bg-secondary shrink-0" />
          <div className="h-3 w-4 rounded-md bg-secondary shrink-0" />
          <div className="h-3 rounded-md bg-secondary" style={{ width: `${w * 100}%` }} />
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
  // The handle resizes the description, not the card — the card follows it.
  const { elRef: bodyRef, height: bodyHeight, dragging, onDragStart } = useDragHeight();
  // Skeleton is gated so a sub-150ms load never flashes one — the card just
  // appears fully populated instead.
  const showSkeleton = useDelayedFlag(commitFilesLoading);
  const viewMode = useRepoStore((s) => s.fileViewMode);
  const setFileViewMode = useRepoStore((s) => s.setFileViewMode);
  // Filter dims non-matching files (by path) rather than hiding them.
  const filterQuery = useRepoStore((s) => s.filterQuery);
  const fileQuery = filterQuery.trim().toLowerCase();

  const hasFiles = showSkeleton || commitFiles.length > 0;
  const filesExpand = filesOpen && hasFiles;
  const bothExpand = commitOpen && filesExpand;

  const date = new Date(commit.timestamp * 1000);
  const dateStr = date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Extended topbar — mirrors the working-changes header */}
      <div className="flex h-6 shrink-0 items-center gap-2 border-border bg-background pl-3 pr-2">
        <span className="text-caption font-semibold tracking-widest text-faint">
          Commit
        </span>
        {/* The SHA lives here — the commit card's refs row shows tags only.
            No diffstat: the Changed Files card header already carries it. */}
        <span className="text-xs text-faint">{commit.short_id}</span>
        <div className="ml-auto flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <IconButton
                variant="faint"
                onClick={() => setFileViewMode(viewMode === "flat" ? "tree" : "flat")}
              >
                {viewMode === "flat" ? (
                  <FolderTree className="h-3.5 w-3.5" />
                ) : (
                  <List className="h-3.5 w-3.5" />
                )}
              </IconButton>
            </TooltipTrigger>
            <TooltipContent>
              {viewMode === "flat" ? "Tree view" : "Flat view"}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Resizable commit-details / changed-files split — each card scrolls
          independently, mirroring the unstaged/staged split in working changes. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden pt-1 pr-2 pb-2 pl-2">
        {/* Commit section */}
        <CollapsibleSection
          label="Commit details"
          isOpen={commitOpen}
          onToggle={() => setCommitOpen(!commitOpen)}
          // `min-h-0` so a short panel squeezes the description (which clamps down
          // to one line) before it starts clipping the author rows below it.
          bodyClassName="flex min-h-0 flex-1 flex-col"
          // Never scrolls, and never has a height of its own: the description is
          // the only elastic part, so the card is exactly as tall as its content.
          style={{ flexGrow: 0, flexShrink: 1, flexBasis: "auto" }}
        >
          <div className="flex flex-1 flex-col px-4 pb-4">
            {/* Message — hero. Tint every conventional-commit prefix + its icon */}
            <CommitMessageText
              message={commit.message}
              className="text-sm text-foreground"
            />

            {/* Body (description) */}
            {commit.body && (
            <ClampedBody
              text={commit.body}
              boxRef={bodyRef}
              height={bodyHeight}
              dragging={dragging}
            />
          )}

            {/* Divider — separates "what changed" from provenance */}
            <div className="-ml-4 -mr-2 my-3 h-px bg-border" />

            {/* Identity — author + co-authors + date, mirroring the graph hover tooltip */}
            <div className="flex flex-col gap-2.5">
              {/* Primary author */}
              <div className="flex items-center gap-2">
                <AuthorAvatar name={commit.author_name} email={commit.author_email} size={26} />
                <span className="shrink-0 text-xs text-foreground">{commit.author_name}</span>
                {commit.author_email && (
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {commit.author_email}
                  </span>
                )}
              </div>

              {/* Co-authors */}
              {commit.co_authors.map((ca, i) => (
                <div key={i} className="flex items-center gap-2">
                  <AuthorAvatar name={ca.name} email={ca.email} size={26} />
                  <span className="shrink-0 text-xs text-foreground">{ca.name}</span>
                  {ca.email && (
                    <span className="min-w-0 truncate text-xs text-muted-foreground">{ca.email}</span>
                  )}
                  <span className="ml-auto shrink-0 text-label text-dim">co-authored</span>
                </div>
              ))}

              {/* Date */}
              <div className="flex items-center mt-1 gap-2 text-xs text-muted-foreground">
                <Calendar className="h-3.5 w-3.5 shrink-0" />
                <span className="text-white">{dateStr}</span>
              </div>
            </div>

            {/* Refs — tag chips (the SHA lives in the panel topbar) */}
            {commitTags.length > 0 && (
              <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                {commitTags.map((t) => (
                  <span
                    key={t.name}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    <Tag className="h-2.5 w-2.5 shrink-0 text-faint" />
                    {t.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </CollapsibleSection>

        {/* Only the description resizes, so no description means nothing to drag. */}
        {bothExpand && commit.body ? (
          <RowDragHandle onMouseDown={onDragStart} label="Resize commit description" />
        ) : (
          <div className="h-2 shrink-0" aria-hidden="true" />
        )}

        {/* Changed files section */}
        {hasFiles && (
          <CollapsibleSection
            label={changedFilesLabel(commitFiles, showSkeleton)}
            isOpen={filesOpen}
            onToggle={() => setFilesOpen(!filesOpen)}
            style={
              filesExpand
                ? { flexGrow: 1, flexShrink: 1, flexBasis: 0, minHeight: FILES_MIN_HEIGHT }
                : { flexShrink: 0 }
            }
          >
            {showSkeleton ? (
              <FileListSkeleton />
            ) : viewMode === "tree" ? (
              <CommitFileTreeView
                files={commitFiles}
                selectedFilePath={selectedFilePath}
                fileQuery={fileQuery}
                onFileClick={onFileClick}
                storageKey={`commit:${commit.id}`}
              />
            ) : (
              <div className="px-2 pb-3">
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
  const showSkeleton = useDelayedFlag(stashFilesLoading);
  const viewMode = useRepoStore((s) => s.fileViewMode);
  const setFileViewMode = useRepoStore((s) => s.setFileViewMode);
  const fileQuery = useRepoStore((s) => s.filterQuery).trim().toLowerCase();

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto [scrollbar-gutter:stable] bg-background py-2 pr-2 pl-2">
      {/* Stash info */}
      <CollapsibleSection
        label="Stash"
        isOpen={infoOpen}
        onToggle={() => setInfoOpen(!infoOpen)}
        className="shrink-0"
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
      {(showSkeleton || stashFiles.length > 0) && (
        <CollapsibleSection
          label={changedFilesLabel(stashFiles, showSkeleton)}
          isOpen={filesOpen}
          onToggle={() => setFilesOpen(!filesOpen)}
          className="shrink-0"
          action={
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  size="sm"
                  variant="faint"
                  onClick={() => setFileViewMode(viewMode === "flat" ? "tree" : "flat")}
                >
                  {viewMode === "flat" ? (
                    <FolderTree className="h-3 w-3" />
                  ) : (
                    <List className="h-3 w-3" />
                  )}
                </IconButton>
              </TooltipTrigger>
              <TooltipContent>
                {viewMode === "flat" ? "Tree view" : "Flat view"}
              </TooltipContent>
            </Tooltip>
          }
        >
          {showSkeleton ? (
            <FileListSkeleton />
          ) : viewMode === "tree" ? (
            <CommitFileTreeView
              files={stashFiles}
              selectedFilePath={selectedFilePath}
              fileQuery={fileQuery}
              onFileClick={onFileClick}
              storageKey={`stash:${stash.index}`}
            />
          ) : (
            <div className="px-2 pb-3">
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
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      <span className="shrink-0 whitespace-nowrap">Changed Files <span className="text-faint">{files.length}</span></span>
      <DiffStat files={files} className="overflow-hidden min-w-0 shrink-[999]" />
    </span>
  );
}

function CollapsibleSection({
  label,
  isOpen,
  onToggle,
  action,
  className,
  style,
  cardRef,
  bodyClassName,
  children,
}: {
  label: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
  /** Extra classes on the outer card (e.g. shrink-0 inside a scrolling column). */
  className?: string;
  /** Inline styles on the outer card — used to drive the resizable flex split. */
  style?: React.CSSProperties;
  /** Ref on the outer card, for measuring during a resize drag. */
  cardRef?: React.Ref<HTMLDivElement>;
  /** Classes on the body wrapper. Defaults to a scrolling body. */
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      ref={cardRef}
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card animate-fade-in",
        className,
      )}
      style={style}
    >
      <SectionHeader
        label={label}
        isOpen={isOpen}
        onToggle={onToggle}
        className="shrink-0 px-4 py-2"
        action={action}
      />
      {isOpen && (
        <div className={bodyClassName ?? "min-h-0 overflow-y-auto"}>{children}</div>
      )}
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
        "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 my-1 text-left transition-colors",
        isSelected ? "bg-card-hover text-accent-foreground" : "hover:bg-card-hover",
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
  storageKey,
}: {
  files: FileStatus[];
  selectedFilePath: string | null;
  fileQuery: string;
  onFileClick: (path: string) => void;
  storageKey: string;
}) {
  const tree = useMemo(() => buildFileTree(files), [files]);

  return (
    <TreeCollapseProvider storageKey={storageKey}>
      <div className="px-2 pb-3">
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
    </TreeCollapseProvider>
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
  const { collapsed, toggle } = useTreeCollapse();
  const expanded = !collapsed.has(node.path);
  const indent = depth * 16;
  // Dim a node when filtering and neither it nor any descendant matches.
  const dimmed =
    fileQuery !== "" && !treeNodeMatchesFilter(node, fileQuery);

  if (node.type === "directory") {
    return (
      <div>
        <button
          onClick={(e) => toggle(node.path, collectDirPaths(node), e.altKey)}
          className={cn(
            "relative flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 my-1 text-xs text-muted-foreground hover:bg-card-hover hover:text-foreground transition-colors",
            dimmed && FILTER_DIM_CLASS,
          )}
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
          <span className="truncate"><HighlightedText text={node.name} /></span>
        </button>
        {expanded && (
          <div className="relative">
            <div
              className="absolute -top-1.5 -bottom-1.5 w-px bg-border"
              style={{ left: `${22 + indent}px` }}
            />
            {node.children.map((child) => (
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
        )}
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
        "relative flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 my-1 text-left transition-colors",
        isSelected ? "bg-card-hover text-accent-foreground" : "hover:bg-card-hover",
        dimmed && FILTER_DIM_CLASS,
      )}
      style={{ paddingLeft: `${16 + indent + 16}px` }}
    >
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
