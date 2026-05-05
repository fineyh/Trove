import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { convertFileSrc as tauriConvertFileSrc } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Conversation,
  ConversationKind,
  ConvChangedEvent,
  Message,
  SearchHit,
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
