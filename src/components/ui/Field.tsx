import { forwardRef } from "react";
import { cn } from "../../lib/cn";

export const inputClass =
  "h-8 w-full rounded-lg border border-app-border bg-app-panel px-2.5 text-sm text-app-fg outline-none transition-colors duration-fast placeholder:text-app-muted focus:border-app-accent focus:ring-2 focus:ring-app-accent/20 disabled:opacity-50";

interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, className, ...rest },
  ref,
) {
  return (
    <label className="flex flex-col gap-1.5">
      {label && <span className="text-xs font-medium text-app-secondary">{label}</span>}
      <input
        ref={ref}
        className={cn(
          inputClass,
          error ? "border-app-danger focus:border-app-danger focus:ring-app-danger/20" : undefined,
          className,
        )}
        {...rest}
      />
      {error ? (
        <span className="text-xs text-app-danger">{error}</span>
      ) : (
        hint && <span className="text-xs text-app-muted">{hint}</span>
      )}
    </label>
  );
});
