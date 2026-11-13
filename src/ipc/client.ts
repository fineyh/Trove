import { Channel, invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppEnvironment,
  AppSettings,
  AuthStatus,
  BackupExportResult,
  BackupImportResult,
  BrokenGroup,
  Conversation,
  ConversationKind,
  ConvChangedEvent,
  CreatedLibrary,
  DownloadEvent,
  GeotaggedMedia,
  IdleLockMinutes,
  ImportProgressEvent,
  LibraryInfo,
  Message,
  RepairOutcome,
  RepairScope,
  SearchHit,
  SecurityStatus,
  BootError,
  StorageStats,
  UnlockMethod,
  UpdateChannel,
  UpdateInfo,
  VolumePayload,
} from "../types";
import { isTauri } from "../hooks/useIsTauri";

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    return Promise.reject(
      new Error(`Tauri runtime not available — '${cmd}' skipped`),
    );
  }
  return tauriInvoke<T>(cmd, args);
}

function subscribe<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => {});
  return listen<T>(event, (e) => handler(e.payload));
}

// ─── trove:// — media reaches the WebView by id only (ADR-037) ──────────────

// WebView2 serves custom schemes as `http://<scheme>.localhost/`; the other
// platforms use the scheme itself. `convertFileSrc` would percent-encode the
// slashes, so the URL is built by hand.
const TROVE_BASE =
  typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent)
    ? "http://trove.localhost"
    : "trove://localhost";

/** 320px thumbnail stored in the library. */
export function thumbSrc(lib: string, mediaId: number): string {
  return `${TROVE_BASE}/${lib}/thumb/${mediaId}`;
}

/** The original file (ranged for video). */
export function mediaSrc(lib: string, mediaId: number): string {
  return `${TROVE_BASE}/${lib}/media/${mediaId}`;
}

export function avatarSrc(lib: string, convId: number): string {
  return `${TROVE_BASE}/${lib}/avatar/${convId}`;
}

// ─── Security (app-level) ───────────────────────────────────────────────────

export async function bootError(): Promise<BootError | null> {
  return invoke<BootError | null>("boot_error");
}

export async function securityStatus(): Promise<SecurityStatus> {
  return invoke<SecurityStatus>("security_status");
}

export async function appUnlock(secret: string, method: UnlockMethod): Promise<void> {
  await invoke("app_unlock", { secret, method });
}

export async function appLock(): Promise<void> {
  await invoke("app_lock");
}

/** Returns the recovery code (shown once). */
export async function appSetPassword(password: string): Promise<string> {
  return invoke<string>("app_set_password", { password });
}

export async function appChangePassword(oldPassword: string, newPassword: string): Promise<void> {
  await invoke("app_change_password", { oldPassword, newPassword });
}

export async function appRemovePassword(password: string): Promise<void> {
  await invoke("app_remove_password", { password });
}

export async function appResetRecovery(password: string): Promise<string> {
  return invoke<string>("app_reset_recovery", { password });
}

export async function deleteLegacyCopy(): Promise<void> {
  await invoke("delete_legacy_copy");
}

export async function scheduleWebviewPurge(): Promise<void> {
  await invoke("schedule_webview_purge");
}

export function onSecurityChanged(handler: () => void): Promise<UnlistenFn> {
  return subscribe<null>("security:changed", () => handler());
}

// ─── Libraries ──────────────────────────────────────────────────────────────

export async function listLibraries(): Promise<LibraryInfo[]> {
  return invoke<LibraryInfo[]>("list_libraries");
}

export interface CreateLibraryArgs {
  name: string;
  icon?: string | null;
  color?: string | null;
  password?: string | null;
}

export async function createLibrary(args: CreateLibraryArgs): Promise<CreatedLibrary> {
  return invoke<CreatedLibrary>("create_library", { args });
}

export interface UpdateLibraryArgs {
  id: string;
  name?: string;
  icon?: string | null;
  color?: string | null;
}

export async function updateLibrary(args: UpdateLibraryArgs): Promise<void> {
  await invoke("update_library", { args });
}

export async function reorderLibraries(ids: string[]): Promise<void> {
  await invoke("reorder_libraries", { ids });
}

export async function unlockLibrary(id: string, secret: string, method: UnlockMethod): Promise<void> {
  await invoke("unlock_library", { id, secret, method });
}

export async function lockLibrary(id: string): Promise<void> {
  await invoke("lock_library", { id });
}

/** The library is re-encrypted under a new id; the result carries it. */
export async function setLibraryPassword(id: string, password: string): Promise<CreatedLibrary> {
  return invoke<CreatedLibrary>("set_library_password", { id, password });
}

export async function changeLibraryPassword(id: string, oldPassword: string, newPassword: string): Promise<void> {
  await invoke("change_library_password", { id, oldPassword, newPassword });
}

export async function removeLibraryPassword(id: string, password: string): Promise<void> {
  await invoke("remove_library_password", { id, password });
}

export async function resetLibraryRecovery(id: string, password: string): Promise<string> {
  return invoke<string>("reset_library_recovery", { id, password });
}

/** Writes a new key file into `dir`; returns its full path. */
export async function setLibraryKeyfile(id: string, dir: string): Promise<string> {
  return invoke<string>("set_library_keyfile", { id, dir });
}

export async function removeLibraryKeyfile(id: string): Promise<void> {
  await invoke("remove_library_keyfile", { id });
}

export async function deleteLibrary(id: string, confirmName: string): Promise<void> {
  await invoke("delete_library", { id, confirmName });
}

/** Returns the conversation's id in the target library. */
export async function moveConversation(from: string, convId: number, to: string): Promise<number> {
  return invoke<number>("move_conversation", { from, convId, to });
}

export function onLibrariesChanged(handler: () => void): Promise<UnlistenFn> {
  return subscribe<null>("libraries:changed", () => handler());
}

// ─── Conversations ──────────────────────────────────────────────────────────

export async function listConversations(lib: string): Promise<Conversation[]> {
  if (!isTauri()) return [];
  return invoke<Conversation[]>("list_conversations", { lib });
}

export interface CreateConversationArgs {
  name: string;
  avatarPath?: string | null;
  kind?: ConversationKind;
  sourcePath?: string | null;
}

export async function createConversation(lib: string, args: CreateConversationArgs): Promise<number> {
  return invoke<number>("create_conversation", { lib, args });
}

export interface UpdateConversationArgs {
  id: number;
  name?: string;
  avatarPath?: string;
  pinned?: boolean;
  archived?: boolean;
}

export async function updateConversation(lib: string, args: UpdateConversationArgs): Promise<void> {
  await invoke("update_conversation", { lib, args });
}

export async function deleteConversation(lib: string, id: number): Promise<void> {
  await invoke("delete_conversation", { lib, id });
}

// ─── Messages ───────────────────────────────────────────────────────────────

/** Cursor for paging backwards. Composite because `createdAt` is not
 *  monotonic with `id` (folder scans store the file's mtime). */
export interface MessageCursor {
  createdAt: number;
  id: number;
}

export interface ListMessagesArgs {
  convId: number;
  /** Omit for the newest page; pass the oldest held message to go further back. */
  before?: MessageCursor;
  limit?: number;
}

export async function listMessages(lib: string, args: ListMessagesArgs): Promise<Message[]> {
  if (!isTauri()) return [];
  return invoke<Message[]>("list_messages", { lib, args });
}

/**
 * One page of a conversation's *media* messages, oldest -> newest.
 *
 * Deliberately not `listMessages`: the viewer and the profile-drawer grid need
 * the conversation's whole media sequence, not the slice of chat the user has
 * scrolled into memory.
 */
export async function listConvMedia(lib: string, args: ListMessagesArgs): Promise<Message[]> {
  if (!isTauri()) return [];
  return invoke<Message[]>("list_conv_media", { lib, args });
}

export async function sendText(lib: string, convId: number, text: string): Promise<Message> {
  return invoke<Message>("send_text", { lib, args: { convId, text } });
}

export async function importFiles(lib: string, convId: number, paths: string[]): Promise<void> {
  await invoke("import_files", { lib, args: { convId, paths } });
}

export interface CreateManualFromFolderResult {
  convId: number;
  imported: number;
}

export async function createManualFromFolder(
  lib: string,
  folderPath: string,
  name?: string,
): Promise<CreateManualFromFolderResult> {
  return invoke<CreateManualFromFolderResult>("create_manual_from_folder", {
    lib,
    args: { folderPath, name },
  });
}

export async function rescanFolder(lib: string, convId: number): Promise<{ added: number }> {
  return invoke<{ added: number }>("rescan_folder", { lib, convId });
}

/** Ask the running import/scan to stop at the next file boundary. */
export async function cancelImport(): Promise<void> {
  if (!isTauri()) return;
  await invoke("cancel_import");
}

export function onImportProgress(handler: (p: ImportProgressEvent) => void): Promise<UnlistenFn> {
  return subscribe("import:progress", handler);
}

export async function incrementPlayCount(lib: string, messageId: number): Promise<number> {
  return invoke<number>("increment_play_count", { lib, messageId });
}

export async function deleteMessage(lib: string, messageId: number, deleteFile = false): Promise<void> {
  await invoke("delete_message", { lib, messageId, deleteFile });
}

export async function search(lib: string, query: string): Promise<SearchHit[]> {
  if (!isTauri()) return [];
  return invoke<SearchHit[]>("search", { lib, query });
}

// ─── Media file actions (by id; the path stays in Rust) ─────────────────────

export async function openMedia(lib: string, mediaId: number): Promise<void> {
  await invoke("open_media", { lib, mediaId });
}

export async function revealMedia(lib: string, mediaId: number): Promise<void> {
  await invoke("reveal_media", { lib, mediaId });
}

export async function mediaPathForCopy(lib: string, mediaId: number): Promise<string> {
  return invoke<string>("media_path_for_copy", { lib, mediaId });
}

// ─── Map ────────────────────────────────────────────────────────────────────

export async function listGeotaggedMedia(lib: string): Promise<GeotaggedMedia[]> {
  if (!isTauri()) return [];
  return invoke<GeotaggedMedia[]>("list_geotagged_media", { lib });
}

export async function backfillGeotags(lib: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("backfill_geotags", { lib });
}

export function onGeoBackfillDone(
  handler: (p: { lib: string; updated: number }) => void,
): Promise<UnlistenFn> {
  return subscribe("geo:backfill-done", handler);
}

// ─── Background change events ───────────────────────────────────────────────

export function onConvChanged(handler: (p: ConvChangedEvent) => void): Promise<UnlistenFn> {
  return subscribe("conv:changed", handler);
}

/** Payload: the library whose volumes changed. */
export function onVolumesChanged(handler: (lib: string) => void): Promise<UnlistenFn> {
  return subscribe("volumes:changed", handler);
}

// ─── Thumbnails (ADR-037) ───────────────────────────────────────────────────

export interface ThumbJob {
  mediaId: number;
  kind: "image" | "video";
  ext: string;
}

export async function thumbsNext(lib: string, limit = 8): Promise<ThumbJob[]> {
  return invoke<ThumbJob[]>("thumbs_next", { lib, limit });
}

export async function thumbsRemaining(lib: string): Promise<number> {
  return invoke<number>("thumbs_remaining", { lib });
}

export interface ThumbMeta {
  mediaId: number;
  mime: string;
  width: number;
  height: number;
  origWidth?: number;
  origHeight?: number;
  durationMs?: number;
}

/** Raw body, metadata in headers — no JSON number-array inflation. */
export async function thumbsPut(lib: string, meta: ThumbMeta, bytes: Uint8Array): Promise<void> {
  const headers: Record<string, string> = {
    "x-lib": lib,
    "x-media-id": String(meta.mediaId),
    "x-mime": meta.mime,
    "x-width": String(meta.width),
    "x-height": String(meta.height),
  };
  if (meta.origWidth) headers["x-orig-width"] = String(meta.origWidth);
  if (meta.origHeight) headers["x-orig-height"] = String(meta.origHeight);
  if (meta.durationMs) headers["x-duration-ms"] = String(Math.round(meta.durationMs));
  if (!isTauri()) return;
  await tauriInvoke("thumbs_put", bytes, { headers });
}

export async function thumbsFail(lib: string, mediaId: number): Promise<void> {
  await invoke("thumbs_fail", { lib, mediaId });
}

/** Payload: the library with new work. */
export function onThumbsWake(handler: (lib: string) => void): Promise<UnlistenFn> {
  return subscribe("thumbs:wake", handler);
}

// ─── Settings (app-wide, stored in the main library) ────────────────────────

export const DEFAULT_SETTINGS: AppSettings = {
  offlineContent: "show",
  repairDefaultScope: "lastFolderOnly",
  idleLockMinutes: 0,
  mapTiles: "online",
};

function parseRepairScope(raw: string | undefined): RepairScope {
  switch (raw) {
    case "last_folder_recursive":
      return "lastFolderRecursive";
    case "all_volumes":
      return "allMountedVolumes";
    default:
      return "lastFolderOnly";
  }
}

function serializeRepairScope(value: RepairScope): string {
  switch (value) {
    case "lastFolderRecursive":
      return "last_folder_recursive";
    case "allMountedVolumes":
      return "all_volumes";
    default:
      return "last_folder_only";
  }
}

function parseIdle(raw: string | undefined): IdleLockMinutes {
  const n = Number(raw);
  return ([0, 5, 15, 30, 60] as const).find((v) => v === n) ?? 0;
}

export async function getAllSettings(): Promise<AppSettings> {
  if (!isTauri()) return DEFAULT_SETTINGS;
  const raw = await invoke<Record<string, string>>("get_all_settings");
  return {
    offlineContent: raw["offline_content"] === "hide" ? "hide" : "show",
    repairDefaultScope: parseRepairScope(raw["repair_default_scope"]),
    idleLockMinutes: parseIdle(raw["idle_lock_minutes"]),
    mapTiles: raw["map_tiles"] === "off" ? "off" : "online",
  };
}

export async function saveSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K],
): Promise<void> {
  switch (key) {
    case "offlineContent":
      return invoke("set_setting", { key: "offline_content", value });
    case "repairDefaultScope":
      return invoke("set_setting", {
        key: "repair_default_scope",
        value: serializeRepairScope(value as RepairScope),
      });
    case "idleLockMinutes":
      return invoke("set_setting", { key: "idle_lock_minutes", value: String(value) });
    case "mapTiles":
      return invoke("set_setting", { key: "map_tiles", value });
  }
}

// ─── UI preferences (outside the libraries, readable while locked) ─────────

export type ThemePref = "system" | "light" | "dark";

export interface UiPrefs {
  theme: ThemePref;
  updateChannel: UpdateChannel;
  updateAuto: boolean;
  /** Unix ms of the last successful update check, 0 if never. */
  updateLastCheck: number;
}

export async function getUiPrefs(): Promise<UiPrefs> {
  const raw = isTauri() ? await invoke<Record<string, string>>("get_ui_prefs") : {};
  const t = raw["theme"];
  return {
    theme: t === "light" || t === "dark" ? t : "system",
    updateChannel: raw["update_channel"] === "beta" ? "beta" : "stable",
    updateAuto: raw["update_auto"] !== "off",
    updateLastCheck: Number(raw["update_last_check"]) || 0,
  };
}

export function setUiPref(key: "theme", value: ThemePref): Promise<void>;
export function setUiPref(key: "update_channel", value: UpdateChannel): Promise<void>;
export function setUiPref(key: "update_auto", value: "on" | "off"): Promise<void>;
export function setUiPref(key: string, value: string): Promise<void> {
  if (!isTauri()) return Promise.resolve();
  return invoke("set_ui_pref", { key, value });
}

// ─── Repair / volumes / storage (per library) ───────────────────────────────

export async function listBrokenPointers(lib: string): Promise<BrokenGroup[]> {
  if (!isTauri()) return [];
  return invoke<BrokenGroup[]>("list_broken_pointers", { lib });
}

export interface RepairMediaArgs {
  mediaId: number;
  scope: RepairScope;
  explicitPath?: string;
}

export async function repairMedia(lib: string, args: RepairMediaArgs): Promise<RepairOutcome> {
  return invoke<RepairOutcome>("repair_media", { lib, args });
}

export async function listVolumes(lib: string): Promise<VolumePayload[]> {
  if (!isTauri()) return [];
  return invoke<VolumePayload[]>("list_volumes", { lib });
}

export async function rescanVolumes(lib: string): Promise<void> {
  await invoke("rescan_volumes", { lib });
}

export async function forgetVolume(lib: string, id: number): Promise<void> {
  await invoke("forget_volume", { lib, id });
}

export async function getStorageStats(lib: string): Promise<StorageStats | null> {
  if (!isTauri()) return null;
  return invoke<StorageStats>("get_storage_stats", { lib });
}

// ─── System ─────────────────────────────────────────────────────────────────

export async function openPath(path: string): Promise<void> {
  await invoke("open_path", { path });
}

/** Open a web/mail URL in the OS default browser (not the app WebView). */
export async function openUrl(url: string): Promise<void> {
  await invoke("open_url", { url });
}

// ─── Account / backup / updates ─────────────────────────────────────────────

const DEFAULT_AUTH: AuthStatus = {
  hasIdentity: false,
  email: null,
  displayName: null,
  pictureUrl: null,
  vaultUnlocked: true,
};

export async function authStatus(): Promise<AuthStatus> {
  if (!isTauri()) return DEFAULT_AUTH;
  return invoke<AuthStatus>("auth_status");
}

export async function googleLogin(): Promise<AuthStatus> {
  return invoke<AuthStatus>("google_login");
}

export async function logout(): Promise<void> {
  await invoke("logout");
}

export async function exportBackup(destPath: string, password?: string): Promise<BackupExportResult> {
  return invoke<BackupExportResult>("export_backup", {
    args: { destPath, password: password || null },
  });
}

export async function importBackup(sourcePath: string): Promise<BackupImportResult> {
  return invoke<BackupImportResult>("import_backup", { args: { sourcePath } });
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  return invoke<UpdateInfo>("check_for_update");
}

export async function installUpdate(onEvent: (e: DownloadEvent) => void): Promise<void> {
  const ch = new Channel<DownloadEvent>(onEvent);
  await invoke("install_update", { onEvent: ch });
}

export async function appEnvironment(): Promise<AppEnvironment | null> {
  if (!isTauri()) return null;
  return invoke<AppEnvironment>("app_environment");
}
