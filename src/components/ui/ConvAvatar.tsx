import { Folder } from "lucide-react";
import { useState } from "react";
import { avatarSrc } from "../../ipc/client";
import { libraryColor, useLibrariesStore } from "../../stores/libraries";
import type { Conversation } from "../../types";
import { cn } from "../../lib/cn";

/**
 * A conversation's avatar: the picture the user chose, else the default —
 * its first letter (a folder glyph for a synced folder) in the color of the
 * library it lives in. Color belongs to the library, never to the
 * conversation (ADR-050).
 */
export function ConvAvatar({ conv, size = 40 }: { conv: Conversation; size?: number }) {
  const lib = useLibrariesStore((s) => s.current);
  const color = useLibrariesStore((s) => s.list.find((l) => l.id === s.current)?.color);
  // updatedAt busts the <img> cache after the avatar changes.
  const src = conv.hasAvatar && lib !== null ? `${avatarSrc(lib, conv.id)}?v=${conv.updatedAt}` : null;
  // Remembered per URL, so a new picture gets its own chance to load.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = src !== null && failedSrc !== src;
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden font-semibold",
        !showImage &&
          "bg-[color:color-mix(in_srgb,var(--tint)_14%,transparent)] text-[color:color-mix(in_srgb,var(--tint)_75%,black)] dark:bg-[color:color-mix(in_srgb,var(--tint)_26%,transparent)] dark:text-[color:color-mix(in_srgb,var(--tint)_50%,white)]",
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        borderRadius: Math.round(size * 0.24),
        ["--tint" as string]: libraryColor(color).bg,
      }}
    >
      {showImage ? (
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setFailedSrc(src)}
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
