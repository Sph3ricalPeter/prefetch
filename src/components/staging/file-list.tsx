import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  Trash2,
  Folder,
  FolderOpen,
  Loader2,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import type { FileStatus } from "@/types/git";
import { useRepoStore } from "@/stores/repo-store";
import { FileIcon } from "@/components/ui/file-icon";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/context-menu";
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
  const stashFiles = useRepoStore((s) => s.stashFiles);
  const showInFolder = useRepoStore((s) => s.showInFolder);
  const openInEditor = useRepoStore((s) => s.openInEditor);
  const deleteFile = useRepoStore((s) => s.deleteFile);

  const fileViewMode = useRepoStore((s) => s.fileViewMode);

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
  const viewMode = fileViewMode;

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

      if (e.shiftKey && lastClickedRef.current && lastClickedRef.current.section === section) {
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
        // Clear multi-select and open single-file context menu
        setMultiSelected(new Set());
        setFileContextMenu({ file, isStaged, x: e.clientX, y: e.clientY });
      }
    },
    [multiSelected],
  );

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
            ? () => wrappedStage(unstaged.map((f) => f.path))
            : undefined
        }
        actionDisabled={isLoading || busyOp !== null}
        isBusy={busyOp === "stage"}
      >
        {viewMode === "tree" ? (
          <FileTreeView
            files={unstaged}
            selectedFilePath={selectedFilePath}
            multiSelected={multiSelected}
            isLfsFile={isLfsFile}
            onSelect={(path, e) => handleFileClick(e, unstaged.find((f) => f.path === path)!, false, unstaged)}
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
              isSelected={selectedFilePath === file.path}
              isMultiSelected={multiSelected.has(file.path)}
              isLfs={!!isLfsFile(file.path)}
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

      {/* Divider between unstaged and staged */}
      <div className="mx-3 my-[4px] border-t border-border" />

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
      >
        {viewMode === "tree" ? (
          <FileTreeView
            files={staged}
            selectedFilePath={selectedFilePath}
            multiSelected={multiSelected}
            isLfsFile={isLfsFile}
            onSelect={(path, e) => handleFileClick(e, staged.find((f) => f.path === path)!, true, staged)}
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
              isSelected={selectedFilePath === file.path}
              isMultiSelected={multiSelected.has(file.path)}
              isLfs={!!isLfsFile(file.path)}
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
            deleteFile,
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
  children: React.ReactNode;
}) {
  return (
    <div className="pb-[10px]">
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
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
            >
              {isBusy && <Loader2 className="h-3 w-3 animate-spin" />}
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
  multiSelected,
  isLfsFile,
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
    <div>
      {tree.map((node) => (
        <TreeNodeView
          key={node.path}
          node={node}
          depth={0}
          selectedFilePath={selectedFilePath}
          multiSelected={multiSelected}
          isLfsFile={isLfsFile}
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

function TreeNodeView({
  node,
  depth,
  selectedFilePath,
  multiSelected,
  isLfsFile,
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
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onFolderContextMenu?.(collectFilePaths(node), node.path, e.clientX, e.clientY);
          }}
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
            multiSelected={multiSelected}
            isLfsFile={isLfsFile}
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
  const statusLabel = statusTypeLabel(file.status_type);
  const isSelected = selectedFilePath === file.path;
  const isMulti = multiSelected?.has(file.path) ?? false;
  const isLfs = !!isLfsFile(file.path);

  return (
    <div
      className={`group flex items-center gap-1.5 px-3 py-1.5 cursor-pointer transition-colors ${
        isMulti
          ? "bg-primary/15 text-accent-foreground"
          : isSelected
            ? "bg-accent text-accent-foreground"
            : "hover:bg-secondary"
      }`}
      style={{ paddingLeft: `${12 + indent + 16}px` }}
      onClick={(e) => onSelect(file.path, e)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onFileContextMenu?.(file, e.clientX, e.clientY, e);
      }}
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
  isMultiSelected,
  isLfs,
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
  onSelect: (e: React.MouseEvent) => void;
  onToggle: () => void;
  toggleIcon: React.ReactNode;
  toggleTitle: string;
  onDiscard: () => void;
  disabled: boolean;
  onContextMenu?: (e: React.MouseEvent) => void;
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
        isMultiSelected
          ? "bg-primary/15 text-accent-foreground"
          : isSelected
            ? "bg-accent text-accent-foreground"
            : "hover:bg-secondary"
      }`}
      onClick={onSelect}
      onContextMenu={onContextMenu}
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

  // Only show a conflict label for non-obvious types (both_modified is the
  // common case and redundant — if there's a conflict both sides changed).
  const conflictLabel = (() => {
    switch (file.conflict_type) {
      case "both_added": return "Both added";
      case "both_deleted": return "Both deleted";
      case "added_by_us": return "We added";
      case "added_by_them": return "They added";
      case "deleted_by_us": return "We deleted";
      case "deleted_by_them": return "They deleted";
      default: return null;
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
      {conflictLabel && (
        <span className="shrink-0 text-xs text-red-400">
          {conflictLabel}
        </span>
      )}
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
            className="shrink-0 rounded px-1.5 py-0.5 opacity-0 group-hover:opacity-100 text-xs font-medium text-purple-400 hover:bg-purple-500/20 transition-all disabled:opacity-40"
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
    items.push({ label: "Unstage file", onClick: () => unstage([file.path]) });
  } else {
    items.push({ label: "Stage file", onClick: () => stage([file.path]) });
  }

  // Stash (only for unstaged files)
  if (!isStaged) {
    items.push({ separator: true });
    items.push({ label: "Stash this file", onClick: () => stashFiles([file.path]) });
  }

  items.push({ separator: true });

  // External
  items.push({ label: "Open in default editor", onClick: () => openInEditor(file.path) });
  items.push({ label: "Show in folder", onClick: () => showInFolder(file.path) });

  items.push({ separator: true });

  // Clipboard
  items.push({
    label: "Copy file path",
    onClick: () => navigator.clipboard.writeText(file.path),
  });

  items.push({ separator: true });

  // Destructive
  items.push({
    label: "Discard changes",
    onClick: () => discard(file.path),
    destructive: true,
  });
  items.push({
    label: "Delete file",
    onClick: () => deleteFile(file.path),
    destructive: true,
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
    items.push({ label: `Unstage folder (${count} files)`, onClick: () => unstage(paths) });
  } else {
    items.push({ label: `Stage folder (${count} files)`, onClick: () => stage(paths) });
  }

  // Stash (only for unstaged)
  if (!isStaged) {
    items.push({ separator: true });
    items.push({ label: "Stash folder", onClick: () => stashFiles(paths) });
  }

  items.push({ separator: true });

  // External
  items.push({ label: "Open folder", onClick: () => showInFolder(folderPath) });

  items.push({ separator: true });

  // Destructive
  items.push({
    label: "Discard folder changes",
    onClick: () => discard(paths),
    destructive: true,
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
    items.push({ label: `Unstage ${count} files`, onClick: () => unstage(paths) });
  } else {
    items.push({ label: `Stage ${count} files`, onClick: () => stage(paths) });
  }

  // Stash (only for unstaged)
  if (!isStaged) {
    items.push({ separator: true });
    items.push({ label: `Stash ${count} files`, onClick: () => stashFiles(paths) });
  }

  items.push({ separator: true });

  // Destructive
  items.push({
    label: `Discard ${count} files`,
    onClick: () => discard(paths),
    destructive: true,
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
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-md bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground transition-all hover:bg-destructive/90 hover:-translate-y-px disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
