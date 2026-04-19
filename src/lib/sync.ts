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
import {
  db,
  resetResolvedAssetCache,
  withLocalVaultDatabase,
  writeImportedVaultSnapshot,
  type ZenNotesDatabase
} from "../data/db";
import type {
  AppLanguage,
  AppSettings,
  Asset,
  Folder,
  HostedAccountSession,
  HostedAccountUser,
  HostedAccountVault,
  Note,
  Project,
  SyncConnection,
  SyncConnectionProvider,
  SyncChangeFeed,
  SyncChangeSet,
  SyncEnvelope,
  SyncEntityKind,
  SyncRemoteVault,
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

type RemoteSyncConfig = {
  provider: SyncConnectionProvider;
  serverUrl: string;
  vaultId: string;
  token: string;
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

function buildVaultChangesUrl(serverUrl: string, vaultId: string, sinceRevision?: string | null) {
  const baseUrl = `${normalizeBaseUrl(serverUrl)}/v1/vaults/${encodeURIComponent(normalizeVaultId(vaultId))}/changes`;

  if (!sinceRevision) {
    return baseUrl;
  }

  return `${baseUrl}?since=${encodeURIComponent(sinceRevision)}`;
}

function buildAccountUrl(serverUrl: string, path: string) {
  return `${normalizeBaseUrl(serverUrl)}${path}`;
}

function buildPersonalUrl(serverUrl: string, path: string) {
  return `${normalizeBaseUrl(serverUrl)}${path}`;
}

function createBearerHeaders(token: string, includeJson = false) {
  return {
    ...(includeJson ? JSON_HEADERS : {}),
    Authorization: `Bearer ${token}`
  };
}

function normalizeRequestError(error: unknown) {
  if (error instanceof Error) {
    if (error.name === "AbortError" || error instanceof TypeError) {
      return "SERVER_UNAVAILABLE";
    }

    if (error.message) {
      return error.message;
    }
  }

  return "SYNC_FAILED";
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

function createEmptyChangeSet(deviceId = "server"): SyncChangeSet {
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

function isChangeSetEmpty(changeSet: SyncChangeSet) {
  return (
    changeSet.projects.length === 0 &&
    changeSet.folders.length === 0 &&
    changeSet.tags.length === 0 &&
    changeSet.notes.length === 0 &&
    changeSet.assets.length === 0 &&
    changeSet.tombstones.length === 0
  );
}

function countChangeSetEntries(changeSet: SyncChangeSet) {
  return (
    changeSet.projects.length +
    changeSet.folders.length +
    changeSet.tags.length +
    changeSet.notes.length +
    changeSet.assets.length +
    changeSet.tombstones.length
  );
}

function buildRecordChangeSetFromSnapshot(snapshot: SyncSnapshot, shadows: readonly SyncShadow[]) {
  const changeSet = createEmptyChangeSet(snapshot.deviceId);
  const shadowMap = buildShadowMap(shadows);

  changeSet.exportedAt = snapshot.exportedAt;

  snapshot.projects.forEach((project) => {
    const state = createRecordState("project", project, project.updatedAt);

    if ((shadowMap.get(state.key)?.hash ?? null) !== state.hash) {
      changeSet.projects.push(project);
    }
  });

  snapshot.folders.forEach((folder) => {
    const state = createRecordState("folder", folder, folder.updatedAt);

    if ((shadowMap.get(state.key)?.hash ?? null) !== state.hash) {
      changeSet.folders.push(folder);
    }
  });

  snapshot.tags.forEach((tag) => {
    const state = createRecordState("tag", tag, tag.updatedAt);

    if ((shadowMap.get(state.key)?.hash ?? null) !== state.hash) {
      changeSet.tags.push(tag);
    }
  });

  snapshot.notes.forEach((note) => {
    const state = createRecordState("note", note, note.updatedAt);

    if ((shadowMap.get(state.key)?.hash ?? null) !== state.hash) {
      changeSet.notes.push(note);
    }
  });

  snapshot.assets.forEach((asset) => {
    const state = createRecordState("asset", asset, asset.updatedAt);

    if ((shadowMap.get(state.key)?.hash ?? null) !== state.hash) {
      changeSet.assets.push(asset);
    }
  });

  snapshot.tombstones.forEach((tombstone) => {
    const state = createTombstoneState(tombstone);

    if ((shadowMap.get(state.key)?.hash ?? null) !== state.hash) {
      changeSet.tombstones.push(tombstone);
    }
  });

  return {
    ...changeSet,
    projects: sortById(changeSet.projects),
    folders: sortById(changeSet.folders),
    tags: sortById(changeSet.tags),
    notes: sortById(changeSet.notes),
    assets: sortById(changeSet.assets),
    tombstones: sortTombstones(changeSet.tombstones)
  };
}

function buildChangeSetBetweenSnapshots(previous: SyncSnapshot, next: SyncSnapshot) {
  const changeSet = createEmptyChangeSet(next.deviceId);
  changeSet.exportedAt = next.exportedAt;

  const appendEntityChanges = <T extends { id: string }>(
    entityType: SyncEntityKind,
    nextRecords: readonly T[],
    previousRecords: readonly T[],
    timestampAccessor: (record: T) => number
  ) => {
    const nextMap = buildStateMap(entityType, nextRecords, next.tombstones, timestampAccessor);
    const previousMap = buildStateMap(entityType, previousRecords, previous.tombstones, timestampAccessor);
    const keys = new Set([...nextMap.keys(), ...previousMap.keys()]);

    keys.forEach((key) => {
      const nextState = nextMap.get(key) ?? null;
      const previousState = previousMap.get(key) ?? null;

      if (!nextState || nextState.hash === previousState?.hash) {
        return;
      }

      appendResolvedStateToChangeSet(entityType, changeSet, nextState);
    });
  };

  appendEntityChanges("project", next.projects, previous.projects, (record: Project) => record.updatedAt);
  appendEntityChanges("folder", next.folders, previous.folders, (record: Folder) => record.updatedAt);
  appendEntityChanges("tag", next.tags, previous.tags, (record: Tag) => record.updatedAt);
  appendEntityChanges("note", next.notes, previous.notes, (record: SyncedNoteRecord) => record.updatedAt);
  appendEntityChanges("asset", next.assets, previous.assets, (record: SyncedAssetRecord) => record.updatedAt);

  return {
    ...changeSet,
    projects: sortById(changeSet.projects),
    folders: sortById(changeSet.folders),
    tags: sortById(changeSet.tags),
    notes: sortById(changeSet.notes),
    assets: sortById(changeSet.assets),
    tombstones: sortTombstones(changeSet.tombstones)
  } satisfies SyncChangeSet;
}

function createSyncShadowRecord<T extends { id: string }>(
  entityType: SyncEntityKind,
  record: T,
  syncedAt: number,
  revision: string | null
) {
  return {
    key: getEntityKey(entityType, record.id),
    entityType,
    entityId: record.id,
    hash: hashStableValue(record),
    deleted: false,
    syncedAt,
    revision
  } satisfies SyncShadow;
}

function createSyncTombstoneShadow(tombstone: SyncTombstone, syncedAt: number, revision: string | null) {
  return {
    key: tombstone.key,
    entityType: tombstone.entityType,
    entityId: tombstone.entityId,
    hash: createTombstoneHash(tombstone),
    deleted: true,
    syncedAt,
    revision
  } satisfies SyncShadow;
}

function buildShadowEntries(
  source: Pick<SyncChangeSet, "projects" | "folders" | "tags" | "notes" | "assets" | "tombstones">,
  syncedAt: number,
  revision: string | null
) {
  const shadows: SyncShadow[] = [];

  source.projects.forEach((project) => {
    shadows.push(createSyncShadowRecord("project", project, syncedAt, revision));
  });

  source.folders.forEach((folder) => {
    shadows.push(createSyncShadowRecord("folder", folder, syncedAt, revision));
  });

  source.tags.forEach((tag) => {
    shadows.push(createSyncShadowRecord("tag", tag, syncedAt, revision));
  });

  source.notes.forEach((note) => {
    shadows.push(createSyncShadowRecord("note", note, syncedAt, revision));
  });

  source.assets.forEach((asset) => {
    shadows.push(createSyncShadowRecord("asset", asset, syncedAt, revision));
  });

  source.tombstones.forEach((tombstone) => {
    shadows.push(createSyncTombstoneShadow(tombstone, syncedAt, revision));
  });

  return shadows;
}

function collectChangeSetKeys(
  source: Pick<SyncChangeSet, "projects" | "folders" | "tags" | "notes" | "assets" | "tombstones">
) {
  return [
    ...source.projects.map((project) => getEntityKey("project", project.id)),
    ...source.folders.map((folder) => getEntityKey("folder", folder.id)),
    ...source.tags.map((tag) => getEntityKey("tag", tag.id)),
    ...source.notes.map((note) => getEntityKey("note", note.id)),
    ...source.assets.map((asset) => getEntityKey("asset", asset.id)),
    ...source.tombstones.map((tombstone) => tombstone.key)
  ];
}

function appendResolvedStateToChangeSet<T extends { id: string }>(
  entityType: SyncEntityKind,
  changeSet: SyncChangeSet,
  resolved: SnapshotEntityState<T>
) {
  if (resolved.deleted && resolved.tombstone) {
    changeSet.tombstones.push(resolved.tombstone);
    return;
  }

  if (!resolved.record) {
    return;
  }

  switch (entityType) {
    case "project":
      changeSet.projects.push(resolved.record as unknown as Project);
      break;
    case "folder":
      changeSet.folders.push(resolved.record as unknown as Folder);
      break;
    case "tag":
      changeSet.tags.push(resolved.record as unknown as Tag);
      break;
    case "note":
      changeSet.notes.push(resolved.record as unknown as SyncedNoteRecord);
      break;
    case "asset":
      changeSet.assets.push(resolved.record as unknown as SyncedAssetRecord);
      break;
  }
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
  let response: Response;

  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new Error(normalizeRequestError(error));
  }

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

export async function probeSyncConnectionAvailability(
  connection: Pick<SyncConnection, "provider" | "serverUrl" | "managementToken" | "sessionToken">
): Promise<"available" | "unavailable" | "authError"> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), 3500);

  try {
    if (connection.provider === "hosted") {
      await requestJson<{
        user: HostedAccountUser;
        session: Omit<HostedAccountSession, "token">;
        vaultCount: number;
      }>(buildAccountUrl(connection.serverUrl, "/v1/auth/me"), {
        method: "GET",
        headers: createBearerHeaders(connection.sessionToken, false),
        signal: controller.signal
      });
    } else {
      await requestJson<{
        vaults: SyncRemoteVault[];
      }>(buildPersonalUrl(connection.serverUrl, "/v1/personal/vaults"), {
        method: "GET",
        headers: createBearerHeaders(connection.managementToken, false),
        signal: controller.signal
      });
    }

    return "available";
  } catch (error) {
    const message = normalizeRequestError(error);

    if (message === "UNAUTHORIZED" || message === "INVALID_CREDENTIALS") {
      return "authError";
    }

    return "unavailable";
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
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

export async function deleteHostedVault(serverUrl: string, sessionToken: string, vaultId: string) {
  return requestJson<{
    ok: true;
    vaultId: string;
  }>(buildAccountUrl(serverUrl, `/v1/account/vaults/${encodeURIComponent(vaultId)}`), {
    method: "DELETE",
    headers: createBearerHeaders(sessionToken, false)
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

export async function loadPersonalServerVaults(serverUrl: string, managementToken: string) {
  return requestJson<{
    vaults: SyncRemoteVault[];
  }>(buildPersonalUrl(serverUrl, "/v1/personal/vaults"), {
    method: "GET",
    headers: createBearerHeaders(managementToken, false)
  });
}

export async function createPersonalServerVault(
  serverUrl: string,
  managementToken: string,
  payload: {
    name: string;
    id?: string;
  }
) {
  return requestJson<{
    vault: SyncRemoteVault;
  }>(buildPersonalUrl(serverUrl, "/v1/personal/vaults"), {
    method: "POST",
    headers: createBearerHeaders(managementToken, true),
    body: JSON.stringify(payload)
  });
}

export async function deletePersonalServerVault(
  serverUrl: string,
  managementToken: string,
  vaultId: string
) {
  return requestJson<{
    ok: true;
    vaultId: string;
  }>(buildPersonalUrl(serverUrl, `/v1/personal/vaults/${encodeURIComponent(vaultId)}`), {
    method: "DELETE",
    headers: createBearerHeaders(managementToken, false)
  });
}

export async function issuePersonalServerVaultToken(
  serverUrl: string,
  managementToken: string,
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
  }>(buildPersonalUrl(serverUrl, `/v1/personal/vaults/${encodeURIComponent(vaultId)}/tokens`), {
    method: "POST",
    headers: createBearerHeaders(managementToken, true),
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

export async function importRemoteVaultIntoLocalVault(input: {
  localVaultId: string;
  serverUrl: string;
  remoteVaultId: string;
  syncToken: string;
  language?: AppLanguage;
}) {
  const envelope = await pullSelfHostedEnvelope(input.serverUrl, input.remoteVaultId, input.syncToken);

  await writeImportedVaultSnapshot(input.localVaultId, {
    snapshot: envelope.snapshot,
    revision: envelope.revision,
    language: input.language
  });

  return {
    revision: envelope.revision,
    importedBodies:
      envelope.snapshot.projects.length +
      envelope.snapshot.folders.length +
      envelope.snapshot.tags.length +
      envelope.snapshot.notes.length +
      envelope.snapshot.assets.length
  };
}

async function pullSelfHostedChanges(
  serverUrl: string,
  vaultId: string,
  token: string,
  sinceRevision: string
) {
  return requestJson<SyncChangeFeed>(buildVaultChangesUrl(serverUrl, vaultId, sinceRevision), {
    method: "GET",
    headers: createBearerHeaders(token, false)
  });
}

async function pushSelfHostedChanges(
  serverUrl: string,
  vaultId: string,
  token: string,
  baseRevision: string | null,
  changes: SyncChangeSet
) {
  let response: Response;

  try {
    response = await fetch(buildVaultChangesUrl(serverUrl, vaultId), {
      method: "POST",
      headers: createBearerHeaders(token, true),
      body: JSON.stringify({
        baseRevision,
        changes
      })
    });
  } catch (error) {
    throw new Error(normalizeRequestError(error));
  }

  const payload = (await response.json().catch(() => null)) as
    | { revision?: string | null; error?: string }
    | null;

  if (response.status === 409) {
    return {
      conflict: true,
      revision:
        payload && typeof payload === "object" && "revision" in payload
          ? payload.revision ?? null
          : null
    };
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && typeof payload.error === "string"
        ? payload.error
        : `HTTP_${response.status}`;
    throw new Error(message);
  }

  return {
    conflict: false,
    revision:
      payload && typeof payload === "object" && typeof payload.revision === "string"
        ? payload.revision
        : null
  };
}

async function pushSelfHostedEnvelope(
  serverUrl: string,
  vaultId: string,
  token: string,
  baseRevision: string | null,
  snapshot: SyncSnapshot
) {
  let response: Response;

  try {
    response = await fetch(buildVaultStateUrl(serverUrl, vaultId), {
      method: "PUT",
      headers: createBearerHeaders(token, true),
      body: JSON.stringify({
        baseRevision,
        snapshot
      })
    });
  } catch (error) {
    throw new Error(normalizeRequestError(error));
  }

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

export async function exportLocalSyncSnapshot(database: ZenNotesDatabase = db): Promise<SyncSnapshot> {
  const [projects, folders, tags, notes, assets, settings, tombstones] = await Promise.all([
    database.projects.toArray(),
    database.folders.toArray(),
    database.tags.toArray(),
    database.notes.toArray(),
    database.assets.toArray(),
    database.settings.get("app"),
    database.syncTombstones.toArray()
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

function createChangeStateMaps(changeSet: SyncChangeSet) {
  return {
    projects: buildStateMap("project", changeSet.projects, changeSet.tombstones, (record) => record.updatedAt),
    folders: buildStateMap("folder", changeSet.folders, changeSet.tombstones, (record) => record.updatedAt),
    tags: buildStateMap("tag", changeSet.tags, changeSet.tombstones, (record) => record.updatedAt),
    notes: buildStateMap("note", changeSet.notes, changeSet.tombstones, (record) => record.updatedAt),
    assets: buildStateMap("asset", changeSet.assets, changeSet.tombstones, (record) => record.updatedAt)
  };
}

function mergeChangeSetsIntoSnapshot(
  localSnapshot: SyncSnapshot,
  localChanges: SyncChangeSet,
  remoteChanges: SyncChangeSet,
  shadows: readonly SyncShadow[]
) {
  const shadowMap = buildShadowMap(shadows);
  const stats: SyncRunStats = {
    pulled: countChangeSetEntries(remoteChanges),
    pushed: 0,
    conflicts: 0
  };
  const outgoingChanges = createEmptyChangeSet(localSnapshot.deviceId);
  outgoingChanges.exportedAt = Date.now();

  const localStateMaps = createChangeStateMaps(localChanges);
  const remoteStateMaps = createChangeStateMaps(remoteChanges);
  const currentProjectsMap = new Map(localSnapshot.projects.map((project) => [project.id, project]));
  const currentFoldersMap = new Map(localSnapshot.folders.map((folder) => [folder.id, folder]));
  const currentTagsMap = new Map(localSnapshot.tags.map((tag) => [tag.id, tag]));
  const currentNotesMap = new Map(localSnapshot.notes.map((note) => [note.id, note]));
  const currentAssetsMap = new Map(localSnapshot.assets.map((asset) => [asset.id, asset]));
  const mergedTombstones = new Map(localSnapshot.tombstones.map((tombstone) => [tombstone.key, tombstone]));
  const localAssetsById = new Map(localSnapshot.assets.map((asset) => [asset.id, asset]));
  let localMutationCount = 0;

  const registerResolvedGenericState = <T extends { id: string }>(
    entityType: SyncEntityKind,
    resolved: SnapshotEntityState<T>,
    localState: SnapshotEntityState<T> | null,
    remoteState: SnapshotEntityState<T> | null
  ) => {
    const remoteCurrentHash = remoteState?.hash ?? shadowMap.get(resolved.key)?.hash ?? null;
    const localCurrentHash = localState?.hash ?? shadowMap.get(resolved.key)?.hash ?? null;

    if (resolved.hash !== localCurrentHash) {
      localMutationCount += 1;
    }

    if (resolved.hash !== remoteCurrentHash && resolved.hash === (localState?.hash ?? null)) {
      appendResolvedStateToChangeSet(entityType, outgoingChanges, resolved);
    }
  };

  const projectKeys = new Set([...localStateMaps.projects.keys(), ...remoteStateMaps.projects.keys()]);
  projectKeys.forEach((key) => {
    const localState = localStateMaps.projects.get(key) ?? null;
    const remoteState = remoteStateMaps.projects.get(key) ?? null;
    const resolved = resolveGenericState<Project>({
      local: localState,
      remote: remoteState,
      shadowHash: shadowMap.get(key)?.hash ?? null
    });

    if (!resolved) {
      return;
    }

    registerResolvedGenericState("project", resolved, localState, remoteState);

    if (resolved.deleted && resolved.tombstone) {
      currentProjectsMap.delete(resolved.tombstone.entityId);
      mergedTombstones.set(resolved.tombstone.key, resolved.tombstone);
      return;
    }

    if (resolved.record) {
      currentProjectsMap.set(resolved.record.id, resolved.record);
      mergedTombstones.delete(key);
    }
  });

  const folderKeys = new Set([...localStateMaps.folders.keys(), ...remoteStateMaps.folders.keys()]);
  folderKeys.forEach((key) => {
    const localState = localStateMaps.folders.get(key) ?? null;
    const remoteState = remoteStateMaps.folders.get(key) ?? null;
    const resolved = resolveGenericState<Folder>({
      local: localState,
      remote: remoteState,
      shadowHash: shadowMap.get(key)?.hash ?? null
    });

    if (!resolved) {
      return;
    }

    registerResolvedGenericState("folder", resolved, localState, remoteState);

    if (resolved.deleted && resolved.tombstone) {
      currentFoldersMap.delete(resolved.tombstone.entityId);
      mergedTombstones.set(resolved.tombstone.key, resolved.tombstone);
      return;
    }

    if (resolved.record && currentProjectsMap.has(resolved.record.projectId)) {
      currentFoldersMap.set(resolved.record.id, resolved.record);
      mergedTombstones.delete(key);
    } else if (resolved.record) {
      currentFoldersMap.delete(resolved.record.id);
    }
  });

  const tagKeys = new Set([...localStateMaps.tags.keys(), ...remoteStateMaps.tags.keys()]);
  tagKeys.forEach((key) => {
    const localState = localStateMaps.tags.get(key) ?? null;
    const remoteState = remoteStateMaps.tags.get(key) ?? null;
    const resolved = resolveGenericState<Tag>({
      local: localState,
      remote: remoteState,
      shadowHash: shadowMap.get(key)?.hash ?? null
    });

    if (!resolved) {
      return;
    }

    registerResolvedGenericState("tag", resolved, localState, remoteState);

    if (resolved.deleted && resolved.tombstone) {
      currentTagsMap.delete(resolved.tombstone.entityId);
      mergedTombstones.set(resolved.tombstone.key, resolved.tombstone);
      return;
    }

    if (resolved.record) {
      currentTagsMap.set(resolved.record.id, resolved.record);
      mergedTombstones.delete(key);
    }
  });

  const noteKeys = new Set([...localStateMaps.notes.keys(), ...remoteStateMaps.notes.keys()]);
  const conflictAssets: SyncedAssetRecord[] = [];

  noteKeys.forEach((key) => {
    const localState = localStateMaps.notes.get(key) ?? null;
    const remoteState = remoteStateMaps.notes.get(key) ?? null;
    const resolved = resolveNoteState(
      {
        local: localState,
        remote: remoteState,
        shadowHash: shadowMap.get(key)?.hash ?? null
      },
      localAssetsById,
      currentProjectsMap,
      currentFoldersMap,
      currentTagsMap,
      stats
    );
    const remoteCurrentHash = remoteState?.hash ?? shadowMap.get(key)?.hash ?? null;
    const localCurrentHash = localState?.hash ?? shadowMap.get(key)?.hash ?? null;

    if (resolved.canonical) {
      if (resolved.canonical.hash !== localCurrentHash) {
        localMutationCount += 1;
      }

      if (
        resolved.canonical.hash !== remoteCurrentHash &&
        resolved.canonical.hash === (localState?.hash ?? null)
      ) {
        appendResolvedStateToChangeSet("note", outgoingChanges, resolved.canonical);
      }

      if (resolved.canonical.deleted && resolved.canonical.tombstone) {
        currentNotesMap.delete(resolved.canonical.tombstone.entityId);
        mergedTombstones.set(resolved.canonical.tombstone.key, resolved.canonical.tombstone);
      } else if (resolved.canonical.record) {
        const record = resolved.canonical.record;
        const projectId = sanitizeProjectId(record, currentProjectsMap);
        const folderId = sanitizeFolderId(record, currentFoldersMap, projectId);

        currentNotesMap.set(record.id, {
          ...record,
          projectId,
          folderId,
          tagIds: sanitizeTagIds(record, currentTagsMap)
        });
        mergedTombstones.delete(key);
      }
    }

    if (resolved.conflictClone) {
      currentNotesMap.set(resolved.conflictClone.id, resolved.conflictClone);
      outgoingChanges.notes.push(resolved.conflictClone);
      localMutationCount += 1;
    }

    resolved.conflictAssets.forEach((asset) => {
      conflictAssets.push(asset);
      outgoingChanges.assets.push(asset);
    });
  });

  const assetKeys = new Set([...localStateMaps.assets.keys(), ...remoteStateMaps.assets.keys()]);
  assetKeys.forEach((key) => {
    const localState = localStateMaps.assets.get(key) ?? null;
    const remoteState = remoteStateMaps.assets.get(key) ?? null;
    const resolved = resolveGenericState<SyncedAssetRecord>({
      local: localState,
      remote: remoteState,
      shadowHash: shadowMap.get(key)?.hash ?? null
    });

    if (!resolved) {
      return;
    }

    registerResolvedGenericState("asset", resolved, localState, remoteState);

    if (resolved.deleted && resolved.tombstone) {
      currentAssetsMap.delete(resolved.tombstone.entityId);
      mergedTombstones.set(resolved.tombstone.key, resolved.tombstone);
      return;
    }

    if (resolved.record) {
      currentAssetsMap.set(resolved.record.id, resolved.record);
      mergedTombstones.delete(key);
    }
  });

  conflictAssets.forEach((asset) => {
    currentAssetsMap.set(asset.id, asset);
    mergedTombstones.delete(getEntityKey("asset", asset.id));
  });

  const notes = sortById([...currentNotesMap.values()]);
  const assets = sortById(pruneUnreferencedAssets([...currentAssetsMap.values()], notes));
  const liveAssetIds = new Set(assets.map((asset) => asset.id));

  [...mergedTombstones.keys()].forEach((key) => {
    if (key.startsWith("asset:")) {
      const assetId = key.replace("asset:", "");

      if (liveAssetIds.has(assetId)) {
        mergedTombstones.delete(key);
      }
    }
  });

  outgoingChanges.projects = sortById(outgoingChanges.projects);
  outgoingChanges.folders = sortById(outgoingChanges.folders);
  outgoingChanges.tags = sortById(outgoingChanges.tags);
  outgoingChanges.notes = sortById(outgoingChanges.notes);
  outgoingChanges.assets = sortById(outgoingChanges.assets);
  outgoingChanges.tombstones = sortTombstones(outgoingChanges.tombstones);
  stats.pushed = countChangeSetEntries(outgoingChanges);

  return {
    snapshot: {
      deviceId: localSnapshot.deviceId,
      exportedAt: Date.now(),
      projects: sortById([...currentProjectsMap.values()]),
      folders: sortById([...currentFoldersMap.values()]),
      tags: sortById([...currentTagsMap.values()]),
      notes,
      assets,
      tombstones: sortTombstones([...mergedTombstones.values()])
    } satisfies SyncSnapshot,
    outgoingChanges,
    stats,
    requiresLocalReplace: localMutationCount > 0
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

async function replaceLocalDataFromSnapshot(
  snapshot: SyncSnapshot,
  settings: AppSettings,
  database: ZenNotesDatabase = db
) {
  const notes = sortById(snapshot.notes).map((note) => hydrateNote(note));
  const assets = sortById(snapshot.assets).map((asset) => hydrateAsset(asset));
  const nextOpenedNoteId =
    settings.lastOpenedNoteId && notes.some((note) => note.id === settings.lastOpenedNoteId)
      ? settings.lastOpenedNoteId
      : notes[0]?.id ?? null;

  resetResolvedAssetCache();

  await database.transaction(
    "rw",
    [
      database.projects,
      database.folders,
      database.tags,
      database.notes,
      database.assets,
      database.syncTombstones,
      database.settings
    ],
    async () => {
      await database.projects.clear();
      await database.folders.clear();
      await database.tags.clear();
      await database.notes.clear();
      await database.assets.clear();
      await database.syncTombstones.clear();

      if (snapshot.projects.length > 0) {
        await database.projects.bulkAdd(sortById(snapshot.projects));
      }

      if (snapshot.folders.length > 0) {
        await database.folders.bulkAdd(sortById(snapshot.folders));
      }

      if (snapshot.tags.length > 0) {
        await database.tags.bulkAdd(sortById(snapshot.tags));
      }

      if (notes.length > 0) {
        await database.notes.bulkAdd(notes);
      }

      if (assets.length > 0) {
        await database.assets.bulkAdd(assets);
      }

      if (snapshot.tombstones.length > 0) {
        await database.syncTombstones.bulkAdd(sortTombstones(snapshot.tombstones));
      }

      await database.settings.update("app", {
        lastOpenedNoteId: nextOpenedNoteId
      });
    }
  );
}

async function applySyncChangeSetToLocalData(
  changeSet: SyncChangeSet,
  database: ZenNotesDatabase = db
) {
  if (isChangeSetEmpty(changeSet)) {
    return;
  }

  const projectIdsToDelete = changeSet.tombstones
    .filter((tombstone) => tombstone.entityType === "project")
    .map((tombstone) => tombstone.entityId);
  const folderIdsToDelete = changeSet.tombstones
    .filter((tombstone) => tombstone.entityType === "folder")
    .map((tombstone) => tombstone.entityId);
  const tagIdsToDelete = changeSet.tombstones
    .filter((tombstone) => tombstone.entityType === "tag")
    .map((tombstone) => tombstone.entityId);
  const noteIdsToDelete = changeSet.tombstones
    .filter((tombstone) => tombstone.entityType === "note")
    .map((tombstone) => tombstone.entityId);
  const assetIdsToDelete = changeSet.tombstones
    .filter((tombstone) => tombstone.entityType === "asset")
    .map((tombstone) => tombstone.entityId);
  const restoredTombstoneKeys = [
    ...changeSet.projects.map((project) => getEntityKey("project", project.id)),
    ...changeSet.folders.map((folder) => getEntityKey("folder", folder.id)),
    ...changeSet.tags.map((tag) => getEntityKey("tag", tag.id)),
    ...changeSet.notes.map((note) => getEntityKey("note", note.id)),
    ...changeSet.assets.map((asset) => getEntityKey("asset", asset.id))
  ];
  const hydratedNotes = sortById(changeSet.notes).map((note) => hydrateNote(note));
  const hydratedAssets = sortById(changeSet.assets).map((asset) => hydrateAsset(asset));
  const needsAssetCacheReset = changeSet.assets.length > 0 || assetIdsToDelete.length > 0;

  await database.transaction(
    "rw",
    [
      database.projects,
      database.folders,
      database.tags,
      database.notes,
      database.assets,
      database.syncTombstones,
      database.settings
    ],
    async () => {
      if (projectIdsToDelete.length > 0) {
        await database.projects.bulkDelete(projectIdsToDelete);
      }

      if (folderIdsToDelete.length > 0) {
        await database.folders.bulkDelete(folderIdsToDelete);
      }

      if (tagIdsToDelete.length > 0) {
        await database.tags.bulkDelete(tagIdsToDelete);
      }

      if (noteIdsToDelete.length > 0) {
        await database.notes.bulkDelete(noteIdsToDelete);
      }

      if (assetIdsToDelete.length > 0) {
        await database.assets.bulkDelete(assetIdsToDelete);
      }

      if (changeSet.projects.length > 0) {
        await database.projects.bulkPut(sortById(changeSet.projects));
      }

      if (changeSet.folders.length > 0) {
        await database.folders.bulkPut(sortById(changeSet.folders));
      }

      if (changeSet.tags.length > 0) {
        await database.tags.bulkPut(sortById(changeSet.tags));
      }

      if (hydratedNotes.length > 0) {
        await database.notes.bulkPut(hydratedNotes);
      }

      if (hydratedAssets.length > 0) {
        await database.assets.bulkPut(hydratedAssets);
      }

      if (restoredTombstoneKeys.length > 0) {
        await database.syncTombstones.bulkDelete(restoredTombstoneKeys);
      }

      if (changeSet.tombstones.length > 0) {
        await database.syncTombstones.bulkPut(sortTombstones(changeSet.tombstones));
      }

      const currentSettings = await database.settings.get("app");

      if (!currentSettings) {
        throw new Error("SETTINGS_MISSING");
      }

      const nextOpenedNoteId =
        currentSettings.lastOpenedNoteId &&
        (await database.notes.get(currentSettings.lastOpenedNoteId))
          ? currentSettings.lastOpenedNoteId
          : ((await database.notes.orderBy("id").first())?.id ?? null);

      if (nextOpenedNoteId !== currentSettings.lastOpenedNoteId) {
        await database.settings.update("app", {
          lastOpenedNoteId: nextOpenedNoteId
        });
      }
    }
  );

  if (needsAssetCacheReset) {
    resetResolvedAssetCache();
  }
}

async function persistSyncShadows(
  snapshot: SyncSnapshot,
  revision: string | null,
  database: ZenNotesDatabase = db
) {
  const syncedAt = Date.now();
  const shadows = buildShadowEntries(snapshot, syncedAt, revision);

  await database.transaction("rw", database.syncShadows, async () => {
    await database.syncShadows.clear();

    if (shadows.length > 0) {
      await database.syncShadows.bulkAdd(shadows);
    }
  });
}

async function persistSyncShadowChanges(
  changeSet: SyncChangeSet,
  revision: string | null,
  database: ZenNotesDatabase = db
) {
  if (isChangeSetEmpty(changeSet)) {
    return;
  }

  const shadows = buildShadowEntries(changeSet, Date.now(), revision);

  await database.transaction("rw", database.syncShadows, async () => {
    if (shadows.length > 0) {
      await database.syncShadows.bulkPut(shadows);
    }
  });
}

async function clearSyncDirtyEntriesByKeys(
  keys: readonly string[],
  database: ZenNotesDatabase = db
) {
  if (keys.length === 0) {
    return;
  }

  await database.syncDirtyEntries.bulkDelete([...keys]);
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
    localPendingCount?: number;
  }
): Promise<SyncExecutionResult> {
  return runConfiguredSync(
    {
      provider: "selfHosted",
      serverUrl: settings.selfHostedUrl,
      vaultId: settings.selfHostedVaultId,
      token: settings.selfHostedToken
    },
    options
  );
}

export async function runHostedSync(
  settings: AppSettings,
  options?: {
    onStatusChange?: (status: SyncStatus) => Promise<void> | void;
    localPendingCount?: number;
  }
): Promise<SyncExecutionResult> {
  return runConfiguredSync(
    {
      provider: "hosted",
      serverUrl: settings.hostedUrl,
      vaultId: settings.hostedVaultId,
      token: settings.hostedSyncToken
    },
    options
  );
}

function shouldFallbackToSnapshotSync(error: unknown) {
  const message = parseSyncError(error);
  return message === "NOT_FOUND" || message === "HTTP_404";
}

async function runSnapshotSyncCycle(
  serverUrl: string,
  vaultId: string,
  token: string,
  providedEnvelope?: SyncEnvelope | null,
  database: ZenNotesDatabase = db
) {
  const [remoteEnvelope, localSnapshot, shadows] = await Promise.all([
    providedEnvelope ? Promise.resolve(providedEnvelope) : pullSelfHostedEnvelope(serverUrl, vaultId, token),
    exportLocalSyncSnapshot(database),
    database.syncShadows.toArray()
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
    return "retry" as const;
  }

  const nextSettings = await database.settings.get("app");

  if (!nextSettings) {
    throw new Error("SETTINGS_MISSING");
  }

  await replaceLocalDataFromSnapshot(merged.snapshot, nextSettings, database);
  await persistSyncShadows(merged.snapshot, pushed.envelope.revision, database);
  await database.syncDirtyEntries.clear();
  await database.settings.update("app", {
    syncStatus: "idle",
    lastSyncAt: Date.now(),
    syncCursor: pushed.envelope.revision
  });

  return {
    revision: pushed.envelope.revision ?? "",
    stats: merged.stats
  } satisfies SyncExecutionResult;
}

async function runDeltaSyncCycle(
  serverUrl: string,
  vaultId: string,
  token: string,
  options?: {
    localPendingCount?: number;
  },
  database: ZenNotesDatabase = db
) {
  const [settings, shadows] = await Promise.all([
    database.settings.get("app"),
    database.syncShadows.toArray()
  ]);

  if (!settings) {
    throw new Error("SETTINGS_MISSING");
  }

  if (!settings.syncCursor || shadows.length === 0) {
    return null;
  }

  let remoteFeed: SyncChangeFeed;

  try {
    remoteFeed = await pullSelfHostedChanges(serverUrl, vaultId, token, settings.syncCursor);
  } catch (error) {
    if (shouldFallbackToSnapshotSync(error)) {
      return null;
    }

    throw error;
  }

  if (remoteFeed.mode === "snapshot") {
    if (remoteFeed.snapshot) {
      return runSnapshotSyncCycle(serverUrl, vaultId, token, {
        revision: remoteFeed.revision,
        snapshot: remoteFeed.snapshot
      }, database);
    }

    return null;
  }

  const remoteChanges = remoteFeed.changes ?? createEmptyChangeSet("server");
  const localPendingCount =
    typeof options?.localPendingCount === "number" ? Math.max(0, options.localPendingCount) : null;

  if (localPendingCount === 0) {
    const finalRevision = remoteFeed.revision ?? settings.syncCursor;

    if (!isChangeSetEmpty(remoteChanges)) {
      await applySyncChangeSetToLocalData(remoteChanges, database);
      await persistSyncShadowChanges(remoteChanges, finalRevision, database);
      await clearSyncDirtyEntriesByKeys(collectChangeSetKeys(remoteChanges), database);
    }

    await database.settings.update("app", {
      syncStatus: "idle",
      lastSyncAt: Date.now(),
      syncCursor: finalRevision
    });

    return {
      revision: finalRevision ?? "",
      stats: {
        pulled: countChangeSetEntries(remoteChanges),
        pushed: 0,
        conflicts: 0
      }
    } satisfies SyncExecutionResult;
  }

  const localSnapshot = await exportLocalSyncSnapshot(database);
  const localChanges = buildRecordChangeSetFromSnapshot(localSnapshot, shadows);
  const merged = mergeChangeSetsIntoSnapshot(localSnapshot, localChanges, remoteChanges, shadows);
  const localDeltaToApply = buildChangeSetBetweenSnapshots(localSnapshot, merged.snapshot);
  const shadowChanges = buildRecordChangeSetFromSnapshot(merged.snapshot, shadows);
  let finalRevision = remoteFeed.revision ?? settings.syncCursor;

  if (!isChangeSetEmpty(merged.outgoingChanges)) {
    const pushed = await pushSelfHostedChanges(
      serverUrl,
      vaultId,
      token,
      remoteFeed.revision,
      merged.outgoingChanges
    );

    if (pushed.conflict) {
      return "retry" as const;
    }

    finalRevision = pushed.revision ?? finalRevision;
  }

  if (!isChangeSetEmpty(localDeltaToApply)) {
    await applySyncChangeSetToLocalData(localDeltaToApply, database);
  }

  await persistSyncShadowChanges(shadowChanges, finalRevision, database);
  await clearSyncDirtyEntriesByKeys(collectChangeSetKeys(shadowChanges), database);
  await database.settings.update("app", {
    syncStatus: "idle",
    lastSyncAt: Date.now(),
    syncCursor: finalRevision
  });

  return {
    revision: finalRevision ?? "",
    stats: merged.stats
  } satisfies SyncExecutionResult;
}

async function runConfiguredSyncInternal(
  remote: RemoteSyncConfig,
  options?: {
    onStatusChange?: (status: SyncStatus) => Promise<void> | void;
    localPendingCount?: number;
  },
  database: ZenNotesDatabase = db
): Promise<SyncExecutionResult> {
  const serverUrl = normalizeBaseUrl(remote.serverUrl);
  const vaultId = normalizeVaultId(remote.vaultId);
  const token = remote.token.trim();

  if (!serverUrl) {
    throw new Error(remote.provider === "hosted" ? "HOSTED_URL_REQUIRED" : "SELF_HOSTED_URL_REQUIRED");
  }

  if (!token) {
    throw new Error(
      remote.provider === "hosted" ? "HOSTED_SYNC_TOKEN_REQUIRED" : "SELF_HOSTED_TOKEN_REQUIRED"
    );
  }

  if (!vaultId) {
    throw new Error(remote.provider === "hosted" ? "HOSTED_VAULT_REQUIRED" : "SELF_HOSTED_VAULT_REQUIRED");
  }

  await options?.onStatusChange?.("syncing");

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const deltaResult = await runDeltaSyncCycle(serverUrl, vaultId, token, {
        localPendingCount: options?.localPendingCount
      }, database);

      if (deltaResult === "retry") {
        continue;
      }

      if (deltaResult) {
        await options?.onStatusChange?.("idle");
        return deltaResult;
      }

      const snapshotResult = await runSnapshotSyncCycle(serverUrl, vaultId, token, undefined, database);

      if (snapshotResult === "retry") {
        continue;
      }

      await options?.onStatusChange?.("idle");
      return snapshotResult;
    }

    throw new Error("SYNC_REVISION_CONFLICT");
  } catch (error) {
    await database.settings.update("app", {
      syncStatus: "error"
    });
    await options?.onStatusChange?.("error");
    throw new Error(parseSyncError(error));
  }
}

export async function runConfiguredSync(
  remote: RemoteSyncConfig,
  options?: {
    onStatusChange?: (status: SyncStatus) => Promise<void> | void;
    localPendingCount?: number;
    localVaultId?: string;
  }
): Promise<SyncExecutionResult> {
  if (options?.localVaultId) {
    return withLocalVaultDatabase(options.localVaultId, async (database) =>
      runConfiguredSyncInternal(remote, options, database)
    );
  }

  return runConfiguredSyncInternal(remote, options, db);
}
