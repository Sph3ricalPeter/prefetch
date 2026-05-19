import { useState, useEffect, useCallback, useMemo } from "react";
import {
  X,
  Search,
  Lock,
  Globe,
  Download,
  Link,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Settings,
  FolderOpen,
  ChevronsUpDown,
  User,
  Check,
} from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { homeDir } from "@tauri-apps/api/path";
import { toast } from "sonner";
import { useRepoStore } from "@/stores/repo-store";
import { useProfileStore } from "@/stores/profile-store";
import { listForgeRepos, cloneRepo, checkProfileToken } from "@/lib/commands";
import { getUiState, setUiState } from "@/lib/database";
import { ForgeIcon } from "@/components/ui/forge-icons";
import { ProfileAvatar } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import type { ForgeKind, ForgeRepo } from "@/types/git";
import type { Profile } from "@/types/profile";
import type { SettingsTarget } from "@/components/ui/settings-page";

const FORGE_HOSTS: { kind: ForgeKind; host: string; label: string }[] = [
  { kind: "github", host: "github.com", label: "GitHub" },
  { kind: "gitlab", host: "gitlab.com", label: "GitLab" },
  { kind: "bitbucket", host: "bitbucket.org", label: "Bitbucket" },
];

interface CloneDialogProps {
  onClose: () => void;
  onOpenSettings?: (target?: SettingsTarget) => void;
}

type Tab = "forge" | "url";

export function CloneDialog({ onClose, onOpenSettings }: CloneDialogProps) {
  const profiles = useProfileStore((s) => s.profiles);
  const activeProfile = useProfileStore((s) => s.activeProfile);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(activeProfile);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(activeProfile ? "forge" : "url");
  const [cloneDir, setCloneDir] = useState<string | null>(null);

  const profileId = selectedProfile?.id;

  useEffect(() => {
    const key = profileId ? `clone_dir:${profileId}` : "clone_dir";
    getUiState(key).then((val) => {
      if (val) setCloneDir(val);
      else getUiState("clone_dir").then((fallback) => setCloneDir(fallback));
    });
  }, [profileId]);

  const hasProfile = selectedProfile !== null;

  const handleProfileChange = useCallback((profile: Profile | null) => {
    setSelectedProfile(profile);
    setProfileDropdownOpen(false);
    if (!profile && tab === "forge") setTab("url");
  }, [tab]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-lg max-h-[80vh] flex flex-col rounded-lg border border-border bg-popover shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <h2 className="text-sm font-semibold text-foreground">Clone Repository</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Profile selector — shared across tabs */}
        <div className="px-5 pb-3">
          <p className="text-label text-faint uppercase tracking-wider font-medium mb-1.5">Profile</p>
          <div className="relative">
            <button
              onClick={() => setProfileDropdownOpen((o) => !o)}
              className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-xs text-left hover:bg-secondary transition-colors"
            >
              {selectedProfile ? (
                <>
                  <ProfileAvatar
                    name={selectedProfile.user_name}
                    email={selectedProfile.user_email}
                    size={20}
                    color={selectedProfile.color}
                    icon={selectedProfile.icon}
                    avatarUrl={selectedProfile.avatar_url}
                  />
                  <span className="flex-1 truncate font-medium text-foreground">{selectedProfile.name}</span>
                </>
              ) : (
                <>
                  <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="flex-1 text-muted-foreground">No Profile</span>
                </>
              )}
              <ChevronsUpDown className="h-3 w-3 text-muted-foreground shrink-0" />
            </button>
            {profileDropdownOpen && (
              <>
                <div className="fixed inset-0 z-[9]" onClick={() => setProfileDropdownOpen(false)} />
                <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-popover shadow-[0_8px_30px_rgba(0,0,0,0.5)] py-1">
                  <button
                    onClick={() => handleProfileChange(null)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                  >
                    <User className="h-3.5 w-3.5 shrink-0 text-faint" />
                    <span className="flex-1 text-left truncate">No Profile</span>
                    {!selectedProfile && <Check className="h-3 w-3 shrink-0 text-primary" />}
                  </button>
                  {profiles.length > 0 && <div className="mx-2 my-1 border-t border-border" />}
                  {profiles.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => handleProfileChange(p)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-secondary transition-colors"
                      style={{ borderLeftWidth: 3, borderLeftColor: p.color }}
                    >
                      <ProfileAvatar
                        name={p.user_name}
                        email={p.user_email}
                        size={20}
                        color={p.color}
                        icon={p.icon}
                        avatarUrl={p.avatar_url}
                      />
                      <div className="flex-1 min-w-0 text-left">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-foreground">{p.name}</span>
                        </div>
                        <span className="block truncate text-label text-dim">{p.user_email}</span>
                      </div>
                      {selectedProfile?.id === p.id && <Check className="h-3 w-3 shrink-0 text-primary" />}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-5 pb-3">
          {hasProfile ? (
            <TabPill active={tab === "forge"} onClick={() => setTab("forge")}>
              <Download className="h-3 w-3" />
              Accounts
            </TabPill>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <TabPill active={false} onClick={() => {}} disabled>
                    <Download className="h-3 w-3" />
                    Accounts
                  </TabPill>
                </span>
              </TooltipTrigger>
              <TooltipContent>Requires profile with auth</TooltipContent>
            </Tooltip>
          )}
          <TabPill active={tab === "url"} onClick={() => setTab("url")}>
            <Link className="h-3 w-3" />
            URL
          </TabPill>
        </div>

        <div className="border-t border-border" />

        {/* Content */}
        {tab === "forge" ? (
          <ForgeTab selectedProfile={selectedProfile} cloneDir={cloneDir} onClose={onClose} onOpenSettings={onOpenSettings} />
        ) : (
          <UrlTab cloneDir={cloneDir} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

function TabPill({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        disabled
          ? "text-faint cursor-not-allowed opacity-50"
          : active
            ? "bg-secondary text-foreground"
            : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// ── Forge tab — wizard flow ──────────────────────────────────────────────────

type ForgeStep = "pick-provider" | "pick-repo";

function ForgeTab({ selectedProfile, cloneDir, onClose, onOpenSettings }: { selectedProfile: Profile | null; cloneDir: string | null; onClose: () => void; onOpenSettings?: (target?: SettingsTarget) => void }) {
  const profileId = selectedProfile?.id ?? undefined;

  const [step, setStep] = useState<ForgeStep>("pick-provider");
  const [selectedHost, setSelectedHost] = useState<typeof FORGE_HOSTS[0] | null>(null);
  const [repos, setRepos] = useState<ForgeRepo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<ForgeRepo | null>(null);
  const [targetPath, setTargetPath] = useState("");
  const [tokenStatus, setTokenStatus] = useState<Record<string, boolean>>({});
  const [checkingTokens, setCheckingTokens] = useState(true);

  // Check which hosts have tokens when profile changes
  useEffect(() => {
    if (!profileId) {
      setTokenStatus({});
      setCheckingTokens(false);
      return;
    }
    setCheckingTokens(true);
    let cancelled = false;
    Promise.all(
      FORGE_HOSTS.map((h) =>
        checkProfileToken(profileId, h.host)
          .then((ok) => [h.host, ok] as const)
          .catch(() => [h.host, false] as const),
      ),
    ).then((results) => {
      if (cancelled) return;
      setTokenStatus(Object.fromEntries(results));
      setCheckingTokens(false);
    });
    return () => { cancelled = true; };
  }, [profileId]);

  const selectProvider = useCallback(async (host: typeof FORGE_HOSTS[0]) => {
    setSelectedHost(host);
    setStep("pick-repo");
    setLoading(true);
    setError(null);
    setRepos([]);
    setSelectedRepo(null);
    setFilter("");
    try {
      const r = await listForgeRepos(host.host, profileId);
      setRepos(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  const goBack = useCallback(() => {
    setStep("pick-provider");
    setSelectedHost(null);
    setRepos([]);
    setSelectedRepo(null);
    setFilter("");
    setError(null);
    setTargetPath("");
  }, []);

  // Set default target path when a repo is selected
  useEffect(() => {
    if (!selectedRepo) return;
    (cloneDir ? Promise.resolve(cloneDir) : homeDir().then((h) => `${h}repos/`))
      .then((dir) => setTargetPath(`${dir}${selectedRepo.name}`))
      .catch(() => setTargetPath(selectedRepo.name));
  }, [selectedRepo, cloneDir]);

  const filteredRepos = useMemo(() => {
    if (!filter) return repos;
    const lower = filter.toLowerCase();
    return repos.filter(
      (r) =>
        r.name.toLowerCase().includes(lower) ||
        r.full_name.toLowerCase().includes(lower) ||
        (r.description?.toLowerCase().includes(lower) ?? false),
    );
  }, [repos, filter]);

  const handleBrowse = useCallback(async () => {
    const selected = await open({ directory: true, title: "Choose clone destination" });
    if (selected) {
      const repoName = selectedRepo?.name ?? "";
      setTargetPath(repoName ? `${selected}/${repoName}` : selected);
    }
  }, [selectedRepo]);

  // ── Step 1: Pick provider ──────────────────────────────────────────────

  // Reset to pick-provider when profile changes
  useEffect(() => {
    setStep("pick-provider");
    setSelectedHost(null);
    setRepos([]);
    setSelectedRepo(null);
  }, [profileId]);

  if (step === "pick-provider") {
    return (
      <div className="p-5 space-y-2">
        <p className="text-label text-faint uppercase tracking-wider font-medium mb-1.5">Providers</p>
        {checkingTokens ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {FORGE_HOSTS.map((h) => {
              const hasToken = tokenStatus[h.host];
              return (
                <button
                  key={h.host}
                  onClick={() => hasToken && selectProvider(h)}
                  disabled={!hasToken}
                  className={`group flex w-full items-center gap-3 rounded-md border px-4 py-3 text-left transition-colors ${
                    hasToken
                      ? "border-border hover:bg-secondary hover:border-border cursor-pointer"
                      : "border-border/50 opacity-60 cursor-not-allowed"
                  }`}
                >
                  <ForgeIcon kind={h.kind} className="h-5 w-5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium text-foreground">{h.label}</span>
                    <p className="text-label text-muted-foreground">
                      {hasToken ? "Browse your repositories" : "No token configured"}
                    </p>
                  </div>
                  {hasToken ? (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
                  ) : (
                    <span className="text-label text-faint shrink-0">Not connected</span>
                  )}
                </button>
              );
            })}

            {/* Link to settings if any host is missing a token */}
            {Object.values(tokenStatus).some((v) => !v) && (
              <div className="pt-2 flex items-center justify-center">
                <button
                  onClick={() => { onClose(); onOpenSettings?.({ tab: "profiles" }); }}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Settings className="h-3 w-3" />
                  Connect accounts in Settings → Profiles
                </button>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  // ── Step 2: Pick repo ──────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-0">
      {/* Sub-header with back button */}
      <div className="flex items-center gap-2 px-5 py-3">
        <button
          onClick={goBack}
          className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <ForgeIcon kind={selectedHost?.kind ?? null} className="h-3.5 w-3.5" />
        <span className="text-xs font-medium text-foreground">{selectedHost?.label}</span>
        <span className="text-xs text-muted-foreground">
          {!loading && `· ${repos.length} repositories`}
        </span>
      </div>

      {/* Search */}
      <div className="px-5 pb-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Filter repositories..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full rounded-md bg-background border border-border pl-7 pr-2.5 py-1.5 text-xs text-foreground placeholder:text-faint outline-none focus:ring-1 focus:ring-ring transition-colors"
            autoFocus
          />
        </div>
      </div>

      {/* Repo list */}
      <div className="border-t border-border flex-1 min-h-0 overflow-y-auto max-h-[260px]">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="ml-2 text-xs text-muted-foreground">Loading repositories...</span>
          </div>
        )}
        {error && (
          <p className="py-6 text-xs text-destructive text-center px-5">{error}</p>
        )}
        {!loading && !error && filteredRepos.length === 0 && (
          <p className="py-6 text-xs text-muted-foreground text-center">
            {filter ? "No matching repositories" : "No repositories found"}
          </p>
        )}
        {!loading && (
          <div className="p-2">
            {filteredRepos.map((repo) => (
              <button
                key={repo.full_name}
                onClick={() => setSelectedRepo(repo)}
                className={`w-full text-left rounded-md px-3 py-2 transition-colors ${
                  selectedRepo?.full_name === repo.full_name
                    ? "bg-secondary ring-1 ring-ring"
                    : "hover:bg-secondary/60"
                }`}
              >
                <div className="flex items-center gap-2">
                  {repo.is_private ? (
                    <Lock className="h-3 w-3 text-yellow-500 shrink-0" />
                  ) : (
                    <Globe className="h-3 w-3 text-muted-foreground shrink-0" />
                  )}
                  <span className="text-xs font-medium text-foreground truncate">
                    {repo.full_name}
                  </span>
                </div>
                {repo.description && (
                  <p className="mt-0.5 text-label text-muted-foreground truncate pl-5">
                    {repo.description}
                  </p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Clone footer — only show when a repo is selected */}
      {selectedRepo && (
        <CloneFooter
          targetPath={targetPath}
          setTargetPath={setTargetPath}
          onBrowse={handleBrowse}
          cloneUrl={selectedRepo.clone_url_https}
          profileId={profileId}
          cloneProfile={selectedProfile}
          onClose={onClose}
        />
      )}
    </div>
  );
}

// ── URL tab ──────────────────────────────────────────────────────────────────

function UrlTab({ cloneDir, onClose }: { cloneDir: string | null; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [targetPath, setTargetPath] = useState("");

  // Derive repo name from URL for default target path
  useEffect(() => {
    if (!url) return;
    const match = url.match(/\/([^/]+?)(?:\.git)?$/);
    if (match) {
      const repoName = match[1];
      (cloneDir ? Promise.resolve(cloneDir) : homeDir().then((h) => `${h}repos/`))
        .then((dir) => setTargetPath(`${dir}${repoName}`))
        .catch(() => setTargetPath(repoName));
    }
  }, [url, cloneDir]);

  const handleBrowse = useCallback(async () => {
    const selected = await open({ directory: true, title: "Choose clone destination" });
    if (selected) {
      const match = url.match(/\/([^/]+?)(?:\.git)?$/);
      const repoName = match?.[1] ?? "";
      setTargetPath(repoName ? `${selected}/${repoName}` : selected);
    }
  }, [url]);

  return (
    <div className="flex flex-col">
      {/* URL input */}
      <div className="p-5 space-y-3">
        <div>
          <label className="block text-label text-muted-foreground mb-1.5">Repository URL</label>
          <input
            type="text"
            placeholder="https://github.com/owner/repo.git"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full rounded-md bg-background border border-border px-2.5 py-1.5 text-xs text-foreground placeholder:text-faint outline-none focus:ring-1 focus:ring-ring transition-colors"
            autoFocus
          />
          <p className="mt-1.5 text-label text-faint">HTTPS or SSH clone URL</p>
        </div>
      </div>

      {/* Clone footer — always visible once URL is entered */}
      {url && (
        <CloneFooter
          targetPath={targetPath}
          setTargetPath={setTargetPath}
          onBrowse={handleBrowse}
          cloneUrl={url}
          onClose={onClose}
        />
      )}
    </div>
  );
}

// ── Shared clone footer ──────────────────────────────────────────────────────

function CloneFooter({
  targetPath,
  setTargetPath,
  onBrowse,
  cloneUrl,
  profileId,
  cloneProfile,
  onClose,
}: {
  targetPath: string;
  setTargetPath: (p: string) => void;
  onBrowse: () => void;
  cloneUrl: string;
  profileId?: string;
  cloneProfile?: Profile | null;
  onClose: () => void;
}) {
  const openRepository = useRepoStore((s) => s.openRepository);
  const [cloning, setCloning] = useState(false);

  const handleClone = useCallback(async () => {
    if (!cloneUrl || !targetPath || cloning) return;

    setCloning(true);
    const toastId = toast.loading("Cloning...");
    const unlisten = await listen<string>("git_progress", (event) => {
      toast.loading(event.payload, { id: toastId });
    });

    try {
      await cloneRepo(cloneUrl, targetPath, profileId);
      // Remember the parent directory for next clone
      const sep = targetPath.includes("\\") ? "\\" : "/";
      const lastSep = targetPath.lastIndexOf(sep);
      if (lastSep > 0) {
        const parentDir = targetPath.slice(0, lastSep + 1);
        if (profileId) setUiState(`clone_dir:${profileId}`, parentDir);
        setUiState("clone_dir", parentDir);
      }
      toast.success("Clone complete", { id: toastId });
      onClose();
      await openRepository(targetPath);
      // Activate the profile that was used for cloning so the repo inherits
      // the token association (autoSwitchForRepo deactivates because the new
      // repo has no saved profile yet).
      if (cloneProfile) {
        await useProfileStore.getState().activateProfile(cloneProfile);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg, { id: toastId });
    } finally {
      unlisten();
      setCloning(false);
    }
  }, [cloneUrl, targetPath, profileId, cloneProfile, cloning, onClose, openRepository]);

  return (
    <div className="border-t border-border px-5 py-4 space-y-3">
      <div>
        <label className="block text-label text-muted-foreground mb-1.5">Destination</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={targetPath}
            onChange={(e) => setTargetPath(e.target.value)}
            className="flex-1 rounded-md bg-background border border-border px-2.5 py-1.5 text-xs text-foreground placeholder:text-faint outline-none focus:ring-1 focus:ring-ring transition-colors"
            placeholder="/path/to/clone"
          />
          <button
            onClick={onBrowse}
            className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <button
        onClick={handleClone}
        disabled={!targetPath || cloning}
        className="w-full rounded-md bg-accent-foreground px-3 py-1.5 text-xs font-medium text-background transition-colors hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
      >
        {cloning ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            Cloning...
          </>
        ) : (
          <>
            <Download className="h-3 w-3" />
            Clone
          </>
        )}
      </button>
    </div>
  );
}
