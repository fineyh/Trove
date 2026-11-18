import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { useSessionStore } from "../../stores/session";
import { toast } from "../../stores/toast";
import { Button, Modal } from "../ui/Modal";

/**
 * Shows a recovery code exactly once (ADR-036 §5). The user must tick that
 * they saved it before the dialog lets go — closing it any other way would
 * lose the only copy that exists.
 */
export function RecoveryCodeDialog() {
  const recovery = useSessionStore((s) => s.recovery);
  const close = useSessionStore((s) => s.showRecovery);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setSaved(false);
    setCopied(false);
  }, [recovery]);

  if (!recovery) return null;

  const groups = recovery.code.split("-");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(recovery.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      toast.error("无法复制", e);
    }
  };

  return (
    <Modal
      open
      layer="top"
      busy={!saved}
      onClose={() => close(null)}
      width="md"
      title="保存恢复密钥"
      subtitle={`忘记「${recovery.target}」的密码时，可用它解锁。此密钥仅显示一次`}
      footer={
        <>
          <label className="mr-auto flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={saved}
              onChange={(e) => setSaved(e.target.checked)}
              className="h-4 w-4 accent-[rgb(var(--accent))]"
            />
            我已妥善保存
          </label>
          <Button variant="primary" disabled={!saved} onClick={() => close(null)}>
            完成
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="selectable grid grid-cols-4 gap-2 rounded-xl bg-app-subtle p-3 font-mono text-base tracking-wider">
          {groups.map((g, i) => (
            <span key={i} className="rounded-md bg-app-panel py-1.5 text-center">
              {g}
            </span>
          ))}
        </div>
        <Button
          variant="secondary"
          onClick={copy}
          size="sm"
          icon={copied ? <Check size={14} className="text-app-success" /> : <Copy size={14} />}
          className="self-start"
        >
          {copied ? "已复制" : "复制"}
        </Button>
        <p className="text-xs text-app-muted">请写下或存入密码管理器，并与数据分开保管。输入时不区分大小写。</p>
      </div>
    </Modal>
  );
}
