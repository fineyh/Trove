//! 兜底：没被任何 catch 接住的 Promise rejection 与运行时异常也要让用户看到。
//! 装它的理由是扫代码时发现确实有「连 catch 都没有」的调用（StoragePane 的
//! handleRescan / handleForgetConfirm），逐个补 catch 之外还需要一张网。

import { isNoTauriError } from "./errors";
import { toast } from "../stores/toast";

let installed = false;

export function installGlobalErrorHandlers() {
  if (installed) return;
  installed = true;

  window.addEventListener("unhandledrejection", (e) => {
    if (isNoTauriError(e.reason)) return;
    toast.error("操作失败", e.reason);
  });

  window.addEventListener(
    "error",
    (e) => {
      // 资源加载失败（失效媒体的 <img>/<video>）也会打到 window 上，但 target
      // 是那个元素而不是 window。这类错误由 broken 状态机负责，不该弹 toast。
      if (e.target && e.target !== window) return;
      if (isNoTauriError(e.error ?? e.message)) return;
      toast.error("出现未预期的错误", e.error ?? e.message);
    },
    true,
  );
}
