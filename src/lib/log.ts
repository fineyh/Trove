import { error } from "@tauri-apps/plugin-log";

/** 写进日志文件（6.1）。release 没有控制台，用户报 bug 时只能靠它。
 *  写失败不再报错：浏览器预览里没有 Tauri，日志本身也不该变成新的错误来源。 */
export function logError(message: string) {
  error(message).catch(() => {});
}
