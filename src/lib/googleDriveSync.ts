import { createPlainSyncDescriptor } from "./e2ee";
import type {
  SyncConnection,
  SyncEnvelope,
  SyncRemoteVault,
  SyncSecureEnvelope,
  SyncSnapshot,
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
export const GOOGLE_DRIVE_BINDING_TOKEN = "google-drive-session";
const GOOGLE_IDENTITY_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
const GOOGLE_IDENTITY_LOAD_TIMEOUT_MS = 10_000;
const GOOGLE_IDENTITY_POLL_INTERVAL_MS = 50;

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

function buildVaultDescriptor(vaultId: string, vaultName: string): SyncVaultDescriptor {
  return {
    localVaultId: null,
    vaultGuid: vaultId,
    name: vaultName,
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
}) {
  const google = getGoogleIdentityApi();
  const clientId = ensureClientId(options?.clientId);

  if (!google?.accounts?.oauth2) {
    throw new Error("GOOGLE_OAUTH_NOT_READY");
  }

  return new Promise<GoogleTokenResponse>((resolve, reject) => {
    const tokenClient = google.accounts?.oauth2?.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_DRIVE_APP_DATA_SCOPE,
      include_granted_scopes: true,
      prompt: options?.prompt ?? "consent select_account",
      login_hint: options?.loginHint,
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error));
          return;
        }

        resolve(response);
      },
      error_callback: (error) => {
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
      prompt: options?.prompt ?? "consent select_account",
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
      vaults: Array.isArray(manifest.vaults) ? manifest.vaults : []
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
  if (!fileName.startsWith(GOOGLE_DRIVE_VAULT_PREFIX) || !fileName.endsWith(".json")) {
    return null;
  }

  return fileName.slice(GOOGLE_DRIVE_VAULT_PREFIX.length, -".json".length).trim() || null;
}

function normalizeRemoteVaultRecord(record: GoogleDriveRemoteVaultRecord): SyncRemoteVault {
  return {
    id: record.id,
    name: record.name,
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
      updatedAt: normalizeDriveTimestamp(file.modifiedTime),
      revision: envelope.revision ?? null
    } satisfies GoogleDriveRemoteVaultRecord;
  }

  if ("snapshot" in blob && derivedId) {
    return {
      id: derivedId,
      name: sanitizeText(blob.metadata?.vault?.name, derivedId),
      fileId: file.id,
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
  const manifestById = new Map(state.manifest.vaults.map((entry) => [entry.id, entry]));
  const resolvedRecords: GoogleDriveRemoteVaultRecord[] = [];

  for (const file of vaultFiles) {
    const parsed = await parseVaultFileForCatalog(accessToken, file);

    if (!parsed) {
      continue;
    }

    const manifestEntry = manifestById.get(parsed.id);
    resolvedRecords.push({
      ...parsed,
      name: manifestEntry?.name || parsed.name,
      updatedAt: Math.max(parsed.updatedAt, manifestEntry?.updatedAt ?? 0),
      revision: manifestEntry?.revision ?? parsed.revision
    });
  }

  const manifestNeedsUpdate =
    resolvedRecords.length !== state.manifest.vaults.length ||
    resolvedRecords.some((record) => {
      const current = manifestById.get(record.id);
      return !current || current.fileId !== record.fileId || current.name !== record.name || current.revision !== record.revision;
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

export async function connectGoogleDriveAccount(options?: {
  clientId?: string;
  loginHint?: string;
}) {
  if (!googleDriveOAuthReady()) {
    await prepareGoogleDriveOAuth();
  }

  const token = await requestGoogleDriveAccessToken({
    clientId: options?.clientId,
    loginHint: options?.loginHint
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
  const state = await readGoogleDriveManifestState(accessToken);
  const record: GoogleDriveRemoteVaultRecord = {
    id: vaultId,
    name: vaultName,
    fileId: sanitizeText(created.id),
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
    name: `${GOOGLE_DRIVE_VAULT_PREFIX}${input.vaultId}.json`,
    parents: existing ? undefined : [GOOGLE_DRIVE_APP_FOLDER],
    payload: blob
  });
  const record: GoogleDriveRemoteVaultRecord = {
    id: input.vaultId,
    name: sanitizeText(input.vaultName, input.vaultId),
    fileId: sanitizeText(response.id, existing?.fileId ?? ""),
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
