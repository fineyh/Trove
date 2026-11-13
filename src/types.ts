export type ConversationKind = "manual" | "folder_watch";

export interface Conversation {
  id: number;
  name: string;
  hasAvatar: boolean;
  kind: ConversationKind;
  pinned: boolean;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  preview: string | null;
  previewKind: "text" | "image" | "video" | "other" | null;
  /** folder_watch: the source folder's volume isn't mounted. */
  sourceOffline: boolean;
}

export type MediaKind = "image" | "video" | "other";

/**
 * "ok": reachable. "offline": its volume isn't mounted (not a problem, just
 * not here). "missing": the volume is mounted but the file is gone (ADR-035).
 */
export type MediaStatus = "ok" | "offline" | "missing";

export interface MediaPayload {
  id: number;
  kind: MediaKind;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  sizeBytes: number;
  /** Lower-case extension. Paths never reach the WebView (ADR-037). */
  ext: string;
  status: MediaStatus;
  hasThumb: boolean;
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
  kind: MediaKind;
  ext: string;
  status: MediaStatus;
  hasThumb: boolean;
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
  lib: string;
  convId: number;
  added: number;
  broken: number;
  renamed?: number;
}

/** Payload of the backend `import:progress` event. */
export interface ImportProgressEvent {
  lib: string;
  convId: number;
  done: number;
  /** 0 = still enumerating the folder (show an indeterminate bar). */
  total: number;
  current: string | null;
  finished: boolean;
  cancelled: boolean;
  /** 单个文件导入失败的个数（不会中断整批）。 */
  failed: number;
}

export type OfflineContent = "show" | "hide";

export type RepairScope =
  | "lastFolderOnly"
  | "lastFolderRecursive"
  | "allMountedVolumes";

/** 0 = never. */
export type IdleLockMinutes = 0 | 5 | 15 | 30 | 60;

export type MapTiles = "online" | "off";

export interface AppSettings {
  offlineContent: OfflineContent;
  repairDefaultScope: RepairScope;
  idleLockMinutes: IdleLockMinutes;
  mapTiles: MapTiles;
}

export interface BrokenItem {
  messageId: number;
  mediaId: number;
  kind: MediaKind;
  hasThumb: boolean;
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
  passwordProtected: boolean;
}

export interface BackupImportResult {
  backupDir: string;
  passwordProtected: boolean;
  libraries: number;
}

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string | null;
  date: string | null;
  notes: string | null;
  channel: UpdateChannel;
  /** Unix ms. */
  checkedAt: number;
}

export type UpdateChannel = "stable" | "beta";

export type DownloadEvent =
  | { event: "progress"; downloaded: number; total: number | null }
  | { event: "installing" };

export interface AppEnvironment {
  version: string;
  channel: UpdateChannel;
  os: string;
  arch: string;
  webview: string | null;
}

// ─── Security & libraries (ADR-036 / ADR-038) ───────────────────────────────

/** Startup failed (R4.1): the window shows only this. */
export type BootErrorKind =
  | "keyring_missing"
  | "keyring_damaged"
  | "newer_version"
  | "library_unreadable"
  | "data_dir"
  | "other";

export interface BootError {
  kind: BootErrorKind;
  /** The raw error, shown folded away. */
  detail: string;
  dataDir: string;
}

export interface SecurityStatus {
  /** A startup password is set. */
  appPassword: boolean;
  appUnlocked: boolean;
  appRecovery: boolean;
  mainLibrary: string;
  /** The plaintext pre-migration database is still on disk. */
  legacyPlainCopy: boolean;
  legacyProblem: string | null;
}

export type UnlockedBy = "app" | "password" | "recovery" | "keyfile";

export interface LibraryInfo {
  id: string;
  name: string;
  /** One emoji, or null for the name's first letter. */
  icon: string | null;
  /** One of `LIBRARY_COLORS`' keys. */
  color: string | null;
  isMain: boolean;
  /** Has its own password: doesn't open with the app. */
  encrypted: boolean;
  unlocked: boolean;
  unlockedBy: UnlockedBy | null;
  hasRecovery: boolean;
  keyfilePath: string | null;
}

export interface CreatedLibrary {
  id: string;
  recoveryCode: string | null;
}

export type UnlockMethod = "password" | "recovery";
