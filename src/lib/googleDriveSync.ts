import { createPlainSyncDescriptor } from "./e2ee";
import type {
  SyncChangeFeed,
  SyncChangeSet,
  SyncConnection,
  SyncEnvelope,
  SyncEncryptedPayload,
  SyncRemoteVault,
  SyncSecureEnvelope,
  SyncSnapshot,
  SyncTombstone,
  SyncVaultDescriptor
} from "../types";

export const GOOGLE_DRIVE_API_BASE_URL = "https://www.googleapis.com";
export const GOOGLE_DRIVE_UPLOAD_BASE_URL = "https://www.googleapis.com/upload/drive/v3/files";
export const GOOGLE_DRIVE_FILES_BASE_URL = "https://www.googleapis.com/drive/v3/files";
export const GOOGLE_DRIVE_ABOUT_URL = "https://www.googleapis.com/drive/v3/about";
export const GOOGLE_DRIVE_APP_DATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
export const GOOGLE_DRIVE_APP_FOLDER = "appDataFolder";
export const GOOGLE_DRIVE_MANIFEST_FILE = "zen-sync-manifest.json";
export const GOOGLE_DRIVE_VAULT_PREFIX = "vault-";
export const GOOGLE_DRIVE_VAULT_JOURNAL_SUFFIX = ".journal.json";
export const GOOGLE_DRIVE_BINDING_TOKEN = "google-drive-session";
const GOOGLE_IDENTITY_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
const GOOGLE_IDENTITY_LOAD_TIMEOUT_MS = 10_000;
const GOOGLE_IDENTITY_POLL_INTERVAL_MS = 50;
const GOOGLE_DRIVE_CHANGE_HISTORY_LIMIT = 240;

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

type GoogleTokenClientConfig = {
  client_id: string;
  scope: string;
  callback: (response: GoogleTokenResponse) => void;
  error_callback?: (error: { type?: string }) => void;
  include_granted_scopes?: boolean;
  prompt?: string;
  login_hint?: string;
};

type GoogleTokenClient = {
  requestAccessToken: (config?: {
    prompt?: string;
    login_hint?: string;
    scope?: string;
    include_granted_scopes?: boolean;
  }) => void;
};

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: GoogleTokenClientConfig) => GoogleTokenClient;
        };
      };
    };
  }
}

type GoogleDriveAboutResponse = {
  user?: {
    displayName?: string;
    emailAddress?: string;
    permissionId?: string;
  };
};

type GoogleDriveListResponse = {
  files?: Array<{
    id?: string;
    name?: string;
    createdTime?: string;
    modifiedTime?: string;
  }>;
};

type GoogleDriveFileMeta = {
  id: string;
  name: string;
  createdTime: string;
  modifiedTime: string;
};

type GoogleDriveManifestFileState = {
  fileId: string | null;
  manifest: GoogleDriveManifest;
  files: GoogleDriveFileMeta[];
};

export interface GoogleDriveConnectionDraft {
  provider: "googleDrive";
  accessToken: string;
  expiresAt: number | null;
  refreshToken?: string | null;
}

export interface GoogleDriveRemoteVaultRecord {
  id: string;
  name: string;
  fileId: string;
  journalFileId?: string | null;
  vaultKind: "regular" | "private";
  updatedAt: number;
  revision: string | null;
}

export interface GoogleDriveManifest {
  schemaVersion: 1;
  provider: "googleDrive";
  folder: typeof GOOGLE_DRIVE_APP_FOLDER;
  updatedAt: number;
  vaults: GoogleDriveRemoteVaultRecord[];
}

export interface GoogleDriveVaultBlob {
  schemaVersion: 1;
  provider: "googleDrive";
  vaultId: string;
  updatedAt: number;
  envelope: SyncEnvelope | SyncSecureEnvelope;
}

interface GoogleDriveVaultJournalEntry {
  revision: string;
  baseRevision: string | null;
  createdAt: number;
  changes: SyncChangeSet | null;
  encryptedChanges: SyncEncryptedPayload | null;
}

interface GoogleDriveVaultJournalBlob {
  schemaVersion: 1;
  provider: "googleDrive";
  vaultId: string;
  updatedAt: number;
  entries: GoogleDriveVaultJournalEntry[];
}

export interface GoogleDriveAccountSession {
  accessToken: string;
  expiresAt: number | null;
  userId: string | null;
  userName: string;
  userEmail: string;
}

let googleIdentityLoadPromise: Promise<NonNullable<Window["google"]>> | null = null;

function now() {
  return Date.now();
}

function getClientIdFromEnv() {
  return import.meta.env.VITE_GOOGLE_DRIVE_CLIENT_ID?.trim() ?? "";
}

export function getGoogleDriveClientId() {
  return getClientIdFromEnv();
}

export function isGoogleDriveConfigured() {
  return Boolean(getClientIdFromEnv());
}

function ensureClientId(clientId?: string) {
  const value = clientId?.trim() || getClientIdFromEnv();

  if (!value) {
    throw new Error("GOOGLE_DRIVE_CLIENT_ID_REQUIRED");
  }

  return value;
}

function normalizeDriveTimestamp(value: string | undefined) {
  if (!value) {
    return now();
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : now();
}

function createDefaultManifest(): GoogleDriveManifest {
  return {
    schemaVersion: 1,
    provider: "googleDrive",
    folder: GOOGLE_DRIVE_APP_FOLDER,
    updatedAt: now(),
    vaults: []
  };
}

function sanitizeText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

function createEmptyChangeSet(deviceId = "google-drive"): SyncChangeSet {
  return {
    deviceId,
    exportedAt: 0,
    projects: [],
    folders: [],
    tags: [],
    notes: [],
    assets: [],
    tombstones: []
  };
}

function normalizeEncryptedPayload(value: unknown): SyncEncryptedPayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as Partial<SyncEncryptedPayload>;

  if (
    payload.version !== 1 ||
    payload.cipher !== "aes-gcm-256" ||
    typeof payload.iv !== "string" ||
    !payload.iv.trim() ||
    typeof payload.ciphertext !== "string" ||
    !payload.ciphertext.trim()
  ) {
    return null;
  }

  return {
    version: 1,
    cipher: "aes-gcm-256",
    iv: payload.iv.trim(),
    ciphertext: payload.ciphertext.trim()
  };
}

function normalizeChangeSetPayload(
  payload: Partial<SyncChangeSet> | null | undefined,
  fallbackDeviceId = "google-drive"
): SyncChangeSet {
  if (!payload || typeof payload !== "object") {
    return createEmptyChangeSet(fallbackDeviceId);
  }

  return {
    deviceId: typeof payload.deviceId === "string" ? payload.deviceId : fallbackDeviceId,
    exportedAt: typeof payload.exportedAt === "number" ? payload.exportedAt : now(),
    projects: Array.isArray(payload.projects) ? payload.projects.filter(Boolean) : [],
    folders: Array.isArray(payload.folders) ? payload.folders.filter(Boolean) : [],
    tags: Array.isArray(payload.tags) ? payload.tags.filter(Boolean) : [],
    notes: Array.isArray(payload.notes) ? payload.notes.filter(Boolean) : [],
    assets: Array.isArray(payload.assets) ? payload.assets.filter(Boolean) : [],
    tombstones: Array.isArray(payload.tombstones) ? payload.tombstones.filter(Boolean) : []
  };
}

function sortById<T extends { id: string }>(records: readonly T[]) {
  return [...records].sort((left, right) => left.id.localeCompare(right.id));
}

function sortTombstones(records: readonly SyncTombstone[]) {
  return [...records].sort((left, right) => left.key.localeCompare(right.key));
}

function getEntityKey(entityType: "project" | "folder" | "tag" | "note" | "asset", entityId: string) {
  return `${entityType}:${entityId}`;
}

function applyChangeSetIntoMaps(
  maps: {
    project: Map<string, SyncChangeSet["projects"][number]>;
    folder: Map<string, SyncChangeSet["folders"][number]>;
    tag: Map<string, SyncChangeSet["tags"][number]>;
    note: Map<string, SyncChangeSet["notes"][number]>;
    asset: Map<string, SyncChangeSet["assets"][number]>;
    tombstones: Map<string, SyncTombstone>;
  },
  changeSet: SyncChangeSet
) {
  const applyRecords = <T extends { id: string }>(
    entityType: "project" | "folder" | "tag" | "note" | "asset",
    target: Map<string, T>,
    records: readonly T[]
  ) => {
    records.forEach((record) => {
      target.set(record.id, record);
      maps.tombstones.delete(getEntityKey(entityType, record.id));
    });
  };

  applyRecords("project", maps.project, changeSet.projects);
  applyRecords("folder", maps.folder, changeSet.folders);
  applyRecords("tag", maps.tag, changeSet.tags);
  applyRecords("note", maps.note, changeSet.notes);
  applyRecords("asset", maps.asset, changeSet.assets);

  changeSet.tombstones.forEach((tombstone) => {
    switch (tombstone.entityType) {
      case "project":
        maps.project.delete(tombstone.entityId);
        break;
      case "folder":
        maps.folder.delete(tombstone.entityId);
        break;
      case "tag":
        maps.tag.delete(tombstone.entityId);
        break;
      case "note":
        maps.note.delete(tombstone.entityId);
        break;
      case "asset":
        maps.asset.delete(tombstone.entityId);
        break;
    }

    maps.tombstones.set(tombstone.key, tombstone);
  });
}

function collapseChangeSetBatches(changeSets: readonly SyncChangeSet[]) {
  const maps = {
    project: new Map<string, SyncChangeSet["projects"][number]>(),
    folder: new Map<string, SyncChangeSet["folders"][number]>(),
    tag: new Map<string, SyncChangeSet["tags"][number]>(),
    note: new Map<string, SyncChangeSet["notes"][number]>(),
    asset: new Map<string, SyncChangeSet["assets"][number]>(),
    tombstones: new Map<string, SyncTombstone>()
  };
  let deviceId = "google-drive";
  let exportedAt = 0;

  changeSets.forEach((rawChangeSet) => {
    const changeSet = normalizeChangeSetPayload(rawChangeSet, deviceId);
    deviceId = changeSet.deviceId || deviceId;
    exportedAt = Math.max(exportedAt, changeSet.exportedAt || 0);
    applyChangeSetIntoMaps(maps, changeSet);
  });

  return {
    deviceId,
    exportedAt,
    projects: sortById([...maps.project.values()]),
    folders: sortById([...maps.folder.values()]),
    tags: sortById([...maps.tag.values()]),
    notes: sortById([...maps.note.values()]),
    assets: sortById([...maps.asset.values()]),
    tombstones: sortTombstones([...maps.tombstones.values()])
  } satisfies SyncChangeSet;
}

function pruneJournalEntries(entries: readonly GoogleDriveVaultJournalEntry[]) {
  return entries.slice(-GOOGLE_DRIVE_CHANGE_HISTORY_LIMIT);
}

function buildVaultDescriptor(vaultId: string, vaultName: string): SyncVaultDescriptor {
  return {
    localVaultId: null,
    vaultGuid: vaultId,
    name: vaultName,
    vaultKind: "regular",
    schemaVersion: 1
  };
}

function createEmptyGoogleDriveEnvelope(vaultId: string, vaultName: string): SyncEnvelope {
  const snapshot: SyncSnapshot = {
    deviceId: "google-drive",
    exportedAt: 0,
    projects: [],
    folders: [],
    tags: [],
    notes: [],
    assets: [],
    tombstones: []
  };

  return {
    revision: null,
    snapshot,
    metadata: createPlainSyncDescriptor(buildVaultDescriptor(vaultId, vaultName))
  };
}

function createDefaultVaultBlob(vaultId: string, vaultName: string): GoogleDriveVaultBlob {
  return {
    schemaVersion: 1,
    provider: "googleDrive",
    vaultId,
    updatedAt: now(),
    envelope: createEmptyGoogleDriveEnvelope(vaultId, vaultName)
  };
}

function createDefaultVaultJournalBlob(vaultId: string): GoogleDriveVaultJournalBlob {
  return {
    schemaVersion: 1,
    provider: "googleDrive",
    vaultId,
    updatedAt: now(),
    entries: []
  };
}

function buildGoogleDriveVaultStateFileName(vaultId: string) {
  return `${GOOGLE_DRIVE_VAULT_PREFIX}${vaultId}.json`;
}

function buildGoogleDriveVaultJournalFileName(vaultId: string) {
  return `${GOOGLE_DRIVE_VAULT_PREFIX}${vaultId}${GOOGLE_DRIVE_VAULT_JOURNAL_SUFFIX}`;
}

function escapeQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function buildGoogleAuthHeaders(accessToken: string, extra?: HeadersInit) {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...extra
  };
}

function getGoogleIdentityApi() {
  return window.google?.accounts?.oauth2 ? window.google : null;
}

export function googleDriveOAuthReady() {
  if (typeof window === "undefined") {
    return false;
  }

  return Boolean(getGoogleIdentityApi());
}

export async function prepareGoogleDriveOAuth() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("GOOGLE_OAUTH_UNAVAILABLE");
  }

  const ready = getGoogleIdentityApi();

  if (ready) {
    return ready;
  }

  if (googleIdentityLoadPromise) {
    return googleIdentityLoadPromise;
  }

  googleIdentityLoadPromise = new Promise<NonNullable<Window["google"]>>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity="true"]');
    let script: HTMLScriptElement | null = existing;
    let timeoutId: number | null = null;
    let pollId: number | null = null;
    let settled = false;

    const cleanup = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      if (pollId !== null) {
        window.clearTimeout(pollId);
      }

      script?.removeEventListener("load", handleLoad);
      script?.removeEventListener("error", handleError);
    };

    const finalizeSuccess = (api: NonNullable<Window["google"]>) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(api);
    };

    const finalizeError = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      googleIdentityLoadPromise = null;
      reject(error);
    };

    const pollUntilReady = () => {
      const api = getGoogleIdentityApi();

      if (api) {
        finalizeSuccess(api);
        return;
      }

      pollId = window.setTimeout(pollUntilReady, GOOGLE_IDENTITY_POLL_INTERVAL_MS);
    };

    const handleLoad = () => {
      script?.setAttribute("data-google-identity-loaded", "true");
      pollUntilReady();
    };

    const handleError = () => {
      finalizeError(new Error("GOOGLE_OAUTH_SCRIPT_FAILED"));
    };

    timeoutId = window.setTimeout(() => {
      finalizeError(new Error("GOOGLE_OAUTH_SCRIPT_FAILED"));
    }, GOOGLE_IDENTITY_LOAD_TIMEOUT_MS);

    script =
      existing ??
      (() => {
        const nextScript = document.createElement("script");
        nextScript.src = GOOGLE_IDENTITY_SCRIPT_SRC;
        nextScript.async = true;
        nextScript.defer = true;
        nextScript.dataset.googleIdentity = "true";
        document.head.appendChild(nextScript);
        return nextScript;
      })();

    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });
    pollUntilReady();
  });

  return googleIdentityLoadPromise;
}

function requestGoogleDriveAccessToken(options?: {
  clientId?: string;
  prompt?: string;
  loginHint?: string;
  silent?: boolean;
}) {
  const google = getGoogleIdentityApi();
  const clientId = ensureClientId(options?.clientId);
  const silent = options?.silent === true;
  const prompt = options?.prompt ?? (silent ? "none" : "consent select_account");

  if (!google?.accounts?.oauth2) {
    throw new Error("GOOGLE_OAUTH_NOT_READY");
  }

  return new Promise<GoogleTokenResponse>((resolve, reject) => {
    const tokenClient = google.accounts?.oauth2?.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_DRIVE_APP_DATA_SCOPE,
      include_granted_scopes: true,
      prompt,
      login_hint: options?.loginHint,
      callback: (response) => {
        if (response.error) {
          reject(new Error(silent ? "GOOGLE_DRIVE_AUTH_REQUIRED" : response.error));
          return;
        }

        resolve(response);
      },
      error_callback: (error) => {
        if (silent) {
          reject(new Error("GOOGLE_DRIVE_AUTH_REQUIRED"));
          return;
        }

        if (error.type === "popup_closed") {
          reject(new Error("GOOGLE_OAUTH_POPUP_CLOSED"));
          return;
        }

        if (error.type === "popup_failed_to_open") {
          reject(new Error("GOOGLE_OAUTH_POPUP_FAILED"));
          return;
        }

        reject(new Error("GOOGLE_OAUTH_FAILED"));
      }
    });

    if (!tokenClient) {
      reject(new Error("GOOGLE_OAUTH_UNAVAILABLE"));
      return;
    }

    tokenClient.requestAccessToken({
      prompt,
      login_hint: options?.loginHint
    });
  });
}

async function googleDriveJsonRequest<T>(
  url: string,
  accessToken: string,
  init: RequestInit = {}
) {
  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      headers: buildGoogleAuthHeaders(accessToken, init.headers)
    });
  } catch {
    throw new Error("SERVER_UNAVAILABLE");
  }

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? ((await response.json().catch(() => null)) as T | { error?: { message?: string } } | null)
    : null;

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("GOOGLE_DRIVE_AUTH_REQUIRED");
    }

    const driveMessage =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error &&
      typeof payload.error === "object" &&
      "message" in payload.error &&
      typeof payload.error.message === "string"
        ? payload.error.message
        : null;

    throw new Error(driveMessage || `HTTP_${response.status}`);
  }

  return payload as T;
}

async function googleDriveTextRequest(url: string, accessToken: string) {
  let response: Response;

  try {
    response = await fetch(url, {
      method: "GET",
      headers: buildGoogleAuthHeaders(accessToken)
    });
  } catch {
    throw new Error("SERVER_UNAVAILABLE");
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("GOOGLE_DRIVE_AUTH_REQUIRED");
    }

    throw new Error(`HTTP_${response.status}`);
  }

  return response.text();
}

async function googleDriveDeleteRequest(url: string, accessToken: string) {
  let response: Response;

  try {
    response = await fetch(url, {
      method: "DELETE",
      headers: buildGoogleAuthHeaders(accessToken)
    });
  } catch {
    throw new Error("SERVER_UNAVAILABLE");
  }

  if (!response.ok && response.status !== 404) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("GOOGLE_DRIVE_AUTH_REQUIRED");
    }

    throw new Error(`HTTP_${response.status}`);
  }
}

async function uploadGoogleDriveJsonFile<T extends object>(input: {
  accessToken: string;
  fileId?: string | null;
  name: string;
  payload: T;
  parents?: string[];
}) {
  const boundary = `zen-notes-${crypto.randomUUID()}`;
  const metadata = {
    name: input.name,
    ...(input.parents?.length ? { parents: input.parents } : {})
  };
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(input.payload),
    `--${boundary}--`
  ].join("\r\n");
  const url = input.fileId
    ? `${GOOGLE_DRIVE_UPLOAD_BASE_URL}/${encodeURIComponent(input.fileId)}?uploadType=multipart&fields=id,name,createdTime,modifiedTime`
    : `${GOOGLE_DRIVE_UPLOAD_BASE_URL}?uploadType=multipart&fields=id,name,createdTime,modifiedTime`;

  return googleDriveJsonRequest<{
    id?: string;
    name?: string;
    createdTime?: string;
    modifiedTime?: string;
  }>(url, input.accessToken, {
    method: input.fileId ? "PATCH" : "POST",
    headers: {
      "Content-Type": `multipart/related; boundary=${boundary}`
    },
    body
  });
}

async function listGoogleDriveAppDataFiles(accessToken: string) {
  const params = new URLSearchParams({
    spaces: GOOGLE_DRIVE_APP_FOLDER,
    fields: "files(id,name,createdTime,modifiedTime)",
    pageSize: "1000"
  });
  const payload = await googleDriveJsonRequest<GoogleDriveListResponse>(
    `${GOOGLE_DRIVE_FILES_BASE_URL}?${params.toString()}`,
    accessToken,
    {
      method: "GET"
    }
  );

  return (payload.files ?? [])
    .map((file) => ({
      id: sanitizeText(file.id),
      name: sanitizeText(file.name),
      createdTime: sanitizeText(file.createdTime),
      modifiedTime: sanitizeText(file.modifiedTime)
    }))
    .filter((file) => file.id && file.name);
}

async function readDriveFileJson<T>(accessToken: string, fileId: string) {
  const text = await googleDriveTextRequest(
    `${GOOGLE_DRIVE_FILES_BASE_URL}/${encodeURIComponent(fileId)}?alt=media`,
    accessToken
  );

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("GOOGLE_DRIVE_INVALID_PAYLOAD");
  }
}

async function readGoogleDriveManifestState(accessToken: string): Promise<GoogleDriveManifestFileState> {
  const files = await listGoogleDriveAppDataFiles(accessToken);
  const manifestMeta = files.find((file) => file.name === GOOGLE_DRIVE_MANIFEST_FILE) ?? null;

  if (!manifestMeta) {
    return {
      fileId: null,
      manifest: createDefaultManifest(),
      files
    };
  }

  const payload = await readDriveFileJson<GoogleDriveManifest>(accessToken, manifestMeta.id).catch(() => null);
  const manifest = payload && payload.provider === "googleDrive" ? payload : createDefaultManifest();

  return {
    fileId: manifestMeta.id,
    manifest: {
      ...createDefaultManifest(),
      ...manifest,
      vaults: Array.isArray(manifest.vaults)
        ? manifest.vaults.map((entry) => ({
            ...entry,
            journalFileId: sanitizeText(entry?.journalFileId, "") || null,
            vaultKind: entry?.vaultKind === "private" ? "private" : "regular"
          }))
        : []
    },
    files
  };
}

async function writeGoogleDriveManifest(accessToken: string, state: GoogleDriveManifestFileState) {
  const payload: GoogleDriveManifest = {
    ...state.manifest,
    updatedAt: now(),
    vaults: [...state.manifest.vaults].sort((left, right) => left.name.localeCompare(right.name))
  };

  const response = await uploadGoogleDriveJsonFile({
    accessToken,
    fileId: state.fileId,
    name: GOOGLE_DRIVE_MANIFEST_FILE,
    parents: state.fileId ? undefined : [GOOGLE_DRIVE_APP_FOLDER],
    payload
  });

  return {
    fileId: sanitizeText(response.id) || state.fileId,
    manifest: payload
  };
}

function deriveVaultIdFromFileName(fileName: string) {
  if (
    !fileName.startsWith(GOOGLE_DRIVE_VAULT_PREFIX) ||
    !fileName.endsWith(".json") ||
    fileName.endsWith(GOOGLE_DRIVE_VAULT_JOURNAL_SUFFIX)
  ) {
    return null;
  }

  return fileName.slice(GOOGLE_DRIVE_VAULT_PREFIX.length, -".json".length).trim() || null;
}

function deriveVaultIdFromJournalFileName(fileName: string) {
  if (
    !fileName.startsWith(GOOGLE_DRIVE_VAULT_PREFIX) ||
    !fileName.endsWith(GOOGLE_DRIVE_VAULT_JOURNAL_SUFFIX)
  ) {
    return null;
  }

  return fileName
    .slice(GOOGLE_DRIVE_VAULT_PREFIX.length, -GOOGLE_DRIVE_VAULT_JOURNAL_SUFFIX.length)
    .trim() || null;
}

function normalizeRemoteVaultRecord(record: GoogleDriveRemoteVaultRecord): SyncRemoteVault {
  return {
    id: record.id,
    name: record.name,
    vaultKind: record.vaultKind,
    createdAt: record.updatedAt,
    updatedAt: record.updatedAt,
    lastRevision: record.revision ?? null,
    lastSyncAt: record.updatedAt,
    tokenCount: 1
  };
}

async function parseVaultFileForCatalog(accessToken: string, file: GoogleDriveFileMeta) {
  const blob = await readDriveFileJson<GoogleDriveVaultBlob | SyncEnvelope>(accessToken, file.id).catch(() => null);
  const derivedId = deriveVaultIdFromFileName(file.name);

  if (!blob) {
    if (!derivedId) {
      return null;
    }

    return {
      id: derivedId,
      name: derivedId,
      fileId: file.id,
      vaultKind: "regular",
      updatedAt: normalizeDriveTimestamp(file.modifiedTime),
      revision: null
    } satisfies GoogleDriveRemoteVaultRecord;
  }

  if ("envelope" in blob && blob.envelope && typeof blob.envelope === "object") {
    const envelope = blob.envelope;
    const vaultId = sanitizeText(blob.vaultId, derivedId ?? "");
    const vaultName =
      sanitizeText(
        envelope.metadata?.vault?.name,
        sanitizeText(blob.vaultId, derivedId ?? "")
      ) || vaultId;

    if (!vaultId) {
      return null;
    }

    return {
      id: vaultId,
      name: vaultName,
      fileId: file.id,
      vaultKind: envelope.metadata?.payloadMode === "encrypted" ? "private" : "regular",
      updatedAt: normalizeDriveTimestamp(file.modifiedTime),
      revision: envelope.revision ?? null
    } satisfies GoogleDriveRemoteVaultRecord;
  }

  if ("snapshot" in blob && derivedId) {
    return {
      id: derivedId,
      name: sanitizeText(blob.metadata?.vault?.name, derivedId),
      fileId: file.id,
      vaultKind: blob.metadata?.payloadMode === "encrypted" ? "private" : "regular",
      updatedAt: normalizeDriveTimestamp(file.modifiedTime),
      revision: blob.revision ?? null
    } satisfies GoogleDriveRemoteVaultRecord;
  }

  return null;
}

async function resolveGoogleDriveCatalog(accessToken: string) {
  const state = await readGoogleDriveManifestState(accessToken);
  const vaultFiles = state.files.filter(
    (file) => file.name !== GOOGLE_DRIVE_MANIFEST_FILE && deriveVaultIdFromFileName(file.name)
  );
  const journalFilesByVaultId = new Map(
    state.files
      .map((file) => [deriveVaultIdFromJournalFileName(file.name), file] as const)
      .filter((entry): entry is [string, GoogleDriveFileMeta] => Boolean(entry[0]))
  );
  const manifestById = new Map(state.manifest.vaults.map((entry) => [entry.id, entry]));
  const resolvedRecords: GoogleDriveRemoteVaultRecord[] = [];

  for (const file of vaultFiles) {
    const parsed = await parseVaultFileForCatalog(accessToken, file);

    if (!parsed) {
      continue;
    }

    const manifestEntry = manifestById.get(parsed.id);
    const journalMeta = journalFilesByVaultId.get(parsed.id) ?? null;
    resolvedRecords.push({
      ...parsed,
      journalFileId:
        sanitizeText(manifestEntry?.journalFileId, "") ||
        sanitizeText(journalMeta?.id, "") ||
        null,
      name: manifestEntry?.name || parsed.name,
      updatedAt: Math.max(parsed.updatedAt, manifestEntry?.updatedAt ?? 0),
      revision: manifestEntry?.revision ?? parsed.revision
    });
  }

  const manifestNeedsUpdate =
    resolvedRecords.length !== state.manifest.vaults.length ||
    resolvedRecords.some((record) => {
      const current = manifestById.get(record.id);
      return (
        !current ||
        current.fileId !== record.fileId ||
        (current.journalFileId ?? null) !== (record.journalFileId ?? null) ||
        current.name !== record.name ||
        current.vaultKind !== record.vaultKind ||
        current.revision !== record.revision
      );
    });

  if (manifestNeedsUpdate) {
    await writeGoogleDriveManifest(accessToken, {
      ...state,
      manifest: {
        ...state.manifest,
        updatedAt: now(),
        vaults: resolvedRecords
      }
    });
  }

  return resolvedRecords.sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name));
}

async function getRemoteVaultRecord(accessToken: string, vaultId: string) {
  const catalog = await resolveGoogleDriveCatalog(accessToken);
  return catalog.find((entry) => entry.id === vaultId) ?? null;
}

function normalizeEnvelopePayload(
  value: GoogleDriveVaultBlob | SyncEnvelope | SyncSecureEnvelope
): SyncEnvelope | SyncSecureEnvelope {
  const candidate =
    value && typeof value === "object" && "envelope" in value && value.envelope
      ? value.envelope
      : value;

  if (
    !candidate ||
    typeof candidate !== "object" ||
    (!("snapshot" in candidate) || !candidate.snapshot) &&
      (!("encryptedSnapshot" in candidate) || !candidate.encryptedSnapshot)
  ) {
    throw new Error("GOOGLE_DRIVE_INVALID_PAYLOAD");
  }

  return candidate as SyncEnvelope | SyncSecureEnvelope;
}

function isEncryptedEnvelope(
  envelope: SyncEnvelope | SyncSecureEnvelope
): envelope is SyncSecureEnvelope {
  return Boolean(
    envelope &&
      typeof envelope === "object" &&
      "encryptedSnapshot" in envelope &&
      envelope.encryptedSnapshot
  );
}

function buildSnapshotFallbackFeed(
  envelope: SyncEnvelope | SyncSecureEnvelope
): SyncChangeFeed {
  return {
    mode: "snapshot",
    revision: envelope.revision ?? null,
    baseRevision: null,
    changes: null,
    encryptedChanges: null,
    snapshot: isEncryptedEnvelope(envelope) ? null : envelope.snapshot,
    metadata: envelope.metadata ?? null
  };
}

function normalizeJournalEntry(
  entry: unknown,
  fallbackDeviceId = "google-drive"
): GoogleDriveVaultJournalEntry | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const payload = entry as Record<string, unknown>;
  const revision = sanitizeText(payload.revision, "");

  if (!revision) {
    return null;
  }

  const changes = payload.encryptedChanges
    ? null
    : normalizeChangeSetPayload(payload.changes as Partial<SyncChangeSet> | null, fallbackDeviceId);
  const encryptedChanges = normalizeEncryptedPayload(payload.encryptedChanges);

  if (!changes && !encryptedChanges) {
    return null;
  }

  return {
    revision,
    baseRevision:
      typeof payload.baseRevision === "string" || payload.baseRevision === null
        ? (payload.baseRevision ?? null)
        : null,
    createdAt: typeof payload.createdAt === "number" ? payload.createdAt : now(),
    changes,
    encryptedChanges
  };
}

async function readGoogleDriveJournalState(
  accessToken: string,
  record: Pick<GoogleDriveRemoteVaultRecord, "id" | "journalFileId">
) {
  let journalFileId = sanitizeText(record.journalFileId, "") || null;

  if (!journalFileId) {
    const files = await listGoogleDriveAppDataFiles(accessToken);
    const journalMeta =
      files.find((file) => file.name === buildGoogleDriveVaultJournalFileName(record.id)) ?? null;
    journalFileId = journalMeta?.id ?? null;
  }

  if (!journalFileId) {
    return {
      fileId: null,
      blob: createDefaultVaultJournalBlob(record.id)
    };
  }

  const payload = await readDriveFileJson<GoogleDriveVaultJournalBlob>(accessToken, journalFileId).catch(
    () => null
  );

  if (!payload || payload.provider !== "googleDrive" || !Array.isArray(payload.entries)) {
    return {
      fileId: journalFileId,
      blob: createDefaultVaultJournalBlob(record.id)
    };
  }

  return {
    fileId: journalFileId,
    blob: {
      schemaVersion: 1,
      provider: "googleDrive" as const,
      vaultId: sanitizeText(payload.vaultId, record.id) || record.id,
      updatedAt: typeof payload.updatedAt === "number" ? payload.updatedAt : now(),
      entries: payload.entries
        .map((entry) => normalizeJournalEntry(entry))
        .filter((entry): entry is GoogleDriveVaultJournalEntry => Boolean(entry))
    }
  };
}

async function writeGoogleDriveJournalState(
  accessToken: string,
  record: Pick<GoogleDriveRemoteVaultRecord, "id" | "journalFileId">,
  entries: readonly GoogleDriveVaultJournalEntry[]
) {
  const response = await uploadGoogleDriveJsonFile({
    accessToken,
    fileId: record.journalFileId ?? null,
    name: buildGoogleDriveVaultJournalFileName(record.id),
    parents: record.journalFileId ? undefined : [GOOGLE_DRIVE_APP_FOLDER],
    payload: {
      schemaVersion: 1,
      provider: "googleDrive",
      vaultId: record.id,
      updatedAt: now(),
      entries: pruneJournalEntries(entries)
    } satisfies GoogleDriveVaultJournalBlob
  });

  return sanitizeText(response.id, record.journalFileId ?? "") || null;
}

export async function connectGoogleDriveAccount(options?: {
  clientId?: string;
  loginHint?: string;
  prompt?: string;
  silent?: boolean;
}) {
  if (!googleDriveOAuthReady()) {
    await prepareGoogleDriveOAuth();
  }

  const token = await requestGoogleDriveAccessToken({
    clientId: options?.clientId,
    loginHint: options?.loginHint,
    prompt: options?.prompt,
    silent: options?.silent
  });

  if (!token.access_token) {
    throw new Error("GOOGLE_DRIVE_AUTH_REQUIRED");
  }

  const about = await googleDriveJsonRequest<GoogleDriveAboutResponse>(
    `${GOOGLE_DRIVE_ABOUT_URL}?fields=user(displayName,emailAddress,permissionId)`,
    token.access_token,
    {
      method: "GET"
    }
  );

  return {
    accessToken: token.access_token,
    expiresAt:
      typeof token.expires_in === "number" ? now() + Math.max(30, token.expires_in) * 1000 : null,
    userId: sanitizeText(about.user?.permissionId) || null,
    userName: sanitizeText(about.user?.displayName),
    userEmail: sanitizeText(about.user?.emailAddress)
  } satisfies GoogleDriveAccountSession;
}

export async function listGoogleDriveRemoteVaults(accessToken: string) {
  const records = await resolveGoogleDriveCatalog(accessToken);
  return records.map(normalizeRemoteVaultRecord);
}

export async function createGoogleDriveRemoteVault(
  accessToken: string,
  payload: {
    name: string;
    id?: string;
  }
) {
  const vaultId = sanitizeText(payload.id, "") || crypto.randomUUID();
  const vaultName = sanitizeText(payload.name, "New vault");
  const existing = await getRemoteVaultRecord(accessToken, vaultId);

  if (existing) {
    return normalizeRemoteVaultRecord(existing);
  }

  const fileName = `${GOOGLE_DRIVE_VAULT_PREFIX}${vaultId}.json`;
  const blob = createDefaultVaultBlob(vaultId, vaultName);
  const created = await uploadGoogleDriveJsonFile({
    accessToken,
    name: fileName,
    parents: [GOOGLE_DRIVE_APP_FOLDER],
    payload: blob
  });
  const journalCreated = await uploadGoogleDriveJsonFile({
    accessToken,
    name: buildGoogleDriveVaultJournalFileName(vaultId),
    parents: [GOOGLE_DRIVE_APP_FOLDER],
    payload: createDefaultVaultJournalBlob(vaultId)
  });
  const state = await readGoogleDriveManifestState(accessToken);
  const record: GoogleDriveRemoteVaultRecord = {
    id: vaultId,
    name: vaultName,
    fileId: sanitizeText(created.id),
    journalFileId: sanitizeText(journalCreated.id) || null,
    vaultKind: "regular",
    updatedAt: normalizeDriveTimestamp(created.modifiedTime),
    revision: blob.envelope.revision ?? null
  };

  await writeGoogleDriveManifest(accessToken, {
    ...state,
    manifest: {
      ...state.manifest,
      updatedAt: now(),
      vaults: [...state.manifest.vaults.filter((entry) => entry.id !== vaultId), record]
    }
  });

  return normalizeRemoteVaultRecord(record);
}

export async function deleteGoogleDriveRemoteVault(accessToken: string, vaultId: string) {
  const record = await getRemoteVaultRecord(accessToken, vaultId);

  if (!record) {
    throw new Error("VAULT_NOT_FOUND");
  }

  await googleDriveDeleteRequest(
    `${GOOGLE_DRIVE_FILES_BASE_URL}/${encodeURIComponent(record.fileId)}`,
    accessToken
  );

  if (record.journalFileId) {
    await googleDriveDeleteRequest(
      `${GOOGLE_DRIVE_FILES_BASE_URL}/${encodeURIComponent(record.journalFileId)}`,
      accessToken
    );
  }

  const state = await readGoogleDriveManifestState(accessToken);
  await writeGoogleDriveManifest(accessToken, {
    ...state,
    manifest: {
      ...state.manifest,
      updatedAt: now(),
      vaults: state.manifest.vaults.filter((entry) => entry.id !== vaultId)
    }
  });
}

export async function loadGoogleDriveRemoteEnvelope(accessToken: string, vaultId: string) {
  const record = await getRemoteVaultRecord(accessToken, vaultId);

  if (!record) {
    throw new Error("VAULT_NOT_FOUND");
  }

  const payload = await readDriveFileJson<GoogleDriveVaultBlob | SyncEnvelope | SyncSecureEnvelope>(
    accessToken,
    record.fileId
  );

  return normalizeEnvelopePayload(payload);
}

export async function saveGoogleDriveRemoteEnvelope(
  accessToken: string,
  input: {
    vaultId: string;
    vaultName: string;
    envelope: SyncEnvelope | SyncSecureEnvelope;
  }
) {
  const existing = await getRemoteVaultRecord(accessToken, input.vaultId);
  const blob: GoogleDriveVaultBlob = {
    schemaVersion: 1,
    provider: "googleDrive",
    vaultId: input.vaultId,
    updatedAt: now(),
    envelope: input.envelope
  };
  const response = await uploadGoogleDriveJsonFile({
    accessToken,
    fileId: existing?.fileId ?? null,
    name: buildGoogleDriveVaultStateFileName(input.vaultId),
    parents: existing ? undefined : [GOOGLE_DRIVE_APP_FOLDER],
    payload: blob
  });
  const journalFileId = await writeGoogleDriveJournalState(
    accessToken,
    {
      id: input.vaultId,
      journalFileId: existing?.journalFileId ?? null
    },
    []
  );
  const record: GoogleDriveRemoteVaultRecord = {
    id: input.vaultId,
    name: sanitizeText(input.vaultName, input.vaultId),
    fileId: sanitizeText(response.id, existing?.fileId ?? ""),
    journalFileId,
    vaultKind: input.envelope.metadata?.payloadMode === "encrypted" ? "private" : "regular",
    updatedAt: normalizeDriveTimestamp(response.modifiedTime),
    revision: input.envelope.revision ?? null
  };
  const state = await readGoogleDriveManifestState(accessToken);

  await writeGoogleDriveManifest(accessToken, {
    ...state,
    manifest: {
      ...state.manifest,
      updatedAt: now(),
      vaults: [...state.manifest.vaults.filter((entry) => entry.id !== input.vaultId), record]
    }
  });

  return record;
}

export async function loadGoogleDriveRemoteChangeFeed(
  accessToken: string,
  vaultId: string,
  sinceRevision: string
) {
  const record = await getRemoteVaultRecord(accessToken, vaultId);

  if (!record) {
    throw new Error("VAULT_NOT_FOUND");
  }

  const envelope = await loadGoogleDriveRemoteEnvelope(accessToken, vaultId);

  if (!sinceRevision.trim() || !envelope.revision) {
    return buildSnapshotFallbackFeed(envelope);
  }

  if (sinceRevision === envelope.revision) {
    return {
      mode: "delta",
      revision: envelope.revision,
      baseRevision: sinceRevision,
      changes: envelope.metadata?.payloadMode === "encrypted" ? null : createEmptyChangeSet("google-drive"),
      encryptedChanges: envelope.metadata?.payloadMode === "encrypted" ? [] : null,
      snapshot: null,
      metadata: envelope.metadata ?? null
    } satisfies SyncChangeFeed;
  }

  const journalState = await readGoogleDriveJournalState(accessToken, record);
  const journal = journalState.blob.entries;

  if (journal.length > 0 && journal[journal.length - 1]?.revision !== envelope.revision) {
    return buildSnapshotFallbackFeed(envelope);
  }

  const cursorIndex = journal.findIndex((entry) => entry.revision === sinceRevision);

  if (cursorIndex === -1) {
    return buildSnapshotFallbackFeed(envelope);
  }

  const slice = journal.slice(cursorIndex + 1);

  if (envelope.metadata?.payloadMode === "encrypted") {
    const batches = slice
      .map((entry) => entry.encryptedChanges)
      .filter((entry): entry is SyncEncryptedPayload => Boolean(entry));

    if (batches.length !== slice.length) {
      return buildSnapshotFallbackFeed(envelope);
    }

    return {
      mode: "delta",
      revision: envelope.revision,
      baseRevision: sinceRevision,
      changes: null,
      encryptedChanges: batches,
      snapshot: null,
      metadata: envelope.metadata ?? null
    } satisfies SyncChangeFeed;
  }

  return {
    mode: "delta",
    revision: envelope.revision,
    baseRevision: sinceRevision,
    changes: collapseChangeSetBatches(
      slice
        .map((entry) => entry.changes)
        .filter((entry): entry is SyncChangeSet => Boolean(entry))
    ),
    encryptedChanges: null,
    snapshot: null,
    metadata: envelope.metadata ?? null
  } satisfies SyncChangeFeed;
}

export async function pushGoogleDriveRemoteChanges(
  accessToken: string,
  input: {
    vaultId: string;
    vaultName: string;
    baseRevision: string | null;
    envelope: SyncEnvelope | SyncSecureEnvelope;
    changes?: SyncChangeSet | null;
    encryptedChanges?: SyncEncryptedPayload | null;
  }
) {
  const record = await getRemoteVaultRecord(accessToken, input.vaultId);

  if (!record) {
    throw new Error("VAULT_NOT_FOUND");
  }

  const currentEnvelope = await loadGoogleDriveRemoteEnvelope(accessToken, input.vaultId);

  if (currentEnvelope.revision !== input.baseRevision) {
    return {
      conflict: true as const,
      revision: currentEnvelope.revision ?? null
    };
  }

  const journalState = await readGoogleDriveJournalState(accessToken, record);
  const nextJournal = [...journalState.blob.entries];

  if (isEncryptedEnvelope(currentEnvelope)) {
    if (!input.encryptedChanges || !isEncryptedEnvelope(input.envelope)) {
      throw new Error("ENCRYPTED_DELTA_PAYLOAD_REQUIRED");
    }

    nextJournal.push({
      revision: input.envelope.revision ?? `rev-${now()}-${crypto.randomUUID()}`,
      baseRevision: input.baseRevision,
      createdAt: now(),
      changes: null,
      encryptedChanges: input.encryptedChanges
    });
  } else {
    const normalizedChanges = normalizeChangeSetPayload(input.changes, "google-drive");

    nextJournal.push({
      revision: input.envelope.revision ?? `rev-${now()}-${crypto.randomUUID()}`,
      baseRevision: input.baseRevision,
      createdAt: now(),
      changes: normalizedChanges,
      encryptedChanges: null
    });
  }

  const stateRecord = await saveGoogleDriveRemoteEnvelope(accessToken, {
    vaultId: input.vaultId,
    vaultName: input.vaultName,
    envelope: input.envelope
  });
  const journalFileId = await writeGoogleDriveJournalState(
    accessToken,
    {
      id: input.vaultId,
      journalFileId: stateRecord.journalFileId ?? record.journalFileId ?? null
    },
    nextJournal
  );
  const state = await readGoogleDriveManifestState(accessToken);

  await writeGoogleDriveManifest(accessToken, {
    ...state,
    manifest: {
      ...state.manifest,
      updatedAt: now(),
      vaults: [
        ...state.manifest.vaults.filter((entry) => entry.id !== input.vaultId),
        {
          ...stateRecord,
          journalFileId
        }
      ]
    }
  });

  return {
    conflict: false as const,
    revision: input.envelope.revision ?? null
  };
}

export function buildGoogleDriveConnectionLabel(session: Pick<GoogleDriveAccountSession, "userEmail" | "userName">) {
  return session.userEmail || session.userName || "Google Drive";
}

export function buildGoogleDriveBindingToken() {
  return GOOGLE_DRIVE_BINDING_TOKEN;
}

export async function probeGoogleDriveConnection(connection: Pick<SyncConnection, "sessionToken" | "tokenExpiresAt">) {
  if (!connection.sessionToken.trim()) {
    return "authError" as const;
  }

  if (connection.tokenExpiresAt && connection.tokenExpiresAt <= now() + 15_000) {
    return "authError" as const;
  }

  try {
    await listGoogleDriveRemoteVaults(connection.sessionToken.trim());
    return "available" as const;
  } catch (error) {
    const message = error instanceof Error ? error.message : "GOOGLE_DRIVE_AUTH_REQUIRED";
    return message === "GOOGLE_DRIVE_AUTH_REQUIRED" ? ("authError" as const) : ("unavailable" as const);
  }
}
