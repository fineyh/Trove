export type ConversationKind = "manual" | "folder_watch";

export interface Conversation {
  id: number;
  name: string;
  avatarPath: string | null;
  kind: ConversationKind;
  encrypted: boolean;
  unlocked: boolean;
  pinned: boolean;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  preview: string | null;
  previewKind: "text" | "image" | "video" | "other" | null;
}

export interface VaultStatus {
  hasMasterPassword: boolean;
  unlocked: boolean;
}

export interface MediaPayload {
  id: number;
  kind: "image" | "video" | "other";
  width: number | null;
  height: number | null;
  durationMs: number | null;
  absolutePath: string;
  state: "live" | "broken";
  sizeBytes: number;
}

export interface Message {
  id: number;
  convId: number;
  caption: string | null;
  playCount: number;
  createdAt: number;
  media: MediaPayload | null;
}

export interface SearchHit {
  convId: number;
  convName: string;
  messageId: number | null;
  snippet: string;
  createdAt: number | null;
}

export interface ConvChangedEvent {
  convId: number;
  added: number;
  broken: number;
}

export type MissingFileStrategy = "hide" | "placeholder";

export interface AppSettings {
  missingFileStrategy: MissingFileStrategy;
}

export interface VolumePayload {
  id: number;
  platformId: string;
  label: string;
  lastMount: string | null;
  currentMount: string | null;
  online: boolean;
  mediaCount: number;
  brokenCount: number;
}
