/**
 * Make the WebView behave like a desktop app window rather than a web page:
 * no browser context menu on empty space, no reload / print / page zoom /
 * history shortcuts, no dragging images and links out of the window.
 *
 * Shared by the main window and the player popups. Our own handlers still run:
 * only the browser's default action is cancelled, never propagation.
 */

const DEV = import.meta.env.DEV;

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) {
    return !el.readOnly && !el.disabled && !["checkbox", "radio", "range", "button", "submit", "color", "file"].includes(el.type);
  }
  return false;
}

function hasSelection(): boolean {
  const s = window.getSelection();
  return !!s && !s.isCollapsed && s.toString().trim().length > 0;
}

/** Browser shortcuts that mean nothing in Trove. */
function isBrowserShortcut(e: KeyboardEvent): boolean {
  const k = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  if (k === "f5" || k === "f3" || k === "f7" || k === "browserback" || k === "browserforward") return true;
  if (e.altKey && (k === "arrowleft" || k === "arrowright" || k === "home")) return true;
  if (mod && ["r", "p", "s", "u", "g", "j", "h", "o", "n", "t", "w", "f", "=", "+", "-", "0"].includes(k)) {
    // Ctrl+F / Ctrl+N are left to the app's own handlers (they call
    // preventDefault-independent logic); here we only stop the browser.
    return true;
  }
  if (!DEV && (k === "f12" || (mod && e.shiftKey && ["i", "j", "c"].includes(k)))) return true;
  return false;
}

export function installNativeShell(): void {
  // Capture phase on window runs before React's root listeners, but we only
  // cancel the default action, so React handlers still see the event.
  window.addEventListener(
    "keydown",
    (e) => {
      if (isBrowserShortcut(e)) e.preventDefault();
    },
    true,
  );

  // Bubble phase: a component that showed its own menu already called
  // preventDefault. Text fields and selected text are left to TextEditMenu.
  document.addEventListener("contextmenu", (e) => {
    if (e.defaultPrevented) return;
    if (isEditable(e.target) || hasSelection()) return;
    if (DEV && e.shiftKey) return; // Shift+right-click → Inspect, in dev only
    e.preventDefault();
  });

  // Ctrl+wheel / pinch would zoom the whole page.
  window.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) e.preventDefault();
    },
    { passive: false },
  );

  document.addEventListener("dragstart", (e) => {
    const t = e.target;
    if (t instanceof HTMLElement && t.getAttribute("draggable") === "true") return;
    if (t instanceof HTMLImageElement || t instanceof HTMLAnchorElement || t instanceof Text) e.preventDefault();
    else if (t instanceof HTMLElement && t.closest("a, img")) e.preventDefault();
  });

  // Middle-click on a link would open a new browser window.
  document.addEventListener("auxclick", (e) => {
    if (e.button === 1) e.preventDefault();
  });
}
