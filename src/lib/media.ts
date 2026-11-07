import type { MediaPayload } from "../types";
import { isHeicExt } from "./heic";

/** HEIC/HEIF count as images whatever `kind` an older row was stored with. */
export function isImageMedia(m: Pick<MediaPayload, "kind" | "ext">): boolean {
  return m.kind === "image" || isHeicExt(m.ext);
}

export function kindLabel(m: Pick<MediaPayload, "kind" | "ext">): string {
  if (isImageMedia(m)) return "图片";
  if (m.kind === "video") return "视频";
  return "文件";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
