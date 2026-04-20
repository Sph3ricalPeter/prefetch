import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Tag,
  ArrowUpFromLine,
  Trash2,
  Plus,
} from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useRepoStore } from "@/stores/repo-store";

export function TagList({ filter = "" }: { filter?: string }) {
  const allTags = useRepoStore((s) => s.tags);
  const selectedCommitId = useRepoStore((s) => s.selectedCommitId);
  const createNewTag = useRepoStore((s) => s.createNewTag);
  const deleteExistingTag = useRepoStore((s) => s.deleteExistingTag);
  const pushExistingTag = useRepoStore((s) => s.pushExistingTag);
  const isLoading = useRepoStore((s) => s.isLoading);
  const [isOpen, setIsOpen] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagMessage, setNewTagMessage] = useState("");

  const tags = filter
    ? allTags.filter((t) =>
        t.name.toLowerCase().includes(filter.toLowerCase()),
      )
    : allTags;

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
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1 text-xs font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
        >
          {isOpen ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          Tags
          {tags.length > 0 && (
            <span className="ml-1 normal-case tracking-normal text-muted-foreground/50">
              {tags.length}
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
            className="w-full rounded bg-secondary px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
          />
          <input
            type="text"
            placeholder="Message (optional)"
            value={newTagMessage}
            onChange={(e) => setNewTagMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full rounded bg-secondary px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-ring"
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
      {isOpen && tags.length > 0 && (
        <div>
          {tags.map((tag) => (
            <div
              key={tag.name}
              className="group flex items-center gap-1.5 px-3 py-1 text-xs text-muted-foreground hover:bg-secondary transition-colors"
            >
              <Tag className="h-3 w-3 shrink-0" />
              <span className="truncate flex-1">{tag.name}</span>
              <span className="shrink-0 font-mono text-muted-foreground/40 text-xs">
                {tag.commit_id}
              </span>

              {/* Push button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      pushExistingTag(tag.name);
                    }}
                    disabled={isLoading}
                    className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground transition-all disabled:opacity-40"
                  >
                    <ArrowUpFromLine className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Push to remote</TooltipContent>
              </Tooltip>

              {/* Delete button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteExistingTag(tag.name);
                    }}
                    disabled={isLoading}
                    className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-destructive/20 hover:text-destructive-foreground transition-all disabled:opacity-40"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Delete tag</TooltipContent>
              </Tooltip>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
