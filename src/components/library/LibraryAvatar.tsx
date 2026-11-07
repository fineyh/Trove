import { Lock } from "lucide-react";
import { cn } from "../../lib/cn";
import { libraryColor } from "../../stores/libraries";
import { iconFor } from "./libraryIcons";

interface LibraryAvatarProps {
  name: string;
  icon: string | null;
  color: string | null;
  size?: number;
  /** Show a lock badge (password-protected and currently locked). */
  locked?: boolean;
  className?: string;
}

/** A library's tile: its glyph (or first letter) on its color. */
export function LibraryAvatar({ name, icon, color, size = 40, locked = false, className }: LibraryAvatarProps) {
  const c = libraryColor(color);
  const Glyph = iconFor(icon);
  // Anything not `lucide:` is a legacy emoji, shown as-is.
  const legacy = icon && !icon.startsWith("lucide:") ? icon : null;
  return (
    <span className={cn("relative inline-flex shrink-0 select-none", className)} style={{ width: size, height: size }}>
      <span
        className="flex h-full w-full items-center justify-center font-semibold"
        style={{
          background: c.bg,
          color: c.fg,
          borderRadius: Math.round(size * 0.28),
          fontSize: legacy ? size * 0.5 : size * 0.42,
          lineHeight: 1,
          opacity: locked ? 0.55 : 1,
        }}
      >
        {Glyph ? (
          <Glyph size={Math.round(size * 0.5)} strokeWidth={2} />
        ) : (
          (legacy ?? Array.from(name.trim())[0]?.toUpperCase() ?? "?")
        )}
      </span>
      {locked && (
        <span
          className="absolute -bottom-1 -right-1 flex items-center justify-center rounded-full bg-app-fg text-app-panel ring-2 ring-app"
          style={{ width: Math.round(size * 0.44), height: Math.round(size * 0.44) }}
        >
          <Lock size={Math.round(size * 0.24)} strokeWidth={2.75} />
        </span>
      )}
    </span>
  );
}
