import { useState } from "react";
import { Link, X, CheckCircle, AlertCircle } from "lucide-react";
import { useRepoStore } from "@/stores/repo-store";
import { openUrl } from "@/lib/commands";

/**
 * Modal for connecting a GitHub or GitLab account via a Personal Access Token.
 *
 * Usage:
 *   const [open, setOpen] = useState(false);
 *   <button onClick={() => setOpen(true)}>Connect GitHub</button>
 *   {open && <ForgeSettings onClose={() => setOpen(false)} />}
 */
export function ForgeSettings({ onClose }: { onClose: () => void }) {
  const forgeStatus = useRepoStore((s) => s.forgeStatus);
  const saveForgeToken = useRepoStore((s) => s.saveForgeToken);
  const deleteForgeToken = useRepoStore((s) => s.deleteForgeToken);

  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);

  const host = forgeStatus?.host ?? null;
  const kind = forgeStatus?.kind ?? null;
  const hasToken = forgeStatus?.has_token ?? false;
  const detected = forgeStatus?.owner && forgeStatus?.repo;

  const handleSave = async () => {
    if (!host || !token.trim()) return;
    setSaving(true);
    await saveForgeToken(host, token.trim());
    setSaving(false);
    setToken("");
    onClose();
  };

  const handleDelete = async () => {
    if (!host) return;
    await deleteForgeToken(host);
    onClose();
  };

  const forgeName = kind === "gitlab" ? "GitLab" : "GitHub";
  const tokenDocsUrl =
    kind === "gitlab"
      ? "https://gitlab.com/-/user_settings/personal_access_tokens/legacy/new"
      : "https://github.com/settings/tokens";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="relative w-full max-w-sm rounded-lg border border-border bg-popover p-5 shadow-xl">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute right-3 top-3 rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        <h2 className="mb-4 text-sm font-semibold text-foreground">
          Connect {forgeName}
        </h2>

        {/* Detected repo */}
        {detected ? (
          <div className="mb-4 flex items-center gap-2 rounded bg-secondary px-3 py-2 text-xs">
            <Link className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">
              {forgeName} ·{" "}
              <span className="text-foreground font-medium">
                {forgeStatus?.owner}/{forgeStatus?.repo}
              </span>
            </span>
          </div>
        ) : (
          <div className="mb-4 flex items-center gap-2 rounded bg-secondary px-3 py-2 text-xs text-muted-foreground">
            <AlertCircle className="h-3 w-3 shrink-0" />
            No GitHub/GitLab remote detected on this repository.
          </div>
        )}

        {/* Connection status */}
        {host && (
          <div className="mb-4 flex items-center gap-2 text-xs">
            {hasToken ? (
              <>
                <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                <span className="text-muted-foreground">
                  Token stored for{" "}
                  <span className="text-foreground font-medium">{host}</span>
                </span>
              </>
            ) : (
              <>
                <AlertCircle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
                <span className="text-muted-foreground">
                  No token — PR detection will not work.
                </span>
              </>
            )}
          </div>
        )}

        {/* PAT input */}
        {host && (
          <div className="space-y-2">
            <label className="block text-xs text-muted-foreground">
              Personal Access Token{" "}
              <button
                type="button"
                onClick={() => openUrl(tokenDocsUrl)}
                className="text-primary hover:underline"
              >
                (create one)
              </button>
            </label>
            <input
              type="password"
              placeholder={hasToken ? "Enter new token to replace…" : "ghp_…"}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") onClose();
              }}
              className="w-full rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-faint outline-none focus:ring-1 focus:ring-ring"
            />

            <div className="flex gap-2 pt-1">
              <button
                onClick={handleSave}
                disabled={!token.trim() || saving}
                className="flex-1 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {saving ? "Saving…" : "Save Token"}
              </button>
              {hasToken && (
                <button
                  onClick={handleDelete}
                  className="rounded border border-border px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 transition-colors"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
