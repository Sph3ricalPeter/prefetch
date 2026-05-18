import { useState, useEffect } from "react";
import { gravatarUrl } from "@/lib/gravatar";
import { searchUserAvatar } from "@/lib/commands";

/**
 * Resolves an avatar image URL for an email address.
 * Tries gravatar (d=404) first, then the forge API as fallback.
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
    const src = gravatarUrl(email, 80);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (!cancelled) setResult({ email, url: src });
    };
    img.onerror = () => {
      searchUserAvatar(email)
        .then((forgeUrl) => {
          if (!cancelled && forgeUrl) {
            const forgeImg = new Image();
            forgeImg.crossOrigin = "anonymous";
            forgeImg.onload = () => {
              if (!cancelled) setResult({ email, url: forgeUrl });
            };
            forgeImg.onerror = () => {};
            forgeImg.src = forgeUrl;
          }
        })
        .catch(() => {});
    };
    img.src = src;
    return () => { cancelled = true; };
  }, [email, skip]);

  return email && result?.email === email ? result.url : null;
}
