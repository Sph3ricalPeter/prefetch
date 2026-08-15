import { useState, useEffect } from "react";
import { gravatarUrl } from "@/lib/gravatar";
import { searchUserAvatar } from "@/lib/commands";
import { rememberAvatarUrl, rememberedAvatarUrl } from "@/lib/avatar-cache";

/**
 * Resolves an avatar image URL for an email address.
 * Retries the remembered URL first, then gravatar (d=404), then the forge API.
 * Returns the loaded URL or null.
 */
export function useAvatarUrl(
  email: string | undefined,
  skip = false,
): string | null {
  const [result, setResult] = useState<{ email: string; url: string } | null>(null);

  useEffect(() => {
    if (!email || skip) return;
    let cancelled = false;

    // No crossOrigin: these only ever render into an <img>, never have their
    // pixels read back, and requiring CORS breaks forge avatars (e.g.
    // self-hosted GitLab) whose host sends no Access-Control-Allow-Origin.
    const probe = (url: string, onFail: () => void) => {
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        rememberAvatarUrl(email, url);
        setResult({ email, url });
      };
      img.onerror = onFail;
      img.src = url;
    };

    const fromGravatar = () =>
      probe(gravatarUrl(email, 80), () => {
        searchUserAvatar(email)
          .then((forgeUrl) => {
            if (forgeUrl && !cancelled) probe(forgeUrl, () => {});
          })
          .catch(() => {});
      });

    const remembered = rememberedAvatarUrl(email);
    if (remembered) probe(remembered, fromGravatar);
    else fromGravatar();

    return () => { cancelled = true; };
  }, [email, skip]);

  return email && result?.email === email ? result.url : null;
}
