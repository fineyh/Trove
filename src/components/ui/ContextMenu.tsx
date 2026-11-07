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

/** A menu entry, or a divider between groups. */
export type ContextMenuEntry = ContextMenuItem | "separator";

interface ContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}

const MARGIN = 6;

export function ContextMenu({ open, x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width + MARGIN > window.innerWidth) left = Math.max(MARGIN, x - rect.width);
    if (top + rect.height + MARGIN > window.innerHeight) top = Math.max(MARGIN, window.innerHeight - rect.height - MARGIN);
    setPos({ left, top });
  }, [open, x, y]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("contextmenu", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("contextmenu", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [open, onClose]);

  if (!open) return null;

  // Drop leading / trailing / doubled separators left by conditional items.
  const entries = items.filter(
    (it, i, arr) => it !== "separator" || (i > 0 && i < arr.length - 1 && arr[i - 1] !== "separator"),
  );

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      style={{ position: "fixed", left: pos?.left ?? x, top: pos?.top ?? y, visibility: pos ? "visible" : "hidden" }}
      className="z-[70] min-w-[180px] animate-menu-in rounded-xl bg-app-panel p-1 shadow-lg ring-1 ring-black/[0.06] dark:ring-white/10"
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((item, idx) =>
        item === "separator" ? (
          <div key={`sep-${idx}`} role="separator" className="mx-2 my-1 h-px bg-app-border" />
        ) : (
          <button
            key={idx}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              if (!item.disabled) item.onClick();
            }}
            className={cn(
              "flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm transition-colors duration-fast",
              "disabled:pointer-events-none disabled:opacity-40",
              item.variant === "danger"
                ? "text-app-danger hover:bg-app-danger/10"
                : "text-app-fg hover:bg-app-hover/[0.06]",
            )}
          >
            {item.icon && (
              <span
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center",
                  item.variant === "danger" ? "" : "text-app-secondary",
                )}
              >
                {item.icon}
              </span>
            )}
            <span className="truncate">{item.label}</span>
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
