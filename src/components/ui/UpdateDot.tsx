import { cn } from "../../lib/cn";

/** The "new version available" marker on the settings icon and the About entry. */
export function UpdateDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("pointer-events-none h-2 w-2 rounded-full bg-app-danger ring-2 ring-app", className)}
    />
  );
}
