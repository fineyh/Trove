/**
 * Files from outside the window: dragged in, or pasted after Ctrl+C in
 * Explorer. Tauri hands over the paths (a WebView `File` has none, and Trove
 * only stores where a file is), so the drop target is found by hit-testing
 * `data-drop` under the pointer rather than with HTML drag events.
 */
import { getCurrentWebview } from "@tauri-apps/api/webview";
import * as ipc from "../ipc/client";
import { useConversationsStore } from "../stores/conversations";
import { useFileDropStore, sameTarget, type DropTarget, type DropZone, type DroppedFiles } from "../stores/fileDrop";
import { useMessagesStore } from "../stores/messages";
import { useSessionStore } from "../stores/session";
import { toast } from "../stores/toast";
import { isTauri } from "../hooks/useIsTauri";
import { isEditable } from "./nativeShell";

function parseTarget(v: string | undefined): DropTarget | null {
  const m = /^(pane|row|list)\/(?:(new)|(conv|watch):(\d+))$/.exec(v ?? "");
  if (!m) return null;
  const zone = m[1] as DropZone;
  if (m[2]) return { zone, kind: "new" };
  return { zone, kind: m[3] as "conv" | "watch", convId: Number(m[4]) };
}

/** Physical window pixels → the target under them. */
function targetAt(x: number, y: number): DropTarget | null {
  const dpr = window.devicePixelRatio || 1;
  const el = document.elementFromPoint(x / dpr, y / dpr);
  return parseTarget(el?.closest<HTMLElement>("[data-drop]")?.dataset.drop);
}

/** Add files to a conversation, or hand them to the new-conversation dialog. */
export async function deliverFiles(target: DropTarget, files: DroppedFiles): Promise<void> {
  if (files.paths.length === 0) return;
  const session = useSessionStore.getState();
  if (target.kind === "new") {
    useFileDropStore.getState().setPending(files);
    session.setNewConversationOpen(true);
    return;
  }
  if (target.kind === "watch") {
    toast.info("无法添加到同步文件夹", "同步文件夹随文件夹自动更新。");
    return;
  }
  if (session.activeConversationId !== target.convId) session.setActiveConversation(target.convId);
  try {
    await useMessagesStore.getState().importFiles(target.convId, files.paths);
  } catch (e) {
    toast.error("无法导入", e);
  }
}

/** Locked, another view, or something modal is up: files go nowhere. */
function blocked(): boolean {
  const s = useSessionStore.getState();
  return (
    s.view !== "chats" ||
    s.lightboxMessageId !== null ||
    document.querySelector("[data-drop]") === null ||
    document.querySelector('[aria-modal="true"]') !== null
  );
}

function installDrag(): void {
  const store = useFileDropStore;
  let token = 0;
  void getCurrentWebview()
    .onDragDropEvent((event) => {
      const p = event.payload;
      if (p.type === "enter") {
        const mine = ++token;
        const paths = p.paths;
        if (paths.length === 0) return; // dragging text or a link, not files
        store.setState({ drag: { paths, kinds: null, target: blocked() ? null : targetAt(p.position.x, p.position.y) } });
        void ipc.inspectPaths(paths).then((kinds) => {
          const d = store.getState().drag;
          if (mine === token && d) store.setState({ drag: { ...d, kinds } });
        });
      } else if (p.type === "over") {
        const d = store.getState().drag;
        if (!d) return;
        const target = blocked() ? null : targetAt(p.position.x, p.position.y);
        if (!sameTarget(target, d.target)) store.setState({ drag: { ...d, target } });
      } else if (p.type === "drop") {
        const d = store.getState().drag;
        token++;
        store.setState({ drag: null });
        if (!d || blocked()) return;
        const target = targetAt(p.position.x, p.position.y);
        if (!target) return;
        const paths = p.paths.length ? p.paths : d.paths;
        const same = paths.length === d.paths.length && paths.every((x, i) => x === d.paths[i]);
        void (async () => {
          const kinds = (same ? d.kinds : null) ?? (await ipc.inspectPaths(paths));
          await deliverFiles(target, { paths, kinds });
        })();
      } else {
        token++;
        store.setState({ drag: null });
      }
    })
    .catch((e) => console.error("drag-drop listener", e));
}

function installPaste(): void {
  document.addEventListener("paste", (e) => {
    if (blocked()) return;
    const types = e.clipboardData?.types ?? [];
    // Text into a text field stays an ordinary paste.
    if (isEditable(e.target) && types.includes("text/plain")) return;
    e.preventDefault();
    void (async () => {
      const paths = await ipc.clipboardFiles().catch(() => [] as string[]);
      if (paths.length === 0) {
        if (types.includes("Files")) toast.info("无法粘贴图片", "请复制文件本身，再粘贴。");
        return;
      }
      const kinds = await ipc.inspectPaths(paths);
      const s = useSessionStore.getState();
      const conv = useConversationsStore.getState().list.find((c) => c.id === s.activeConversationId);
      const target: DropTarget = !conv
        ? { zone: "pane", kind: "new" }
        : { zone: "pane", kind: conv.kind === "folder_watch" ? "watch" : "conv", convId: conv.id };
      await deliverFiles(target, { paths, kinds });
    })();
  });
}

/** Main window only: the player popups take no files. */
export function installFileDrop(): void {
  if (!isTauri()) return;
  installDrag();
  installPaste();
}
