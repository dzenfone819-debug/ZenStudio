import {
  buildExcerpt,
  extractReferencedAssetIds,
  extractPlainText,
  normalizeNoteContent,
  remapReferencedAssetIds
} from "./notes";
import {
  buildCanvasExcerpt,
  extractCanvasPlainText,
  extractCanvasReferencedFileIds,
  normalizeCanvasContent,
  remapCanvasFileIds
} from "./canvas";
import { db, resetResolvedAssetCache } from "../data/db";
import type {
  AppSettings,
  Asset,
  Folder,
  HostedAccountSession,
  HostedAccountUser,
  HostedAccountVault,
  Note,
  Project,
  SyncEnvelope,
  SyncEntityKind,
  SyncRunStats,
  SyncShadow,
  SyncSnapshot,
  SyncStatus,
  SyncTombstone,
  SyncedAssetRecord,
  SyncedNoteRecord,
  Tag
} from "../types";

type SnapshotEntityState<T> = {
  kind: SyncEntityKind;
  key: string;
  hash: string;
  timestamp: number;
  deleted: boolean;
  record?: T;
  tombstone?: SyncTombstone;
};

type SyncExecutionResult = {
  revision: string;
  stats: SyncRunStats;
};

type SyncMutationState<T> = {
  local: SnapshotEntityState<T> | null;
  remote: SnapshotEntityState<T> | null;
  shadowHash: string | null;
};

const CONFLICT_SUFFIX = " (Conflict)";
const JSON_HEADERS = {
  "Content-Type": "application/json"
};

type HostedAccountOverview = {
  user: HostedAccountUser;
  session: Omit<HostedAccountSession, "token">;
  vaults: HostedAccountVault[];
};

function getEntityKey(entityType: SyncEntityKind, entityId: string) {
  return `${entityType}:${entityId}`;
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function normalizeVaultId(value: string) {
  return value.trim();
}

function buildVaultStateUrl(serverUrl: string, vaultId: string) {
  return `${normalizeBaseUrl(serverUrl)}/v1/vaults/${encodeURIComponent(normalizeVaultId(vaultId))}/state`;
}

function buildAccountUrl(serverUrl: string, path: string) {
  return `${normalizeBaseUrl(serverUrl)}${path}`;
}

function createBearerHeaders(token: string, includeJson = false) {
  return {
    ...(includeJson ? JSON_HEADERS : {}),
    Authorization: `Bearer ${token}`
  };
}

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortObjectKeys(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = sortObjectKeys((value as Record<string, unknown>)[key]);
      return result;
    }, {});
}

function stableStringify(value: unknown) {
  return JSON.stringify(sortObjectKeys(value));
}

function hashStableValue(value: unknown) {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `h${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function createTombstoneHash(tombstone: SyncTombstone) {
  return hashStableValue({
    deleted: true,
    deletedAt: tombstone.deletedAt
  });
}

function sortById<T extends { id: string }>(records: readonly T[]) {
  return [...records].sort((left, right) => left.id.localeCompare(right.id));
}

function sortTombstones(records: readonly SyncTombstone[]) {
  return [...records].sort((left, right) => left.key.localeCompare(right.key));
}

function serializeNote(note: Note): SyncedNoteRecord {
  return {
    id: note.id,
    title: note.title,
    contentType: note.contentType,
    projectId: note.projectId,
    folderId: note.folderId,
    color: note.color,
    tagIds: [...note.tagIds],
    content: normalizeNoteContent(note.content),
    canvasContent: note.canvasContent ? normalizeCanvasContent(note.canvasContent) : null,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    pinned: note.pinned,
    favorite: note.favorite,
    archived: note.archived,
    trashedAt: note.trashedAt,
    conflictOriginId: note.conflictOriginId
  };
}

function hydrateNote(record: SyncedNoteRecord): Note {
  const normalizedContent = normalizeNoteContent(record.content);
  const normalizedCanvas = record.canvasContent ? normalizeCanvasContent(record.canvasContent) : null;
  const excerpt =
    record.contentType === "canvas"
      ? buildCanvasExcerpt(normalizedCanvas)
      : buildExcerpt(normalizedContent);
  const plainText =
    record.contentType === "canvas"
      ? extractCanvasPlainText(normalizedCanvas)
      : extractPlainText(normalizedContent);

  return {
    ...record,
    tagIds: [...record.tagIds],
    content: normalizedContent,
    canvasContent: normalizedCanvas,
    excerpt,
    plainText,
    syncState: record.conflictOriginId ? "conflict" : "synced"
  };
}

async function blobToBase64(blob: Blob) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("BLOB_READ_FAILED"));
    };

    reader.onerror = () => {
      reject(reader.error ?? new Error("BLOB_READ_FAILED"));
    };

    reader.readAsDataURL(blob);
  });

  return dataUrl.split(",")[1] ?? "";
}

function base64ToBlob(base64: string, mimeType: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

async function serializeAsset(asset: Asset): Promise<SyncedAssetRecord> {
  return {
    id: asset.id,
    noteId: asset.noteId,
    name: asset.name,
    mimeType: asset.mimeType,
    size: asset.size,
    kind: asset.kind,
    data: await blobToBase64(asset.blob),
    version: asset.version,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt
  };
}

function hydrateAsset(record: SyncedAssetRecord): Asset {
  return {
    id: record.id,
    noteId: record.noteId,
    name: record.name,
    mimeType: record.mimeType,
    size: record.size,
    kind: record.kind,
    blob: base64ToBlob(record.data, record.mimeType),
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function createRecordState<T extends { id: string }>(
  entityType: SyncEntityKind,
  record: T,
  timestamp: number
) {
  return {
    kind: entityType,
    key: getEntityKey(entityType, record.id),
    hash: hashStableValue(record),
    timestamp,
    deleted: false,
    record
  } satisfies SnapshotEntityState<T>;
}

function createTombstoneState(tombstone: SyncTombstone) {
  return {
    kind: tombstone.entityType,
    key: tombstone.key,
    hash: createTombstoneHash(tombstone),
    timestamp: tombstone.deletedAt,
    deleted: true,
    tombstone
  } satisfies SnapshotEntityState<never>;
}

function buildStateMap<T extends { id: string }>(
  entityType: SyncEntityKind,
  records: readonly T[],
  tombstones: readonly SyncTombstone[],
  timestampAccessor: (record: T) => number
) {
  const map = new Map<string, SnapshotEntityState<T>>();

  records.forEach((record) => {
    map.set(
      getEntityKey(entityType, record.id),
      createRecordState(entityType, record, timestampAccessor(record))
    );
  });

  tombstones
    .filter((tombstone) => tombstone.entityType === entityType)
    .forEach((tombstone) => {
      map.set(tombstone.key, createTombstoneState(tombstone) as SnapshotEntityState<T>);
    });

  return map;
}

function pickNewerState<T>(
  left: SnapshotEntityState<T> | null,
  right: SnapshotEntityState<T> | null
) {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  if (left.timestamp !== right.timestamp) {
    return left.timestamp > right.timestamp ? left : right;
  }

  return right.hash.localeCompare(left.hash) >= 0 ? right : left;
}

function resolveGenericState<T>(state: SyncMutationState<T>) {
  const localHash = state.local?.hash ?? null;
  const remoteHash = state.remote?.hash ?? null;

  if (localHash === remoteHash) {
    return state.remote ?? state.local;
  }

  if (!state.shadowHash) {
    if (!state.local) {
      return state.remote;
    }

    if (!state.remote) {
      return state.local;
    }

    return pickNewerState(state.local, state.remote);
  }

  if (localHash === state.shadowHash) {
    return state.remote;
  }

  if (remoteHash === state.shadowHash) {
    return state.local;
  }

  return pickNewerState(state.local, state.remote);
}

function normalizeConflictTitle(title: string) {
  const baseTitle = title.trim() || "Untitled";
  return baseTitle.endsWith(CONFLICT_SUFFIX) ? baseTitle : `${baseTitle}${CONFLICT_SUFFIX}`;
}

function sanitizeProjectId(note: SyncedNoteRecord, projects: Map<string, Project>) {
  if (projects.has(note.projectId)) {
    return note.projectId;
  }

  return projects.keys().next().value ?? note.projectId;
}

function sanitizeFolderId(note: SyncedNoteRecord, folders: Map<string, Folder>, projectId: string) {
  if (!note.folderId) {
    return null;
  }

  const folder = folders.get(note.folderId);

  if (!folder || folder.projectId !== projectId) {
    return null;
  }

  return folder.id;
}

function sanitizeTagIds(note: SyncedNoteRecord, tags: Map<string, Tag>) {
  return note.tagIds.filter((tagId) => tags.has(tagId));
}

function createConflictAssetClone(
  asset: SyncedAssetRecord,
  nextNoteId: string,
  nextAssetId: string,
  timestamp: number
) {
  return {
    ...asset,
    id: nextAssetId,
    noteId: nextNoteId,
    updatedAt: timestamp
  } satisfies SyncedAssetRecord;
}

function createConflictNoteClone(
  note: SyncedNoteRecord,
  localAssetsById: Map<string, SyncedAssetRecord>,
  projects: Map<string, Project>,
  folders: Map<string, Folder>,
  tags: Map<string, Tag>
) {
  const timestamp = Date.now();
  const nextNoteId = crypto.randomUUID();
  const assetIdMap = new Map<string, string>();
  const clonedAssets: SyncedAssetRecord[] = [];
  const referencedAssetIds =
    note.contentType === "canvas"
      ? extractCanvasReferencedFileIds(note.canvasContent)
      : extractReferencedAssetIds(note.content);

  referencedAssetIds.forEach((assetId) => {
    const localAsset = localAssetsById.get(assetId);

    if (!localAsset) {
      return;
    }

    const nextAssetId = crypto.randomUUID();
    assetIdMap.set(assetId, nextAssetId);
    clonedAssets.push(createConflictAssetClone(localAsset, nextNoteId, nextAssetId, timestamp));
  });

  const projectId = sanitizeProjectId(note, projects);
  const folderId = sanitizeFolderId(note, folders, projectId);
  const nextNote: SyncedNoteRecord = {
    ...note,
    id: nextNoteId,
    title: normalizeConflictTitle(note.title),
    projectId,
    folderId,
    tagIds: sanitizeTagIds(note, tags),
    content:
      note.contentType === "canvas"
        ? note.content
        : remapReferencedAssetIds(note.content, assetIdMap),
    canvasContent:
      note.contentType === "canvas"
        ? remapCanvasFileIds(note.canvasContent, assetIdMap)
        : note.canvasContent,
    updatedAt: timestamp,
    conflictOriginId: note.id
  };

  return {
    note: nextNote,
    assets: clonedAssets
  };
}

function resolveNoteState(
  state: SyncMutationState<SyncedNoteRecord>,
  localAssetsById: Map<string, SyncedAssetRecord>,
  projects: Map<string, Project>,
  folders: Map<string, Folder>,
  tags: Map<string, Tag>,
  stats: SyncRunStats
) {
  const localHash = state.local?.hash ?? null;
  const remoteHash = state.remote?.hash ?? null;

  if (localHash === remoteHash) {
    return {
      canonical: state.remote ?? state.local,
      conflictClone: null,
      conflictAssets: [] as SyncedAssetRecord[]
    };
  }

  if (!state.shadowHash) {
    if (!state.local) {
      return {
        canonical: state.remote,
        conflictClone: null,
        conflictAssets: [] as SyncedAssetRecord[]
      };
    }

    if (!state.remote) {
      return {
        canonical: state.local,
        conflictClone: null,
        conflictAssets: [] as SyncedAssetRecord[]
      };
    }

    if (!state.local.deleted && !state.remote.deleted) {
      const clone = createConflictNoteClone(
        state.local.record!,
        localAssetsById,
        projects,
        folders,
        tags
      );
      stats.conflicts += 1;

      return {
        canonical: state.remote,
        conflictClone: clone.note,
        conflictAssets: clone.assets
      };
    }

    return {
      canonical: pickNewerState(state.local, state.remote),
      conflictClone: null,
      conflictAssets: [] as SyncedAssetRecord[]
    };
  }

  if (localHash === state.shadowHash) {
    return {
      canonical: state.remote,
      conflictClone: null,
      conflictAssets: [] as SyncedAssetRecord[]
    };
  }

  if (remoteHash === state.shadowHash) {
    return {
      canonical: state.local,
      conflictClone: null,
      conflictAssets: [] as SyncedAssetRecord[]
    };
  }

  if (state.local && state.remote && !state.local.deleted && !state.remote.deleted) {
    const clone = createConflictNoteClone(
      state.local.record!,
      localAssetsById,
      projects,
      folders,
      tags
    );
    stats.conflicts += 1;

    return {
      canonical: state.remote,
      conflictClone: clone.note,
      conflictAssets: clone.assets
    };
  }

  return {
    canonical: pickNewerState(state.local, state.remote),
    conflictClone: null,
    conflictAssets: [] as SyncedAssetRecord[]
  };
}

function collectReferencedAssetIds(notes: readonly SyncedNoteRecord[]) {
  const assetIds = new Set<string>();

  notes.forEach((note) => {
    const ids =
      note.contentType === "canvas"
        ? extractCanvasReferencedFileIds(note.canvasContent)
        : extractReferencedAssetIds(note.content);

    ids.forEach((assetId) => assetIds.add(assetId));
  });

  return assetIds;
}

function pruneUnreferencedAssets(
  assets: readonly SyncedAssetRecord[],
  notes: readonly SyncedNoteRecord[]
) {
  const referencedAssetIds = collectReferencedAssetIds(notes);
  const liveNoteIds = new Set(notes.map((note) => note.id));

  return assets.filter(
    (asset) => liveNoteIds.has(asset.noteId) && referencedAssetIds.has(asset.id)
  );
}

async function requestJson<T>(url: string, init: RequestInit = {}) {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => null)) as T | { error?: string } | null;

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `HTTP_${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

export async function registerHostedAccount(
  serverUrl: string,
  payload: {
    name: string;
    email: string;
    password: string;
  }
) {
  return requestJson<{
    user: HostedAccountUser;
    session: HostedAccountSession;
  }>(buildAccountUrl(serverUrl, "/v1/auth/register"), {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export async function loginHostedAccount(
  serverUrl: string,
  payload: {
    email: string;
    password: string;
  }
) {
  return requestJson<{
    user: HostedAccountUser;
    session: HostedAccountSession;
  }>(buildAccountUrl(serverUrl, "/v1/auth/login"), {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  });
}

export async function logoutHostedAccount(serverUrl: string, sessionToken: string) {
  return requestJson<{ ok: true }>(buildAccountUrl(serverUrl, "/v1/auth/logout"), {
    method: "POST",
    headers: createBearerHeaders(sessionToken, false)
  });
}

export async function loadHostedAccountOverview(serverUrl: string, sessionToken: string) {
  const [mePayload, vaultsPayload] = await Promise.all([
    requestJson<{
      user: HostedAccountUser;
      session: Omit<HostedAccountSession, "token">;
      vaultCount: number;
    }>(buildAccountUrl(serverUrl, "/v1/auth/me"), {
      method: "GET",
      headers: createBearerHeaders(sessionToken, false)
    }),
    requestJson<{
      user: HostedAccountUser;
      vaults: HostedAccountVault[];
    }>(buildAccountUrl(serverUrl, "/v1/account/vaults"), {
      method: "GET",
      headers: createBearerHeaders(sessionToken, false)
    })
  ]);

  return {
    user: mePayload.user,
    session: mePayload.session,
    vaults: vaultsPayload.vaults
  } satisfies HostedAccountOverview;
}

export async function createHostedVault(
  serverUrl: string,
  sessionToken: string,
  payload: {
    name: string;
    id?: string;
  }
) {
  return requestJson<{
    vault: HostedAccountVault;
  }>(buildAccountUrl(serverUrl, "/v1/account/vaults"), {
    method: "POST",
    headers: createBearerHeaders(sessionToken, true),
    body: JSON.stringify(payload)
  });
}

export async function issueHostedVaultToken(
  serverUrl: string,
  sessionToken: string,
  vaultId: string,
  label: string
) {
  return requestJson<{
    token: string;
    tokenMeta: {
      id: string;
      vaultId: string;
      label: string;
      createdAt: number;
      lastUsedAt: number | null;
    };
  }>(buildAccountUrl(serverUrl, `/v1/account/vaults/${encodeURIComponent(vaultId)}/tokens`), {
    method: "POST",
    headers: createBearerHeaders(sessionToken, true),
    body: JSON.stringify({
      label
    })
  });
}

async function pullSelfHostedEnvelope(serverUrl: string, vaultId: string, token: string) {
  return requestJson<SyncEnvelope>(buildVaultStateUrl(serverUrl, vaultId), {
    method: "GET",
    headers: createBearerHeaders(token, false)
  });
}

async function pushSelfHostedEnvelope(
  serverUrl: string,
  vaultId: string,
  token: string,
  baseRevision: string | null,
  snapshot: SyncSnapshot
) {
  const response = await fetch(buildVaultStateUrl(serverUrl, vaultId), {
    method: "PUT",
    headers: createBearerHeaders(token, true),
    body: JSON.stringify({
      baseRevision,
      snapshot
    })
  });

  const payload = (await response.json().catch(() => null)) as SyncEnvelope | { error?: string } | null;

  if (response.status === 409) {
    return {
      conflict: true,
      envelope: payload as SyncEnvelope
    };
  }

  if (!response.ok || !payload || typeof payload !== "object" || !("revision" in payload)) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `HTTP_${response.status}`;
    throw new Error(message);
  }

  return {
    conflict: false,
    envelope: payload as SyncEnvelope
  };
}

export async function exportLocalSyncSnapshot(): Promise<SyncSnapshot> {
  const [projects, folders, tags, notes, assets, settings, tombstones] = await Promise.all([
    db.projects.toArray(),
    db.folders.toArray(),
    db.tags.toArray(),
    db.notes.toArray(),
    db.assets.toArray(),
    db.settings.get("app"),
    db.syncTombstones.toArray()
  ]);

  if (!settings) {
    throw new Error("SETTINGS_MISSING");
  }

  const syncedAssets = await Promise.all(sortById(assets).map((asset) => serializeAsset(asset)));

  return {
    deviceId: settings.localDeviceId,
    exportedAt: Date.now(),
    projects: sortById(projects),
    folders: sortById(folders),
    tags: sortById(tags),
    notes: sortById(notes).map((note) => serializeNote(note)),
    assets: sortById(syncedAssets),
    tombstones: sortTombstones(tombstones)
  };
}

function buildShadowMap(shadows: readonly SyncShadow[]) {
  return new Map(shadows.map((shadow) => [shadow.key, shadow]));
}

function countChangedKeys<T>(
  localMap: Map<string, SnapshotEntityState<T>>,
  remoteMap: Map<string, SnapshotEntityState<T>>,
  shadows: Map<string, SyncShadow>
) {
  const keys = new Set([...localMap.keys(), ...remoteMap.keys()]);
  let pulled = 0;
  let pushed = 0;

  keys.forEach((key) => {
    const shadowHash = shadows.get(key)?.hash ?? null;
    const localHash = localMap.get(key)?.hash ?? null;
    const remoteHash = remoteMap.get(key)?.hash ?? null;

    if (shadowHash !== localHash) {
      pushed += 1;
    }

    if (shadowHash !== remoteHash) {
      pulled += 1;
    }
  });

  return {
    pulled,
    pushed
  };
}

function mergeSnapshots(
  local: SyncSnapshot,
  remote: SyncSnapshot,
  shadows: readonly SyncShadow[]
) {
  const shadowMap = buildShadowMap(shadows);
  const stats: SyncRunStats = {
    pulled: 0,
    pushed: 0,
    conflicts: 0
  };

  const localProjects = buildStateMap("project", local.projects, local.tombstones, (record) => record.updatedAt);
  const remoteProjects = buildStateMap("project", remote.projects, remote.tombstones, (record) => record.updatedAt);
  const localFolders = buildStateMap("folder", local.folders, local.tombstones, (record) => record.updatedAt);
  const remoteFolders = buildStateMap("folder", remote.folders, remote.tombstones, (record) => record.updatedAt);
  const localTags = buildStateMap("tag", local.tags, local.tombstones, (record) => record.updatedAt);
  const remoteTags = buildStateMap("tag", remote.tags, remote.tombstones, (record) => record.updatedAt);
  const localNotes = buildStateMap("note", local.notes, local.tombstones, (record) => record.updatedAt);
  const remoteNotes = buildStateMap("note", remote.notes, remote.tombstones, (record) => record.updatedAt);
  const localAssets = buildStateMap("asset", local.assets, local.tombstones, (record) => record.updatedAt);
  const remoteAssets = buildStateMap("asset", remote.assets, remote.tombstones, (record) => record.updatedAt);
  const changeCounts = [
    countChangedKeys(localProjects, remoteProjects, shadowMap),
    countChangedKeys(localFolders, remoteFolders, shadowMap),
    countChangedKeys(localTags, remoteTags, shadowMap),
    countChangedKeys(localNotes, remoteNotes, shadowMap),
    countChangedKeys(localAssets, remoteAssets, shadowMap)
  ];

  stats.pulled = changeCounts.reduce((sum, entry) => sum + entry.pulled, 0);
  stats.pushed = changeCounts.reduce((sum, entry) => sum + entry.pushed, 0);

  const mergedProjectsMap = new Map<string, Project>();
  const mergedFoldersMap = new Map<string, Folder>();
  const mergedTagsMap = new Map<string, Tag>();
  const mergedTombstones = new Map<string, SyncTombstone>();
  const mergedProjectKeys = new Set([...localProjects.keys(), ...remoteProjects.keys()]);
  const mergedFolderKeys = new Set([...localFolders.keys(), ...remoteFolders.keys()]);
  const mergedTagKeys = new Set([...localTags.keys(), ...remoteTags.keys()]);

  mergedProjectKeys.forEach((key) => {
    const resolved = resolveGenericState({
      local: localProjects.get(key) ?? null,
      remote: remoteProjects.get(key) ?? null,
      shadowHash: shadowMap.get(key)?.hash ?? null
    });

    if (!resolved) {
      return;
    }

    if (resolved.deleted && resolved.tombstone) {
      mergedTombstones.set(key, resolved.tombstone);
      return;
    }

    if (resolved.record) {
      mergedProjectsMap.set(resolved.record.id, resolved.record);
    }
  });

  mergedFolderKeys.forEach((key) => {
    const resolved = resolveGenericState({
      local: localFolders.get(key) ?? null,
      remote: remoteFolders.get(key) ?? null,
      shadowHash: shadowMap.get(key)?.hash ?? null
    });

    if (!resolved) {
      return;
    }

    if (resolved.deleted && resolved.tombstone) {
      mergedTombstones.set(key, resolved.tombstone);
      return;
    }

    if (resolved.record && mergedProjectsMap.has(resolved.record.projectId)) {
      mergedFoldersMap.set(resolved.record.id, resolved.record);
    }
  });

  mergedTagKeys.forEach((key) => {
    const resolved = resolveGenericState({
      local: localTags.get(key) ?? null,
      remote: remoteTags.get(key) ?? null,
      shadowHash: shadowMap.get(key)?.hash ?? null
    });

    if (!resolved) {
      return;
    }

    if (resolved.deleted && resolved.tombstone) {
      mergedTombstones.set(key, resolved.tombstone);
      return;
    }

    if (resolved.record) {
      mergedTagsMap.set(resolved.record.id, resolved.record);
    }
  });

  const localAssetsById = new Map(local.assets.map((asset) => [asset.id, asset]));
  const mergedNotesMap = new Map<string, SyncedNoteRecord>();
  const conflictAssets: SyncedAssetRecord[] = [];
  const mergedNoteKeys = new Set([...localNotes.keys(), ...remoteNotes.keys()]);

  mergedNoteKeys.forEach((key) => {
    const resolved = resolveNoteState(
      {
        local: localNotes.get(key) ?? null,
        remote: remoteNotes.get(key) ?? null,
        shadowHash: shadowMap.get(key)?.hash ?? null
      },
      localAssetsById,
      mergedProjectsMap,
      mergedFoldersMap,
      mergedTagsMap,
      stats
    );

    if (resolved.canonical?.deleted && resolved.canonical.tombstone) {
      mergedTombstones.set(key, resolved.canonical.tombstone);
    } else if (resolved.canonical?.record) {
      const record = resolved.canonical.record;
      const projectId = sanitizeProjectId(record, mergedProjectsMap);
      const folderId = sanitizeFolderId(record, mergedFoldersMap, projectId);

      mergedNotesMap.set(record.id, {
        ...record,
        projectId,
        folderId,
        tagIds: sanitizeTagIds(record, mergedTagsMap)
      });
    }

    if (resolved.conflictClone) {
      mergedNotesMap.set(resolved.conflictClone.id, resolved.conflictClone);
    }

    resolved.conflictAssets.forEach((asset) => {
      conflictAssets.push(asset);
    });
  });

  const mergedAssetKeys = new Set([...localAssets.keys(), ...remoteAssets.keys()]);
  const mergedAssetsMap = new Map<string, SyncedAssetRecord>();

  mergedAssetKeys.forEach((key) => {
    const resolved = resolveGenericState({
      local: localAssets.get(key) ?? null,
      remote: remoteAssets.get(key) ?? null,
      shadowHash: shadowMap.get(key)?.hash ?? null
    });

    if (!resolved) {
      return;
    }

    if (resolved.deleted && resolved.tombstone) {
      mergedTombstones.set(key, resolved.tombstone);
      return;
    }

    if (resolved.record) {
      mergedAssetsMap.set(resolved.record.id, resolved.record);
    }
  });

  conflictAssets.forEach((asset) => {
    mergedAssetsMap.set(asset.id, asset);
    mergedTombstones.delete(getEntityKey("asset", asset.id));
  });

  const notes = sortById([...mergedNotesMap.values()]);
  const assets = sortById(pruneUnreferencedAssets([...mergedAssetsMap.values()], notes));
  const liveAssetIds = new Set(assets.map((asset) => asset.id));

  [...mergedTombstones.keys()].forEach((key) => {
    if (key.startsWith("asset:")) {
      const assetId = key.replace("asset:", "");

      if (liveAssetIds.has(assetId)) {
        mergedTombstones.delete(key);
      }
    }
  });

  return {
    snapshot: {
      deviceId: local.deviceId,
      exportedAt: Date.now(),
      projects: sortById([...mergedProjectsMap.values()]),
      folders: sortById([...mergedFoldersMap.values()]),
      tags: sortById([...mergedTagsMap.values()]),
      notes,
      assets,
      tombstones: sortTombstones([...mergedTombstones.values()])
    } satisfies SyncSnapshot,
    stats
  };
}

async function replaceLocalDataFromSnapshot(snapshot: SyncSnapshot, settings: AppSettings) {
  const notes = sortById(snapshot.notes).map((note) => hydrateNote(note));
  const assets = sortById(snapshot.assets).map((asset) => hydrateAsset(asset));
  const nextOpenedNoteId =
    settings.lastOpenedNoteId && notes.some((note) => note.id === settings.lastOpenedNoteId)
      ? settings.lastOpenedNoteId
      : notes[0]?.id ?? null;

  resetResolvedAssetCache();

  await db.transaction(
    "rw",
    [db.projects, db.folders, db.tags, db.notes, db.assets, db.syncTombstones, db.settings],
    async () => {
      await db.projects.clear();
      await db.folders.clear();
      await db.tags.clear();
      await db.notes.clear();
      await db.assets.clear();
      await db.syncTombstones.clear();

      if (snapshot.projects.length > 0) {
        await db.projects.bulkAdd(sortById(snapshot.projects));
      }

      if (snapshot.folders.length > 0) {
        await db.folders.bulkAdd(sortById(snapshot.folders));
      }

      if (snapshot.tags.length > 0) {
        await db.tags.bulkAdd(sortById(snapshot.tags));
      }

      if (notes.length > 0) {
        await db.notes.bulkAdd(notes);
      }

      if (assets.length > 0) {
        await db.assets.bulkAdd(assets);
      }

      if (snapshot.tombstones.length > 0) {
        await db.syncTombstones.bulkAdd(sortTombstones(snapshot.tombstones));
      }

      await db.settings.update("app", {
        lastOpenedNoteId: nextOpenedNoteId
      });
    }
  );
}

async function persistSyncShadows(snapshot: SyncSnapshot, revision: string | null) {
  const syncedAt = Date.now();
  const shadows: SyncShadow[] = [];

  snapshot.projects.forEach((project) => {
    shadows.push({
      key: getEntityKey("project", project.id),
      entityType: "project",
      entityId: project.id,
      hash: hashStableValue(project),
      deleted: false,
      syncedAt,
      revision
    });
  });

  snapshot.folders.forEach((folder) => {
    shadows.push({
      key: getEntityKey("folder", folder.id),
      entityType: "folder",
      entityId: folder.id,
      hash: hashStableValue(folder),
      deleted: false,
      syncedAt,
      revision
    });
  });

  snapshot.tags.forEach((tag) => {
    shadows.push({
      key: getEntityKey("tag", tag.id),
      entityType: "tag",
      entityId: tag.id,
      hash: hashStableValue(tag),
      deleted: false,
      syncedAt,
      revision
    });
  });

  snapshot.notes.forEach((note) => {
    shadows.push({
      key: getEntityKey("note", note.id),
      entityType: "note",
      entityId: note.id,
      hash: hashStableValue(note),
      deleted: false,
      syncedAt,
      revision
    });
  });

  snapshot.assets.forEach((asset) => {
    shadows.push({
      key: getEntityKey("asset", asset.id),
      entityType: "asset",
      entityId: asset.id,
      hash: hashStableValue(asset),
      deleted: false,
      syncedAt,
      revision
    });
  });

  snapshot.tombstones.forEach((tombstone) => {
    shadows.push({
      key: tombstone.key,
      entityType: tombstone.entityType,
      entityId: tombstone.entityId,
      hash: createTombstoneHash(tombstone),
      deleted: true,
      syncedAt,
      revision
    });
  });

  await db.transaction("rw", db.syncShadows, async () => {
    await db.syncShadows.clear();

    if (shadows.length > 0) {
      await db.syncShadows.bulkAdd(shadows);
    }
  });
}

function parseSyncError(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "SYNC_FAILED";
}

export async function runSelfHostedSync(
  settings: AppSettings,
  options?: {
    onStatusChange?: (status: SyncStatus) => Promise<void> | void;
  }
): Promise<SyncExecutionResult> {
  if (settings.syncProvider !== "selfHosted") {
    throw new Error("SELF_HOSTED_PROVIDER_REQUIRED");
  }

  return runRemoteVaultSync(
    settings,
    {
      serverUrl: settings.selfHostedUrl,
      vaultId: settings.selfHostedVaultId,
      token: settings.selfHostedToken,
      missingUrlError: "SELF_HOSTED_URL_REQUIRED",
      missingTokenError: "SELF_HOSTED_TOKEN_REQUIRED",
      missingVaultError: "SELF_HOSTED_VAULT_REQUIRED"
    },
    options
  );
}

export async function runHostedSync(
  settings: AppSettings,
  options?: {
    onStatusChange?: (status: SyncStatus) => Promise<void> | void;
  }
): Promise<SyncExecutionResult> {
  if (settings.syncProvider !== "hosted") {
    throw new Error("HOSTED_PROVIDER_REQUIRED");
  }

  return runRemoteVaultSync(
    settings,
    {
      serverUrl: settings.hostedUrl,
      vaultId: settings.hostedVaultId,
      token: settings.hostedSyncToken,
      missingUrlError: "HOSTED_URL_REQUIRED",
      missingTokenError: "HOSTED_SYNC_TOKEN_REQUIRED",
      missingVaultError: "HOSTED_VAULT_REQUIRED"
    },
    options
  );
}

async function runRemoteVaultSync(
  settings: AppSettings,
  remote: {
    serverUrl: string;
    vaultId: string;
    token: string;
    missingUrlError: string;
    missingTokenError: string;
    missingVaultError: string;
  },
  options?: {
    onStatusChange?: (status: SyncStatus) => Promise<void> | void;
  }
): Promise<SyncExecutionResult> {
  const serverUrl = normalizeBaseUrl(remote.serverUrl);
  const vaultId = normalizeVaultId(remote.vaultId);
  const token = remote.token.trim();

  if (!serverUrl) {
    throw new Error(remote.missingUrlError);
  }

  if (!token) {
    throw new Error(remote.missingTokenError);
  }

  if (!vaultId) {
    throw new Error(remote.missingVaultError);
  }

  await options?.onStatusChange?.("syncing");

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const [remoteEnvelope, localSnapshot, shadows] = await Promise.all([
        pullSelfHostedEnvelope(serverUrl, vaultId, token),
        exportLocalSyncSnapshot(),
        db.syncShadows.toArray()
      ]);
      const merged = mergeSnapshots(localSnapshot, remoteEnvelope.snapshot, shadows);
      const pushed = await pushSelfHostedEnvelope(
        serverUrl,
        vaultId,
        token,
        remoteEnvelope.revision,
        merged.snapshot
      );

      if (pushed.conflict) {
        continue;
      }

      const nextSettings = await db.settings.get("app");

      if (!nextSettings) {
        throw new Error("SETTINGS_MISSING");
      }

      await replaceLocalDataFromSnapshot(merged.snapshot, nextSettings);
      await persistSyncShadows(merged.snapshot, pushed.envelope.revision);
      await db.settings.update("app", {
        syncStatus: "idle",
        lastSyncAt: Date.now(),
        syncCursor: pushed.envelope.revision
      });

      await options?.onStatusChange?.("idle");

      return {
        revision: pushed.envelope.revision ?? "",
        stats: merged.stats
      };
    }

    throw new Error("SYNC_REVISION_CONFLICT");
  } catch (error) {
    await db.settings.update("app", {
      syncStatus: "error"
    });
    await options?.onStatusChange?.("error");
    throw new Error(parseSyncError(error));
  }
}
