export type AppLanguage = "en" | "ru";
export type SyncProvider = "none" | "googleDrive" | "selfHosted";
export type MobileSection = "vault" | "notes" | "editor";
export type SaveState = "idle" | "saving" | "saved";
export type AssetKind = "image" | "file" | "audio" | "video";
export type NoteContentType = "note" | "canvas";
export type NoteListView = "all" | "favorites" | "archived" | "trash";
export type SyncState = "local" | "dirty" | "synced" | "conflict";
export type SyncStatus = "disabled" | "idle" | "syncing" | "error";
export type ConflictStrategy = "duplicate";
export type SyncEntityKind = "project" | "folder" | "tag" | "note" | "asset";

export interface StoredBlock {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: StoredBlock[];
  [key: string]: unknown;
}

export type NoteContent = StoredBlock[];

export interface CanvasSceneElement {
  id: string;
  type: string;
  isDeleted?: boolean;
  fileId?: string | null;
  [key: string]: unknown;
}

export interface CanvasSceneAppState {
  viewBackgroundColor?: string;
  gridSize?: number | null;
  gridStep?: number;
  scrollX?: number;
  scrollY?: number;
  zoom?: {
    value?: number;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface CanvasContent {
  elements: CanvasSceneElement[];
  appState: CanvasSceneAppState | null;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  createdAt: number;
  updatedAt: number;
}

export interface Folder {
  id: string;
  projectId: string;
  name: string;
  parentId: string | null;
  color: string;
  createdAt: number;
  updatedAt: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  updatedAt: number;
}

export interface Note {
  id: string;
  title: string;
  contentType: NoteContentType;
  projectId: string;
  folderId: string | null;
  color: string;
  tagIds: string[];
  content: NoteContent;
  canvasContent: CanvasContent | null;
  excerpt: string;
  plainText: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  favorite: boolean;
  archived: boolean;
  trashedAt: number | null;
  syncState: SyncState;
  conflictOriginId: string | null;
}

export interface Asset {
  id: string;
  noteId: string;
  name: string;
  mimeType: string;
  size: number;
  kind: AssetKind;
  blob: Blob;
  version?: number;
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings {
  id: "app";
  language: AppLanguage;
  syncEnabled: boolean;
  syncStatus: SyncStatus;
  syncProvider: SyncProvider;
  selfHostedUrl: string;
  selfHostedVaultId: string;
  selfHostedToken: string;
  conflictStrategy: ConflictStrategy;
  encryptionEnabled: boolean;
  lastSyncAt: number | null;
  syncCursor: string | null;
  localDeviceId: string;
  lastOpenedNoteId: string | null;
}

export interface SyncShadow {
  key: string;
  entityType: SyncEntityKind;
  entityId: string;
  hash: string;
  deleted: boolean;
  syncedAt: number;
  revision: string | null;
}

export interface SyncTombstone {
  key: string;
  entityType: SyncEntityKind;
  entityId: string;
  deletedAt: number;
}

export interface SyncedNoteRecord {
  id: string;
  title: string;
  contentType: NoteContentType;
  projectId: string;
  folderId: string | null;
  color: string;
  tagIds: string[];
  content: NoteContent;
  canvasContent: CanvasContent | null;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  favorite: boolean;
  archived: boolean;
  trashedAt: number | null;
  conflictOriginId: string | null;
}

export interface SyncedAssetRecord {
  id: string;
  noteId: string;
  name: string;
  mimeType: string;
  size: number;
  kind: AssetKind;
  data: string;
  version?: number;
  createdAt: number;
  updatedAt: number;
}

export interface SyncSnapshot {
  deviceId: string;
  exportedAt: number;
  projects: Project[];
  folders: Folder[];
  tags: Tag[];
  notes: SyncedNoteRecord[];
  assets: SyncedAssetRecord[];
  tombstones: SyncTombstone[];
}

export interface SyncEnvelope {
  revision: string | null;
  snapshot: SyncSnapshot;
}

export interface SyncRunStats {
  pulled: number;
  pushed: number;
  conflicts: number;
}
