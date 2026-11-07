import { ArrowRight, Check, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../../lib/cn";
import { errText } from "../../lib/errors";
import { useConversationsStore } from "../../stores/conversations";
import { useLibrariesStore } from "../../stores/libraries";
import { useSessionStore } from "../../stores/session";
import { toast } from "../../stores/toast";
import { Button, Modal, Notice } from "../ui/Modal";
import { LibraryAvatar } from "./LibraryAvatar";

/** Move a conversation (rows + thumbnails) into another library (ADR-038 §5). */
export function MoveConversationDialog() {
  const convId = useSessionStore((s) => s.movingConversationId);
  const close = useSessionStore((s) => s.setMovingConversation);
  const conv = useConversationsStore((s) =>
    convId === null ? null : (s.list.find((c) => c.id === convId) ?? null),
  );
  const libraries = useLibrariesStore((s) => s.list);
  const current = useLibrariesStore((s) => s.current);
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTarget(null);
    setError(null);
  }, [convId]);

  if (convId === null || !conv) return null;

  const others = libraries.filter((l) => l.id !== current);
  const targetLib = others.find((l) => l.id === target) ?? null;

  const submit = async () => {
    if (!targetLib) return;
    setBusy(true);
    setError(null);
    try {
      const wasActive = useSessionStore.getState().activeConversationId === convId;
      await useConversationsStore.getState().moveTo(convId, targetLib.id);
      if (wasActive) useSessionStore.getState().setActiveConversation(null);
      close(null);
      toast.success(`已移到「${targetLib.name}」`, conv.name);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      busy={busy}
      onClose={() => close(null)}
      title="移到其他库"
      subtitle={`「${conv.name}」的消息和缩略图会搬到目标库，并从这里删除。原文件不动。`}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(null)} disabled={busy}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={!targetLib || busy}
            onClick={submit}
            icon={busy ? undefined : <ArrowRight size={14} />}
          >
            {busy ? "移动中…" : "移动"}
          </Button>
        </>
      }
    >
      {others.length === 0 ? (
        <Notice>
          还没有其他库。先在左侧栏点 <b>+</b> 新建一个库。
        </Notice>
      ) : (
        <div className="flex flex-col gap-1.5">
          {others.map((l) => {
            const locked = l.encrypted && !l.unlocked;
            const selected = target === l.id;
            return (
              <button
                key={l.id}
                type="button"
                disabled={locked}
                onClick={() => setTarget(l.id)}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-2.5 text-left transition",
                  selected
                    ? "border-app-accent bg-app-accent/5"
                    : "border-app-border hover:bg-app-subtle",
                  locked && "cursor-not-allowed opacity-50 hover:bg-transparent",
                )}
              >
                <LibraryAvatar name={l.name} icon={l.icon} color={l.color} size={34} locked={locked} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{l.name}</span>
                  <span className="text-xs text-app-muted">
                    {locked ? "已锁定，先解锁才能移入" : l.encrypted ? "加密库" : l.isMain ? "主库" : "普通库"}
                  </span>
                </div>
                {selected ? (
                  <Check size={16} className="text-app-accent" />
                ) : (
                  locked && <Lock size={14} className="text-app-muted" />
                )}
              </button>
            );
          })}
        </div>
      )}
      {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
    </Modal>
  );
}
