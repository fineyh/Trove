import { Check, Copy, LifeBuoy } from "lucide-react";
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
      toast.error("复制失败", e);
    }
  };

  return (
    <Modal
      open
      layer="top"
      busy={!saved}
      onClose={() => close(null)}
      width="md"
      icon={
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600">
          <LifeBuoy size={18} />
        </div>
      }
      title="保存恢复密钥"
      subtitle={`忘记「${recovery.target}」的密码时，用它解锁。它只显示这一次。`}
      footer={
        <>
          <label className="mr-auto flex cursor-pointer items-center gap-2 text-sm">
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
        <div className="grid grid-cols-4 gap-2 rounded-xl border border-app-border bg-app-subtle/50 p-3 font-mono text-[15px] tracking-wider">
          {groups.map((g, i) => (
            <span
              key={i}
              className="select-text rounded-md bg-app-panel py-1.5 text-center shadow-sm"
            >
              {g}
            </span>
          ))}
        </div>
        <Button
          variant="secondary"
          onClick={copy}
          icon={copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
          className="self-start"
        >
          {copied ? "已复制" : "复制到剪贴板"}
        </Button>
        <ul className="flex list-disc flex-col gap-1 pl-4 text-xs leading-5 text-app-muted">
          <li>写在纸上，或存进密码管理器；不要和数据放在同一个地方。</li>
          <li>Trove 不保存它的明文，丢了只能用密码重新生成一个。</li>
          <li>大小写和 0 / O 不敏感，输入时可以不带横线。</li>
        </ul>
      </div>
    </Modal>
  );
}
