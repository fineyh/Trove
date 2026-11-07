import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * One tooltip for the whole app, driven by `data-tip` attributes instead of
 * the native `title` (which renders as the OS's system tip).
 *
 *   <button data-tip="设置" data-tip-side="right">…</button>
 *
 * Shows after a short delay; once one is visible, moving to the next control
 * shows its tip at once, like native toolbars.
 */
type Side = "top" | "bottom" | "left" | "right";

const DELAY = 450;
const WARM_MS = 400;
const GAP = 6;
const MARGIN = 6;

interface Tip {
  text: string;
  side: Side;
  rect: DOMRect;
}

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer = 0;
    let current: HTMLElement | null = null;
    let lastHidden = 0;

    const hide = () => {
      window.clearTimeout(timer);
      if (current) lastHidden = Date.now();
      current = null;
      setTip(null);
    };

    const show = (el: HTMLElement) => {
      const text = el.getAttribute("data-tip");
      if (!text || !el.isConnected) return;
      setTip({
        text,
        side: (el.getAttribute("data-tip-side") as Side | null) ?? "bottom",
        rect: el.getBoundingClientRect(),
      });
    };

    const onOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-tip]") ?? null;
      if (el === current) return;
      const warm = current !== null || Date.now() - lastHidden < WARM_MS;
      window.clearTimeout(timer);
      if (current) lastHidden = Date.now();
      current = el;
      setTip(null);
      if (!el) return;
      if (warm) show(el);
      else timer = window.setTimeout(() => current === el && show(el), DELAY);
    };

    document.addEventListener("mouseover", onOver);
    window.addEventListener("mousedown", hide, true);
    window.addEventListener("keydown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    document.documentElement.addEventListener("mouseleave", hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mouseover", onOver);
      window.removeEventListener("mousedown", hide, true);
      window.removeEventListener("keydown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
      document.documentElement.removeEventListener("mouseleave", hide);
    };
  }, []);

  useLayoutEffect(() => {
    if (!tip || !ref.current) {
      setPos(null);
      return;
    }
    const { width: w, height: h } = ref.current.getBoundingClientRect();
    const r = tip.rect;
    let side = tip.side;
    if (side === "bottom" && r.bottom + GAP + h > window.innerHeight - MARGIN) side = "top";
    if (side === "top" && r.top - GAP - h < MARGIN) side = "bottom";
    if (side === "right" && r.right + GAP + w > window.innerWidth - MARGIN) side = "left";
    let left = 0;
    let top = 0;
    switch (side) {
      case "top":
        left = r.left + r.width / 2 - w / 2;
        top = r.top - GAP - h;
        break;
      case "bottom":
        left = r.left + r.width / 2 - w / 2;
        top = r.bottom + GAP;
        break;
      case "left":
        left = r.left - GAP - w;
        top = r.top + r.height / 2 - h / 2;
        break;
      case "right":
        left = r.right + GAP;
        top = r.top + r.height / 2 - h / 2;
        break;
    }
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - w - MARGIN));
    top = Math.max(MARGIN, Math.min(top, window.innerHeight - h - MARGIN));
    setPos({ left, top });
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      style={{ position: "fixed", left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      className="pointer-events-none z-[100] max-w-xs animate-fade-in whitespace-pre-line rounded-md bg-[#25272d] px-2 py-1 text-xs text-white shadow-md dark:bg-[#3a3d45]"
    >
      {tip.text}
    </div>,
    document.body,
  );
}
