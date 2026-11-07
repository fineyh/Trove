import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { isTauri } from "../../hooks/useIsTauri";
import { cn } from "../../lib/cn";
import { DRAWS_WINDOW_BUTTONS } from "../../lib/windowChrome";

/**
 * Minimize / maximize / close, flush in the window's top-right corner so a
 * flick of the mouse into the corner still lands on close. Sized to the 52px
 * pane headers they sit in; headers keep `--wc-width` free on their right.
 * Over a dark full-window viewer (`data-immersive`) they turn light.
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const [focused, setFocused] = useState(() => document.hasFocus());

  useEffect(() => {
    if (!DRAWS_WINDOW_BUTTONS) return;
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);

    let unlisten: (() => void) | null = null;
    let cancelled = false;
    if (isTauri()) {
      const win = getCurrentWindow();
      const sync = () => void win.isMaximized().then((m) => setMaximized(m === true)).catch(() => {});
      sync();
      void win
        .onResized(sync)
        .then((fn) => {
          if (cancelled) fn();
          else unlisten = fn;
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      unlisten?.();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  if (!DRAWS_WINDOW_BUTTONS) return null;

  const win = () => getCurrentWindow();
  return (
    <div className={cn("window-controls fixed right-0 top-0 z-[1500] flex", !focused && "is-inactive")}>
      <CaptionButton label="最小化" onClick={() => void win().minimize()}>
        <path d="M0 5.5h10" />
      </CaptionButton>
      <CaptionButton label={maximized ? "向下还原" : "最大化"} onClick={() => void win().toggleMaximize()}>
        {maximized ? (
          <>
            <rect x="0.5" y="2.5" width="7" height="7" rx="1" />
            <path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" />
          </>
        ) : (
          <rect x="0.5" y="0.5" width="9" height="9" rx="1" />
        )}
      </CaptionButton>
      <CaptionButton label="关闭" close onClick={() => void win().close()}>
        <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
      </CaptionButton>
    </div>
  );
}

function CaptionButton({
  label,
  close,
  onClick,
  children,
}: {
  label: string;
  close?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      data-tip={label}
      tabIndex={-1}
      onClick={() => {
        if (isTauri()) onClick();
      }}
      className={cn("caption-button flex h-[51px] w-[46px] items-center justify-center", close && "is-close")}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

/** A 52px strip that moves the window, for screens with no header row.
 *  The parent must be positioned. */
export function DragStrip({ className }: { className?: string }) {
  return (
    <div
      data-drag-region
      className={cn("absolute inset-x-0 top-0 h-[52px]", className)}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
