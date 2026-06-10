import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Tag,
  Plus,
} from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useRepoStore } from "@/stores/repo-store";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/context-menu";
import { FILTER_DIM_CLASS } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function TagList() {
  const allTags = useRepoStore((s) => s.tags);
  const filter = useRepoStore((s) => s.filterQuery);
  const selectedCommitId = useRepoStore((s) => s.selectedCommitId);
  const createNewTag = useRepoStore((s) => s.createNewTag);
  const deleteExistingTag = useRepoStore((s) => s.deleteExistingTag);
  const pushExistingTag = useRepoStore((s) => s.pushExistingTag);
  const isOpen = useRepoStore((s) => s.sidebarSections.tags);
  const setSidebarSection = useRepoStore((s) => s.setSidebarSection);
  const [isCreating, setIsCreating] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagMessage, setNewTagMessage] = useState("");
  const [tagContextMenu, setTagContextMenu] = useState<{
    tagName: string;
    x: number;
    y: number;
  } | null>(null);
  const [confirmDeleteTag, setConfirmDeleteTag] = useState<string | null>(null);

  // Filter dims non-matching rows rather than hiding them.
  const q = filter.trim().toLowerCase();
  const isDimmed = (name: string) =>
    q !== "" && !name.toLowerCase().includes(q);

  const handleCreate = async () => {
    if (!newTagName.trim()) return;
    await createNewTag(
      newTagName.trim(),
      selectedCommitId ?? undefined,
      newTagMessage.trim() || undefined,
    );
    setNewTagName("");
    setNewTagMessage("");
    setIsCreating(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCreate();
    } else if (e.key === "Escape") {
      setIsCreating(false);
      setNewTagName("");
      setNewTagMessage("");
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center px-3 py-1.5">
        <button
          onClick={() => setSidebarSection("tags", !isOpen)}
          className="flex items-center gap-1 text-label font-semibold text-muted-foreground uppercase tracking-[0.06em] hover:text-foreground transition-colors"
        >
          {isOpen ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          Tags
          {allTags.length > 0 && (
            <span className="ml-1 normal-case tracking-normal text-faint">
              {allTags.length}
            </span>
          )}
        </button>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setIsCreating(!isCreating)}
              className="ml-auto rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            >
              <Plus className="h-3 w-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Create tag</TooltipContent>
        </Tooltip>
      </div>

      {/* Create tag inline form */}
      {isCreating && (
        <div className="px-3 pb-2 space-y-1">
          <input
            type="text"
            placeholder="Tag name (e.g. v1.0.0)"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            className="w-full rounded bg-secondary px-2 py-1 text-xs text-foreground placeholder:text-faint outline-none focus:ring-1 focus:ring-ring"
          />
          <input
            type="text"
            placeholder="Message (optional)"
            value={newTagMessage}
            onChange={(e) => setNewTagMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full rounded bg-secondary px-2 py-1 text-xs text-foreground placeholder:text-faint outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex gap-1">
            <button
              onClick={handleCreate}
              disabled={!newTagName.trim()}
              className="flex-1 rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              Create
            </button>
            <button
              onClick={() => {
                setIsCreating(false);
                setNewTagName("");
                setNewTagMessage("");
              }}
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Tag entries */}
      {isOpen && allTags.length > 0 && (
        <div>
          {allTags.map((tag) => (
            <div
              key={tag.name}
              onContextMenu={(e) => {
                e.preventDefault();
                setTagContextMenu({ tagName: tag.name, x: e.clientX, y: e.clientY });
              }}
              className={cn(
                "group flex items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground hover:bg-secondary transition-colors",
                isDimmed(tag.name) && FILTER_DIM_CLASS,
              )}
            >
              <Tag className="h-3 w-3 shrink-0" />
              <span className="shrink-0">{tag.name}</span>
              <span className="ml-auto min-w-0 truncate text-faint text-xs">
                {tag.commit_id}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Tag context menu */}
      {tagContextMenu && (
        <ContextMenu
          x={tagContextMenu.x}
          y={tagContextMenu.y}
          items={buildTagContextMenuItems(
            tagContextMenu.tagName,
            pushExistingTag,
            (name) => setConfirmDeleteTag(name),
          )}
          onClose={() => setTagContextMenu(null)}
        />
      )}

      {/* Delete tag confirmation */}
      {confirmDeleteTag != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-card p-4 shadow-lg max-w-xs">
            <p className="text-sm text-foreground mb-1">Delete tag?</p>
            <p className="text-xs text-muted-foreground mb-4">
              This will delete the local tag &quot;{confirmDeleteTag}&quot;. If it has been pushed, the remote tag is not affected.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteTag(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors whitespace-nowrap"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  deleteExistingTag(confirmDeleteTag);
                  setConfirmDeleteTag(null);
                }}
                className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 hover:-translate-y-px transition-all whitespace-nowrap"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function buildTagContextMenuItems(
  tagName: string,
  pushTag: (name: string) => void,
  confirmDelete: (name: string) => void,
): ContextMenuItem[] {
  return [
    {
      label: "Push to remote",
      onClick: () => pushTag(tagName),
    },
    {
      label: "Copy tag name",
      onClick: () => navigator.clipboard.writeText(tagName),
    },
    { separator: true },
    {
      label: `Delete ${tagName}…`,
      onClick: () => confirmDelete(tagName),
      destructive: true,
    },
  ];
}
