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
import { IconButton, iconButtonVariants } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";
import { open } from "@tauri-apps/plugin-dialog";
import { useProfileStore } from "@/stores/profile-store";
import { useRepoStore } from "@/stores/repo-store";
import { getInitials, getContrastColor, PROFILE_COLORS, PROFILE_ICONS } from "@/lib/avatar";
import { fetchProfileForgeAvatars } from "@/lib/forge-avatars";
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
  const loadProfiles = useProfileStore((s) => s.loadProfiles);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

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
        <IconButton variant="subtle" onClick={onClose}>
          <X className="h-4 w-4" />
        </IconButton>
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
              style={{ borderLeftWidth: 3, borderLeftColor: profile.color }}
            >
              <ProfileAvatar email={profile.user_email} name={profile.user_name} color={profile.color} icon={profile.icon} avatarUrl={profile.avatar_url} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-foreground truncate">
                    {profile.name}
                  </span>
                  {profile.is_default && (
                    <Star className="h-2.5 w-2.5 text-yellow-500 shrink-0 fill-yellow-500" />
                  )}
                  {activeProfile?.id === profile.id && (
                    <span
                      className="rounded-md px-1 py-0.5 text-caption font-medium shrink-0"
                      style={{ backgroundColor: `${profile.color}18`, color: profile.color }}
                    >
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
                    className={cn(
                      iconButtonVariants({ variant: "subtle", reveal: "fade" }),
                      "shrink-0 hover:bg-destructive/10 hover:text-destructive",
                    )}
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
        className="flex items-center gap-1.5 w-full rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
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
  const [color, setColor] = useState(profile?.color ?? PROFILE_COLORS[0]);
  const [icon, setIcon] = useState<string | null>(profile?.icon ?? null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile?.avatar_url ?? null);
  const [forgeAvatars, setForgeAvatars] = useState<Record<string, { url: string; kind: string; label: string }>>({});
  const [paths, setPaths] = useState<ProfilePath[]>([]);
  const [saving, setSaving] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // Load paths when editing
  useEffect(() => {
    if (profile) {
      getPathsForProfile(profile.id).then(setPaths).catch(() => {});
    }
  }, [profile, getPathsForProfile]);

  // Fetch forge avatar URLs for existing profiles with tokens (incl. self-hosted, #72)
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    fetchProfileForgeAvatars(profile.id)
      .then((map) => {
        if (!cancelled) setForgeAvatars(map);
      })
      .catch(() => {});
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

  const handleBack = () => {
    if (isDirty) {
      setShowDiscardConfirm(true);
    } else {
      onBack();
    }
  };

  return (
    <>
      {/* Discard changes confirmation */}
      {showDiscardConfirm && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 rounded-lg">
          <div className="rounded-lg border border-border bg-popover p-4 shadow-lg max-w-xs">
            <p className="text-sm text-foreground mb-1">Unsaved changes</p>
            <p className="text-xs text-muted-foreground mb-4">
              You have unsaved changes that will be lost.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDiscardConfirm(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors whitespace-nowrap"
              >
                Keep Editing
              </button>
              <button
                onClick={() => { setShowDiscardConfirm(false); onBack(); }}
                className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 hover:-translate-y-px transition-all whitespace-nowrap"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <IconButton variant="subtle" onClick={handleBack}>
          <ChevronLeft className="h-4 w-4" />
        </IconButton>
        <h2 className="text-sm font-semibold text-foreground">
          {isEditing ? "Edit Profile" : "Create Profile"}
        </h2>
      </div>

      <div className="space-y-4" onKeyDown={handleKeyDown}>
        {/* Avatar preview + name */}
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
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-faint outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        {/* Profile color */}
        <div>
          <label className="block text-label text-muted-foreground mb-1.5">Color</label>
          <div className="flex gap-1.5">
            {PROFILE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className="h-5 w-5 rounded-full transition-all"
                style={{
                  backgroundColor: c,
                  outline: color === c ? `2px solid ${c}` : "2px solid transparent",
                  outlineOffset: 2,
                }}
              />
            ))}
          </div>
        </div>

        {/* Avatar icon */}
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
                      <ForgeIcon kind={kind as ForgeKind} className="absolute -bottom-px -right-px h-2.5 w-2.5 rounded-xs bg-popover p-px text-muted-foreground" />
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
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-faint outline-none focus:ring-1 focus:ring-ring"
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
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-faint outline-none focus:ring-1 focus:ring-ring"
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
              className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-faint outline-none focus:ring-1 focus:ring-ring"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <IconButton
                  variant="outline"
                  onClick={handleBrowseSshKey}
                  className="shrink-0"
                >
                  <KeyRound className="h-3 w-3" />
                </IconButton>
              </TooltipTrigger>
              <TooltipContent>Browse for SSH key</TooltipContent>
            </Tooltip>
          </div>
          <p className="text-label text-faint">
            When set, git push/pull/fetch will use this key via GIT_SSH_COMMAND.
          </p>
        </div>

        {/* Path prefixes (only for existing profiles) */}
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
                    <IconButton
                      size="sm"
                      variant="subtle"
                      reveal="fade"
                      onClick={() => handleRemovePath(p.id)}
                      className="shrink-0 hover:bg-destructive/20 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </IconButton>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-label text-faint italic">
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
              ? "Saving…"
              : isEditing
                ? "Save Changes"
                : "Create Profile"}
          </button>
          <button
            onClick={handleBack}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors whitespace-nowrap"
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
