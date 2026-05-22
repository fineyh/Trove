import { Sparkles, type LucideIcon } from "lucide-react";

interface PlaceholderPaneProps {
  title: string;
  message: string;
  icon?: LucideIcon;
}

export function PlaceholderPane({ title, message, icon }: PlaceholderPaneProps) {
  const Icon = icon ?? Sparkles;
  return (
    <div className="flex h-full flex-col">
      <h2 className="mb-5 text-lg font-semibold">{title}</h2>
      <div className="flex flex-1 items-center justify-center">
        <div className="flex max-w-sm flex-col items-center gap-3 rounded-lg border border-dashed border-app-border bg-app-subtle/30 px-6 py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-app-accent/10 text-app-accent">
            <Icon size={22} />
          </div>
          <div className="text-sm text-app-muted">{message}</div>
        </div>
      </div>
    </div>
  );
}
