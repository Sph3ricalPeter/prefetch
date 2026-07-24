import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  Trash2,
  Folder,
  FolderOpen,
  Loader2,
  Pencil,
  ArrowRightLeft,
  HelpCircle,
  Archive,
  ExternalLink,
  Copy,
  Undo2,
  Save,
} from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FileStatus } from "@/types/git";
import { useRepoStore } from "@/stores/repo-store";
import { FileIcon } from "@/components/ui/file-icon";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/context-menu";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  buildFileTree,
  collectFilePaths,
  collectDirPaths,
  flattenTreeFiles,
  fileMatchesFilter,
  treeNodeMatchesFilter,
} from "@/lib/file-tree";
import type { FileTreeNode } from "@/lib/file-tree";
import { TreeCollapseProvider, useTreeCollapse } from "@/hooks/use-tree-collapse";
import { FILTER_DIM_CLASS } from "@/lib/constants";
import { HighlightedText } from "@/components/ui/highlighted-text";
import { SectionHeader } from "@/components/ui/section-header";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/ui/modal";

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
  const selectedFileStaged = useRepoStore((s) => s.selectedFileStaged);
  const lfsInfo = useRepoStore((s) => s.lfsInfo);
  const stage = useRepoStore((s) => s.stage);
  const unstage = useRepoStore((s) => s.unstage);
  const discard = useRepoStore((s) => s.discard);
  const resolveOurs = useRepoStore((s) => s.resolveOurs);
  const resolveTheirs = useRepoStore((s) => s.resolveTheirs);
  const resolveConflictManual = useRepoStore((s) => s.resolveConflictManual);
  const conflictOutputText = useRepoStore((s) => s.conflictOutputText);
  const conflictAutoResolvedFiles = useRepoStore((s) => s.conflictAutoResolvedFiles);
  const selectFile = useRepoStore((s) => s.selectFile);
  const isLoading = useRepoStore((s) => s.isLoading);
  const stashFiles = useRepoStore((s) => s.stashFiles);
  const showInFolder = useRepoStore((s) => s.showInFolder);
  const openInEditor = useRepoStore((s) => s.openInEditor);
  const deleteFile = useRepoStore((s) => s.deleteFile);

  const fileViewMode = useRepoStore((s) => s.fileViewMode);
  // Filter dims non-matching files (by path) rather than hiding them.
  const filterQuery = useRepoStore((s) => s.filterQuery);
  const fileQuery = useMemo(() => filterQuery.trim().toLowerCase(), [filterQuery]);

  const isLfsFile = (filePath: string) =>
    lfsInfo?.initialized &&
    lfsInfo.tracked_patterns.some((p) => matchesLfsPattern(filePath, p.pattern));
  // Track in-flight stage/unstage ops for spinner + disable feedback
  const [busyOp, setBusyOp] = useState<"stage" | "unstage" | null>(null);

  const wrappedStage = useCallback(async (paths: string[]) => {
    setBusyOp("stage");
    try { await stage(paths); } finally { setBusyOp(null); }
  }, [stage]);

  const wrappedUnstage = useCallback(async (paths: string[]) => {
    setBusyOp("unstage");
    try { await unstage(paths); } finally { setBusyOp(null); }
  }, [unstage]);

  const [confirmDiscard, setConfirmDiscard] = useState<string[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [conflictsOpen, setConflictsOpen] = useState(true);
  const [stagedOpen, setStagedOpen] = useState(true);
  const [unstagedOpen, setUnstagedOpen] = useState(true);
  const [fileContextMenu, setFileContextMenu] = useState<{
    file: FileStatus;
    isStaged: boolean;
    x: number;
    y: number;
  } | null>(null);
  const [folderContextMenu, setFolderContextMenu] = useState<{
    paths: string[];
    folderPath: string;
    isStaged: boolean;
    x: number;
    y: number;
  } | null>(null);
  // Multi-select context menu (shown when right-clicking a multi-selected file)
  const [batchContextMenu, setBatchContextMenu] = useState<{
    paths: string[];
    isStaged: boolean;
    x: number;
    y: number;
  } | null>(null);
  const [conflictContextMenu, setConflictContextMenu] = useState<{
    file: FileStatus;
    x: number;
    y: number;
  } | null>(null);
  const viewMode = fileViewMode;

  // ── Unstaged / staged split ratio (drag handle between the two cards) ──────
  // `ratio` is the unstaged card's share (0..1) of the resizable area; the
  // staged card gets the rest. Drag the handle to rebalance. Kept in component
  // state (resets to an even split when the view remounts).
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [splitDragging, setSplitDragging] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);
  const splitDragRef = useRef<{ startY: number; startRatio: number; avail: number } | null>(null);

  const onSplitDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const el = splitRef.current;
      if (!el) return;
      splitDragRef.current = { startY: e.clientY, startRatio: splitRatio, avail: el.clientHeight };
      setSplitDragging(true);
    },
    [splitRatio],
  );

  useEffect(() => {
    if (!splitDragging) return;
    const onMove = (e: MouseEvent) => {
      const d = splitDragRef.current;
      if (!d || d.avail <= 0) return;
      const next = Math.max(0.15, Math.min(0.85, d.startRatio + (e.clientY - d.startY) / d.avail));
      setSplitRatio(next);
    };
    const onUp = () => setSplitDragging(false);
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [splitDragging]);

  // ── Multi-select state ────────────────────────────────────────────────────
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  const lastClickedRef = useRef<{ path: string; section: "staged" | "unstaged" } | null>(null);

  /** Handle click with Ctrl / Shift modifiers for multi-select.
   *  Returns true if the click was handled as a multi-select action. */
  const handleFileClick = useCallback(
    (
      e: React.MouseEvent,
      file: FileStatus,
      isStaged: boolean,
      sectionFiles: FileStatus[],
    ) => {
      const section: "staged" | "unstaged" = isStaged ? "staged" : "unstaged";

      if (e.ctrlKey || e.metaKey) {
        // Ctrl+click: toggle this file in the selection
        setMultiSelected((prev) => {
          const next = new Set(prev);
          if (next.has(file.path)) {
            next.delete(file.path);
          } else {
            next.add(file.path);
          }
          return next;
        });
        lastClickedRef.current = { path: file.path, section };
        return;
      }

      if (e.shiftKey && lastClickedRef.current) {
        if (lastClickedRef.current.section === section) {
          // Shift+click: range select within the same section
          const lastIdx = sectionFiles.findIndex((f) => f.path === lastClickedRef.current!.path);
          const curIdx = sectionFiles.findIndex((f) => f.path === file.path);
          if (lastIdx >= 0 && curIdx >= 0) {
            const from = Math.min(lastIdx, curIdx);
            const to = Math.max(lastIdx, curIdx);
            const rangePaths = sectionFiles.slice(from, to + 1).map((f) => f.path);
            setMultiSelected((prev) => {
              const next = new Set(prev);
              for (const p of rangePaths) next.add(p);
              return next;
            });
            return;
          }
        }
        // Cross-section shift-click, or anchor lost after status refresh —
        // start a fresh selection at the clicked file.
        setMultiSelected(new Set([file.path]));
        lastClickedRef.current = { path: file.path, section };
        return;
      }

      // Plain click: clear multi-select, open diff
      setMultiSelected(new Set());
      lastClickedRef.current = { path: file.path, section };
      selectFile(file.path, isStaged);
    },
    [selectFile],
  );

  /** Handle right-click: if file is in multi-select, show batch menu;
   *  otherwise fall through to single-file context menu. */
  const handleFileContextMenu = useCallback(
    (e: React.MouseEvent, file: FileStatus, isStaged: boolean) => {
      e.preventDefault();
      if (multiSelected.size > 1 && multiSelected.has(file.path)) {
        setBatchContextMenu({
          paths: [...multiSelected],
          isStaged,
          x: e.clientX,
          y: e.clientY,
        });
      } else {
        // Clear multi-select and open single-file context menu. Select the
        // right-clicked row too, so the visible selection matches what the
        // menu acts on (otherwise the menu targets this file while the old
        // selection stays highlighted — the action appears to do nothing).
        setMultiSelected(new Set());
        selectFile(file.path, isStaged);
        setFileContextMenu({ file, isStaged, x: e.clientX, y: e.clientY });
      }
    },
    [multiSelected, selectFile],
  );

  const conflicted = fileStatuses.filter((f) => f.is_conflicted);
  const staged = fileStatuses.filter((f) => f.is_staged && !f.is_conflicted);
  const unstaged = fileStatuses.filter((f) => !f.is_staged && !f.is_conflicted);

  const unstagedTreeOrder = useMemo(
    () => flattenTreeFiles(buildFileTree(unstaged)),
    [unstaged],
  );
  const stagedTreeOrder = useMemo(
    () => flattenTreeFiles(buildFileTree(staged)),
    [staged],
  );

  // A section only claims resizable space when it's open AND has files; an empty
  // or collapsed section shrinks to just its header. The drag handle (and ratio
  // split) only apply when both sections are competing for space.
  const unstagedExpands = unstagedOpen && unstaged.length > 0;
  const stagedExpands = stagedOpen && staged.length > 0;
  const bothExpand = unstagedExpands && stagedExpands;
  const growStyle = (expands: boolean, grow: number): React.CSSProperties =>
    expands
      ? { flexGrow: grow, flexShrink: 1, flexBasis: 0, minHeight: 0 }
      : { flexShrink: 0 };

  if (fileStatuses.length === 0) {
    return (
      <div className="flex items-center justify-center p-4 text-xs text-muted-foreground">
        No changes
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
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
          className="shrink-0"
          bodyClassName="max-h-48"
        >
          {viewMode === "tree" ? (
            <ConflictTreeView
              files={conflicted}
              selectedFilePath={selectedFilePath}
              fileQuery={fileQuery}
              isAutoResolved={(path) => conflictAutoResolvedFiles.has(path)}
              onSelect={(path) => selectFile(path, false)}
              onResolveOurs={resolveOurs}
              onResolveTheirs={resolveTheirs}
              onSave={(path) => {
                const text = conflictAutoResolvedFiles.get(path);
                if (text != null) resolveConflictManual(path, text);
              }}
              onFileContextMenu={(e, file) => {
                e.preventDefault();
                setConflictContextMenu({ file, x: e.clientX, y: e.clientY });
              }}
              disabled={isLoading}
            />
          ) : (
            conflicted.map((file) => (
              <ConflictRow
                key={`conflict-${file.path}`}
                file={file}
                isSelected={selectedFilePath === file.path}
                dimmed={fileQuery !== "" && !fileMatchesFilter(file.path, fileQuery)}
                isAutoResolved={conflictAutoResolvedFiles.has(file.path)}
                onSelect={() => selectFile(file.path, false)}
                onResolveOurs={() => resolveOurs(file.path)}
                onResolveTheirs={() => resolveTheirs(file.path)}
                onSave={() => {
                  const text = conflictAutoResolvedFiles.get(file.path);
                  if (text != null) resolveConflictManual(file.path, text);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setConflictContextMenu({ file, x: e.clientX, y: e.clientY });
                }}
                disabled={isLoading}
              />
            ))
          )}
        </FileSection>
      )}

      {/* Resizable unstaged / staged split — each card scrolls independently */}
      <div ref={splitRef} className="flex min-h-0 flex-1 flex-col">
      {/* Unstaged section */}
      <FileSection
        label="Unstaged"
        count={unstaged.length}
        isOpen={unstagedOpen}
        onToggle={() => setUnstagedOpen(!unstagedOpen)}
        actionLabel="Stage All"
        onAction={
          unstaged.length > 0
            ? () => wrappedStage(unstaged.map((f) => f.path))
            : undefined
        }
        actionDisabled={isLoading || busyOp !== null}
        isBusy={busyOp === "stage"}
        style={growStyle(unstagedExpands, bothExpand ? splitRatio : 1)}
      >
        {viewMode === "tree" ? (
          <FileTreeView
            files={unstaged}
            selectedFilePath={selectedFilePath && !selectedFileStaged ? selectedFilePath : null}
            multiSelected={multiSelected}
            isLfsFile={isLfsFile}
            fileQuery={fileQuery}
            onSelect={(path, e) => handleFileClick(e, unstaged.find((f) => f.path === path)!, false, unstagedTreeOrder)}
            onToggle={(path) => wrappedStage([path])}
            toggleIcon={<Plus className="h-3 w-3" />}
            toggleTitle="Stage"
            onDiscard={(path) => setConfirmDiscard([path])}
            onToggleBatch={(paths) => wrappedStage(paths)}
            onDiscardBatch={(paths) => setConfirmDiscard(paths)}
            disabled={isLoading || busyOp !== null}
            onFileContextMenu={(file, _x, _y, e) => handleFileContextMenu(e!, file, false)}
            onFolderContextMenu={(paths, folderPath, x, y) => setFolderContextMenu({ paths, folderPath, isStaged: false, x, y })}
          />
        ) : (
          unstaged.map((file) => (
            <FileRow
              key={`unstaged-${file.path}`}
              file={file}
              isSelected={selectedFilePath === file.path && !selectedFileStaged}
              isMultiSelected={multiSelected.has(file.path)}
              isLfs={!!isLfsFile(file.path)}
              dimmed={fileQuery !== "" && !fileMatchesFilter(file.path, fileQuery)}
              onSelect={(e) => handleFileClick(e, file, false, unstaged)}
              onToggle={() => wrappedStage([file.path])}
              toggleIcon={<Plus className="h-3 w-3" />}
              toggleTitle="Stage"
              onDiscard={() => setConfirmDiscard([file.path])}
              disabled={isLoading || busyOp !== null}
              onContextMenu={(e) => handleFileContextMenu(e, file, false)}
            />
          ))
        )}
      </FileSection>

      {bothExpand ? (
        <div
          onMouseDown={onSplitDragStart}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize unstaged and staged"
          className="group relative h-2 shrink-0 cursor-row-resize"
        >
          <div className="absolute left-1/2 top-1/2 h-1 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/30 transition-colors group-hover:bg-muted-foreground/60" />
        </div>
      ) : (
        <div className="h-2 shrink-0" aria-hidden="true" />
      )}

      {/* Staged section */}
      <FileSection
        label="Staged"
        count={staged.length}
        isOpen={stagedOpen}
        onToggle={() => setStagedOpen(!stagedOpen)}
        actionLabel="Unstage All"
        onAction={
          staged.length > 0
            ? () => wrappedUnstage(staged.map((f) => f.path))
            : undefined
        }
        actionDisabled={isLoading || busyOp !== null}
        isBusy={busyOp === "unstage"}
        style={growStyle(stagedExpands, bothExpand ? 1 - splitRatio : 1)}
      >
        {viewMode === "tree" ? (
          <FileTreeView
            files={staged}
            selectedFilePath={selectedFilePath && selectedFileStaged ? selectedFilePath : null}
            multiSelected={multiSelected}
            isLfsFile={isLfsFile}
            fileQuery={fileQuery}
            onSelect={(path, e) => handleFileClick(e, staged.find((f) => f.path === path)!, true, stagedTreeOrder)}
            onToggle={(path) => wrappedUnstage([path])}
            toggleIcon={<Minus className="h-3 w-3" />}
            toggleTitle="Unstage"
            onDiscard={(path) => setConfirmDiscard([path])}
            onToggleBatch={(paths) => wrappedUnstage(paths)}
            onDiscardBatch={(paths) => setConfirmDiscard(paths)}
            disabled={isLoading || busyOp !== null}
            onFileContextMenu={(file, _x, _y, e) => handleFileContextMenu(e!, file, true)}
            onFolderContextMenu={(paths, folderPath, x, y) => setFolderContextMenu({ paths, folderPath, isStaged: true, x, y })}
          />
        ) : (
          staged.map((file) => (
            <FileRow
              key={`staged-${file.path}`}
              file={file}
              isSelected={selectedFilePath === file.path && selectedFileStaged}
              isMultiSelected={multiSelected.has(file.path)}
              isLfs={!!isLfsFile(file.path)}
              dimmed={fileQuery !== "" && !fileMatchesFilter(file.path, fileQuery)}
              onSelect={(e) => handleFileClick(e, file, true, staged)}
              onToggle={() => wrappedUnstage([file.path])}
              toggleIcon={<Minus className="h-3 w-3" />}
              toggleTitle="Unstage"
              onDiscard={() => setConfirmDiscard([file.path])}
              disabled={isLoading || busyOp !== null}
              onContextMenu={(e) => handleFileContextMenu(e, file, true)}
            />
          ))
        )}
      </FileSection>
      </div>

      {/* Discard confirmation dialog */}
      {confirmDiscard && (
        <DiscardDialog
          paths={confirmDiscard}
          onConfirm={() => {
            discard(confirmDiscard);
            setConfirmDiscard(null);
            // Discarded files leave the list — drop them from the selection so
            // no stale entries remain highlighted.
            setMultiSelected(new Set());
          }}
          onCancel={() => setConfirmDiscard(null)}
        />
      )}

      {/* Delete confirmation dialog */}
      {confirmDelete && (
        <DeleteDialog
          path={confirmDelete}
          onConfirm={() => {
            deleteFile(confirmDelete);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {/* File context menu */}
      {fileContextMenu && (
        <ContextMenu
          x={fileContextMenu.x}
          y={fileContextMenu.y}
          items={buildFileContextMenuItems(
            fileContextMenu.file,
            fileContextMenu.isStaged,
            wrappedStage,
            wrappedUnstage,
            (path) => setConfirmDiscard([path]),
            stashFiles,
            openInEditor,
            showInFolder,
            (path) => setConfirmDelete(path),
          )}
          onClose={() => setFileContextMenu(null)}
        />
      )}

      {/* Folder context menu */}
      {folderContextMenu && (
        <ContextMenu
          x={folderContextMenu.x}
          y={folderContextMenu.y}
          items={buildFolderContextMenuItems(
            folderContextMenu.paths,
            folderContextMenu.folderPath,
            folderContextMenu.isStaged,
            wrappedStage,
            wrappedUnstage,
            (paths) => setConfirmDiscard(paths),
            stashFiles,
            showInFolder,
          )}
          onClose={() => setFolderContextMenu(null)}
        />
      )}

      {/* Batch (multi-select) context menu */}
      {batchContextMenu && (
        <ContextMenu
          x={batchContextMenu.x}
          y={batchContextMenu.y}
          items={buildBatchContextMenuItems(
            batchContextMenu.paths,
            batchContextMenu.isStaged,
            wrappedStage,
            wrappedUnstage,
            (paths) => setConfirmDiscard(paths),
            stashFiles,
          )}
          onClose={() => setBatchContextMenu(null)}
        />
      )}

      {/* Conflict context menu */}
      {conflictContextMenu && (
        <ContextMenu
          x={conflictContextMenu.x}
          y={conflictContextMenu.y}
          items={buildConflictContextMenuItems(
            conflictContextMenu.file,
            resolveOurs,
            resolveTheirs,
            selectedFilePath === conflictContextMenu.file.path ? resolveConflictManual : null,
            selectedFilePath === conflictContextMenu.file.path ? conflictOutputText : null,
            openInEditor,
            showInFolder,
          )}
          onClose={() => setConflictContextMenu(null)}
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
  isBusy,
  labelClassName,
  className,
  style,
  bodyClassName,
  children,
}: {
  label: string;
  count: number;
  isOpen: boolean;
  onToggle: () => void;
  actionLabel: string;
  onAction?: () => void;
  actionDisabled: boolean;
  isBusy?: boolean;
  labelClassName?: string;
  /** Extra classes on the outer card (e.g. shrink-0). */
  className?: string;
  /** Inline styles on the outer card — used to drive the resizable flex split. */
  style?: React.CSSProperties;
  /** Extra classes on the scrollable body (e.g. a max-height cap). */
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card",
        className,
      )}
      style={style}
    >
      <SectionHeader
        label={label}
        count={count}
        isOpen={isOpen}
        onToggle={onToggle}
        className="shrink-0 px-3"
        labelClassName={labelClassName}
        action={
          onAction && count > 0 ? (
            <button
              onClick={onAction}
              disabled={actionDisabled}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
            >
              {isBusy && <Loader2 className="h-3 w-3 animate-spin" />}
              {actionLabel}
            </button>
          ) : undefined
        }
      />
      {isOpen && (
        <div className={cn("min-h-0 overflow-y-auto px-2 pb-2", bodyClassName)}>
          {children}
        </div>
      )}
    </div>
  );
}

// --- Tree view ---

function FileTreeView({
  files,
  selectedFilePath,
  multiSelected,
  isLfsFile,
  fileQuery,
  onSelect,
  onToggle,
  toggleIcon,
  toggleTitle,
  onDiscard,
  onToggleBatch,
  onDiscardBatch,
  disabled,
  onFileContextMenu,
  onFolderContextMenu,
}: {
  files: FileStatus[];
  selectedFilePath: string | null;
  multiSelected?: Set<string>;
  isLfsFile: (path: string) => boolean | undefined;
  fileQuery: string;
  onSelect: (path: string, e: React.MouseEvent) => void;
  onToggle: (path: string) => void;
  toggleIcon: React.ReactNode;
  toggleTitle: string;
  onDiscard: (path: string) => void;
  onToggleBatch: (paths: string[]) => void;
  onDiscardBatch: (paths: string[]) => void;
  disabled: boolean;
  onFileContextMenu?: (file: FileStatus, x: number, y: number, e: React.MouseEvent) => void;
  onFolderContextMenu?: (paths: string[], folderPath: string, x: number, y: number) => void;
}) {
  const tree = useMemo(() => buildFileTree(files), [files]);

  return (
    <TreeCollapseProvider>
      {tree.map((node) => (
        <TreeNodeView
          key={node.path}
          node={node}
          depth={0}
          selectedFilePath={selectedFilePath}
          multiSelected={multiSelected}
          isLfsFile={isLfsFile}
          fileQuery={fileQuery}
          onSelect={onSelect}
          onToggle={onToggle}
          toggleIcon={toggleIcon}
          toggleTitle={toggleTitle}
          onDiscard={onDiscard}
          onToggleBatch={onToggleBatch}
          onDiscardBatch={onDiscardBatch}
          disabled={disabled}
          onFileContextMenu={onFileContextMenu}
          onFolderContextMenu={onFolderContextMenu}
        />
      ))}
    </TreeCollapseProvider>
  );
}

// --- Conflict tree view ---

function ConflictTreeView({
  files,
  selectedFilePath,
  fileQuery,
  isAutoResolved,
  onSelect,
  onResolveOurs,
  onResolveTheirs,
  onSave,
  onFileContextMenu,
  disabled,
}: {
  files: FileStatus[];
  selectedFilePath: string | null;
  fileQuery: string;
  isAutoResolved: (path: string) => boolean;
  onSelect: (path: string) => void;
  onResolveOurs: (path: string) => void;
  onResolveTheirs: (path: string) => void;
  onSave?: (path: string) => void;
  onFileContextMenu: (e: React.MouseEvent, file: FileStatus) => void;
  disabled: boolean;
}) {
  const tree = useMemo(() => buildFileTree(files), [files]);

  return (
    <TreeCollapseProvider>
      {tree.map((node) => (
        <ConflictTreeNodeView
          key={node.path}
          node={node}
          depth={0}
          selectedFilePath={selectedFilePath}
          fileQuery={fileQuery}
          isAutoResolved={isAutoResolved}
          onSelect={onSelect}
          onResolveOurs={onResolveOurs}
          onResolveTheirs={onResolveTheirs}
          onSave={onSave}
          onFileContextMenu={onFileContextMenu}
          disabled={disabled}
        />
      ))}
    </TreeCollapseProvider>
  );
}

function ConflictTreeNodeView({
  node,
  depth,
  selectedFilePath,
  fileQuery,
  isAutoResolved,
  onSelect,
  onResolveOurs,
  onResolveTheirs,
  onSave,
  onFileContextMenu,
  disabled,
}: {
  node: FileTreeNode;
  depth: number;
  selectedFilePath: string | null;
  fileQuery: string;
  isAutoResolved: (path: string) => boolean;
  onSelect: (path: string) => void;
  onResolveOurs: (path: string) => void;
  onResolveTheirs: (path: string) => void;
  onSave?: (path: string) => void;
  onFileContextMenu: (e: React.MouseEvent, file: FileStatus) => void;
  disabled: boolean;
}) {
  const { collapsed, toggle } = useTreeCollapse();
  const expanded = !collapsed.has(node.path);
  const indent = depth * 16;
  const dimmed = fileQuery !== "" && !treeNodeMatchesFilter(node, fileQuery);

  if (node.type === "directory") {
    const fileCount = collectFilePaths(node).length;
    return (
      <div>
        <div
          className={cn(
            "group relative flex w-full items-center gap-1.5 rounded-md px-2 py-1 my-1 text-xs text-muted-foreground hover:bg-card-hover hover:text-foreground transition-colors cursor-default",
            dimmed && FILTER_DIM_CLASS,
          )}
          style={{ paddingLeft: `${12 + indent}px` }}
          onClick={(e) => toggle(node.path, collectDirPaths(node), e.altKey)}
        >
          {Array.from({ length: depth }, (_, i) => (
            <div
              key={i}
              className="absolute -top-1.5 -bottom-1.5 w-px bg-border"
              style={{ left: `${18 + i * 16}px` }}
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
          <span className="text-faint">{fileCount}</span>
        </div>
        {expanded && node.children.map((child) => (
          <ConflictTreeNodeView
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedFilePath={selectedFilePath}
            fileQuery={fileQuery}
            isAutoResolved={isAutoResolved}
            onSelect={onSelect}
            onResolveOurs={onResolveOurs}
            onResolveTheirs={onResolveTheirs}
            onSave={onSave}
            onFileContextMenu={onFileContextMenu}
            disabled={disabled}
          />
        ))}
      </div>
    );
  }

  const file = node.file!;
  const isSelected = selectedFilePath === file.path;
  const fileAutoResolved = isAutoResolved(file.path);

  return (
    <div
      className={cn(
        "group relative flex items-center gap-1.5 rounded-md px-2 py-1.5 my-1 cursor-default transition-colors",
        isSelected ? "bg-card-hover text-accent-foreground" : "hover:bg-card-hover",
        dimmed && FILTER_DIM_CLASS,
      )}
      style={{ paddingLeft: `${12 + indent + 16}px` }}
      onClick={() => onSelect(file.path)}
      onContextMenu={(e) => onFileContextMenu(e, file)}
    >
      {Array.from({ length: depth }, (_, i) => (
        <div
          key={i}
          className="absolute -top-1.5 -bottom-1.5 w-px bg-border"
          style={{ left: `${18 + i * 16}px` }}
        />
      ))}
      <span className={`w-4 shrink-0 text-center text-xs font-medium ${fileAutoResolved ? "text-purple-400" : "text-red-400"}`}>
        {fileAutoResolved
          ? <Check className="h-[13px] w-[13px] inline-block" />
          : <AlertTriangle className="h-[13px] w-[13px] inline-block" />}
      </span>
      <span className="truncate text-xs text-foreground"><HighlightedText text={node.name} /></span>
      <FileIcon filename={node.name} className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="ml-auto flex items-center gap-1 tabular-nums text-right overflow-hidden min-w-0 shrink-[999]">
        {file.additions != null && (
          <span className="text-xs text-green-400">+{file.additions}</span>
        )}
        {file.deletions != null && file.deletions > 0 && (
          <span className="text-xs text-red-400">-{file.deletions}</span>
        )}
      </span>
      {fileAutoResolved && onSave ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={(e) => { e.stopPropagation(); onSave(file.path); }}
              disabled={disabled}
              className="shrink-0 rounded-md border border-[rgba(var(--conflict-theirs),0.3)] px-1.5 py-0.5 opacity-0 group-hover:opacity-100 text-xs font-medium text-[var(--conflict-theirs-text)] hover:bg-[rgba(var(--conflict-theirs),0.1)] hover:border-[rgba(var(--conflict-theirs),0.4)] transition-all disabled:opacity-40"
            >
              Save
            </button>
          </TooltipTrigger>
          <TooltipContent>Save auto-resolved output</TooltipContent>
        </Tooltip>
      ) : (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={(e) => { e.stopPropagation(); onResolveOurs(file.path); }}
                disabled={disabled}
                className="shrink-0 rounded-md px-1.5 py-0.5 opacity-0 group-hover:opacity-100 text-xs font-medium text-blue-400 hover:bg-blue-500/20 transition-all disabled:opacity-40"
              >
                Ours
              </button>
            </TooltipTrigger>
            <TooltipContent>Keep your version</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={(e) => { e.stopPropagation(); onResolveTheirs(file.path); }}
                disabled={disabled}
                className="shrink-0 rounded-md px-1.5 py-0.5 opacity-0 group-hover:opacity-100 text-xs font-medium text-purple-400 hover:bg-purple-500/20 transition-all disabled:opacity-40"
              >
                Theirs
              </button>
            </TooltipTrigger>
            <TooltipContent>Keep their version</TooltipContent>
          </Tooltip>
        </>
      )}
    </div>
  );
}

function TreeNodeView({
  node,
  depth,
  selectedFilePath,
  multiSelected,
  isLfsFile,
  fileQuery,
  onSelect,
  onToggle,
  toggleIcon,
  toggleTitle,
  onDiscard,
  onToggleBatch,
  onDiscardBatch,
  disabled,
  onFileContextMenu,
  onFolderContextMenu,
}: {
  node: FileTreeNode;
  depth: number;
  selectedFilePath: string | null;
  multiSelected?: Set<string>;
  isLfsFile: (path: string) => boolean | undefined;
  fileQuery: string;
  onSelect: (path: string, e: React.MouseEvent) => void;
  onToggle: (path: string) => void;
  toggleIcon: React.ReactNode;
  toggleTitle: string;
  onDiscard: (path: string) => void;
  onToggleBatch: (paths: string[]) => void;
  onDiscardBatch: (paths: string[]) => void;
  disabled: boolean;
  onFileContextMenu?: (file: FileStatus, x: number, y: number, e: React.MouseEvent) => void;
  onFolderContextMenu?: (paths: string[], folderPath: string, x: number, y: number) => void;
}) {
  const { collapsed, toggle } = useTreeCollapse();
  const expanded = !collapsed.has(node.path);
  const indent = depth * 16;
  // Dim when filtering and neither this node nor any descendant matches.
  const dimmed = fileQuery !== "" && !treeNodeMatchesFilter(node, fileQuery);

  if (node.type === "directory") {
    const fileCount = collectFilePaths(node).length;
    return (
      <div>
        <div
          className={cn(
            "group relative flex w-full items-center gap-1.5 rounded-md px-2 py-1 my-1 text-xs text-muted-foreground hover:bg-card-hover hover:text-foreground transition-colors cursor-default",
            dimmed && FILTER_DIM_CLASS,
          )}
          style={{ paddingLeft: `${12 + indent}px` }}
          onClick={(e) => toggle(node.path, collectDirPaths(node), e.altKey)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onFolderContextMenu?.(collectFilePaths(node), node.path, e.clientX, e.clientY);
          }}
        >
          {Array.from({ length: depth }, (_, i) => (
            <div
              key={i}
              className="absolute -top-1.5 -bottom-1.5 w-px bg-border"
              style={{ left: `${18 + i * 16}px` }}
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
          <span className="text-faint">{fileCount}</span>
          <span className="ml-auto shrink-0 flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  size="sm"
                  variant="subtle"
                  reveal="slide"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDiscardBatch(collectFilePaths(node));
                  }}
                  disabled={disabled}
                  className="shrink-0 hover:bg-destructive/20 hover:text-red-400"
                >
                  <Trash2 className="h-3 w-3" />
                </IconButton>
              </TooltipTrigger>
              <TooltipContent>Discard folder changes</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  size="sm"
                  reveal="slide"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleBatch(collectFilePaths(node));
                  }}
                  disabled={disabled}
                  className="shrink-0 hover:bg-card-hover"
                >
                  {toggleIcon}
                </IconButton>
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
            multiSelected={multiSelected}
            isLfsFile={isLfsFile}
            fileQuery={fileQuery}
            onSelect={onSelect}
            onToggle={onToggle}
            toggleIcon={toggleIcon}
            toggleTitle={toggleTitle}
            onDiscard={onDiscard}
            onToggleBatch={onToggleBatch}
            onDiscardBatch={onDiscardBatch}
            disabled={disabled}
            onFileContextMenu={onFileContextMenu}
            onFolderContextMenu={onFolderContextMenu}
          />
        ))}
      </div>
    );
  }

  // File node
  const file = node.file!;
  const statusColor = statusTypeColor(file.status_type);
  const statusLabel = statusTypeIcon(file.status_type);
  const isSelected = selectedFilePath === file.path;
  const isMulti = multiSelected?.has(file.path) ?? false;
  const isLfs = !!isLfsFile(file.path);

  return (
    <div
      className={cn(
        "group relative flex items-center gap-1.5 rounded-md px-2 py-1.5 my-1 cursor-default transition-colors",
        isMulti
          ? "bg-primary/15 text-accent-foreground"
          : isSelected
            ? "bg-card-hover text-accent-foreground"
            : "hover:bg-card-hover",
        dimmed && FILTER_DIM_CLASS,
      )}
      style={{ paddingLeft: `${12 + indent + 16}px` }}
      onClick={(e) => onSelect(file.path, e)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onFileContextMenu?.(file, e.clientX, e.clientY, e);
      }}
    >
      {Array.from({ length: depth }, (_, i) => (
        <div
          key={i}
          className="absolute -top-1.5 -bottom-1.5 w-px bg-border"
          style={{ left: `${18 + i * 16}px` }}
        />
      ))}
      <span className={`w-4 shrink-0 text-center text-xs font-medium ${statusColor}`}>
        {statusLabel}
      </span>
      <FileIcon filename={node.name} className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="truncate text-xs text-foreground"><HighlightedText text={node.name} /></span>
      {isLfs && (
        <span className="shrink-0 rounded-md px-1.5 py-0.5 text-label font-medium leading-none bg-blue-500/20 text-blue-400">
          LFS
        </span>
      )}
      <span className="ml-auto flex items-center gap-1 tabular-nums text-right overflow-hidden min-w-0 shrink-[999]">
        {file.additions != null && (
          <span className="text-xs text-green-400">+{file.additions}</span>
        )}
        {file.deletions != null && file.deletions > 0 && (
          <span className="text-xs text-red-400">-{file.deletions}</span>
        )}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <IconButton
            size="sm"
            variant="subtle"
            reveal="slide"
            onClick={(e) => {
              e.stopPropagation();
              onDiscard(file.path);
            }}
            disabled={disabled}
            className="shrink-0 hover:bg-destructive/20 hover:text-red-400"
          >
            <Trash2 className="h-3 w-3" />
          </IconButton>
        </TooltipTrigger>
        <TooltipContent>Discard changes</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <IconButton
            size="sm"
            reveal="slide"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(file.path);
            }}
            disabled={disabled}
            className="shrink-0 hover:bg-card-hover"
          >
            {toggleIcon}
          </IconButton>
        </TooltipTrigger>
        <TooltipContent>{toggleTitle}</TooltipContent>
      </Tooltip>
    </div>
  );
}

function FileRow({
  file,
  isSelected,
  isMultiSelected,
  isLfs,
  dimmed,
  onSelect,
  onToggle,
  toggleIcon,
  toggleTitle,
  onDiscard,
  disabled,
  onContextMenu,
}: {
  file: FileStatus;
  isSelected: boolean;
  isMultiSelected?: boolean;
  isLfs: boolean;
  dimmed?: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onToggle: () => void;
  toggleIcon: React.ReactNode;
  toggleTitle: string;
  onDiscard: () => void;
  disabled: boolean;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const statusColor = statusTypeColor(file.status_type);
  const statusLabel = statusTypeIcon(file.status_type);
  const fileName = file.path.split("/").pop() ?? file.path;
  const dirPath = file.path.includes("/")
    ? file.path.slice(0, file.path.lastIndexOf("/"))
    : "";

  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 rounded-md px-2 py-1.5 my-1 cursor-default transition-colors",
        isMultiSelected
          ? "bg-primary/15 text-accent-foreground"
          : isSelected
            ? "bg-card-hover text-accent-foreground"
            : "hover:bg-card-hover",
        dimmed && FILTER_DIM_CLASS,
      )}
      onClick={onSelect}
      onContextMenu={onContextMenu}
    >
      <span className={`w-4 shrink-0 text-center text-xs font-medium ${statusColor}`}>
        {statusLabel}
      </span>
      <FileIcon filename={fileName} className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <span className="truncate text-xs text-foreground"><HighlightedText text={fileName} /></span>
        {isLfs && (
          <span className="shrink-0 rounded-md px-1.5 py-0.5 text-label font-medium leading-none bg-blue-500/20 text-blue-400">
            LFS
          </span>
        )}
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
      <Tooltip>
        <TooltipTrigger asChild>
          <IconButton
            size="sm"
            variant="subtle"
            reveal="slide"
            onClick={(e) => {
              e.stopPropagation();
              onDiscard();
            }}
            disabled={disabled}
            className="shrink-0 hover:bg-destructive/20 hover:text-red-400"
          >
            <Trash2 className="h-3 w-3" />
          </IconButton>
        </TooltipTrigger>
        <TooltipContent>Discard changes</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <IconButton
            size="sm"
            reveal="slide"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            disabled={disabled}
            className="shrink-0 hover:bg-card-hover"
          >
            {toggleIcon}
          </IconButton>
        </TooltipTrigger>
        <TooltipContent>{toggleTitle}</TooltipContent>
      </Tooltip>
    </div>
  );
}

function ConflictRow({
  file,
  isSelected,
  isAutoResolved,
  dimmed,
  onSelect,
  onResolveOurs,
  onResolveTheirs,
  onSave,
  onContextMenu,
  disabled,
}: {
  file: FileStatus;
  isSelected: boolean;
  isAutoResolved: boolean;
  dimmed?: boolean;
  onSelect: () => void;
  onResolveOurs: () => void;
  onResolveTheirs: () => void;
  onSave?: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  disabled: boolean;
}) {
  const fileName = file.path.split("/").pop() ?? file.path;
  const dirPath = file.path.includes("/")
    ? file.path.slice(0, file.path.lastIndexOf("/"))
    : "";

  return (
    <div
      className={cn(
        "group flex items-center gap-1.5 rounded-md px-2 py-1.5 my-1 cursor-default transition-colors",
        isSelected ? "bg-card-hover text-accent-foreground" : "hover:bg-card-hover",
        dimmed && FILTER_DIM_CLASS,
      )}
      onClick={onSelect}
      onContextMenu={onContextMenu}
    >
      <span className={`w-4 shrink-0 text-center text-xs font-medium ${isAutoResolved ? "text-purple-400" : "text-red-400"}`}>
        {isAutoResolved
          ? <Check className="h-[13px] w-[13px] inline-block" />
          : <AlertTriangle className="h-[13px] w-[13px] inline-block" />}
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
      {isAutoResolved && onSave ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={(e) => { e.stopPropagation(); onSave(); }}
              disabled={disabled}
              className="shrink-0 rounded-md border border-[rgba(var(--conflict-theirs),0.3)] px-1.5 py-0.5 opacity-0 group-hover:opacity-100 text-xs font-medium text-[var(--conflict-theirs-text)] hover:bg-[rgba(var(--conflict-theirs),0.1)] hover:border-[rgba(var(--conflict-theirs),0.4)] transition-all disabled:opacity-40"
            >
              Save
            </button>
          </TooltipTrigger>
          <TooltipContent>Save auto-resolved output</TooltipContent>
        </Tooltip>
      ) : (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={(e) => { e.stopPropagation(); onResolveOurs(); }}
                disabled={disabled}
                className="shrink-0 rounded-md px-1.5 py-0.5 opacity-0 group-hover:opacity-100 text-xs font-medium text-blue-400 hover:bg-blue-500/20 transition-all disabled:opacity-40"
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
                className="shrink-0 rounded-md px-1.5 py-0.5 opacity-0 group-hover:opacity-100 text-xs font-medium text-purple-400 hover:bg-purple-500/20 transition-all disabled:opacity-40"
              >
                Theirs
              </button>
            </TooltipTrigger>
            <TooltipContent>Keep their version</TooltipContent>
          </Tooltip>
        </>
      )}
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

function statusTypeIcon(type: string): React.ReactNode {
  const cls = "h-[13px] w-[13px]";
  switch (type) {
    case "added":
      return <Plus className={cls} />;
    case "untracked":
      return <HelpCircle className={cls} />;
    case "modified":
      return <Pencil className={cls} />;
    case "deleted":
      return <Minus className={cls} />;
    case "renamed":
      return <ArrowRightLeft className={cls} />;
    default:
      return <HelpCircle className={cls} />;
  }
}

function buildFileContextMenuItems(
  file: FileStatus,
  isStaged: boolean,
  stage: (paths: string[]) => void,
  unstage: (paths: string[]) => void,
  discard: (path: string) => void,
  stashFiles: (paths: string[]) => void,
  openInEditor: (path: string) => void,
  showInFolder: (path: string) => void,
  deleteFile: (path: string) => void,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];

  // Stage / unstage
  if (isStaged) {
    items.push({ label: "Unstage file", onClick: () => unstage([file.path]), icon: Minus });
  } else {
    items.push({ label: "Stage file", onClick: () => stage([file.path]), icon: Plus });
  }

  // Stash (only for unstaged files)
  if (!isStaged) {
    items.push({ separator: true });
    items.push({ label: "Stash this file", onClick: () => stashFiles([file.path]), icon: Archive });
  }

  items.push({ separator: true });

  // External
  items.push({ label: "Open in default editor", onClick: () => openInEditor(file.path), icon: ExternalLink });
  items.push({ label: "Show in folder", onClick: () => showInFolder(file.path), icon: FolderOpen });

  items.push({ separator: true });

  // Clipboard
  items.push({
    label: "Copy file path",
    onClick: () => navigator.clipboard.writeText(file.path),
    icon: Copy,
  });

  items.push({ separator: true });

  // Destructive
  items.push({
    label: "Discard changes",
    onClick: () => discard(file.path),
    destructive: true,
    icon: Undo2,
  });
  items.push({
    label: "Delete file",
    onClick: () => deleteFile(file.path),
    destructive: true,
    icon: Trash2,
  });

  return items;
}

function buildFolderContextMenuItems(
  paths: string[],
  folderPath: string,
  isStaged: boolean,
  stage: (paths: string[]) => void,
  unstage: (paths: string[]) => void,
  discard: (paths: string[]) => void,
  stashFiles: (paths: string[]) => void,
  showInFolder: (path: string) => void,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  const count = paths.length;

  // Stage / unstage
  if (isStaged) {
    items.push({ label: `Unstage folder (${count} files)`, onClick: () => unstage(paths), icon: Minus });
  } else {
    items.push({ label: `Stage folder (${count} files)`, onClick: () => stage(paths), icon: Plus });
  }

  // Stash (only for unstaged)
  if (!isStaged) {
    items.push({ separator: true });
    items.push({ label: "Stash folder", onClick: () => stashFiles(paths), icon: Archive });
  }

  items.push({ separator: true });

  // External
  items.push({ label: "Open folder", onClick: () => showInFolder(folderPath), icon: FolderOpen });

  items.push({ separator: true });

  // Destructive
  items.push({
    label: "Discard folder changes",
    onClick: () => discard(paths),
    destructive: true,
    icon: Undo2,
  });

  return items;
}

function buildBatchContextMenuItems(
  paths: string[],
  isStaged: boolean,
  stage: (paths: string[]) => void,
  unstage: (paths: string[]) => void,
  discard: (paths: string[]) => void,
  stashFiles: (paths: string[]) => void,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  const count = paths.length;

  // Stage / unstage
  if (isStaged) {
    items.push({ label: `Unstage ${count} files`, onClick: () => unstage(paths), icon: Minus });
  } else {
    items.push({ label: `Stage ${count} files`, onClick: () => stage(paths), icon: Plus });
  }

  // Stash (only for unstaged)
  if (!isStaged) {
    items.push({ separator: true });
    items.push({ label: `Stash ${count} files`, onClick: () => stashFiles(paths), icon: Archive });
  }

  items.push({ separator: true });

  // Destructive
  items.push({
    label: `Discard ${count} files`,
    onClick: () => discard(paths),
    destructive: true,
    icon: Undo2,
  });

  return items;
}

function buildConflictContextMenuItems(
  file: FileStatus,
  resolveOurs: (path: string) => void,
  resolveTheirs: (path: string) => void,
  resolveManual: ((path: string, content: string) => Promise<void>) | null,
  outputText: string | null,
  openInEditor: (path: string) => void,
  showInFolder: (path: string) => void,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];

  items.push({ label: "Accept Ours", onClick: () => resolveOurs(file.path), icon: Check });
  items.push({ label: "Accept Theirs", onClick: () => resolveTheirs(file.path), icon: Check });

  if (resolveManual && outputText != null) {
    items.push({
      label: "Save Resolution",
      onClick: () => resolveManual(file.path, outputText),
      icon: Save,
    });
  }

  items.push({ separator: true });

  items.push({ label: "Open in default editor", onClick: () => openInEditor(file.path), icon: ExternalLink });
  items.push({ label: "Show in folder", onClick: () => showInFolder(file.path), icon: FolderOpen });

  items.push({ separator: true });

  items.push({
    label: "Copy file path",
    onClick: () => navigator.clipboard.writeText(file.path),
    icon: Copy,
  });

  return items;
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
    <ConfirmDialog
      open
      onClose={onCancel}
      title="Discard changes?"
      description={
        fileName
          ? `Revert "${fileName}" to its last committed state. This cannot be undone.`
          : `Revert ${paths.length} files to their last committed state. This cannot be undone.`
      }
      confirmLabel="Discard"
      destructive
      onConfirm={onConfirm}
    />
  );
}

function DeleteDialog({
  path,
  onConfirm,
  onCancel,
}: {
  path: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const fileName = path.split("/").pop() ?? path;

  return (
    <ConfirmDialog
      open
      onClose={onCancel}
      title="Delete file?"
      description={`Permanently delete "${fileName}" from disk. This cannot be undone.`}
      confirmLabel="Delete"
      destructive
      onConfirm={onConfirm}
    />
  );
}
