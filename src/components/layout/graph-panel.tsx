import { useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ArrowDownToLine, ArrowUpFromLine, RefreshCw } from "lucide-react";
import { useRepoStore } from "@/stores/repo-store";
import { CommitGraphCanvas } from "@/components/graph/commit-graph-canvas";

// Auto-open this repo during development
const DEV_REPO_PATH = "C:\\Users\\sph3r\\OneDrive\\Desktop\\prefetch";

export function GraphPanel() {
  const store = useRepoStore();

  // Auto-open dev repo on mount
  useEffect(() => {
    if (!store.repoPath && !store.isLoading) {
      store.openRepository(DEV_REPO_PATH);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOpenRepo = async () => {
    const selected = await open({
      directory: true,
      title: "Open Git Repository",
    });
    if (selected) {
      await store.openRepository(selected);
    }
  };

  // No repo open — show open button
  if (!store.repoPath) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 bg-background">
        <button
          onClick={handleOpenRepo}
          disabled={store.isLoading}
          className="rounded-md bg-secondary px-6 py-3 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          {store.isLoading ? "Opening..." : "Open Repository"}
        </button>
        <p className="text-xs text-muted-foreground">
          Select a folder containing a Git repository
        </p>
      </div>
    );
  }

  // Empty repo
  if (!store.isLoading && store.commits.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">No commits yet</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header bar with toolbar */}
      <div className="flex h-10 shrink-0 items-center border-b border-border px-4">
        <span className="text-xs font-medium text-muted-foreground">
          {store.repoName}
        </span>
        <span className="ml-2 text-xs text-muted-foreground/50">
          {store.commits.length.toLocaleString()} commits
        </span>

        {/* Toolbar buttons — right side */}
        <div className="ml-auto flex items-center gap-1">
          <ToolbarButton
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            label="Fetch"
            disabled={store.isLoading}
            onClick={() => store.fetch()}
          />
          <ToolbarButton
            icon={<ArrowDownToLine className="h-3.5 w-3.5" />}
            label="Pull"
            disabled={store.isLoading}
            onClick={() => store.pull()}
          />
          <ToolbarButton
            icon={<ArrowUpFromLine className="h-3.5 w-3.5" />}
            label="Push"
            disabled={store.isLoading}
            onClick={() => store.push()}
          />
        </div>
      </div>

      {/* Graph canvas */}
      <div className="flex-1 min-h-0">
        <CommitGraphCanvas
          commits={store.commits}
          edges={store.edges}
          totalLanes={store.totalLanes}
          selectedCommitId={store.selectedCommitId}
          onSelectCommit={store.selectCommit}
        />
      </div>
    </div>
  );
}

function ToolbarButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
