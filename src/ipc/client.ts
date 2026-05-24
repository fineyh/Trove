import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { convertFileSrc as tauriConvertFileSrc } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AppSettings,
  AuthStatus,
  BackupExportResult,
  BackupImportResult,
  BrokenGroup,
  Conversation,
  ConversationKind,
  ConvChangedEvent,
  MissingFileStrategy,
  Message,
  RepairOutcome,
  RepairScope,
  SearchHit,
  StorageStats,
  UpdateInfo,
  VaultStatus,
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

export async function listConversations(): Promise<Conversation[]> {
  if (!isTauri()) return [];
  return invoke<Conversation[]>("list_conversations");
}

export interface CreateConversationArgs {
  name: string;
  avatarPath?: string | null;
  kind?: ConversationKind;
  sourcePath?: string | null;
  encrypt?: boolean;
  password?: string | null;
}

export async function createConversation(
  args: CreateConversationArgs,
): Promise<number> {
  return invoke<number>("create_conversation", { args });
}

export interface UpdateConversationArgs {
  id: number;
  name?: string;
  avatarPath?: string;
  pinned?: boolean;
  archived?: boolean;
}

export async function updateConversation(
  args: UpdateConversationArgs,
): Promise<void> {
  await invoke("update_conversation", { args });
}

export async function deleteConversation(id: number): Promise<void> {
  await invoke("delete_conversation", { id });
}

export interface ListMessagesArgs {
  convId: number;
  beforeId?: number;
  limit?: number;
}

export async function listMessages(
  args: ListMessagesArgs,
): Promise<Message[]> {
  if (!isTauri()) return [];
  return invoke<Message[]>("list_messages", { args });
}

export async function sendText(
  convId: number,
  text: string,
): Promise<Message> {
  return invoke<Message>("send_text", { args: { convId, text } });
}

export async function importFiles(
  convId: number,
  paths: string[],
): Promise<Array<{ messageId: number; mediaId: number; absolutePath: string }>> {
  return invoke("import_files", { args: { convId, paths } });
}

export interface CreateManualFromFolderResult {
  convId: number;
  imported: number;
}

export async function createManualFromFolder(
  folderPath: string,
  name?: string,
): Promise<CreateManualFromFolderResult> {
  return invoke<CreateManualFromFolderResult>("create_manual_from_folder", {
    args: { folderPath, name },
  });
}

export async function rescanFolder(convId: number): Promise<{ added: number }> {
  return invoke<{ added: number }>("rescan_folder", { convId });
}

export async function incrementPlayCount(messageId: number): Promise<number> {
  return invoke<number>("increment_play_count", { messageId });
}

export async function deleteMessage(messageId: number): Promise<void> {
  await invoke("delete_message", { messageId });
}

export async function search(query: string): Promise<SearchHit[]> {
  if (!isTauri()) return [];
  return invoke<SearchHit[]>("search", { query });
}

export function mediaUrl(absolutePath: string): string {
  if (!isTauri()) return absolutePath;
  return tauriConvertFileSrc(absolutePath);
}

/** Subscribe to backend `conv:changed` events (folder watcher updates). */
export async function onConvChanged(
  handler: (payload: ConvChangedEvent) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<ConvChangedEvent>("conv:changed", (e) => handler(e.payload));
}

/** Subscribe to volume mount/unmount events. */
export async function onVolumesChanged(
  handler: () => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen("volumes:changed", () => handler());
}

const DEFAULT_SETTINGS: AppSettings = {
  missingFileStrategy: "hide",
  repairDefaultScope: "lastFolderOnly",
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

export async function getAllSettings(): Promise<AppSettings> {
  if (!isTauri()) return DEFAULT_SETTINGS;
  const raw = await invoke<Record<string, string>>("get_all_settings");
  const strategy = raw["missing_file_strategy"];
  return {
    missingFileStrategy:
      strategy === "placeholder" ? "placeholder" : "hide",
    repairDefaultScope: parseRepairScope(raw["repair_default_scope"]),
  };
}

export async function setMissingFileStrategy(
  value: MissingFileStrategy,
): Promise<void> {
  await invoke("set_setting", { key: "missing_file_strategy", value });
}

export async function setRepairDefaultScope(value: RepairScope): Promise<void> {
  await invoke("set_setting", {
    key: "repair_default_scope",
    value: serializeRepairScope(value),
  });
}

export async function listBrokenPointers(): Promise<BrokenGroup[]> {
  if (!isTauri()) return [];
  return invoke<BrokenGroup[]>("list_broken_pointers");
}

export interface RepairMediaArgs {
  mediaId: number;
  scope: RepairScope;
  explicitPath?: string;
}

export async function repairMedia(args: RepairMediaArgs): Promise<RepairOutcome> {
  return invoke<RepairOutcome>("repair_media", { args });
}

export async function listVolumes(): Promise<VolumePayload[]> {
  if (!isTauri()) return [];
  return invoke<VolumePayload[]>("list_volumes");
}

export async function rescanVolumes(): Promise<void> {
  await invoke("rescan_volumes");
}

export async function forgetVolume(id: number): Promise<void> {
  await invoke("forget_volume", { id });
}

export async function getStorageStats(): Promise<StorageStats | null> {
  if (!isTauri()) return null;
  return invoke<StorageStats>("get_storage_stats");
}

export async function openPath(path: string): Promise<void> {
  await invoke("open_path", { path });
}

const DEFAULT_VAULT: VaultStatus = { hasMasterPassword: false, unlocked: true };

export async function vaultStatus(): Promise<VaultStatus> {
  if (!isTauri()) return DEFAULT_VAULT;
  return invoke<VaultStatus>("vault_status");
}

export async function vaultSetMasterPassword(password: string): Promise<void> {
  await invoke("vault_set_master_password", { password });
}

export async function vaultUnlock(password: string): Promise<void> {
  await invoke("vault_unlock", { password });
}

export async function vaultLock(): Promise<void> {
  await invoke("vault_lock");
}

export async function vaultChangePassword(
  oldPassword: string,
  newPassword: string,
): Promise<void> {
  await invoke("vault_change_password", { oldPassword, newPassword });
}

export async function vaultRemoveMasterPassword(password: string): Promise<void> {
  await invoke("vault_remove_master_password", { password });
}

export async function unlockConversation(
  convId: number,
  password: string,
): Promise<void> {
  await invoke("unlock_conversation", { args: { convId, password } });
}

export async function lockConversation(convId: number): Promise<void> {
  await invoke("lock_conversation", { convId });
}

export async function listUnlockedConversations(): Promise<number[]> {
  if (!isTauri()) return [];
  return invoke<number[]>("list_unlocked_conversations");
}

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

export async function exportBackup(destPath: string): Promise<BackupExportResult> {
  return invoke<BackupExportResult>("export_backup", { args: { destPath } });
}

export async function importBackup(sourcePath: string): Promise<BackupImportResult> {
  return invoke<BackupImportResult>("import_backup", { args: { sourcePath } });
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  return invoke<UpdateInfo>("check_for_update");
}

export async function installUpdate(): Promise<void> {
  await invoke("install_update");
}
