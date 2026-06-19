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

export interface GeotaggedMedia {
  mediaId: number;
  lat: number;
  lon: number;
  kind: "image" | "video" | "other";
  absolutePath: string;
  /** False when the source volume's mount is unknown (can't preview now). */
  available: boolean;
  convId: number;
  messageId: number;
  createdAt: number;
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

export type RepairScope =
  | "lastFolderOnly"
  | "lastFolderRecursive"
  | "allMountedVolumes";

export interface AppSettings {
  missingFileStrategy: MissingFileStrategy;
  repairDefaultScope: RepairScope;
}

export interface BrokenItem {
  messageId: number;
  mediaId: number;
  kind: "image" | "video" | "other";
  thumbPath: string | null;
  lastKnownRelpath: string | null;
  lastKnownVolumeLabel: string | null;
  detectedAt: number;
  sizeBytes: number;
  messageCreatedAt: number;
}

export interface BrokenGroup {
  convId: number;
  convName: string;
  items: BrokenItem[];
}

export type RepairOutcome =
  | { status: "repaired"; absolute: string }
  | { status: "notFound" }
  | { status: "ambiguous"; candidates: string[] }
  | { status: "mismatch"; reason: string };

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

export interface VolumeStat {
  volumeId: number;
  label: string;
  mediaCount: number;
  sizeBytes: number;
}

export interface StorageStats {
  dataDir: string;
  totalMedia: number;
  totalBytes: number;
  byVolume: VolumeStat[];
}

export interface AuthStatus {
  hasIdentity: boolean;
  email: string | null;
  displayName: string | null;
  pictureUrl: string | null;
  vaultUnlocked: boolean;
}

export interface BackupExportResult {
  destPath: string;
  bytes: number;
  includesVault: boolean;
  dbEncrypted: boolean;
}

export interface BackupImportResult {
  backupDir: string;
  restoredDbBytes: number;
  includesVault: boolean;
  dbEncrypted: boolean;
}

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string | null;
  date: string | null;
  notes: string | null;
}
