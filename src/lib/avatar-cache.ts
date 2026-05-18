// Module-level avatar image cache for the commit graph canvas.
// null = load attempted, pending or failed (fallback to initials).
export const avatarImageCache = new Map<string, HTMLImageElement | null>();

// Tracks emails already tried for forge avatar lookup to avoid duplicate API calls.
export const forgeAvatarAttempted = new Set<string>();

export function clearAvatarCache(): void {
  avatarImageCache.clear();
  forgeAvatarAttempted.clear();
}
