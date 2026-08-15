import { gravatarUrl } from "@/lib/gravatar";
import { searchUserAvatar } from "@/lib/commands";
import {
  avatarImageCache,
  cacheAvatarImage,
  forgeAvatarAttempted,
  rememberAvatarUrl,
  rememberedAvatarUrl,
} from "@/lib/avatar-cache";

/**
 * Kick off loading the avatar for `email` into the shared cache, unless it has
 * already been attempted. A previously resolved URL is retried first; otherwise
 * gravatar, then the forge API on a 404. `onLoaded` fires when an image becomes
 * available so the caller can redraw.
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

  const accept = (img: HTMLImageElement) => {
    cacheAvatarImage(email, img);
    rememberAvatarUrl(email, img.src);
    onLoaded();
  };

  // A remembered URL is the fastest and most reliable path: no 404 probe, no
  // forge round-trip. If it no longer loads we fall through to a fresh resolve,
  // but keep the remembered URL until a new valid one replaces it.
  const remembered = rememberedAvatarUrl(email);
  if (remembered) {
    const img = new Image();
    img.onload = () => accept(img);
    img.onerror = () => resolve();
    img.src = remembered;
    return;
  }
  resolve();

  function resolve(): void {
    const img = new Image();
    img.onload = () => accept(img);
    img.onerror = () => {
      if (forgeAvatarAttempted.has(email)) return;
      forgeAvatarAttempted.add(email);
      searchUserAvatar(email)
        .then((url) => {
          if (!url) return;
          const forgeImg = new Image();
          forgeImg.onload = () => accept(forgeImg);
          forgeImg.src = url;
        })
        .catch(() => {});
    };
    img.src = gravatarUrl(email, sizePx);
  }
}
