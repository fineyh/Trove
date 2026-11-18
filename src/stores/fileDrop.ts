import { create } from "zustand";
import type { PathKind } from "../ipc/client";

/** Which surface is lit: the open conversation's pane, a row in the list,
 *  or the list's「新建会话」slot. The same conversation can be both a pane
 *  and a row, and only the one under the pointer should light up. */
export type DropZone = "pane" | "row" | "list";

/** Where files dragged over the window would go. Set by `data-drop` on the
 *  element under the pointer: `<zone>/conv:<id>`, `<zone>/watch:<id>` or
 *  `<zone>/new`. */
export type DropTarget =
  | { zone: DropZone; kind: "conv"; convId: number }
  | { zone: DropZone; kind: "watch"; convId: number }
  | { zone: DropZone; kind: "new" };

export interface DroppedFiles {
  paths: string[];
  /** One per path; null until the backend has looked. */
  kinds: PathKind[] | null;
}

interface FileDropState {
  /** Files being dragged over the window. */
  drag: (DroppedFiles & { target: DropTarget | null }) | null;
  /** Files waiting for the new-conversation dialog. */
  pending: DroppedFiles | null;
  setPending: (p: DroppedFiles | null) => void;
}

export const useFileDropStore = create<FileDropState>((set) => ({
  drag: null,
  pending: null,
  setPending: (p) => set({ pending: p }),
}));

export function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.zone !== b.zone || a.kind !== b.kind) return false;
  return a.kind === "new" || a.convId === (b as { convId: number }).convId;
}

/** 「3 个文件」「1 个文件夹、2 个文件」. */
export function describeDrop(f: DroppedFiles): string {
  if (!f.kinds) return `${f.paths.length} 项`;
  const folders = f.kinds.filter((k) => k === "folder").length;
  const files = f.kinds.filter((k) => k !== "folder" && k !== "missing").length;
  const parts: string[] = [];
  if (folders) parts.push(`${folders} 个文件夹`);
  if (files) parts.push(`${files} 个文件`);
  return parts.join("、") || "0 个文件";
}

/** The one folder that was dropped, if that is all there is. */
export function singleFolder(f: DroppedFiles): string | null {
  return f.kinds && f.kinds.length === 1 && f.kinds[0] === "folder" ? f.paths[0] : null;
}
