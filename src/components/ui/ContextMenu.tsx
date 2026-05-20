import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  variant?: "danger" | "default";
  disabled?: boolean;
  onClick: () => void;
}

interface ContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

const MARGIN = 4;

export function ContextMenu({ open, x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    if (!open) return;
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + rect.width + MARGIN > vw) left = Math.max(MARGIN, vw - rect.width - MARGIN);
    if (top + rect.height + MARGIN > vh) top = Math.max(MARGIN, vh - rect.height - MARGIN);
    setPos({ left, top });
  }, [open, x, y]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    const onResize = () => onClose();
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("contextmenu", onMouseDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("contextmenu", onMouseDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      ref={menuRef}
      style={{ position: "fixed", left: pos.left, top: pos.top }}
      className="z-50 min-w-[10rem] overflow-hidden rounded-md border border-app-border bg-app-panel py-1 shadow-lg"
      role="menu"
    >
      {items.map((item, idx) => {
        const danger = item.variant === "danger";
        return (
          <button
            key={idx}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onClick();
            }}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              danger
                ? "text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                : "text-app-fg hover:bg-app-subtle",
            )}
          >
            {item.icon && <span className="flex h-4 w-4 items-center justify-center">{item.icon}</span>}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
