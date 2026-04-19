import {
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  FileText,
} from "lucide-react";
import { useState } from "react";
import type { FileStatus } from "@/types/git";
import { useRepoStore } from "@/stores/repo-store";

export function FileList() {
  const {
    fileStatuses,
    selectedFilePath,
    stage,
    unstage,
    selectFile,
    isLoading,
  } = useRepoStore();
  const [stagedOpen, setStagedOpen] = useState(true);
  const [unstagedOpen, setUnstagedOpen] = useState(true);

  const staged = fileStatuses.filter((f) => f.is_staged);
  const unstaged = fileStatuses.filter((f) => !f.is_staged);

  if (fileStatuses.length === 0) {
    return (
      <div className="flex items-center justify-center p-4 text-xs text-muted-foreground">
        No changes
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-y-auto">
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
            disabled={isLoading}
          />
        ))}
      </FileSection>

      {/* Unstaged section */}
      <FileSection
        label="Changes"
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
            disabled={isLoading}
          />
        ))}
      </FileSection>
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
  children,
}: {
  label: string;
  count: number;
  isOpen: boolean;
  onToggle: () => void;
  actionLabel: string;
  onAction?: () => void;
  actionDisabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center px-3 py-1.5">
        <button
          onClick={onToggle}
          className="flex items-center gap-1 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
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
  disabled,
}: {
  file: FileStatus;
  isSelected: boolean;
  onSelect: () => void;
  onToggle: () => void;
  toggleIcon: React.ReactNode;
  toggleTitle: string;
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
      <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className={`w-4 shrink-0 text-center text-xs font-medium ${statusColor}`}>
        {statusLabel}
      </span>
      <span className="truncate text-xs text-foreground">{fileName}</span>
      {dirPath && (
        <span className="truncate text-xs text-muted-foreground/50">
          {dirPath}
        </span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        disabled={disabled}
        title={toggleTitle}
        className="ml-auto shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-secondary text-muted-foreground hover:text-foreground transition-all disabled:opacity-40"
      >
        {toggleIcon}
      </button>
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
