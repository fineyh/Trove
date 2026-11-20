import { Tag, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import * as ipc from "../../ipc/client";
import { cn } from "../../lib/cn";
import { toast } from "../../stores/toast";
import type { TagCount } from "../../types";
import { useEscapeLayer } from "../ui/Modal";

const EMPTY: string[] = [];
/** Suggestions shown at once. */
const SUGGEST = 6;

/**
 * A file's tags (ADR-063), edited in place like the caption: type and press
 * Enter, pick from what's already in use, Backspace on an empty field takes
 * the last one off.
 */
export function TagsField({ lib, mediaId }: { lib: string; mediaId: number }) {
  const [tags, setTags] = useState<string[]>(EMPTY);
  const [draft, setDraft] = useState("");
  const [focused, setFocused] = useState(false);
  const [known, setKnown] = useState<TagCount[]>([]);
  const [pick, setPick] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    setTags(EMPTY);
    setDraft("");
    ipc
      .mediaTags(lib, mediaId)
      .then((t) => live && setTags(t))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [lib, mediaId]);

  // What's in use, fetched each time the field is entered (another item may
  // have added some).
  useEffect(() => {
    if (!focused) return;
    let live = true;
    ipc
      .listTags(lib)
      .then((t) => live && setKnown(t))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [focused, lib]);

  const suggestions = useMemo(() => {
    const have = new Set(tags.map((t) => t.toLowerCase()));
    const q = draft.trim().toLowerCase();
    return known
      .filter((t) => !have.has(t.name.toLowerCase()) && (!q || t.name.toLowerCase().includes(q)))
      .sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)))
      .slice(0, SUGGEST);
  }, [known, tags, draft]);

  useEffect(() => setPick(-1), [draft]);

  useEscapeLayer(focused, () => {
    if (draft) setDraft("");
    else inputRef.current?.blur();
  });

  const add = (name: string) => {
    const n = name.trim();
    setDraft("");
    if (!n || tags.some((t) => t.toLowerCase() === n.toLowerCase())) return;
    setTags((t) => [...t, n]);
    ipc
      .addMediaTag(lib, mediaId, n)
      .then(setTags)
      .catch((e) => {
        toast.error("无法添加标签", e);
        setTags((t) => t.filter((x) => x !== n));
      });
  };

  const remove = (name: string) => {
    setTags((t) => t.filter((x) => x !== name));
    ipc
      .removeMediaTag(lib, mediaId, name)
      .then(setTags)
      .catch((e) => {
        toast.error("无法移除标签", e);
        void ipc.mediaTags(lib, mediaId).then(setTags).catch(() => {});
      });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" && suggestions.length) {
      e.preventDefault();
      setPick((p) => (p + 1) % suggestions.length);
    } else if (e.key === "ArrowUp" && suggestions.length) {
      e.preventDefault();
      setPick((p) => (p <= 0 ? suggestions.length : p) - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      add(pick >= 0 ? suggestions[pick].name : draft);
    } else if (e.key === "," || e.key === "，") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && tags.length) {
      e.preventDefault();
      remove(tags[tags.length - 1]);
    }
  };

  const open = focused && suggestions.length > 0;

  return (
    <div className="relative">
      <div
        className={cn(
          "flex w-full cursor-text gap-3 rounded-lg px-2 py-1.5 transition-colors duration-fast",
          focused ? "bg-app-subtle" : "hover:bg-app-hover/5",
        )}
        onClick={() => inputRef.current?.focus()}
      >
        <span className="flex h-6 w-4 shrink-0 items-center justify-center text-app-muted">
          <Tag size={16} />
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {tags.map((t) => (
            <span
              key={t}
              className="group/tag flex h-6 max-w-full items-center gap-0.5 rounded-md bg-app-hover/10 pl-2 pr-1 text-xs text-app-fg"
            >
              <span className="truncate">{t}</span>
              <button
                type="button"
                aria-label={`移除「${t}」`}
                onClick={(e) => {
                  e.stopPropagation();
                  remove(t);
                }}
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-app-muted opacity-0 transition-opacity duration-fast hover:text-app-fg focus-visible:opacity-100 group-hover/tag:opacity-100"
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            value={draft}
            maxLength={40}
            spellCheck={false}
            aria-label="添加标签"
            placeholder={tags.length ? "" : "添加标签"}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              if (draft.trim()) add(draft);
            }}
            onKeyDown={onKeyDown}
            className="h-6 min-w-[72px] flex-1 bg-transparent text-sm text-app-fg outline-none placeholder:text-app-muted"
          />
        </div>
      </div>

      {open && (
        <ul className="absolute inset-x-2 top-full z-20 mt-1 overflow-hidden rounded-xl border border-app-border bg-app-panel py-1 shadow-lg">
          {suggestions.map((t, i) => (
            <li key={t.name}>
              <button
                type="button"
                // Keep the input focused: blur would add the half-typed draft.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(t.name)}
                onMouseEnter={() => setPick(i)}
                className={cn(
                  "flex h-8 w-full items-center gap-2 px-3 text-left text-sm",
                  i === pick ? "bg-app-hover/10" : "",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                <span className="text-xs tabular-nums text-app-muted">{t.count}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
