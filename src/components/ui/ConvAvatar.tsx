import { Folder } from "lucide-react";
import { useState } from "react";
import { avatarSrc } from "../../ipc/client";
import { useLibrariesStore } from "../../stores/libraries";
import type { Conversation } from "../../types";
import { cn } from "../../lib/cn";

/** Soft tints for letter avatars, picked by name so each conversation keeps its color. */
const TINTS = ["#4F6BED", "#0F8A7E", "#C2410C", "#9333EA", "#BE185D", "#A16207", "#0369A1"] as const;

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
  const folder = conv.kind === "folder_watch";
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden font-semibold",
        showImage
          ? ""
          : folder
            ? "bg-app-subtle text-app-secondary"
            : "bg-[color:color-mix(in_srgb,var(--tint)_13%,transparent)] text-[color:var(--tint)] dark:bg-[color:color-mix(in_srgb,var(--tint)_28%,transparent)] dark:text-[color:color-mix(in_srgb,var(--tint)_45%,white)]",
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        borderRadius: Math.round(size * 0.24),
        ["--tint" as string]: folder ? undefined : tint(conv.name),
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
