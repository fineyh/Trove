import { create } from "zustand";
import * as ipc from "../ipc/client";
import { toast } from "./toast";
import type { ImportProgressEvent } from "../types";

/** Live state of the single in-flight import / folder scan (the backend
 *  enforces one at a time), fed by the `import:progress` event. */
interface ImportJobState {
  /** null = idle. */
  job: ImportProgressEvent | null;
  cancelling: boolean;
  apply: (payload: ImportProgressEvent) => void;
  cancel: () => Promise<void>;
}

export const useImportJobStore = create<ImportJobState>((set) => ({
  job: null,
  cancelling: false,
  apply: (payload) => {
    // Imports run in the library they were started in; the bar shows on that
    // conversation's composer only, and the receipts below name no library.
    if (payload.finished) {
      set({ job: null, cancelling: false });
      // 进度条消失原本是唯一的「结束」信号，而单文件失败只进了后端
      // 的 eprintln!。三种结局各给一个回执。
      if (payload.cancelled) {
        toast.info("已停止导入");
      } else if (payload.failed > 0) {
        toast.error(
          `${payload.failed} 个文件未能导入`,
          "其余文件已导入。",
        );
      } else if (payload.total > 0) {
        toast.success("已导入", `${payload.total} 个文件`);
      }
      return;
    }
    set({ job: payload });
  },
  cancel: async () => {
    set({ cancelling: true });
    try {
      await ipc.cancelImport();
    } catch (e) {
      toast.error("无法停止导入", e);
      set({ cancelling: false });
    }
  },
}));
