import { useState, type KeyboardEvent } from "react";
import {
  X,
  CheckCircle,
  AlertCircle,
  Plus,
  Trash2,
  Globe,
  GitBranch,
  Database,
  User,
  Star,
} from "lucide-react";
import { useRepoStore } from "@/stores/repo-store";
import { useProfileStore } from "@/stores/profile-store";
import { openUrl } from "@/lib/commands";
import { ProfileModal } from "@/components/ui/profile-modal";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

/** Format a byte count into a human-readable string. */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

// ── Profiles section ────────────────────────────────────────────────────────

function ProfilesSection({ onManageProfiles }: { onManageProfiles: () => void }) {
  const profiles = useProfileStore((s) => s.profiles);
  const activeProfile = useProfileStore((s) => s.activeProfile);

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
        Profiles
      </h3>

      {activeProfile ? (
        <div className="flex items-center gap-2 rounded bg-secondary px-3 py-2">
          <User className="h-4 w-4 text-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-medium text-foreground truncate">
                {activeProfile.name}
              </p>
              {activeProfile.is_default && (
                <Star className="h-2.5 w-2.5 text-yellow-500 shrink-0 fill-yellow-500" />
              )}
            </div>
            <p className="text-[11px] text-muted-foreground truncate">
              {activeProfile.user_email}
            </p>
          </div>
          <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No profile active. Git commands use your local/global git config identity.
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        {profiles.length === 0
          ? "Create profiles to manage multiple git identities and SSH keys."
          : `${profiles.length} profile${profiles.length !== 1 ? "s" : ""} configured.`}
      </p>

      <button
        onClick={onManageProfiles}
        className="w-full rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      >
        Manage Profiles
      </button>
    </div>
  );
}

// ── Integration section ──────────────────────────────────────────────────────

function IntegrationsSection() {
  const forgeStatus = useRepoStore((s) => s.forgeStatus);
  const saveForgeToken = useRepoStore((s) => s.saveForgeToken);
  const deleteForgeToken = useRepoStore((s) => s.deleteForgeToken);

  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);

  const host = forgeStatus?.host ?? null;
  const kind = forgeStatus?.kind ?? null;
  const hasToken = forgeStatus?.has_token ?? false;

  const forgeName = kind === "gitlab" ? "GitLab" : "GitHub";
  const tokenDocsUrl =
    kind === "gitlab"
      ? "https://gitlab.com/-/user_settings/personal_access_tokens/legacy/new"
      : "https://github.com/settings/tokens";

  const handleSave = async () => {
    if (!host || !token.trim()) return;
    setSaving(true);
    await saveForgeToken(host, token.trim());
    setSaving(false);
    setToken("");
  };

  const handleDelete = async () => {
    if (!host) return;
    await deleteForgeToken(host);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSave();
  };

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
        Integrations
      </h3>

      {!host ? (
        <p className="text-xs text-muted-foreground">
          No GitHub/GitLab remote detected. Open a repository with a
          GitHub or GitLab origin to configure an integration.
        </p>
      ) : (
        <div className="space-y-3">
          {/* Current connection status */}
          <div className="flex items-center gap-2 rounded bg-secondary px-3 py-2">
            {kind === "gitlab" ? (
              <GitBranch className="h-4 w-4 text-orange-400 shrink-0" />
            ) : (
              <Globe className="h-4 w-4 text-foreground shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">
                {forgeName}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                {host} · {forgeStatus?.owner}/{forgeStatus?.repo}
              </p>
            </div>
            {hasToken ? (
              <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
            ) : (
              <AlertCircle className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
            )}
          </div>

          {/* Status message */}
          <p className="text-xs text-muted-foreground">
            {hasToken ? (
              <>
                Token stored for <span className="font-medium text-foreground">{host}</span>.
                This token is used for PR detection and git authentication
                across all repositories on this host.
              </>
            ) : (
              <>
                No token configured. Add a Personal Access Token to enable
                PR detection and automatic git authentication for all
                repositories on <span className="font-medium text-foreground">{host}</span>.
              </>
            )}
          </p>

          {/* Token input */}
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

            {/* Scopes hint */}
            <div className="rounded bg-secondary px-3 py-2 text-[11px] text-muted-foreground space-y-1">
              <p className="font-medium text-foreground/80">Required scopes:</p>
              {kind === "gitlab" ? (
                <ul className="list-disc list-inside space-y-0.5">
                  <li><span className="font-mono text-foreground/70">read_api</span> — PR/MR detection</li>
                  <li><span className="font-mono text-foreground/70">write_repository</span> — push, pull, fetch</li>
                </ul>
              ) : (
                <ul className="list-disc list-inside space-y-0.5">
                  <li><span className="font-mono text-foreground/70">repo</span> — push, pull, fetch, PR detection</li>
                </ul>
              )}
            </div>
            {/* Show stored token state or input */}
            {hasToken && !token ? (
              <>
                <div className="flex items-center gap-2 w-full rounded border border-border bg-background px-3 py-1.5">
                  <span className="flex-1 text-xs text-muted-foreground font-mono tracking-widest">••••••••••••••••</span>
                  <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setToken(" ")}
                    className="flex-1 rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    Replace Token
                  </button>
                  <button
                    onClick={handleDelete}
                    className="rounded border border-border px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </>
            ) : (
              <>
                <input
                  type="password"
                  placeholder="ghp_…"
                  value={token.trim()}
                  onChange={(e) => setToken(e.target.value)}
                  onKeyDown={handleKeyDown}
                  autoFocus={!!token}
                  className="w-full rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 outline-none focus:ring-1 focus:ring-ring"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSave}
                    disabled={!token.trim() || saving}
                    className="flex-1 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  >
                    {saving ? "Saving…" : "Save Token"}
                  </button>
                  {hasToken && (
                    <button
                      onClick={() => setToken("")}
                      className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── LFS section ──────────────────────────────────────────────────────────────

function LfsSection() {
  const lfsInfo = useRepoStore((s) => s.lfsInfo);
  const isLoading = useRepoStore((s) => s.isLoading);
  const trackLfsPattern = useRepoStore((s) => s.trackLfsPattern);
  const untrackLfsPattern = useRepoStore((s) => s.untrackLfsPattern);
  const pruneLfsObjects = useRepoStore((s) => s.pruneLfsObjects);

  const [newPattern, setNewPattern] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const handleAddPattern = async () => {
    const pattern = newPattern.trim();
    if (!pattern) return;
    await trackLfsPattern(pattern);
    setNewPattern("");
    setIsAdding(false);
  };

  const handlePatternKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddPattern();
    } else if (e.key === "Escape") {
      setIsAdding(false);
      setNewPattern("");
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold text-foreground uppercase tracking-wider">
        Large File Storage (LFS)
      </h3>

      {!lfsInfo ? (
        <p className="text-xs text-muted-foreground">
          Open a repository to see LFS status.
        </p>
      ) : !lfsInfo.installed ? (
        <div className="flex items-start gap-1.5 rounded bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            git-lfs not found.{" "}
            <button
              type="button"
              onClick={() => openUrl("https://git-lfs.com")}
              className="underline"
            >
              Install git-lfs
            </button>{" "}
            to manage large files.
          </span>
        </div>
      ) : !lfsInfo.initialized ? (
        <p className="text-xs text-muted-foreground">
          This repository does not use LFS. LFS will be automatically
          configured when you add tracked patterns.
        </p>
      ) : (
        <div className="space-y-3">
          {/* Status */}
          <div className="flex items-center gap-2 rounded bg-secondary px-3 py-2">
            <Database className="h-4 w-4 text-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground">LFS Active</p>
              <p className="text-[11px] text-muted-foreground">
                {lfsInfo.file_count} file{lfsInfo.file_count !== 1 ? "s" : ""},{" "}
                {formatBytes(lfsInfo.total_size)}
              </p>
            </div>
            <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
          </div>

          <p className="text-xs text-muted-foreground">
            LFS files are handled automatically — commit, push, and pull
            work normally. No separate LFS operations needed.
          </p>

          {/* Tracked patterns */}
          <div className="space-y-1">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Tracked patterns
            </p>
            {lfsInfo.tracked_patterns.length === 0 ? (
              <p className="text-xs text-muted-foreground/50 italic">
                No patterns
              </p>
            ) : (
              lfsInfo.tracked_patterns.map((p) => (
                <div
                  key={p.pattern}
                  className="group flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <span className="flex-1 font-mono">{p.pattern}</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => untrackLfsPattern(p.pattern)}
                        disabled={isLoading}
                        className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-destructive/20 hover:text-destructive-foreground transition-all disabled:opacity-40"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Untrack &quot;{p.pattern}&quot;</TooltipContent>
                  </Tooltip>
                </div>
              ))
            )}
          </div>

          {/* Add pattern */}
          {isAdding ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                type="text"
                placeholder="*.psd"
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                onKeyDown={handlePatternKeyDown}
                className="flex-1 rounded bg-background border border-border px-2 py-0.5 text-xs text-foreground placeholder:text-muted-foreground/40 outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                onClick={handleAddPattern}
                disabled={!newPattern.trim() || isLoading}
                className="rounded px-1.5 py-0.5 text-xs bg-accent hover:bg-accent/80 disabled:opacity-40 transition-colors"
              >
                Add
              </button>
              <button
                onClick={() => {
                  setIsAdding(false);
                  setNewPattern("");
                }}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsAdding(true)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus className="h-3 w-3" />
              Track pattern
            </button>
          )}

          {/* Prune */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={pruneLfsObjects}
                disabled={isLoading}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
              >
                <Trash2 className="h-3 w-3" />
                Prune unreferenced objects
              </button>
            </TooltipTrigger>
            <TooltipContent>
              git lfs prune — remove old LFS objects to reclaim disk space
            </TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

// ── Settings modal ───────────────────────────────────────────────────────────

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [showProfileModal, setShowProfileModal] = useState(false);

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <div className="relative w-full max-w-md max-h-[80vh] overflow-y-auto rounded-lg border border-border bg-popover p-5 shadow-xl">
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute right-3 top-3 rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>

          <h2 className="mb-5 text-sm font-semibold text-foreground">Settings</h2>

          <div className="space-y-6">
            <ProfilesSection onManageProfiles={() => setShowProfileModal(true)} />

            <div className="border-t border-border" />

            <IntegrationsSection />

            <div className="border-t border-border" />

            <LfsSection />
          </div>
        </div>
      </div>

      {showProfileModal && (
        <ProfileModal onClose={() => setShowProfileModal(false)} />
      )}
    </>
  );
}
