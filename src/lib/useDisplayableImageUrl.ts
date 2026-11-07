// React hook wrapping the HEIC decode primitives in `heic.ts`. Kept separate so
// the React-free `heic.ts` can be imported by the lean player bundle.

import { useEffect, useState } from "react";
import { decodeHeicToUrl, isHeicExt } from "./heic";

export type ImageUrlStatus = "ready" | "loading" | "error";

export interface DisplayableImageUrl {
  url: string | null;
  status: ImageUrlStatus;
}

/**
 * Resolve a displayable `<img>` src for the original file at `url`.
 *   - Non-HEIC: returns `url` immediately (`ready`).
 *   - HEIC: decodes, reporting `loading` then `ready` (blob URL) or `error`.
 * An empty `url` is a no-op, so the hook can run before data is there.
 */
export function useDisplayableImageUrl(url: string, ext: string): DisplayableImageUrl {
  const heic = isHeicExt(ext);
  const [state, setState] = useState<DisplayableImageUrl>(() =>
    heic ? { url: null, status: "loading" } : { url, status: "ready" },
  );

  useEffect(() => {
    if (!heic || !url) {
      setState({ url, status: "ready" });
      return;
    }
    let cancelled = false;
    setState({ url: null, status: "loading" });
    decodeHeicToUrl(url)
      .then((u) => {
        if (!cancelled) setState({ url: u, status: "ready" });
      })
      .catch(() => {
        if (!cancelled) setState({ url: null, status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [url, heic]);

  return state;
}
