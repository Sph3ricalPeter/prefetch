import type { LucideIcon } from "lucide-react";
import {
  Archive,
  ArchiveRestore,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  Cherry,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FastForward,
  FolderGit2,
  FolderOpen,
  GitBranchPlus,
  GitCommit,
  GitMerge,
  KeyRound,
  Link,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Tag,
  Trash2,
  Undo2,
  UserRound,
} from "lucide-react";

/**
 * The icon that represents each user-facing action, app-wide.
 *
 * One action means one icon everywhere it appears — the titlebar toolbar, every
 * right-click menu, and the error toast raised when it fails. Before this the
 * same vocabulary was retyped inline in seven files, so an action's icon was
 * whatever the nearest `import { … } from "lucide-react"` happened to include
 * and nothing stopped two menus disagreeing.
 *
 * Keys are the action names used as error-toast titles (see `showError` in
 * lib/toast.ts), so a toast picks up its icon with no extra wiring. Menu labels
 * are usually composed at the call site ("Checkout feat/hunk-staging"), so those
 * reference the icon by the bare action name.
 *
 * Purely internal failures — "Load Diff", "Load Branches" — are deliberately
 * absent: they aren't actions the user invoked and have no icon to share.
 * `showError` falls back to its error glyph for anything not listed.
 */
export const ACTION_ICONS = {
  // ── Syncing with the remote ──────────────────────────────────────
  Fetch: RefreshCw,
  Pull: ArrowDownToLine,
  Push: ArrowUpFromLine,
  "Push Tag": ArrowUpFromLine,
  "Set Upstream": Link,

  // ── History ──────────────────────────────────────────────────────
  Commit: GitCommit,
  "Reword Commit": Pencil,
  Merge: GitMerge,
  Rebase: FastForward,
  "Fast-forward": FastForward,
  "Cherry-pick": Cherry,
  Revert: Undo2,
  Reset: RotateCcw,
  Undo: Undo2,

  // ── Branches and tags ────────────────────────────────────────────
  Checkout: Check,
  "Checkout Commit": Check,
  "Create Branch": GitBranchPlus,
  "Rename Branch": Pencil,
  "Delete Branch": Trash2,
  "Delete Remote Branch": Trash2,
  "Create Tag": Tag,
  "Delete Tag": Trash2,

  // ── Working tree ─────────────────────────────────────────────────
  Stage: Plus,
  Unstage: Minus,
  "Stage Hunk": Plus,
  "Unstage Hunk": Minus,
  "Stage Lines": Plus,
  "Unstage Lines": Minus,
  Discard: Undo2,
  "Discard All": Undo2,
  "Delete File": Trash2,

  // ── Stashes ──────────────────────────────────────────────────────
  "Stash Changes": Archive,
  "Stash Files": Archive,
  "Apply Stash": ArrowDownToLine,
  "Pop Stash": ArchiveRestore,
  "Drop Stash": Trash2,

  // ── Conflicts ────────────────────────────────────────────────────
  "Resolve Conflict": Save,
  "Accept Ours": ChevronRight,
  "Accept Theirs": ChevronLeft,
  "Abort Operation": RotateCcw,
  "Continue Operation": FastForward,

  // ── Repositories ─────────────────────────────────────────────────
  "Open Repository": FolderOpen,
  "Clone Repository": Download,
  "Remove Recent Repository": Trash2,
  "Show in Folder": FolderOpen,
  "Open in Editor": ExternalLink,
  Copy: Copy,
  "Copy Link": Link,

  // ── Worktrees ────────────────────────────────────────────────────
  "Create Worktree": FolderGit2,
  "Remove Worktree": Trash2,
  "Prune Worktrees": Trash2,
  "Reveal Worktree": FolderOpen,

  // ── LFS ──────────────────────────────────────────────────────────
  "Initialize LFS": FolderGit2,
  "Track LFS Pattern": Plus,
  "Untrack LFS Pattern": Minus,
  "Prune LFS Objects": Trash2,

  // ── Forge, profiles, updates ─────────────────────────────────────
  "Open Pull Request": ExternalLink,
  Authenticate: KeyRound,
  "Save Token": KeyRound,
  "Save Forge Token": KeyRound,
  "Remove Token": Trash2,
  "Delete Forge Token": Trash2,
  "Create Profile": UserRound,
  "Update Profile": UserRound,
  "Delete Profile": Trash2,
  "Update check failed": Download,
  "Update download failed": Download,
  "Update restart failed": RefreshCw,
} satisfies Record<string, LucideIcon>;

export type ActionName = keyof typeof ACTION_ICONS;

/** The icon for an action, or undefined for internal operations with no icon. */
export function actionIcon(action: string): LucideIcon | undefined {
  return (ACTION_ICONS as Record<string, LucideIcon>)[action];
}
