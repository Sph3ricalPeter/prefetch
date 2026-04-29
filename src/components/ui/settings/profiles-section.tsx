import { useState, useEffect, type KeyboardEvent } from "react";
import {
  Plus,
  Trash2,
  ChevronLeft,
  FolderOpen,
  Star,
  KeyRound,
  X,
  CheckCircle,
  AlertCircle,
  Globe,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { useProfileStore } from "@/stores/profile-store";
import { useRepoStore } from "@/stores/repo-store";
import { gravatarUrl } from "@/lib/gravatar";
import {
  saveForgeToken as saveForgeTokenCmd,
  deleteForgeToken as deleteForgeTokenCmd,
  checkProfileToken,
  openUrl,
} from "@/lib/commands";
import type { Profile, ProfilePath } from "@/types/profile";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";

// ── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "?";
}

function AvatarPreview({ email, name }: { email: string; name: string }) {
  const src = gravatarUrl(email, 80);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!email) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => { if (!cancelled) setLoadedSrc(src); };
    img.onerror = () => {};
    img.src = src;
    return () => { cancelled = true; };
  }, [src, email]);

  if (loadedSrc === src) {
    return (
      <img src={src} alt={name} className="h-10 w-10 rounded-full shrink-0" />
    );
  }
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/20 text-sm font-bold text-primary">
      {name ? getInitials(name) : "?"}
    </div>
  );
}

// ── Profile list ────────────────────────────────────────────────────────────

function ProfileList({
  onEdit,
}: {
  onEdit: (profile: Profile | null) => void;
}) {
  const profiles = useProfileStore((s) => s.profiles);
  const activeProfile = useProfileStore((s) => s.activeProfile);
  const deleteProfile = useProfileStore((s) => s.deleteProfile);

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
            >
              <AvatarPreview email={profile.user_email} name={profile.user_name} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-foreground truncate">
                    {profile.name}
                  </span>
                  {profile.is_default && (
                    <Star className="h-2.5 w-2.5 text-yellow-500 shrink-0 fill-yellow-500" />
                  )}
                  {activeProfile?.id === profile.id && (
                    <span className="rounded bg-primary/20 px-1 py-0.5 text-caption text-primary shrink-0">
                      active
                    </span>
                  )}
                </div>
                <p className="text-label text-muted-foreground truncate">
                  {profile.user_email}
                </p>
              </div>
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
  const [paths, setPaths] = useState<ProfilePath[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      getPathsForProfile(profile.id).then(setPaths).catch(() => {});
    }
  }, [profile, getPathsForProfile]);

  const canSave = name.trim().length > 0 && userName.trim().length > 0 && userEmail.trim().length > 0;

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
        });
      } else {
        await createProfile({
          name: name.trim(),
          user_name: userName.trim(),
          user_email: userEmail.trim(),
          ssh_key_path: sshKeyPath.trim() || null,
          is_default: isDefault,
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

  return (
    <div>
      {/* Back header */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={onBack}
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
          <AvatarPreview email={userEmail} name={userName || name} />
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
          <p className="text-caption text-faint">
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
            <p className="text-caption text-faint">
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
              <p className="text-caption text-faint italic">
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
        <p className="text-caption text-faint -mt-2 ml-5.5">
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
            onClick={onBack}
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

const FORGE_HOSTS = [
  { host: "github.com", label: "GitHub", tokenDocsUrl: "https://github.com/settings/tokens", placeholder: "ghp_...", scopes: ["repo — push, pull, fetch, PR detection"] },
  { host: "gitlab.com", label: "GitLab", tokenDocsUrl: "https://gitlab.com/-/user_settings/personal_access_tokens/legacy/new", placeholder: "glpat-...", scopes: ["read_api — PR/MR detection", "write_repository — push, pull, fetch"] },
];

function ForgeTokensSection({ profileId }: { profileId: string }) {
  const [tokenStatus, setTokenStatus] = useState<Record<string, boolean>>({});
  const [editingHost, setEditingHost] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [saving, setSaving] = useState(false);
  const loadForgeStatus = useRepoStore((s) => s.loadForgeStatus);

  // Check token status for each host
  useEffect(() => {
    for (const { host } of FORGE_HOSTS) {
      checkProfileToken(profileId, host)
        .then((has) => setTokenStatus((prev) => ({ ...prev, [host]: has })))
        .catch(() => {});
    }
  }, [profileId]);

  const handleSave = async (host: string) => {
    if (!tokenInput.trim()) return;
    setSaving(true);
    try {
      await saveForgeTokenCmd(host, tokenInput.trim(), profileId);
      setTokenStatus((prev) => ({ ...prev, [host]: true }));
      setEditingHost(null);
      setTokenInput("");
      toast.success("Token saved");
      loadForgeStatus().catch(() => {});
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (host: string) => {
    try {
      await deleteForgeTokenCmd(host, profileId);
      setTokenStatus((prev) => ({ ...prev, [host]: false }));
      toast.success("Token removed");
      loadForgeStatus().catch(() => {});
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <div className="space-y-2">
      <h3 className="text-label font-medium text-muted-foreground uppercase tracking-wider">
        Forge Tokens
      </h3>
      <p className="text-caption text-faint">
        Personal Access Tokens for GitHub/GitLab. Applies to all repos accessed with this profile.
      </p>

      <div className="space-y-2">
        {FORGE_HOSTS.map(({ host, label, tokenDocsUrl, placeholder, scopes }) => {
          const hasToken = tokenStatus[host] ?? false;
          const isEditing = editingHost === host;

          return (
            <div key={host} className="rounded-md border border-border px-3 py-2.5 space-y-2">
              {/* Host header */}
              <div className="flex items-center gap-2">
                <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-xs font-medium text-foreground flex-1">{label}</span>
                {hasToken ? (
                  <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5 text-faint shrink-0" />
                )}
              </div>

              {/* Token state */}
              {isEditing ? (
                <div className="space-y-2">
                  <div className="rounded bg-secondary px-2.5 py-2 text-caption text-muted-foreground space-y-0.5">
                    <p className="font-medium">Required scopes:</p>
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
                  <button
                    onClick={() => { setEditingHost(host); setTokenInput(""); }}
                    className="flex-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
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
              ) : (
                <button
                  onClick={() => { setEditingHost(host); setTokenInput(""); }}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  Add token
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); openUrl(tokenDocsUrl); }}
                    className="ml-1 text-primary hover:underline"
                  >
                    (create one)
                  </button>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Exported section ────────────────────────────────────────────────────────

export function ProfilesSection() {
  const [editingProfile, setEditingProfile] = useState<Profile | null | "new">(null);

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
