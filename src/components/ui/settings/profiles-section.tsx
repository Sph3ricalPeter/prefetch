import { useState, useEffect, useCallback, type KeyboardEvent } from "react";
import {
  Plus,
  Trash2,
  ChevronLeft,
  FolderOpen,
  Star,
  KeyRound,
  X,
  Check,
  CheckCircle,
  LogIn,
  Loader2,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { useProfileStore } from "@/stores/profile-store";
import { useRepoStore } from "@/stores/repo-store";
import { getProfileForgeHosts, type ProfileForgeHost } from "@/lib/database";
import { getInitials, getContrastColor, PROFILE_COLORS, PROFILE_ICONS } from "@/lib/avatar";
import {
  saveForgeToken as saveForgeTokenCmd,
  deleteForgeToken as deleteForgeTokenCmd,
  getTokenInfo,
  openUrl,
  startOAuthFlow,
  cancelOAuthFlow,
} from "@/lib/commands";
import type { TokenInfo } from "@/lib/commands";
import type { Profile, ProfilePath } from "@/types/profile";
import type { ForgeKind } from "@/types/git";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { ProfileAvatar, IconSvg } from "@/components/ui/avatar";
import { ForgeIcon } from "@/components/ui/forge-icons";

// ── Profile list ────────────────────────────────────────────────────────────

function ProfileList({
  onEdit,
}: {
  onEdit: (profile: Profile | null) => void;
}) {
  const profiles = useProfileStore((s) => s.profiles);
  const activeProfile = useProfileStore((s) => s.activeProfile);
  const deleteProfile = useProfileStore((s) => s.deleteProfile);
  const loadProfiles = useProfileStore((s) => s.loadProfiles);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  const handleDelete = async (e: React.MouseEvent, profile: Profile) => {
    e.stopPropagation();
    if (!confirm(`Delete profile "${profile.name}"? This cannot be undone.`)) {
      return;
    }
    await deleteProfile(profile.id);
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Profiles let you switch git identities, SSH keys, and forge tokens
        based on which repository you're working in.
      </p>

      <div className="space-y-1.5">
        {profiles.length === 0 ? (
          <p className="text-xs text-faint italic py-4 text-center">
            No profiles yet. Create one to get started.
          </p>
        ) : (
          profiles.map((profile) => (
            <button
              key={profile.id}
              onClick={() => onEdit(profile)}
              className="group flex w-full items-center gap-3 rounded-md border border-border px-3 py-2.5 text-left hover:bg-secondary transition-colors"
              style={{ borderLeftWidth: 3, borderLeftColor: profile.color }}
            >
              <ProfileAvatar email={profile.user_email} name={profile.user_name} color={profile.color} icon={profile.icon} avatarUrl={profile.avatar_url} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-foreground truncate">
                    {profile.name}
                  </span>
                  {profile.is_default && (
                    <span className="flex items-center gap-0.5 rounded-sm bg-secondary px-1 py-0.5 text-caption font-medium text-muted-foreground shrink-0">
                      default
                      <Star className="h-2.5 w-2.5 fill-muted-foreground" />
                    </span>
                  )}
                </div>
                <p className="text-label text-muted-foreground truncate">
                  {profile.user_email}
                </p>
              </div>
              {activeProfile?.id === profile.id && (
                <Check className="h-3 w-3 shrink-0 text-primary" />
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    role="button"
                    onClick={(e) => handleDelete(e, profile)}
                    className="shrink-0 rounded p-1 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                  >
                    <Trash2 className="h-3 w-3" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>Delete profile</TooltipContent>
              </Tooltip>
            </button>
          ))
        )}
      </div>

      <button
        onClick={() => onEdit(null)}
        className="flex items-center gap-1.5 w-full rounded border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
      >
        <Plus className="h-3 w-3" />
        Create Profile
      </button>
    </div>
  );
}

// ── Profile edit / create ───────────────────────────────────────────────────

function ProfileEdit({
  profile,
  onBack,
}: {
  profile: Profile | null;
  onBack: () => void;
}) {
  const createProfile = useProfileStore((s) => s.createProfile);
  const updateProfile = useProfileStore((s) => s.updateProfile);
  const getPathsForProfile = useProfileStore((s) => s.getPathsForProfile);
  const addPathToProfile = useProfileStore((s) => s.addPathToProfile);
  const removePathFromProfile = useProfileStore((s) => s.removePathFromProfile);
  const activeProfile = useProfileStore((s) => s.activeProfile);
  const loadGitIdentity = useRepoStore((s) => s.loadGitIdentity);
  const loadForgeStatus = useRepoStore((s) => s.loadForgeStatus);

  const isEditing = !!profile;

  const [name, setName] = useState(profile?.name ?? "");
  const [userName, setUserName] = useState(profile?.user_name ?? "");
  const [userEmail, setUserEmail] = useState(profile?.user_email ?? "");
  const [sshKeyPath, setSshKeyPath] = useState(profile?.ssh_key_path ?? "");
  const [isDefault, setIsDefault] = useState(profile?.is_default ?? false);
  const [color, setColor] = useState(profile?.color ?? PROFILE_COLORS[0]);
  const [icon, setIcon] = useState<string | null>(profile?.icon ?? null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile?.avatar_url ?? null);
  const [forgeAvatars, setForgeAvatars] = useState<Record<string, { url: string; kind: string; label: string }>>({});
  const [paths, setPaths] = useState<ProfilePath[]>([]);
  const [saving, setSaving] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  useEffect(() => {
    if (profile) {
      getPathsForProfile(profile.id).then(setPaths).catch(() => {});
    }
  }, [profile, getPathsForProfile]);

  // Fetch forge avatar URLs for existing profiles with tokens
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    Promise.all(
      FORGE_HOSTS.map(({ host, label, kind }) =>
        getTokenInfo(profile.id, host)
          .then((info: TokenInfo | null) => ({ host, label, kind, info }))
          .catch(() => ({ host, label, kind, info: null as TokenInfo | null }))
      )
    ).then((results) => {
      if (cancelled) return;
      const map: Record<string, { url: string; kind: string; label: string }> = {};
      for (const { host, label, kind, info } of results) {
        if (info?.avatar_url) {
          map[host] = { url: info.avatar_url, kind, label };
        }
      }
      setForgeAvatars(map);
    });
    return () => { cancelled = true; };
  }, [profile]);

  const hasRequiredFields = name.trim().length > 0 && userName.trim().length > 0 && userEmail.trim().length > 0;

  const isDirty = isEditing
    ? name.trim() !== (profile?.name ?? "") ||
      userName.trim() !== (profile?.user_name ?? "") ||
      userEmail.trim() !== (profile?.user_email ?? "") ||
      (sshKeyPath.trim() || null) !== (profile?.ssh_key_path ?? null) ||
      isDefault !== (profile?.is_default ?? false) ||
      color !== (profile?.color ?? PROFILE_COLORS[0]) ||
      icon !== (profile?.icon ?? null) ||
      avatarUrl !== (profile?.avatar_url ?? null)
    : name.trim().length > 0 || userName.trim().length > 0 || userEmail.trim().length > 0;

  const canSave = hasRequiredFields && (isEditing ? isDirty : true);

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      if (isEditing && profile) {
        await updateProfile(profile.id, {
          name: name.trim(),
          user_name: userName.trim(),
          user_email: userEmail.trim(),
          ssh_key_path: sshKeyPath.trim() || null,
          is_default: isDefault,
          color,
          icon,
          avatar_url: avatarUrl,
        });
      } else {
        await createProfile({
          name: name.trim(),
          user_name: userName.trim(),
          user_email: userEmail.trim(),
          ssh_key_path: sshKeyPath.trim() || null,
          is_default: isDefault,
          color,
          icon,
          avatar_url: avatarUrl,
        });
      }
      if (activeProfile?.id === profile?.id) {
        loadGitIdentity().catch(() => {});
        loadForgeStatus().catch(() => {});
      }
      onBack();
    } catch {
      // Error toasts handled by the store
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canSave) {
      e.preventDefault();
      handleSave();
    }
  };

  const handleBrowseSshKey = async () => {
    const result = await open({
      title: "Select SSH Key",
      multiple: false,
      filters: [{ name: "All Files", extensions: ["*"] }],
    });
    if (result) {
      setSshKeyPath(result as string);
    }
  };

  const handleAddPath = async () => {
    if (!profile) return;
    const result = await open({
      title: "Select folder for this profile",
      directory: true,
      multiple: false,
    });
    if (result) {
      await addPathToProfile(profile.id, result as string);
      const updated = await getPathsForProfile(profile.id);
      setPaths(updated);
    }
  };

  const handleRemovePath = async (pathId: number) => {
    await removePathFromProfile(pathId);
    if (profile) {
      const updated = await getPathsForProfile(profile.id);
      setPaths(updated);
    }
  };

  const handleBack = () => {
    if (isDirty) {
      setShowDiscardConfirm(true);
    } else {
      onBack();
    }
  };

  return (
    <div>
      {/* Discard changes confirmation */}
      {showDiscardConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-lg border border-border bg-popover p-4 shadow-lg max-w-xs">
            <p className="text-sm text-foreground mb-1">Unsaved changes</p>
            <p className="text-xs text-muted-foreground mb-4">
              You have unsaved changes that will be lost.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDiscardConfirm(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              >
                Keep Editing
              </button>
              <button
                onClick={() => { setShowDiscardConfirm(false); onBack(); }}
                className="rounded-md bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground transition-all hover:bg-destructive/90 hover:-translate-y-px"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Back header */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={handleBack}
          className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h3 className="text-xs font-semibold text-foreground">
          {isEditing ? "Edit Profile" : "Create Profile"}
        </h3>
      </div>

      <div className="space-y-4" onKeyDown={handleKeyDown}>
        {/* Avatar + name */}
        <div className="flex items-center gap-3">
          <ProfileAvatar email={userEmail} name={userName || name} color={color} icon={icon} avatarUrl={avatarUrl} />
          <div className="flex-1">
            <label className="block text-label text-muted-foreground mb-1">
              Profile Name
            </label>
            <input
              autoFocus
              type="text"
              placeholder="e.g. Work, Personal"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-faint outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        {/* Profile color */}
        <div>
          <label className="block text-label text-muted-foreground mb-1.5">Badge Color</label>
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              {PROFILE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="h-5 w-5 rounded-full transition-all flex items-center justify-center"
                  style={{
                    backgroundColor: c,
                    boxShadow: color === c ? `0 0 0 2px hsl(var(--background)), 0 0 0 3.5px ${c}` : "none",
                    opacity: color === c ? 1 : 0.55,
                  }}
                >
                  {color === c && (
                    <Check className="h-3 w-3 text-white" strokeWidth={3} />
                  )}
                </button>
              ))}
            </div>
            <span
              className="rounded-sm px-1.5 py-0.5 text-caption font-medium"
              style={{ backgroundColor: `${color}18`, color }}
            >
              {name || "Preview"}
            </span>
          </div>
        </div>

        {/* Avatar */}
        <div>
          <label className="block text-label text-muted-foreground mb-1.5">Avatar</label>
          <div className="flex flex-wrap gap-1.5">
            {/* Forge avatar options */}
            {Object.entries(forgeAvatars).map(([host, { url, kind, label }]) => {
              const forgeKey = `forge:${host}`;
              const isSelected = icon === forgeKey;
              return (
                <Tooltip key={host}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => { setIcon(forgeKey); setAvatarUrl(url); }}
                      className="relative flex h-7 w-7 items-center justify-center rounded-md transition-all overflow-hidden"
                      style={{
                        outline: isSelected ? `2px solid ${color}` : "1px solid hsl(var(--border))",
                        outlineOffset: isSelected ? 2 : 0,
                      }}
                    >
                      <img src={url} alt={label} className="h-full w-full rounded-md object-cover" />
                      <ForgeIcon kind={kind as ForgeKind} className="absolute -bottom-px -right-px h-2.5 w-2.5 rounded-sm bg-popover p-px text-muted-foreground" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{label} avatar</TooltipContent>
                </Tooltip>
              );
            })}
            {/* Initials option */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => { setIcon(null); setAvatarUrl(null); }}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold transition-all"
                  style={{
                    backgroundColor: !icon ? color : "transparent",
                    color: !icon ? getContrastColor(color) : "hsl(var(--muted-foreground))",
                    outline: !icon ? `2px solid ${color}` : "1px solid hsl(var(--border))",
                    outlineOffset: !icon ? 2 : 0,
                  }}
                >
                  {getInitials(userName || name || "AB")}
                </button>
              </TooltipTrigger>
              <TooltipContent>Initials</TooltipContent>
            </Tooltip>
            {/* Custom icons */}
            {PROFILE_ICONS.map((def) => (
              <Tooltip key={def.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => { setIcon(def.id); setAvatarUrl(null); }}
                    className="flex h-7 w-7 items-center justify-center rounded-md transition-all"
                    style={{
                      backgroundColor: icon === def.id ? color : "transparent",
                      color: icon === def.id ? getContrastColor(color) : "hsl(var(--muted-foreground))",
                      outline: icon === def.id ? `2px solid ${color}` : "1px solid hsl(var(--border))",
                      outlineOffset: icon === def.id ? 2 : 0,
                    }}
                  >
                    <IconSvg def={def} size={16} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{def.label}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>

        {/* Git identity */}
        <div className="space-y-2">
          <h3 className="text-label font-medium text-muted-foreground uppercase tracking-wider">
            Git Identity
          </h3>
          <div>
            <label className="block text-label text-muted-foreground mb-1">
              Author Name
            </label>
            <input
              type="text"
              placeholder="Jane Doe"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className="w-full rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-faint outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
          <div>
            <label className="block text-label text-muted-foreground mb-1">
              Author Email
            </label>
            <input
              type="text"
              placeholder="jane@example.com"
              value={userEmail}
              onChange={(e) => setUserEmail(e.target.value)}
              className="w-full rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-faint outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        {/* SSH key */}
        <div className="space-y-2">
          <h3 className="text-label font-medium text-muted-foreground uppercase tracking-wider">
            SSH Key (optional)
          </h3>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              placeholder="~/.ssh/id_ed25519"
              value={sshKeyPath}
              onChange={(e) => setSshKeyPath(e.target.value)}
              className="flex-1 rounded border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-faint outline-none focus:ring-1 focus:ring-ring"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleBrowseSshKey}
                  className="shrink-0 rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                >
                  <KeyRound className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Browse for SSH key</TooltipContent>
            </Tooltip>
          </div>
          <p className="text-label text-faint">
            When set, git push/pull/fetch will use this key via GIT_SSH_COMMAND.
          </p>
        </div>

        {/* Forge tokens (only for existing profiles) */}
        {isEditing && profile && (
          <ForgeTokensSection profileId={profile.id} />
        )}

        {/* Auto-switch paths */}
        {isEditing && (
          <div className="space-y-2">
            <h3 className="text-label font-medium text-muted-foreground uppercase tracking-wider">
              Auto-switch Paths
            </h3>
            <p className="text-label text-faint">
              Repos under these folders will automatically activate this profile.
            </p>
            {paths.length > 0 ? (
              <div className="space-y-1">
                {paths.map((p) => (
                  <div
                    key={p.id}
                    className="group flex items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <FolderOpen className="h-3 w-3 shrink-0 text-faint" />
                    <span className="flex-1 font-mono truncate text-label">
                      {p.path_prefix}
                    </span>
                    <button
                      onClick={() => handleRemovePath(p.id)}
                      className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-destructive/20 hover:text-destructive transition-all"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-label text-faint italic">
                No paths configured.
              </p>
            )}
            <button
              onClick={handleAddPath}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Plus className="h-3 w-3" />
              Add folder
            </button>
          </div>
        )}

        {/* Default toggle */}
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={isDefault}
            onCheckedChange={(v) => setIsDefault(v === true)}
          />
          <span className="text-xs text-muted-foreground">
            Set as default profile
          </span>
        </label>
        <p className="text-label text-faint -mt-2 ml-5.5">
          The default profile is used when no path prefix matches.
        </p>

        {/* Save / Cancel */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="flex-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-all hover:bg-primary/90 hover:-translate-y-px disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
          >
            {saving
              ? "Saving..."
              : isEditing
                ? "Save Changes"
                : "Create Profile"}
          </button>
          <button
            onClick={handleBack}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Forge tokens per profile ────────────────────────────────────────────────

type ForgeHostSpec = { host: string; label: string; kind: ForgeKind; oauthProvider: "github" | "gitlab" | "bitbucket"; hasOAuth: boolean; tokenDocsUrl: string; placeholder: string; scopes: string[] };

const FORGE_HOSTS: ForgeHostSpec[] = [
  { host: "github.com", label: "GitHub", kind: "github", oauthProvider: "github", hasOAuth: true, tokenDocsUrl: "https://github.com/settings/tokens", placeholder: "ghp_...", scopes: ["repo — push, pull, fetch, PR detection"] },
  { host: "gitlab.com", label: "GitLab", kind: "gitlab", oauthProvider: "gitlab", hasOAuth: true, tokenDocsUrl: "https://gitlab.com/-/user_settings/personal_access_tokens/legacy/new", placeholder: "glpat-...", scopes: ["read_api — PR/MR detection", "write_repository — push, pull, fetch"] },
  { host: "bitbucket.org", label: "Bitbucket", kind: "bitbucket", oauthProvider: "bitbucket", hasOAuth: true, tokenDocsUrl: "https://bitbucket.org/account/settings/api-tokens/", placeholder: "API token", scopes: ["read/write:repository — push, pull, fetch", "read:pullrequest — PR detection", "read:user — user info"] },
];

function buildSelfHostedSpec(host: string, kind: ForgeKind): ForgeHostSpec {
  if (kind === "gitlab") {
    return {
      host,
      label: host,
      kind,
      oauthProvider: "gitlab",
      hasOAuth: false,
      tokenDocsUrl: `https://${host}/-/user_settings/personal_access_tokens`,
      placeholder: "glpat-...",
      scopes: ["read_api — PR/MR detection", "write_repository — push, pull, fetch"],
    };
  }
  // GitHub Enterprise
  return {
    host,
    label: host,
    kind,
    oauthProvider: "github",
    hasOAuth: false,
    tokenDocsUrl: `https://${host}/settings/tokens`,
    placeholder: "ghp_...",
    scopes: ["repo — push, pull, fetch, PR detection"],
  };
}

function ForgeTokensSection({ profileId }: { profileId: string }) {
  const [tokenInfos, setTokenInfos] = useState<Record<string, TokenInfo | null>>({});
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [editingHost, setEditingHost] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [oauthWaitingHost, setOauthWaitingHost] = useState<string | null>(null);
  const [profileHosts, setProfileHosts] = useState<ProfileForgeHost[]>([]);
  const loadForgeStatus = useRepoStore((s) => s.loadForgeStatus);

  // Defaults always shown (they have OAuth), plus any host this profile has repos on.
  const hosts: ForgeHostSpec[] = (() => {
    const list = [...FORGE_HOSTS];
    for (const ph of profileHosts) {
      if (!list.some((h) => h.host === ph.host)) {
        list.push(buildSelfHostedSpec(ph.host, ph.kind as ForgeKind));
      }
    }
    return list;
  })();

  const reposByHost: Record<string, { owner: string; repo: string; path: string }[]> = {};
  for (const ph of profileHosts) reposByHost[ph.host] = ph.repos;

  useEffect(() => {
    let cancelled = false;
    getProfileForgeHosts(profileId)
      .then((rows) => {
        if (!cancelled) setProfileHosts(rows);
      })
      .catch(() => {
        if (!cancelled) setProfileHosts([]);
      });
    return () => { cancelled = true; };
  }, [profileId]);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingInfo(true);
    Promise.all(
      hosts.map(({ host }) =>
        getTokenInfo(profileId, host)
          .then((info) => ({ host, info }))
          .catch(() => ({ host, info: null as TokenInfo | null }))
      )
    ).then((results) => {
      if (cancelled) return;
      const map: Record<string, TokenInfo | null> = {};
      for (const { host, info } of results) map[host] = info;
      setTokenInfos(map);
      setLoadingInfo(false);
    });
    return () => { cancelled = true; };
    // hosts is derived from profileHosts; depend on its serialised host list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, profileHosts.map((p) => p.host).join(",")]);

  const fetchHostTokenInfo = useCallback(async (host: string, retries = 2): Promise<TokenInfo | null> => {
    for (let i = 0; i <= retries; i++) {
      const info = await getTokenInfo(profileId, host).catch(() => null);
      if (info) return info;
      if (i < retries) await new Promise((r) => setTimeout(r, 600));
    }
    return null;
  }, [profileId]);

  const handleSave = async (host: string) => {
    if (!tokenInput.trim()) return;
    setSaving(true);
    try {
      await saveForgeTokenCmd(host, tokenInput.trim(), profileId);
      setEditingHost(null);
      setTokenInput("");
      toast.success("Token saved");
      loadForgeStatus().catch(() => {});
      setLoadingInfo(true);
      const info = await fetchHostTokenInfo(host);
      setTokenInfos((prev) => ({ ...prev, [host]: info }));
      setLoadingInfo(false);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (host: string) => {
    try {
      await deleteForgeTokenCmd(host, profileId);
      setTokenInfos((prev) => ({ ...prev, [host]: null }));
      toast.success("Token removed");
      loadForgeStatus().catch(() => {});
    } catch (e) {
      toast.error(String(e));
    }
  };

  const handleOAuth = async (host: string, provider: "github" | "gitlab" | "bitbucket") => {
    setOauthWaitingHost(host);
    try {
      await startOAuthFlow(provider, profileId);
      toast.success("Authenticated via OAuth");
      loadForgeStatus().catch(() => {});
      setLoadingInfo(true);
      const info = await fetchHostTokenInfo(host);
      setTokenInfos((prev) => ({ ...prev, [host]: info }));
      setLoadingInfo(false);
    } catch (e) {
      const msg = String(e);
      if (!msg.includes("cancelled")) toast.error(msg);
    } finally {
      setOauthWaitingHost(null);
    }
  };

  const handleCancelOAuth = async () => {
    await cancelOAuthFlow().catch(() => {});
    setOauthWaitingHost(null);
  };

  return (
    <div className="space-y-2">
      <h3 className="text-label font-medium text-muted-foreground uppercase tracking-wider">
        Forge Tokens
      </h3>
      <p className="text-label text-faint">
        Authenticate with GitHub, GitLab, or Bitbucket via OAuth or a token.
      </p>

      <div className="space-y-2">
        {hosts.map(({ host, label, kind, oauthProvider, hasOAuth, tokenDocsUrl, placeholder, scopes }) => {
          const info = tokenInfos[host];
          const hasToken = info != null;
          const isEditing = editingHost === host;
          const isWaiting = oauthWaitingHost === host;

          return (
            <div key={host} className="rounded-md border border-border px-3 py-2.5 space-y-2">
              {/* Host header + connected status */}
              <div className="flex items-center gap-2">
                <ForgeIcon kind={kind} className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs font-medium text-foreground">{label}</span>
                <div className="flex-1" />
                {loadingInfo ? (
                  <Loader2 className="h-3 w-3 animate-spin text-faint" />
                ) : hasToken && info ? (
                  <div className="flex items-center gap-1.5">
                    {info.token_type === "oauth" && info.avatar_url ? (
                      <img
                        src={info.avatar_url}
                        alt=""
                        className="h-4 w-4 rounded-full"
                      />
                    ) : (
                      <KeyRound className="h-3 w-3 text-muted-foreground" />
                    )}
                    <span className="text-label text-muted-foreground">
                      {info.token_type === "oauth"
                        ? `@${info.username}`
                        : "PAT connected"}
                    </span>
                    <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />
                  </div>
                ) : (
                  <span className="text-label text-faint">Not connected</span>
                )}
              </div>

              {/* Repos using this host (from this profile's recent repos) */}
              {reposByHost[host]?.length > 0 && (
                <ul className="space-y-0.5 pl-5 text-label text-muted-foreground">
                  {reposByHost[host].map((r) => (
                    <li key={r.path} className="truncate">
                      <span className="text-foreground">{r.owner}</span>
                      <span className="text-faint">/</span>
                      <span className="text-foreground">{r.repo}</span>
                    </li>
                  ))}
                </ul>
              )}

              {/* OAuth waiting state */}
              {isWaiting ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 rounded bg-secondary px-2.5 py-2 text-label text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                    <span>Waiting for authorization in browser...</span>
                  </div>
                  <button
                    onClick={handleCancelOAuth}
                    className="w-full rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : isEditing ? (
                /* Manual PAT input */
                <div className="space-y-2">
                  <div className="rounded bg-secondary px-2.5 py-2 text-label text-muted-foreground space-y-0.5">
                    <p className="font-medium">
                      Required scopes{" "}
                      <button
                        type="button"
                        onClick={() => openUrl(tokenDocsUrl)}
                        className="font-normal text-primary hover:underline"
                      >
                        (create token)
                      </button>
                    </p>
                    <ul className="list-disc list-inside">
                      {scopes.map((s) => {
                        const [code, ...desc] = s.split(" — ");
                        return (
                          <li key={s}>
                            <span className="font-mono text-foreground">{code}</span>
                            {desc.length > 0 && <span> — {desc.join(" — ")}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  <input
                    type="password"
                    placeholder={placeholder}
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSave(host);
                      if (e.key === "Escape") { setEditingHost(null); setTokenInput(""); }
                    }}
                    autoFocus
                    className="w-full rounded border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-faint outline-none focus:ring-1 focus:ring-ring"
                  />
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => handleSave(host)}
                      disabled={!tokenInput.trim() || saving}
                      className="flex-1 rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground transition-all hover:bg-primary/90 hover:-translate-y-px disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
                    >
                      {saving ? "Saving..." : "Save"}
                    </button>
                    <button
                      onClick={() => { setEditingHost(null); setTokenInput(""); }}
                      className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : hasToken ? (
                <div className="flex gap-1.5">
                  {hasOAuth && (
                    <button
                      onClick={() => handleOAuth(host, oauthProvider)}
                      className="flex-1 flex items-center justify-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                    >
                      <LogIn className="h-3 w-3" />
                      Re-login
                    </button>
                  )}
                  <button
                    onClick={() => { setEditingHost(host); setTokenInput(""); }}
                    className={`${hasOAuth ? "" : "flex-1 "}rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors`}
                  >
                    Replace
                  </button>
                  <button
                    onClick={() => handleDelete(host)}
                    className="rounded-md border border-border px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              ) : hasOAuth ? (
                <div className="flex gap-1.5">
                  <button
                    onClick={() => handleOAuth(host, oauthProvider)}
                    className="flex-1 flex items-center justify-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground transition-all hover:bg-primary/90 hover:-translate-y-px"
                  >
                    <LogIn className="h-3 w-3" />
                    Login with {label}
                  </button>
                  <button
                    onClick={() => { setEditingHost(host); setTokenInput(""); }}
                    className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                  >
                    <KeyRound className="h-3 w-3" />
                    Manual token
                  </button>
                </div>
              ) : (
                <div className="flex gap-1.5">
                  <button
                    onClick={() => { setEditingHost(host); setTokenInput(""); }}
                    className="flex-1 flex items-center gap-1 justify-center rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground transition-all hover:bg-primary/90 hover:-translate-y-px"
                  >
                    <KeyRound className="h-3 w-3" />
                    Add token
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Exported section ────────────────────────────────────────────────────────

export function ProfilesSection({ focusProfileId }: { focusProfileId?: string }) {
  const profiles = useProfileStore((s) => s.profiles);
  const [editingProfile, setEditingProfile] = useState<Profile | null | "new">(() => {
    if (!focusProfileId) return null;
    return profiles.find((p) => p.id === focusProfileId) ?? null;
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-foreground mb-1">Profiles</h2>
        <p className="text-xs text-muted-foreground">
          Manage git identities and SSH keys.
        </p>
      </div>

      {editingProfile === null ? (
        <ProfileList
          onEdit={(profile) =>
            setEditingProfile(profile === null ? "new" : profile)
          }
        />
      ) : (
        <ProfileEdit
          profile={editingProfile === "new" ? null : editingProfile}
          onBack={() => setEditingProfile(null)}
        />
      )}
    </div>
  );
}
