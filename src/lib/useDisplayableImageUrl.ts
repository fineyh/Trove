// React hook wrapping the HEIC decode primitives in `heic.ts`. Kept separate so
// the React-free `heic.ts` can be imported by the lean player bundle.

import { useEffect, useState } from "react";
import { decodeHeicToUrl, isHeicPath } from "./heic";

export type ImageUrlStatus = "ready" | "loading" | "error";

export interface DisplayableImageUrl {
  url: string | null;
  status: ImageUrlStatus;
}

/**
 * Resolve a displayable `<img>` src for a media file.
 *   - Non-HEIC: returns `assetUrl` immediately (`ready`).
 *   - HEIC: kicks off a decode, reporting `loading` then `ready` (blob URL) or
 *     `error`.
 */
export function useDisplayableImageUrl(
  absolutePath: string,
  assetUrl: string,
): DisplayableImageUrl {
  const heic = isHeicPath(absolutePath);
  const [state, setState] = useState<DisplayableImageUrl>(() =>
    heic ? { url: null, status: "loading" } : { url: assetUrl, status: "ready" },
  );

  useEffect(() => {
    if (!heic) {
      setState({ url: assetUrl, status: "ready" });
      return;
    }
    let cancelled = false;
    setState({ url: null, status: "loading" });
    decodeHeicToUrl(absolutePath, assetUrl)
      .then((url) => {
        if (!cancelled) setState({ url, status: "ready" });
      })
      .catch(() => {
        if (!cancelled) setState({ url: null, status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [absolutePath, assetUrl, heic]);

  return state;
}
