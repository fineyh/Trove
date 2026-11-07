import { ArrowRight, KeyRound, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { errText } from "../../lib/errors";
import type { UnlockMethod } from "../../types";

interface UnlockFormProps {
  onUnlock: (secret: string, method: UnlockMethod) => Promise<void>;
  /** Offer "use recovery code" (only when one exists). */
  allowRecovery: boolean;
  passwordPlaceholder?: string;
  autoFocus?: boolean;
}

/**
 * Password field with an inline submit arrow, plus a switch to the recovery
 * code. Used by the app's unlock screen and by locked libraries, so both
 * look and behave the same: wrong secret shakes the field and keeps focus.
 */
export function UnlockForm({
  onUnlock,
  allowRecovery,
  passwordPlaceholder = "密码",
  autoFocus = true,
}: UnlockFormProps) {
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
    <form onSubmit={submit} className="flex w-full flex-col gap-3">
      <div
        key={shakeKey}
        className={cn(
          "flex items-center gap-1 rounded-xl border bg-app-panel p-1 pl-3.5 shadow-sm transition",
          "focus-within:border-app-accent/60 focus-within:ring-4 focus-within:ring-app-accent/10",
          error ? "animate-shake border-red-500/60" : "border-app-border",
        )}
      >
        {isRecovery && <KeyRound size={15} className="shrink-0 text-app-muted" />}
        <input
          ref={inputRef}
          type={isRecovery ? "text" : "password"}
          value={secret}
          onChange={(e) => {
            setSecret(e.target.value);
            if (error) setError(null);
          }}
          placeholder={isRecovery ? "恢复密钥，如 ABCD-EFGH-…" : passwordPlaceholder}
          spellCheck={false}
          autoComplete="off"
          className={cn(
            "h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-app-muted/70",
            isRecovery && "font-mono tracking-wide",
          )}
        />
        <button
          type="submit"
          disabled={busy || !secret.trim()}
          aria-label="解锁"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-app-accent text-white transition hover:brightness-110 disabled:opacity-30"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
        </button>
      </div>

      <div className="flex min-h-[1.25rem] items-center justify-between gap-3 text-xs">
        <span className="text-red-500">{error}</span>
        {allowRecovery && (
          <button
            type="button"
            onClick={() => {
              setMethod(isRecovery ? "password" : "recovery");
              setSecret("");
              setError(null);
            }}
            className="shrink-0 text-app-muted transition-colors hover:text-app-accent"
          >
            {isRecovery ? "改用密码" : "忘记密码？使用恢复密钥"}
          </button>
        )}
      </div>
    </form>
  );
}
