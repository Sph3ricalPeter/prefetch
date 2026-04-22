import { useState, useEffect, type KeyboardEvent } from "react";
import {
  X,
  Plus,
  Trash2,
  ChevronLeft,
  FolderOpen,
  Star,
  KeyRound,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useProfileStore } from "@/stores/profile-store";
import { useRepoStore } from "@/stores/repo-store";
import { gravatarUrl } from "@/lib/gravatar";
import type { Profile, ProfilePath } from "@/types/profile";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

// ── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "?";
}

/** Live gravatar preview. */
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

// ── Profile list view ───────────────────────────────────────────────────────

function ProfileListView({
  onEdit,
  onClose,
}: {
  onEdit: (profile: Profile | null) => void;
  onClose: () => void;
}) {
  const profiles = useProfileStore((s) => s.profiles);
  const activeProfile = useProfileStore((s) => s.activeProfile);
  const deleteProfile = useProfileStore((s) => s.deleteProfile);

  const handleDelete = async (e: React.MouseEvent, profile: Profile) => {
    e.stopPropagation();
    // Simple confirmation via window.confirm (Tauri apps support this)
    if (!confirm(`Delete profile "${profile.name}"? This cannot be undone.`)) {
      return;
    }
    await deleteProfile(profile.id);
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground">Profiles</h2>
        <button
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="text-xs text-muted-foreground mb-4">
        Profiles let you switch git identities, SSH keys, and forge tokens
        based on which repository you're working in.
      </p>

      {/* Profile cards */}
      <div className="space-y-1.5 mb-4">
        {profiles.length === 0 ? (
          <p className="text-xs text-faint italic py-4 text-center">
            No profiles yet. Create one to get started.
          </p>
        ) : (
          profiles.map((profile) => (
            <button
              key={profile.id}
              onClick={() => onEdit(profile)}
              className="group flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-secondary transition-colors"
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

      {/* Create button */}
      <button
        onClick={() => onEdit(null)}
        className="flex items-center gap-1.5 w-full rounded border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
      >
        <Plus className="h-3 w-3" />
        Create Profile
      </button>
    </>
  );
}

// ── Profile edit / create view ──────────────────────────────────────────────

function ProfileEditView({
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

  // Load paths when editing
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
      // If we edited the active profile, refresh identity
      if (activeProfile?.id === profile?.id) {
        loadGitIdentity().catch(() => {});
        loadForgeStatus().catch(() => {});
      }
      onBack();
    } catch {
      // Error toasts are handled by the store
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
    <>
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={onBack}
          className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h2 className="text-sm font-semibold text-foreground">
          {isEditing ? "Edit Profile" : "Create Profile"}
        </h2>
      </div>

      <div className="space-y-4" onKeyDown={handleKeyDown}>
        {/* Avatar preview + name */}
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
                  className="shrink-0 rounded border border-border p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
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

        {/* Path prefixes (only for existing profiles) */}
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
                No paths configured — profile won't auto-switch.
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
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border accent-primary"
          />
          <span className="text-xs text-muted-foreground">
            Set as default profile
          </span>
        </label>
        <p className="text-caption text-faint -mt-2 ml-5">
          The default profile is used when no path prefix matches.
        </p>

        {/* Save / Cancel */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="flex-1 rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving
              ? "Saving…"
              : isEditing
                ? "Save Changes"
                : "Create Profile"}
          </button>
          <button
            onClick={onBack}
            className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}

// ── Modal shell ─────────────────────────────────────────────────────────────

export function ProfileModal({ onClose }: { onClose: () => void }) {
  // null = list view, Profile = edit, undefined-ish = create new
  const [editingProfile, setEditingProfile] = useState<Profile | null | "new">(
    null,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="relative w-full max-w-md max-h-[80vh] overflow-y-auto rounded-lg border border-border bg-popover p-5 shadow-xl">
        {editingProfile === null ? (
          <ProfileListView
            onEdit={(profile) =>
              setEditingProfile(profile === null ? "new" : profile)
            }
            onClose={onClose}
          />
        ) : (
          <ProfileEditView
            profile={editingProfile === "new" ? null : editingProfile}
            onBack={() => setEditingProfile(null)}
          />
        )}
      </div>
    </div>
  );
}
