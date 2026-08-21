import { useEffect, useState } from "react";
import { open as openDirectoryPicker } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/modal";
import { useRepoStore } from "@/stores/repo-store";

const INPUT_CLASS =
  "w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring";

/**
 * Create a worktree for `branch`. Rendered by both the sidebar branch list and
 * the graph's commit menu, which is why it owns its own state instead of the
 * caller holding a path input.
 *
 * The path defaults to a sibling of the repo (`<repo>-<branch>`) — the
 * conventional layout. A worktree nested inside the repo would show up in
 * `git status` and confuse tools that walk up looking for the repository root.
 */
export function CreateWorktreeDialog({
  branch,
  onClose,
}: {
  branch: string;
  onClose: () => void;
}) {
  const suggestedWorktreePath = useRepoStore((s) => s.suggestedWorktreePath);
  const addWorktree = useRepoStore((s) => s.addWorktree);
  const [path, setPath] = useState("");

  useEffect(() => {
    let cancelled = false;
    suggestedWorktreePath(branch)
      .then((p) => {
        if (!cancelled) setPath(p);
      })
      .catch(() => {
        /* leave the field empty — the user can type or browse */
      });
    return () => {
      cancelled = true;
    };
  }, [branch, suggestedWorktreePath]);

  const submit = () => {
    const trimmed = path.trim();
    if (!trimmed) return;
    addWorktree(trimmed, branch);
    onClose();
  };

  const browse = async () => {
    const picked = await openDirectoryPicker({
      directory: true,
      title: "Choose worktree location",
    });
    if (typeof picked !== "string") return;
    // The picker returns a parent directory; keep the suggested leaf name.
    const leaf = path.replace(/\\/g, "/").split("/").pop();
    setPath(leaf ? `${picked.replace(/[\\/]$/, "")}/${leaf}` : picked);
  };

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title="Create worktree"
      description={`A second working directory checked out to '${branch}'.`}
      confirmLabel="Create"
      confirmDisabled={!path.trim()}
      onConfirm={submit}
      className="max-w-md p-4"
    >
      <div className="flex gap-2 mb-3">
        <input
          autoFocus
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="Worktree path"
          className={INPUT_CLASS}
        />
        <button
          onClick={browse}
          title="Browse…"
          className="shrink-0 rounded-md border border-border px-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </button>
      </div>
    </ConfirmDialog>
  );
}

/**
 * Confirm removing a worktree. Shared by the Worktrees panel and both branch
 * context menus, which reach it from a `worktree_path` rather than a full
 * WorktreeInfo — so it takes the two strings it actually needs.
 *
 * `label` names what lives there (branch, or a short SHA when detached).
 */
export function RemoveWorktreeDialog({
  path,
  label,
  onClose,
}: {
  path: string;
  label: string;
  onClose: () => void;
}) {
  const removeWorktree = useRepoStore((s) => s.removeWorktree);

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      title="Remove worktree?"
      description={`This deletes the working directory at ${path}. Commits on ${label} are kept.`}
      confirmLabel="Remove"
      destructive
      onConfirm={() => {
        removeWorktree(path);
        onClose();
      }}
    />
  );
}
