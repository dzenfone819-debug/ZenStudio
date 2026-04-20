export type AppLanguage = "en" | "ru";
export type SyncProvider = "none" | "googleDrive" | "selfHosted" | "hosted";
export type SyncConnectionProvider = Exclude<SyncProvider, "none">;
export type MobileSection = "vault" | "notes" | "editor";
export type SaveState = "idle" | "saving" | "saved";
export type AssetKind = "image" | "file" | "audio" | "video";
export type NoteContentType = "note" | "canvas";
export type NoteListView = "all" | "favorites" | "archived" | "trash";
export type SyncState = "local" | "dirty" | "synced" | "conflict";
export type SyncStatus = "disabled" | "idle" | "syncing" | "error";
export type ConflictStrategy = "duplicate";
export type SyncEntityKind = "project" | "folder" | "tag" | "note" | "asset";
export type SyncPayloadMode = "plain" | "encrypted";
export type SyncEncryptionState = "disabled" | "ready" | "locked";
export type SyncEncryptionKdf = "pbkdf2-sha256";
export type SyncEncryptionCipher = "aes-gcm-256";

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
  hostedUrl: string;
  hostedSessionToken: string;
  hostedUserId: string | null;
  hostedUserName: string;
  hostedUserEmail: string;
  hostedVaultId: string;
  hostedSyncToken: string;
  conflictStrategy: ConflictStrategy;
  encryptionEnabled: boolean;
  encryptionVersion: number | null;
  encryptionKdf: SyncEncryptionKdf | null;
  encryptionIterations: number | null;
  encryptionKeyId: string | null;
  encryptionSalt: string | null;
  encryptionKeyCheck: string | null;
  encryptionUpdatedAt: number | null;
  lastSyncAt: number | null;
  syncCursor: string | null;
  localDeviceId: string;
  lastOpenedNoteId: string | null;
}

export interface VaultEncryptionSummary {
  enabled: boolean;
  state: SyncEncryptionState;
  keyId: string | null;
  updatedAt: number | null;
}

export interface SyncRemoteVault {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  lastRevision: string | null;
  lastSyncAt: number | null;
  tokenCount?: number;
}

export interface SyncConnection {
  id: string;
  provider: SyncConnectionProvider;
  label: string;
  serverUrl: string;
  managementToken: string;
  sessionToken: string;
  tokenExpiresAt: number | null;
  userId: string | null;
  userName: string;
  userEmail: string;
  createdAt: number;
  updatedAt: number;
}

export interface SyncVaultBinding {
  id: string;
  localVaultId: string;
  connectionId: string;
  remoteVaultId: string;
  remoteVaultName: string;
  syncToken: string;
  syncStatus: SyncStatus;
  lastSyncAt: number | null;
  syncCursor: string | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface RemoteVaultImportResult {
  localVaultId: string;
  localVaultName: string;
  disposition: "imported" | "linked" | "pendingUnlock";
  nameAdjusted: boolean;
}

export interface HostedAccountUser {
  id: string;
  name: string;
  email: string | null;
  role: "member" | "admin";
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
  hasPassword: boolean;
}

export interface HostedAccountSession {
  id: string;
  createdAt: number;
  expiresAt: number;
  token: string;
}

export interface HostedAccountVault {
  id: string;
  name: string;
  ownerUserId: string | null;
  ownerName: string | null;
  createdAt: number;
  updatedAt: number;
  lastRevision: string | null;
  lastSyncAt: number | null;
  tokenCount: number;
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

export interface SyncDirtyEntry {
  key: string;
  entityType: SyncEntityKind;
  entityId: string;
  updatedAt: number;
  deleted: boolean;
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

export interface SyncVaultDescriptor {
  localVaultId: string | null;
  vaultGuid: string | null;
  name: string | null;
  schemaVersion: number;
}

export interface SyncEncryptionDescriptor {
  version: 1;
  state: SyncEncryptionState;
  keyId: string | null;
  kdf: SyncEncryptionKdf;
  iterations: number | null;
  salt: string | null;
  keyCheck: string | null;
}

export interface SyncEncryptedPayload {
  version: 1;
  cipher: SyncEncryptionCipher;
  iv: string;
  ciphertext: string;
}

export interface SyncEnvelopeMetadata {
  schemaVersion: 1;
  payloadMode: SyncPayloadMode;
  vault: SyncVaultDescriptor | null;
  encryption: SyncEncryptionDescriptor | null;
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

export interface SyncChangeSet {
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
  metadata?: SyncEnvelopeMetadata | null;
}

export interface SyncSecureEnvelope {
  revision: string | null;
  metadata: SyncEnvelopeMetadata;
  encryptedSnapshot: SyncEncryptedPayload;
}

export interface SyncChangeFeed {
  mode: "delta" | "snapshot";
  revision: string | null;
  baseRevision: string | null;
  changes: SyncChangeSet | null;
  snapshot: SyncSnapshot | null;
  metadata?: SyncEnvelopeMetadata | null;
}

export interface SyncRunStats {
  pulled: number;
  pushed: number;
  conflicts: number;
}
