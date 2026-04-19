import { useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { useRepoStore } from "@/stores/repo-store";
import { FileList } from "@/components/staging/file-list";
import { CommitBox } from "@/components/staging/commit-box";
import type { FileStatus } from "@/types/git";

// Claude Code orange — used for CC co-author avatar
const CLAUDE_ORANGE = "#E8734A";

function isClaudeCoAuthor(email: string): boolean {
  return email.includes("anthropic.com") || email.includes("claude");
}

export function DetailPanel() {
  const {
    commits,
    selectedCommitId,
    selectedFilePath,
    fileStatuses,
    commitFiles,
    selectCommitFile,
  } = useRepoStore();

  if (selectedCommitId) {
    const commit = commits.find((c) => c.id === selectedCommitId);
    if (commit) {
      return (
        <CommitDetailView
          commit={commit}
          commitFiles={commitFiles}
          selectedFilePath={selectedFilePath}
          onFileClick={(path) => selectCommitFile(selectedCommitId, path)}
        />
      );
    }
  }

  if (fileStatuses.length > 0) {
    return (
      <div className="flex h-full flex-col bg-card">
        <div className="flex h-10 shrink-0 items-center border-b border-border px-4">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Changes
          </h2>
          <span className="ml-2 text-xs text-muted-foreground/50">
            {fileStatuses.length}
          </span>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          <FileList />
        </div>
        <CommitBox />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center bg-card p-4">
      <p className="text-sm text-muted-foreground">
        Select a commit to view details
      </p>
    </div>
  );
}

function CommitDetailView({
  commit,
  commitFiles,
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
  selectedFilePath: string | null;
  onFileClick: (path: string) => void;
}) {
  const [commitOpen, setCommitOpen] = useState(true);
  const [filesOpen, setFilesOpen] = useState(true);

  const date = new Date(commit.timestamp * 1000);
  const dateStr = date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="flex h-full flex-col bg-card overflow-y-auto">
      {/* Commit section */}
      <CollapsibleSection
        label="Commit"
        isOpen={commitOpen}
        onToggle={() => setCommitOpen(!commitOpen)}
      >
        <div className="px-4 pb-4">
          {/* SHA */}
          <p className="font-mono text-xs text-muted-foreground mb-2">
            {commit.short_id}
          </p>

          {/* Message */}
          <p className="text-sm text-foreground mb-1">{commit.message}</p>

          {/* Body (description) */}
          {commit.body && (
            <div className="rounded-md bg-secondary/50 px-3 py-2 mb-2 max-h-20 overflow-y-auto">
              <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                {commit.body}
              </p>
            </div>
          )}

          {/* Author */}
          <p className="text-xs text-muted-foreground/50 uppercase tracking-wider mt-3 mb-1">
            Author
          </p>
          <div className="flex items-center gap-1.5">
            <div className="h-5 w-5 rounded-full bg-secondary flex items-center justify-center shrink-0">
              <span className="text-xs font-medium text-foreground">
                {commit.author_name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <p className="text-xs text-foreground">{commit.author_name}</p>
              <p className="text-xs text-muted-foreground/60">
                {commit.author_email}
              </p>
            </div>
          </div>

          {/* Co-authors */}
          {commit.co_authors.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground/50 uppercase tracking-wider mt-3 mb-1">
                Co-Author{commit.co_authors.length > 1 ? "s" : ""}
              </p>
              <div className="space-y-1.5">
                {commit.co_authors.map((ca, i) => {
                  const isClaude = isClaudeCoAuthor(ca.email);
                  return (
                    <div key={i} className="flex items-center gap-1.5">
                      <div
                        className="h-5 w-5 rounded-full flex items-center justify-center shrink-0"
                        style={
                          isClaude
                            ? { backgroundColor: CLAUDE_ORANGE }
                            : undefined
                        }
                      >
                        {isClaude ? (
                          <ClaudeIcon />
                        ) : (
                          <span className="text-xs font-medium text-foreground bg-secondary rounded-full h-5 w-5 flex items-center justify-center">
                            {ca.name.charAt(0).toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-foreground">{ca.name}</p>
                        {ca.email && (
                          <p className="text-xs text-muted-foreground/60">
                            {ca.email}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Date */}
          <p className="text-xs text-muted-foreground/60 mt-3">
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
        >
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
        </CollapsibleSection>
      )}
    </div>
  );
}

function CollapsibleSection({
  label,
  isOpen,
  onToggle,
  children,
}: {
  label: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
      >
        {isOpen ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {label}
      </button>
      {isOpen && children}
    </div>
  );
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
  const statusColor =
    file.status_type === "added"
      ? "text-green-400"
      : file.status_type === "deleted"
        ? "text-red-400"
        : file.status_type === "renamed"
          ? "text-blue-400"
          : "text-yellow-400";

  const statusLabel =
    file.status_type === "added"
      ? "A"
      : file.status_type === "deleted"
        ? "D"
        : file.status_type === "renamed"
          ? "R"
          : "M";

  const fileName = file.path.split("/").pop() ?? file.path;
  const dirPath = file.path.includes("/")
    ? file.path.slice(0, file.path.lastIndexOf("/"))
    : "";

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-1.5 px-4 py-1 text-left transition-colors ${
        isSelected
          ? "bg-accent text-accent-foreground"
          : "hover:bg-secondary"
      }`}
    >
      <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span
        className={`w-4 shrink-0 text-center text-xs font-medium ${statusColor}`}
      >
        {statusLabel}
      </span>
      <span className="truncate text-xs text-foreground">{fileName}</span>
      {dirPath && (
        <span className="truncate text-xs text-muted-foreground/50">
          {dirPath}
        </span>
      )}
    </button>
  );
}

/** Tiny Claude sparkle icon in white */
function ClaudeIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z"
        fill="white"
      />
    </svg>
  );
}
