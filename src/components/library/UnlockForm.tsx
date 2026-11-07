import { ArrowRight, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { errText } from "../../lib/errors";
import type { UnlockMethod } from "../../types";

interface UnlockFormProps {
  onUnlock: (secret: string, method: UnlockMethod) => Promise<void>;
  /** Offer "use recovery key" (only when one exists). */
  allowRecovery: boolean;
  passwordPlaceholder?: string;
  autoFocus?: boolean;
}

/**
 * Password field with an inline submit arrow, plus a switch to the recovery
 * key. Used by the app's lock screen and by locked libraries, so both look
 * and behave the same: a wrong secret shakes the field and keeps focus.
 */
export function UnlockForm({ onUnlock, allowRecovery, passwordPlaceholder = "密码", autoFocus = true }: UnlockFormProps) {
  const [method, setMethod] = useState<UnlockMethod>("password");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shakeKey, setShakeKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [method, autoFocus]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !secret.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onUnlock(method === "recovery" ? secret.trim() : secret, method);
      setSecret("");
    } catch (err) {
      setError(errText(err, "解锁失败"));
      setShakeKey((k) => k + 1);
      inputRef.current?.select();
    } finally {
      setBusy(false);
    }
  };

  const isRecovery = method === "recovery";

  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-2">
      <div
        key={shakeKey}
        className={cn(
          "flex items-center gap-1 rounded-xl border bg-app-panel p-1 pl-3 transition-colors duration-fast",
          "focus-within:border-app-accent focus-within:ring-2 focus-within:ring-app-accent/20",
          error ? "animate-shake border-app-danger" : "border-app-border",
        )}
      >
        <input
          ref={inputRef}
          type={isRecovery ? "text" : "password"}
          value={secret}
          onChange={(e) => {
            setSecret(e.target.value);
            if (error) setError(null);
          }}
          placeholder={isRecovery ? "恢复密钥" : passwordPlaceholder}
          spellCheck={false}
          autoComplete="off"
          className={cn("h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-app-muted", isRecovery && "font-mono tracking-wide")}
        />
        <button
          type="submit"
          disabled={busy || !secret.trim()}
          aria-label="解锁"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-app-accent text-app-on-accent transition-colors duration-fast hover:bg-app-accent/90 disabled:bg-transparent disabled:text-app-muted"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
        </button>
      </div>

      <div className="flex min-h-5 items-center justify-between gap-3 px-1 text-xs">
        <span className="text-app-danger">{error}</span>
        {allowRecovery && (
          <button
            type="button"
            onClick={() => {
              setMethod(isRecovery ? "password" : "recovery");
              setSecret("");
              setError(null);
            }}
            className="shrink-0 text-app-muted transition-colors duration-fast hover:text-app-accent"
          >
            {isRecovery ? "使用密码" : "使用恢复密钥"}
          </button>
        )}
      </div>
    </form>
  );
}
