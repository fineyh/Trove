import { useCallback, useEffect, useState } from "react";
import { useSettingsStore } from "../../../stores/settings";
import * as ipc from "../../../ipc/client";
import type { RepairScope } from "../../../types";
import { BrokenManagerDialog } from "./BrokenManagerDialog";
import { cn } from "../../../lib/cn";
import { toast } from "../../../stores/toast";
import { currentLib } from "../../../stores/libraries";

const SCOPE_OPTIONS: ReadonlyArray<{ value: RepairScope; label: string; desc: string }> = [
  {
    value: "lastFolderOnly",
    label: "仅原目录",
    desc: "只在文件原来所在的文件夹里找，最快、最稳",
  },
  {
    value: "lastFolderRecursive",
    label: "原目录及其子目录",
    desc: "兼容文件被分类到子文件夹的情况",
  },
  {
    value: "allMountedVolumes",
    label: "所有挂载的卷",
    desc: "兜底全盘扫描，最慢但最全",
  },
];

export function MediaPane() {
  const repairScope = useSettingsStore((s) => s.settings.repairDefaultScope);
  const save = useSettingsStore((s) => s.save);
  const setRepairScope = (v: RepairScope) => save("repairDefaultScope", v);

  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const refreshCount = useCallback(async () => {
    setLoading(true);
    try {
      const groups = await ipc.listBrokenPointers(currentLib());
      const total = groups.reduce((acc, g) => acc + g.items.length, 0);
      setCount(total);
    } catch (e) {
      toast.error("读取丢失文件列表失败", e);
      setCount(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCount();
  }, [refreshCount]);

  const handleClose = useCallback(() => {
    setOpen(false);
    void refreshCount();
  }, [refreshCount]);

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold">媒体管理</h2>

      <section className="rounded-md border border-app-border">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-col">
            <div className="text-sm font-medium">丢失的文件</div>
            <div className="text-xs text-app-muted">
              {loading
                ? "加载中..."
                : count === null
                  ? "—"
                  : count === 0
                    ? "当前库没有丢失的文件"
                    : `当前库有 ${count} 个文件不在原位置，可以在这里找回或删除`}
              <span className="mt-0.5 block text-app-muted/80">
                盘没连接的文件属于「离线」，不算丢失，不会出现在这里。
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={count === null || count === 0}
            className={cn(
              "rounded-md border border-app-border px-3 py-1.5 text-sm transition",
              "hover:bg-app-subtle disabled:opacity-40 disabled:hover:bg-transparent",
            )}
          >
            管理
          </button>
        </div>

        <div className="border-t border-app-border px-4 py-3">
          <div className="text-sm font-medium">默认自动匹配模式</div>
          <div className="mt-1 text-xs text-app-muted">
            在丢失文件管理里点「自动匹配」时使用的搜索范围
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {SCOPE_OPTIONS.map((opt) => (
              <button
                type="button"
                key={opt.value}
                onClick={() => {
                  void setRepairScope(opt.value);
                }}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-md border p-2.5 text-left transition",
                  repairScope === opt.value
                    ? "border-app-accent bg-app-accent/5"
                    : "border-app-border hover:bg-app-subtle",
                )}
              >
                <span className="text-sm font-medium">{opt.label}</span>
                <span className="text-xs text-app-muted">{opt.desc}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {open && <BrokenManagerDialog onClose={handleClose} scope={repairScope} />}
    </div>
  );
}
