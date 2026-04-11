export type AppLanguage = "en" | "ru";
export type SyncProvider = "none" | "googleDrive" | "selfHosted";
export type MobileSection = "vault" | "notes" | "editor";
export type SaveState = "idle" | "saving" | "saved";
export type AssetKind = "image" | "file" | "audio" | "video";
export type NoteListView = "all" | "favorites" | "archived" | "trash";
export type SyncState = "local" | "dirty" | "synced" | "conflict";
export type SyncStatus = "disabled" | "idle" | "syncing" | "error";
export type ConflictStrategy = "duplicate";

export interface StoredBlock {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: StoredBlock[];
  [key: string]: unknown;
}

export type NoteContent = StoredBlock[];

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
  projectId: string;
  folderId: string | null;
  color: string;
  tagIds: string[];
  content: NoteContent;
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
  selfHostedToken: string;
  conflictStrategy: ConflictStrategy;
  encryptionEnabled: boolean;
  lastSyncAt: number | null;
  localDeviceId: string;
  lastOpenedNoteId: string | null;
}
