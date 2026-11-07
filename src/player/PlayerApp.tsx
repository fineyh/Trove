import { LogicalSize, currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { Loader2, Pin, RotateCcw, RotateCw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { RotatableVideo } from "../components/ui/RotatableVideo";
import { cn } from "../lib/cn";
import { useDisplayableImageUrl } from "../lib/useDisplayableImageUrl";
import { useViewerTransform } from "../lib/useViewerTransform";
import { PLAYER_TITLEBAR_HEIGHT } from "./layout";

/** Don't let the popup exceed this fraction of the monitor's work area. */
const MAX_SCREEN_FRACTION = 0.9;

// Fixed for the window's lifetime: one window shows one item.
const params = new URLSearchParams(location.search);
const SRC = params.get("src") ?? "";
const TITLE = params.get("title") ?? "";
const KIND: "video" | "image" = params.get("kind") === "image" ? "image" : "video";
const IS_HEIC = params.get("heic") === "1";

/** The picture fills the area under the title bar and follows the window size. */
const FILL = { width: "100vw", height: `calc(100vh - ${PLAYER_TITLEBAR_HEIGHT}px)` };

/** Resize the window so the media shows at its native pixel size, clamped to
 *  the current monitor while preserving aspect ratio. Best-effort. */
async function fitWindowTo(w: number, h: number): Promise<void> {
  try {
    const mon = await currentMonitor();
    if (mon) {
      const maxW = (mon.size.width / mon.scaleFactor) * MAX_SCREEN_FRACTION;
      const maxH = (mon.size.height / mon.scaleFactor) * MAX_SCREEN_FRACTION - PLAYER_TITLEBAR_HEIGHT;
      const k = Math.min(1, maxW / w, maxH / h);
      w = Math.round(w * k);
      h = Math.round(h * k);
    }
    await getCurrentWindow().setSize(new LogicalSize(w, h + PLAYER_TITLEBAR_HEIGHT));
  } catch {
    /* sizing is best-effort */
  }
}

export function PlayerApp() {
  const win = useMemo(() => getCurrentWindow(), []);
  const [pinned, setPinned] = useState(false);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  const view = useViewerTransform(SRC, { fill: FILL });
  const { rotation, zoomIn, zoomOut, resetView } = view;
  const image = useDisplayableImageUrl(KIND === "image" ? SRC : "", IS_HEIC ? "heic" : "");

  useEffect(() => {
    if (TITLE) document.title = TITLE;
  }, []);

  // Window follows the media's aspect, swapped at a quarter turn. Never while
  // fullscreen: there the picture simply fills the screen.
  useEffect(() => {
    if (!natural || document.fullscreenElement) return;
    const quarter = ((rotation % 180) + 180) % 180 !== 0;
    void (quarter ? fitWindowTo(natural.h, natural.w) : fitWindowTo(natural.w, natural.h));
  }, [natural, rotation]);

  // Image zoom keys, as in the Lightbox.
  useEffect(() => {
    if (KIND !== "image") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "+" || e.key === "=") zoomIn();
      else if (e.key === "-" || e.key === "_") zoomOut();
      else if (e.key === "0") resetView();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomIn, zoomOut, resetView]);

  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    void win.setAlwaysOnTop(next).catch(() => setPinned(!next));
  };

  return (
    <div className="flex h-full flex-col bg-black text-app-fg">
      <header
        data-tauri-drag-region
        className="flex shrink-0 items-center bg-app-panel pl-3"
        style={{ height: PLAYER_TITLEBAR_HEIGHT }}
      >
        <span data-tauri-drag-region className="min-w-0 flex-1 truncate text-xs text-app-secondary">
          {TITLE}
        </span>
        <TitleButton label="向左旋转" onClick={view.rotateLeft}>
          <RotateCcw size={16} />
        </TitleButton>
        <TitleButton label="向右旋转" onClick={view.rotateRight}>
          <RotateCw size={16} />
        </TitleButton>
        <TitleButton label={pinned ? "取消置顶" : "置顶"} onClick={togglePin} active={pinned}>
          <Pin size={16} />
        </TitleButton>
        <TitleButton label="关闭" onClick={() => void win.close()} danger>
          <X size={16} />
        </TitleButton>
      </header>

      <main
        ref={view.stageRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
      >
        {KIND === "video" ? (
          <RotatableVideo
            src={SRC}
            autoPlay
            style={view.rotationStyle}
            rotation={rotation}
            onNaturalSize={(w, h) => setNatural({ w, h })}
          />
        ) : image.status === "error" ? (
          <div className="text-sm text-app-secondary">无法预览这个格式</div>
        ) : image.status === "loading" || !image.url ? (
          <Loader2 size={28} className="animate-spin text-app-fg/70" />
        ) : (
          <img
            ref={view.mediaRef}
            src={image.url}
            alt=""
            className="shrink-0 object-contain"
            style={view.mediaStyle}
            draggable={false}
            onLoad={(e) =>
              setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
            {...view.mediaHandlers}
          />
        )}
      </main>
    </div>
  );
}

function TitleButton({
  label,
  onClick,
  active,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      data-tip={label}
      className={cn(
        "flex h-full w-10 items-center justify-center transition-colors duration-fast",
        active ? "text-app-accent" : "text-app-secondary hover:text-app-fg",
        danger ? "hover:bg-app-danger hover:text-white" : "hover:bg-app-hover/10",
      )}
    >
      {children}
    </button>
  );
}
