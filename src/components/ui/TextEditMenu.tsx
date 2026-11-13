import { useCallback, useEffect, useState } from "react";
import { ClipboardPaste, Copy, Scissors, TextSelect } from "lucide-react";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { toast } from "../../stores/toast";

const DEV = import.meta.env.DEV;

type Field = HTMLInputElement | HTMLTextAreaElement;

const NON_TEXT_INPUTS = ["checkbox", "radio", "range", "button", "submit", "reset", "color", "file", "image"];

function textField(el: EventTarget | null): Field | null {
  if (el instanceof HTMLTextAreaElement) return el;
  if (el instanceof HTMLInputElement && !NON_TEXT_INPUTS.includes(el.type)) return el;
  return null;
}

interface MenuState {
  x: number;
  y: number;
  /** The text field right-clicked, or null for selected page text. */
  field: Field | null;
  start: number;
  end: number;
  /** Selected page text (field === null). */
  text: string;
}

/** Put focus and the selection back on the field: clicking the menu took them. */
function restore(m: MenuState): Field | null {
  const f = m.field;
  if (!f) return null;
  f.focus();
  try {
    f.setSelectionRange(m.start, m.end);
  } catch {
    // email / number inputs have no selection API; the browser keeps its own.
  }
  return f;
}

/**
 * Our own cut / copy / paste menu for text fields and selected text, replacing
 * the WebView's. A component that shows its own menu calls preventDefault, and
 * nativeShell already cancels the event everywhere else, so this only sees
 * right-clicks on text. Edits go through execCommand so they land in the
 * field's undo stack and fire `input` like typing does (React picks them up).
 */
export function TextEditMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const close = useCallback(() => setMenu(null), []);

  useEffect(() => {
    // Window, bubble phase: runs after React's root and nativeShell's document listener.
    const onContextMenu = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if (DEV && e.shiftKey) return; // Shift+right-click → Inspect, in dev only
      const field = textField(e.target);
      if (field) {
        if (field.disabled) return;
        e.preventDefault();
        setMenu({
          x: e.clientX,
          y: e.clientY,
          field,
          start: field.selectionStart ?? 0,
          end: field.selectionEnd ?? 0,
          text: "",
        });
        return;
      }
      const text = window.getSelection()?.toString() ?? "";
      if (!text.trim()) return;
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, field: null, start: 0, end: 0, text });
    };
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  if (!menu) return null;

  const { field } = menu;
  const selected = field ? field.value.slice(menu.start, menu.end) : menu.text;
  const editable = !!field && !field.readOnly;
  const secret = field instanceof HTMLInputElement && field.type === "password";

  const run = (fn: () => Promise<void> | void, failText: string) => () => {
    setMenu(null);
    Promise.resolve()
      .then(fn)
      .catch((err) => toast.error(failText, err));
  };

  const items: ContextMenuEntry[] = [];
  if (field) {
    items.push({
      label: "剪切",
      icon: <Scissors size={15} />,
      disabled: !editable || secret || !selected,
      onClick: run(async () => {
        await navigator.clipboard.writeText(selected);
        restore(menu);
        document.execCommand("delete");
      }, "剪切失败"),
    });
  }
  items.push({
    label: "复制",
    icon: <Copy size={15} />,
    disabled: secret || !selected,
    onClick: run(async () => {
      await navigator.clipboard.writeText(selected);
      restore(menu);
    }, "复制失败"),
  });
  if (field) {
    items.push(
      {
        label: "粘贴",
        icon: <ClipboardPaste size={15} />,
        disabled: !editable,
        onClick: run(async () => {
          const text = await navigator.clipboard.readText();
          restore(menu);
          if (text) document.execCommand("insertText", false, text);
        }, "粘贴失败"),
      },
      "separator",
      {
        label: "全选",
        icon: <TextSelect size={15} />,
        disabled: !field.value,
        onClick: run(() => {
          field.focus();
          field.select();
        }, "全选失败"),
      },
    );
  }

  return <ContextMenu open x={menu.x} y={menu.y} items={items} onClose={close} />;
}
