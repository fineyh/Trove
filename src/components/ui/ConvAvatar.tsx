import { Folder } from "lucide-react";
import { useState } from "react";
import { avatarSrc } from "../../ipc/client";
import { useLibrariesStore } from "../../stores/libraries";
import type { Conversation } from "../../types";

/** Soft tints for letter avatars, picked by name so each conversation keeps its color. */
const TINTS = [
  ["#4F6BED", "rgb(79 107 237 / 0.12)"],
  ["#0F8A7E", "rgb(15 138 126 / 0.12)"],
  ["#C2410C", "rgb(194 65 12 / 0.12)"],
  ["#9333EA", "rgb(147 51 234 / 0.12)"],
  ["#BE185D", "rgb(190 24 93 / 0.12)"],
  ["#A16207", "rgb(161 98 7 / 0.13)"],
  ["#0369A1", "rgb(3 105 161 / 0.12)"],
] as const;

function tint(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return TINTS[h % TINTS.length];
}

/** A conversation's avatar: its picture, else a folder glyph / first letter. */
export function ConvAvatar({ conv, size = 40 }: { conv: Conversation; size?: number }) {
  const lib = useLibrariesStore((s) => s.current);
  const [failed, setFailed] = useState(false);
  const showImage = conv.hasAvatar && lib !== null && !failed;
  const [fg, bg] = conv.kind === "folder_watch" ? ["rgb(var(--fg-2))", "rgb(var(--fill))"] : tint(conv.name);
  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        borderRadius: Math.round(size * 0.24),
        color: fg,
        background: showImage ? undefined : bg,
      }}
    >
      {showImage ? (
        <img
          // updatedAt busts the <img> cache after the avatar changes.
          src={`${avatarSrc(lib, conv.id)}?v=${conv.updatedAt}`}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
          draggable={false}
        />
      ) : conv.kind === "folder_watch" ? (
        <Folder size={Math.round(size * 0.45)} />
      ) : (
        Array.from(conv.name)[0]
      )}
    </div>
  );
}
