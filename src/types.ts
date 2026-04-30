export type ConversationKind = "manual" | "folder_watch";

export interface Conversation {
  id: number;
  name: string;
  avatarPath: string | null;
  kind: ConversationKind;
  encrypted: boolean;
  pinned: boolean;
  archived: boolean;
  unreadCount: number;
  preview: string | null;
  previewKind: "text" | "image" | "video" | null;
  updatedAt: number;
}

export interface MediaAsset {
  id: number;
  volumeId: number;
  relpath: string;
  sizeBytes: number;
  mtime: number;
  blake3: string;
  kind: "image" | "video" | "other";
  width: number | null;
  height: number | null;
  durationMs: number | null;
  thumbPath: string | null;
  state: "live" | "broken";
}

export interface Message {
  id: number;
  convId: number;
  mediaId: number | null;
  caption: string | null;
  playCount: number;
  createdAt: number;
  media: MediaAsset | null;
}
