import { Info, MoreHorizontal, RotateCcw, RotateCw, X } from "lucide-react";
import { useEffect } from "react";
import { cn } from "../../lib/cn";
import { viewerTime } from "../../lib/datetime";
import { useInfoPanelStore } from "../../stores/infoPanel";
import { IconButton } from "../ui/Button";

interface ViewerBarProps {
  /** When the item was taken, else when it came in. */
  when: { takenAt: number | null; takenOffset: number | null; createdAt: number } | null;
  percent: number;
  zoomed: boolean;
  onResetZoom: () => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
  /** Opens the item's menu under the button. Omitted: no menu. */
  onMore?: (anchor: DOMRect) => void;
  onClose: () => void;
  /** Buttons that only this viewer has, before the info button. */
  extra?: React.ReactNode;
}

/**
 * The viewers' top bar (ADR-062): when on the left, a few tools on the right.
 * Everything else about the item lives in the info panel.
 */
export function ViewerBar({
  when,
  percent,
  zoomed,
  onResetZoom,
  onRotateLeft,
  onRotateRight,
  onMore,
  onClose,
  extra,
}: ViewerBarProps) {
  const panelOpen = useInfoPanelStore((s) => s.open);
  const togglePanel = useInfoPanelStore((s) => s.toggle);
  const loadPanel = useInfoPanelStore((s) => s.load);
  useEffect(loadPanel, [loadPanel]);

  const t = when ? viewerTime(when) : null;
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  return (
    <header
      data-drag-region
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "relative z-10 flex h-[52px] shrink-0 items-center gap-1 pl-5",
        // With the panel open its header has the window buttons' corner.
        panelOpen ? "pr-3" : "pr-[calc(var(--wc-width)+10px)]",
      )}
    >
      {t && (
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-medium text-app-fg">{t.date}</span>
          <span className="text-xs tabular-nums text-app-muted" data-tip={t.zone ?? undefined} data-tip-side="bottom">
            {t.time}
          </span>
        </div>
      )}
      <div className="flex-1" />

      {zoomed && (
        <button
          type="button"
          onClick={stop(onResetZoom)}
          className="mr-1 h-7 rounded-lg px-2 text-xs font-medium tabular-nums text-app-secondary transition-colors duration-fast hover:bg-app-hover/5 hover:text-app-fg"
          data-tip="适应窗口  0"
          data-tip-side="bottom"
        >
          {percent}%
        </button>
      )}
      <IconButton label="向左旋转" tipSide="bottom" icon={<RotateCcw size={18} />} onClick={stop(onRotateLeft)} />
      <IconButton label="向右旋转" tipSide="bottom" icon={<RotateCw size={18} />} onClick={stop(onRotateRight)} />
      <span className="mx-1.5 h-4 w-px bg-app-border" />
      {extra}
      <IconButton
        label="信息  I"
        tipSide="bottom"
        icon={<Info size={18} />}
        active={panelOpen}
        onClick={stop(togglePanel)}
      />
      {onMore && (
        <IconButton
          label="更多"
          tipSide="bottom"
          icon={<MoreHorizontal size={18} />}
          onClick={(e) => {
            e.stopPropagation();
            onMore(e.currentTarget.getBoundingClientRect());
          }}
        />
      )}
      <IconButton label="关闭  Esc" tipSide="bottom" icon={<X size={20} />} onClick={stop(onClose)} />
    </header>
  );
}

/** Keys the viewers share: not while typing (the caption), not with modifiers. */
export function viewerKey(e: KeyboardEvent): string | null {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return null;
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  return e.key;
}
