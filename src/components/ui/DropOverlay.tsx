import { AudioLines, FileText, Folder, Image, Video } from "lucide-react";
import type { PathKind } from "../../ipc/client";
import { describeDrop, useFileDropStore, type DropTarget, type DroppedFiles } from "../../stores/fileDrop";
import { cn } from "../../lib/cn";

function KindIcon({ kind, size }: { kind: PathKind; size: number }) {
  switch (kind) {
    case "folder":
      return <Folder size={size} strokeWidth={1.75} />;
    case "image":
      return <Image size={size} strokeWidth={1.75} />;
    case "video":
      return <Video size={size} strokeWidth={1.75} />;
    case "audio":
      return <AudioLines size={size} strokeWidth={1.75} />;
    default:
      return <FileText size={size} strokeWidth={1.75} />;
  }
}

/** Fan positions, back to front, for one to three cards. */
const FAN: Record<number, { r: number; x: number; y: number }[]> = {
  1: [{ r: 0, x: 0, y: 0 }],
  2: [
    { r: -8, x: -10, y: 2 },
    { r: 4, x: 6, y: 0 },
  ],
  3: [
    { r: -12, x: -20, y: 4 },
    { r: 10, x: 20, y: 4 },
    { r: 0, x: 0, y: 0 },
  ],
};

/** What is being dragged, as a small fanned stack of cards: one per kind,
 *  front card first. Kinds only, never content. */
export function FileStack({ files, muted = false, small = false }: { files: DroppedFiles; muted?: boolean; small?: boolean }) {
  const kinds: PathKind[] = (files.kinds ?? files.paths.map(() => "other" as const)).filter((k) => k !== "missing");
  // Distinct kinds first so a mixed drop shows its mix, then repeats.
  const order = [...new Set(kinds), ...kinds].slice(0, Math.min(3, kinds.length));
  const shown = order.length ? order : (["other"] as PathKind[]);
  const fan = FAN[shown.length];
  // Front card is shown[0]; the fan lists back cards first.
  const cards = shown.length === 3 ? [shown[2], shown[1], shown[0]] : [...shown].reverse();
  const w = small ? 34 : 52;
  const h = small ? 42 : 64;
  const count = kinds.length;

  return (
    <div className="relative" style={{ width: w + (small ? 28 : 44), height: h + (small ? 8 : 12) }}>
      {cards.map((k, i) => {
        const p = fan[i];
        const front = i === cards.length - 1;
        return (
          <div
            key={i}
            className={cn(
              "drop-card absolute left-1/2 top-1/2 flex items-center justify-center border bg-app-panel",
              small ? "rounded-lg" : "rounded-[10px]",
              front && !muted ? "border-app-accent/30 text-app-accent" : "border-app-border text-app-muted",
            )}
            style={
              {
                width: w,
                height: h,
                marginLeft: -w / 2,
                marginTop: -h / 2,
                "--r": `${p.r}deg`,
                "--x": `${small ? p.x * 0.65 : p.x}px`,
                "--y": `${p.y}px`,
                "--i": i,
              } as React.CSSProperties
            }
          >
            <KindIcon kind={k} size={small ? 15 : 22} />
          </div>
        );
      })}
      {count > 1 && (
        <span
          className={cn(
            "drop-card absolute flex items-center justify-center rounded-full font-semibold tabular-nums",
            small ? "-right-0.5 -top-0.5 h-4 min-w-4 px-1 text-[10px]" : "-right-1 -top-1 h-5 min-w-5 px-1.5 text-2xs",
            muted ? "bg-app-subtle text-app-secondary" : "bg-app-accent text-app-on-accent",
          )}
          style={{ "--i": 3 } as React.CSSProperties}
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </div>
  );
}

function matches(t: DropTarget | null, want: DropTarget): boolean {
  if (!t || t.zone !== want.zone || t.kind !== want.kind) return false;
  return t.kind === "new" || t.convId === (want as { convId: number }).convId;
}

/**
 * Covers a pane while files are dragged over it. The pane itself carries the
 * matching `data-drop`; this only draws.
 */
export function DropOverlay({ target, title }: { target: DropTarget; title: string }) {
  const drag = useFileDropStore((s) => (s.drag && matches(s.drag.target, target) ? s.drag : null));
  if (!drag) return null;
  const blocked = target.kind === "watch";

  return (
    <div className="pointer-events-none absolute inset-0 z-30 animate-fade-in bg-app-panel/[0.92] p-3 backdrop-blur-sm">
      <div
        className={cn(
          "drop-frame flex h-full flex-col items-center justify-center gap-6 rounded-2xl border",
          blocked ? "border-app-border" : "border-app-accent/40 bg-app-accent/[0.035]",
        )}
      >
        <FileStack files={drag} muted={blocked} />
        <div className="flex max-w-[80%] flex-col items-center gap-1 text-center">
          <span className={cn("truncate text-base font-medium", blocked && "text-app-secondary")}>{title}</span>
          <span className="text-xs text-app-muted">{blocked ? "同步文件夹随文件夹自动更新" : describeDrop(drag)}</span>
        </div>
      </div>
    </div>
  );
}
