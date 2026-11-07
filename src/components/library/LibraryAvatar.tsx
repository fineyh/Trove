import { Lock } from "lucide-react";
import { cn } from "../../lib/cn";
import { libraryColor } from "../../stores/libraries";

interface LibraryAvatarProps {
  name: string;
  icon: string | null;
  color: string | null;
  size?: number;
  /** Show a lock badge (encrypted and currently locked). */
  locked?: boolean;
  className?: string;
}

/** A library's square: its emoji (or first letter) on its color. */
export function LibraryAvatar({
  name,
  icon,
  color,
  size = 40,
  locked = false,
  className,
}: LibraryAvatarProps) {
  const c = libraryColor(color);
  const label = icon || Array.from(name.trim())[0]?.toUpperCase() || "?";
  return (
    <span
      className={cn("relative inline-flex shrink-0 select-none", className)}
      style={{ width: size, height: size }}
    >
      <span
        className="flex h-full w-full items-center justify-center font-semibold"
        style={{
          background: `linear-gradient(145deg, ${c.bg}, color-mix(in srgb, ${c.bg} 78%, black))`,
          color: c.fg,
          borderRadius: size * 0.3,
          fontSize: icon ? size * 0.5 : size * 0.42,
          lineHeight: 1,
          opacity: locked ? 0.55 : 1,
        }}
      >
        {label}
      </span>
      {locked && (
        <span
          className="absolute -bottom-1 -right-1 flex items-center justify-center rounded-full border-2 border-app-panel bg-app-fg text-app-panel"
          style={{ width: size * 0.45, height: size * 0.45 }}
        >
          <Lock size={size * 0.24} strokeWidth={2.75} />
        </span>
      )}
    </span>
  );
}
