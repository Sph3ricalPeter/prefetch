import { gravatarUrl } from "@/lib/gravatar";
import { searchUserAvatar } from "@/lib/commands";
import { avatarImageCache, forgeAvatarAttempted } from "@/lib/avatar-cache";

/**
 * Kick off loading the avatar for `email` into the shared cache, unless it has
 * already been attempted. Tries gravatar first, then the forge API on a 404.
 * `onLoaded` fires when an image becomes available so the caller can redraw.
 *
 * Keyed by email so a repo with many commits but few authors only loads each
 * avatar once. Intended to be called from a prefetch pass, NOT the draw loop —
 * see issue #70.
 */
export function loadAvatarForEmail(
  email: string,
  sizePx: number,
  onLoaded: () => void,
): void {
  // undefined = never tried; null = pending/failed; Image = loaded.
  if (avatarImageCache.get(email) !== undefined) return;
  avatarImageCache.set(email, null);

  const img = new Image();
  img.src = gravatarUrl(email, sizePx);
  img.onload = () => {
    avatarImageCache.set(email, img);
    onLoaded();
  };
  img.onerror = () => {
    if (forgeAvatarAttempted.has(email)) return;
    forgeAvatarAttempted.add(email);
    searchUserAvatar(email)
      .then((url) => {
        if (!url) return;
        const forgeImg = new Image();
        forgeImg.src = url;
        forgeImg.onload = () => {
          avatarImageCache.set(email, forgeImg);
          onLoaded();
        };
      })
      .catch(() => {});
  };
}
