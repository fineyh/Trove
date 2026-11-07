import { Folder } from "lucide-react";
import { useState } from "react";
import { avatarSrc } from "../../ipc/client";
import { useLibrariesStore } from "../../stores/libraries";
import type { Conversation } from "../../types";

/** A conversation's avatar: its picture, else a folder glyph / first letter. */
export function ConvAvatar({ conv, size = 44 }: { conv: Conversation; size?: number }) {
  const lib = useLibrariesStore((s) => s.current);
  const [failed, setFailed] = useState(false);
  const showImage = conv.hasAvatar && lib !== null && !failed;
  return (
    <div
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-app-accent/10 font-semibold text-app-accent"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
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
        <Folder size={size * 0.45} />
      ) : (
        Array.from(conv.name)[0]
      )}
    </div>
  );
}
