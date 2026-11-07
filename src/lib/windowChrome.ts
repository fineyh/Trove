/**
 * The main window has no system title bar (ADR-043). The panes' own top
 * rows stand in for it: anything marked `data-drag-region` moves the window,
 * a double-click there maximizes, and `WindowControls` draws the buttons.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../hooks/useIsTauri";

/** "windows" | "macos" | "linux" | …; the browser preview counts as Windows. */
export const PLATFORM: string = (() => {
  try {
    return (window as { __TAURI_OS_PLUGIN_INTERNALS__?: { platform?: string } })
      .__TAURI_OS_PLUGIN_INTERNALS__?.platform ?? "windows";
  } catch {
    return "windows";
  }
})();

/** macOS keeps its own traffic lights; elsewhere we draw the buttons. */
export const DRAWS_WINDOW_BUTTONS = PLATFORM !== "macos";

/** Clicks on these keep their own meaning inside a drag region. */
const INTERACTIVE =
  "button, a, input, textarea, select, label, [role='button'], [role='menuitem'], [contenteditable='true'], [data-no-drag]";

export function installWindowChrome(): void {
  document.documentElement.dataset.platform = PLATFORM;
  if (!isTauri()) return;

  document.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const target = e.target instanceof Element ? e.target : null;
    const region = target?.closest("[data-drag-region]");
    if (!region) return;
    const hit = target!.closest(INTERACTIVE);
    if (hit && region.contains(hit)) return;
    e.preventDefault();
    const win = getCurrentWindow();
    // Same split Tauri's own drag regions use: the OS drag loop swallows the
    // second click's mouseup, so the double-click is read off `detail`.
    void (e.detail === 2 ? win.toggleMaximize() : win.startDragging()).catch(() => {});
  });
}
