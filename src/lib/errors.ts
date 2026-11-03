//! 错误文案归一化。应用里有 11 处各写一遍 `e instanceof Error ? ... : String(e)`，
//! 这里收成一处，顺带去掉 Rust 侧的前缀噪音。

/** Rust 的 `AppError` 序列化成**字符串**（见 src-tauri/src/error.rs 的 `Serialize`
 *  实现：`serialize_str(&self.to_string())`），所以 `invoke` 的 reject 值是 string
 *  而不是 Error —— 两种都要认，否则用户看到的是 "[object Object]"。 */
const RUST_PREFIX =
  /^(?:database|io|updater) error: |^not found: |^invalid argument: /;

/** 把任意 catch 到的东西变成一句能给人看的话。 */
export function errText(e: unknown, fallback = "未知错误"): string {
  let raw: string;
  if (e instanceof Error) {
    raw = e.message;
  } else if (typeof e === "string") {
    raw = e;
  } else if (e == null) {
    raw = "";
  } else if (
    typeof e === "object" &&
    typeof (e as { message?: unknown }).message === "string"
  ) {
    raw = (e as { message: string }).message;
  } else {
    raw = String(e);
  }
  const s = raw.replace(RUST_PREFIX, "").trim();
  return s === "" ? fallback : s;
}

/** 非 Tauri 环境（`npm run dev` 的纯浏览器预览）下每个 IPC 都会这样失败，
 *  见 ipc/client.ts 的 invoke 守卫。这不是用户该看到的错误，toast 要滤掉。 */
const NO_TAURI_MARKER = "Tauri runtime not available";

export function isNoTauriError(e: unknown): boolean {
  return errText(e).includes(NO_TAURI_MARKER);
}
