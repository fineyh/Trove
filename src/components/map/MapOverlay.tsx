import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Focus, Loader2, MapPin, Minus, PanelRightOpen, Plus, WifiOff } from "lucide-react";
import { listGeotaggedMedia, onGeoBackfillDone } from "../../ipc/client";
import { photoTime } from "../../lib/datetime";
import { cn } from "../../lib/cn";
import { useIsDark } from "../../lib/useIsDark";
import { useLibrariesStore } from "../../stores/libraries";
import { useMessagesStore } from "../../stores/messages";
import { useSessionStore } from "../../stores/session";
import type { GeotaggedMedia } from "../../types";
import { IconButton } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import { useEscapeLayer } from "../ui/Modal";
import { MapCanvas, type MapCanvasHandle } from "./MapCanvas";
import { MapPanel } from "./MapPanel";
import { MapPhotoViewer } from "./MapPhotoViewer";
import { ATTRIBUTION } from "./mapStyle";

const EMPTY: GeotaggedMedia[] = [];


interface Selection {
  items: GeotaggedMedia[];
  /** Media id of the stack's cover. */
  anchor: number;
}

/** The map of one library. Mounted per library (keyed in MapView), so nothing
 *  here can outlive a switch. */
export default function MapOverlay({ lib }: { lib: string }) {
  const setView = useSessionStore((s) => s.setView);
  const setActiveConversation = useSessionStore((s) => s.setActiveConversation);
  const openLightbox = useSessionStore((s) => s.openLightbox);
  const focusId = useSessionStore((s) => s.mapFocus);
  const libName = useLibrariesStore((s) => s.list.find((l) => l.id === lib)?.name ?? "");
  const dark = useIsDark();

  const canvasRef = useRef<MapCanvasHandle | null>(null);
  const [media, setMedia] = useState<GeotaggedMedia[]>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [inView, setInView] = useState<GeotaggedMedia[]>(EMPTY);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [viewer, setViewer] = useState<{ items: GeotaggedMedia[]; index: number } | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [basemapFailed, setBasemapFailed] = useState(false);

  // Load what has a position, and fetch again when the background read of
  // older media (run when the library opens) found more.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      listGeotaggedMedia(lib).then((m) => {
        if (cancelled) return;
        setMedia([...m].sort((a, b) => photoTime(b) - photoTime(a) || b.mediaId - a.mediaId));
      });
    load()
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    let unlisten: (() => void) | null = null;
    void onGeoBackfillDone(({ lib: l, updated }) => {
      if (cancelled || updated <= 0 || l !== lib) return;
      void load().catch(() => {});
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [lib]);

  // "Show on map" from a message or the viewer.
  useEffect(() => {
    if (focusId === null || loading) return;
    const item = media.find((m) => m.mediaId === focusId);
    if (item) {
      setPanelOpen(true);
      canvasRef.current?.focus(item);
    }
    useSessionStore.getState().clearMapFocus();
  }, [focusId, loading, media]);

  const handleSelect = useCallback((items: GeotaggedMedia[], anchor: number) => {
    setSelection({ items, anchor });
    setPanelOpen(true);
  }, []);
  const clearSelection = useCallback(() => setSelection(null), []);

  // Esc steps back out of a selected stack. Layers above (viewer, dialogs) come first.
  useEscapeLayer(selection !== null, clearSelection);

  const canvasSelection = useMemo(
    () => (selection ? { anchor: selection.anchor, count: selection.items.length } : null),
    [selection],
  );

  const handleJump = (item: GeotaggedMedia) => {
    setViewer(null);
    setView("chats");
    setActiveConversation(item.convId);
    void useMessagesStore.getState().load(item.convId);
    openLightbox(item.messageId);
  };

  const listed = selection?.items ?? inView;
  const empty = !loading && media.length === 0;
  const showPanel = panelOpen && !empty;

  return (
    <div className="fixed inset-y-0 left-16 right-0 z-40 flex border-l border-app-border bg-app">
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          data-drag-region
          className={cn(
            "flex h-[52px] shrink-0 items-center gap-2 border-b border-app-border bg-app-panel pl-2.5",
            showPanel ? "pr-2.5" : "pr-[calc(var(--wc-width)+10px)]",
          )}
        >
          {/* Back, on the left: an X here would sit right beside the window's close. */}
          <IconButton label="返回会话" icon={<ArrowLeft size={18} />} onClick={() => setView("chats")} />
          <span className="text-base font-semibold">地图</span>
          {!loading && (
            <span className="min-w-0 truncate text-xs text-app-muted">
              {libName} · {media.length.toLocaleString()}
            </span>
          )}
          <span className="flex-1" />
          {!showPanel && !empty && (
            <IconButton label="显示列表" icon={<PanelRightOpen size={16} />} onClick={() => setPanelOpen(true)} />
          )}
        </header>

        {/* `isolate`: the map's own layers stay under the viewer and dialogs. */}
        <div className="relative isolate min-h-0 flex-1">
          <MapCanvas
            ref={canvasRef}
            lib={lib}
            items={media}
            dark={dark}
            selection={canvasSelection}
            onSelect={handleSelect}
            onClear={clearSelection}
            onView={setInView}
            onBasemapError={setBasemapFailed}
          />

          {loading && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <Loader2 size={24} className="animate-spin text-app-muted" />
            </div>
          )}

          {empty && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <EmptyState
                className="rounded-2xl bg-app-panel/90 px-8 py-6 shadow-md backdrop-blur"
                icon={<MapPin size={28} strokeWidth={1.5} />}
                title="没有带位置信息的图片或视频"
              />
            </div>
          )}

          {basemapFailed && (
            <div className="pointer-events-none absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-lg border border-app-border bg-app-panel px-2.5 py-1.5 text-xs text-app-secondary shadow-md">
              <WifiOff size={13} className="text-app-warning" />
              无法加载地图，请检查网络连接
            </div>
          )}

          <div className="absolute bottom-4 right-4 z-10 flex flex-col gap-2">
            <div className="flex flex-col overflow-hidden rounded-xl border border-app-border bg-app-panel shadow-md">
              <IconButton label="放大" tipSide="left" className="rounded-none" icon={<Plus size={16} />} onClick={() => canvasRef.current?.zoomIn()} />
              <span className="mx-1.5 h-px bg-app-border" />
              <IconButton label="缩小" tipSide="left" className="rounded-none" icon={<Minus size={16} />} onClick={() => canvasRef.current?.zoomOut()} />
            </div>
            <div className="overflow-hidden rounded-xl border border-app-border bg-app-panel shadow-md">
              <IconButton
                label="显示全部"
                tipSide="left"
                className="rounded-none"
                disabled={media.length === 0}
                icon={<Focus size={16} />}
                onClick={() => canvasRef.current?.fitAll()}
              />
            </div>
          </div>

          <div className="absolute bottom-1.5 left-1.5 z-10 flex gap-1.5 rounded-md bg-app-panel/75 px-1.5 text-2xs leading-[18px] text-app-muted backdrop-blur-sm">
            {ATTRIBUTION.map((a) => (
              <a key={a.href} href={a.href} className="hover:text-app-fg">
                {a.label}
              </a>
            ))}
          </div>
        </div>
      </div>

      {showPanel && (
        <MapPanel
          lib={lib}
          items={listed}
          selected={selection !== null}
          onBack={clearSelection}
          onCollapse={() => setPanelOpen(false)}
          onOpen={(index) => setViewer({ items: listed, index })}
        />
      )}

      {viewer && (
        <MapPhotoViewer
          items={viewer.items}
          index={viewer.index}
          onClose={() => setViewer(null)}
          onIndexChange={(index) => setViewer((v) => (v ? { ...v, index } : v))}
          onJump={handleJump}
        />
      )}
    </div>
  );
}
