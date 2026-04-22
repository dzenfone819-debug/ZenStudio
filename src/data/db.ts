import Dexie, { type EntityTable } from "dexie";

import {
  COLOR_PALETTE,
  DEFAULT_FOLDER_COLOR,
  DEFAULT_NOTE_COLOR,
  DEFAULT_PROJECT_COLOR
} from "../lib/palette";
import {
  buildExcerpt,
  createStarterContent,
  extractPlainText,
  extractReferencedAssetIds,
  getFolderCascade,
  normalizeNoteContent,
  getUntitledTitle
} from "../lib/notes";
import {
  buildCanvasExcerpt,
  createStarterCanvasContent,
  extractCanvasPlainText,
  extractCanvasReferencedFileIds,
  getUntitledCanvasTitle,
  normalizeCanvasContent
} from "../lib/canvas";
import { normalizeTagLookup, normalizeTagName } from "../lib/tags";
import { buildLocalVaultDatabaseName, getStoredActiveLocalVaultId } from "../lib/localVaults";
import type {
  AppLanguage,
  AppSettings,
  Asset,
  AssetKind,
  CanvasContent,
  Folder,
  Note,
  NoteContent,
  Project,
  SyncDirtyEntry,
  SyncEntityKind,
  SyncShadow,
  SyncSnapshot,
  SyncTombstone,
  SyncProvider,
  SyncedAssetRecord,
  SyncedNoteRecord,
  Tag
} from "../types";
import type { BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";

const assetUrlCache = new Map<string, string>();

function getSyncEntityKey(entityType: SyncEntityKind, entityId: string) {
  return `${entityType}:${entityId}`;
}

async function putSyncTombstone(entityType: SyncEntityKind, entityId: string, deletedAt = now()) {
  await db.syncTombstones.put({
    key: getSyncEntityKey(entityType, entityId),
    entityType,
    entityId,
    deletedAt
  });
  await putSyncDirtyEntry(entityType, entityId, deletedAt, true);
}

async function deleteSyncTombstone(entityType: SyncEntityKind, entityId: string) {
  await db.syncTombstones.delete(getSyncEntityKey(entityType, entityId));
}

function now() {
  return Date.now();
}

function createColor(colorPool: string[], seedIndex: number) {
  return colorPool[seedIndex % colorPool.length];
}

const NODE_COLORS = COLOR_PALETTE.map((entry) => entry.hex);

function createDeviceId() {
  return `device-${crypto.randomUUID()}`;
}

function nextSyncState(currentSyncState: Note["syncState"] | undefined): Note["syncState"] {
  return currentSyncState === "conflict" ? "conflict" : "dirty";
}

function detectLanguage(): AppLanguage {
  if (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("ru")) {
    return "ru";
  }

  return "en";
}

async function dataUrlToBlob(dataUrl: string) {
  const response = await fetch(dataUrl);
  return response.blob();
}

function getCanvasAssetName(fileId: string, mimeType: string) {
  const subtype = mimeType.split("/")[1] ?? "bin";
  return `canvas-${fileId.slice(0, 8)}.${subtype.replace(/[^a-z0-9]/gi, "") || "bin"}`;
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

function createSyncShadowRecord<T extends { id: string }>(
  entityType: SyncEntityKind,
  record: T,
  syncedAt: number,
  revision: string | null
) {
  return {
    key: getSyncEntityKey(entityType, record.id),
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

function buildSyncShadowEntries(snapshot: SyncSnapshot, revision: string | null) {
  const syncedAt = now();
  const shadows: SyncShadow[] = [];

  snapshot.projects.forEach((project) => {
    shadows.push(createSyncShadowRecord("project", project, syncedAt, revision));
  });

  snapshot.folders.forEach((folder) => {
    shadows.push(createSyncShadowRecord("folder", folder, syncedAt, revision));
  });

  snapshot.tags.forEach((tag) => {
    shadows.push(createSyncShadowRecord("tag", tag, syncedAt, revision));
  });

  snapshot.notes.forEach((note) => {
    shadows.push(createSyncShadowRecord("note", note, syncedAt, revision));
  });

  snapshot.assets.forEach((asset) => {
    shadows.push(createSyncShadowRecord("asset", asset, syncedAt, revision));
  });

  snapshot.tombstones.forEach((tombstone) => {
    shadows.push(createSyncTombstoneShadow(tombstone, syncedAt, revision));
  });

  return shadows;
}

function base64ToBlob(base64: string, mimeType: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

function hydrateImportedAsset(record: SyncedAssetRecord): Asset {
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

function hydrateImportedNote(record: SyncedNoteRecord): Note {
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

function buildDefaultAppSettings(language: AppLanguage, lastOpenedNoteId: string | null): AppSettings {
  return {
    id: "app",
    language,
    syncEnabled: false,
    syncStatus: "idle",
    syncProvider: "none",
    selfHostedUrl: "",
    selfHostedVaultId: "default",
    selfHostedToken: "",
    hostedUrl: "",
    hostedSessionToken: "",
    hostedUserId: null,
    hostedUserName: "",
    hostedUserEmail: "",
    hostedVaultId: "",
    hostedSyncToken: "",
    conflictStrategy: "duplicate",
    encryptionEnabled: false,
    encryptionVersion: null,
    encryptionKdf: null,
    encryptionIterations: null,
    encryptionKeyId: null,
    encryptionSalt: null,
    encryptionKeyCheck: null,
    encryptionUpdatedAt: null,
    lastSyncAt: null,
    syncCursor: null,
    localDeviceId: createDeviceId(),
    lastOpenedNoteId
  };
}

function createSyncDirtyEntry(
  entityType: SyncEntityKind,
  entityId: string,
  updatedAt = now(),
  deleted = false
) {
  return {
    key: getSyncEntityKey(entityType, entityId),
    entityType,
    entityId,
    updatedAt,
    deleted
  } satisfies SyncDirtyEntry;
}

async function putSyncDirtyEntry(
  entityType: SyncEntityKind,
  entityId: string,
  updatedAt = now(),
  deleted = false
) {
  await db.syncDirtyEntries.put(createSyncDirtyEntry(entityType, entityId, updatedAt, deleted));
}

async function putSyncDirtyEntries(entries: readonly SyncDirtyEntry[]) {
  if (entries.length === 0) {
    return;
  }

  await db.syncDirtyEntries.bulkPut([...entries]);
}

function hasStableValueChanged(previous: unknown, next: unknown) {
  return hashStableValue(previous) !== hashStableValue(next);
}

function isEntityPending(updatedAt: number, shadow: SyncShadow | undefined) {
  return !shadow || shadow.deleted || updatedAt > shadow.syncedAt;
}

function isTombstonePending(tombstone: SyncTombstone, shadow: SyncShadow | undefined) {
  return !shadow || !shadow.deleted || tombstone.deletedAt > shadow.syncedAt;
}

function buildSyncDirtyEntriesFromState(input: {
  projects: Project[];
  folders: Folder[];
  tags: Tag[];
  notes: Note[];
  assets: Asset[];
  shadows: SyncShadow[];
  tombstones: SyncTombstone[];
}) {
  const shadowsByKey = new Map(input.shadows.map((shadow) => [shadow.key, shadow]));
  const entries: SyncDirtyEntry[] = [];

  input.projects.forEach((project) => {
    if (isEntityPending(project.updatedAt, shadowsByKey.get(getSyncEntityKey("project", project.id)))) {
      entries.push(createSyncDirtyEntry("project", project.id, project.updatedAt));
    }
  });

  input.folders.forEach((folder) => {
    if (isEntityPending(folder.updatedAt, shadowsByKey.get(getSyncEntityKey("folder", folder.id)))) {
      entries.push(createSyncDirtyEntry("folder", folder.id, folder.updatedAt));
    }
  });

  input.tags.forEach((tag) => {
    if (isEntityPending(tag.updatedAt, shadowsByKey.get(getSyncEntityKey("tag", tag.id)))) {
      entries.push(createSyncDirtyEntry("tag", tag.id, tag.updatedAt));
    }
  });

  input.notes.forEach((note) => {
    if (isEntityPending(note.updatedAt, shadowsByKey.get(getSyncEntityKey("note", note.id)))) {
      entries.push(createSyncDirtyEntry("note", note.id, note.updatedAt));
    }
  });

  input.assets.forEach((asset) => {
    if (isEntityPending(asset.updatedAt, shadowsByKey.get(getSyncEntityKey("asset", asset.id)))) {
      entries.push(createSyncDirtyEntry("asset", asset.id, asset.updatedAt));
    }
  });

  input.tombstones.forEach((tombstone) => {
    if (isTombstonePending(tombstone, shadowsByKey.get(tombstone.key))) {
      entries.push(createSyncDirtyEntry(tombstone.entityType, tombstone.entityId, tombstone.deletedAt, true));
    }
  });

  return entries.sort((left, right) => left.key.localeCompare(right.key));
}

export class ZenNotesDatabase extends Dexie {
  projects!: EntityTable<Project, "id">;
  folders!: EntityTable<Folder, "id">;
  tags!: EntityTable<Tag, "id">;
  notes!: EntityTable<Note, "id">;
  assets!: EntityTable<Asset, "id">;
  settings!: EntityTable<AppSettings, "id">;
  syncDirtyEntries!: EntityTable<SyncDirtyEntry, "key">;
  syncShadows!: EntityTable<SyncShadow, "key">;
  syncTombstones!: EntityTable<SyncTombstone, "key">;

  constructor(name: string) {
    super(name);

    this.version(1).stores({
      projects: "id,updatedAt",
      folders: "id,parentId,updatedAt",
      tags: "id,name,updatedAt",
      notes: "id,folderId,*tagIds,updatedAt,createdAt,pinned,archived",
      assets: "id,noteId,updatedAt",
      settings: "id"
    });

    this.version(2)
      .stores({
        projects: "id,updatedAt",
        folders: "id,parentId,updatedAt",
        tags: "id,name,updatedAt",
        notes: "id,folderId,*tagIds,updatedAt,createdAt,pinned,favorite,archived,trashedAt,syncState,conflictOriginId",
        assets: "id,noteId,updatedAt",
        settings: "id,syncProvider,syncStatus"
      })
      .upgrade(async (transaction) => {
        await transaction
          .table("notes")
          .toCollection()
          .modify((note) => {
            note.favorite ??= false;
            note.trashedAt ??= null;
            note.syncState ??= "local";
            note.conflictOriginId ??= null;
          });

        await transaction
          .table("settings")
          .toCollection()
          .modify((settings) => {
            settings.syncEnabled ??= false;
            settings.syncStatus ??= "disabled";
            settings.selfHostedToken ??= "";
            settings.conflictStrategy ??= "duplicate";
            settings.encryptionEnabled ??= false;
            settings.lastSyncAt ??= null;
            settings.localDeviceId ??= createDeviceId();
          });
      });

    this.version(3)
      .stores({
        projects: "id,updatedAt",
        folders: "id,parentId,updatedAt",
        tags: "id,name,updatedAt",
        notes: "id,folderId,*tagIds,updatedAt,createdAt,pinned,favorite,archived,trashedAt,syncState,conflictOriginId,color",
        assets: "id,noteId,updatedAt",
        settings: "id,syncProvider,syncStatus"
      })
      .upgrade(async (transaction) => {
        await transaction
          .table("notes")
          .toCollection()
          .modify((note) => {
            note.color ??= DEFAULT_NOTE_COLOR;
          });
      });

    this.version(4)
      .stores({
        projects: "id,updatedAt",
        folders: "id,parentId,updatedAt",
        tags: "id,name,updatedAt",
        notes: "id,folderId,*tagIds,updatedAt,createdAt,pinned,favorite,archived,trashedAt,syncState,conflictOriginId,color",
        assets: "id,noteId,updatedAt",
        settings: "id,syncProvider,syncStatus"
      })
      .upgrade(async (transaction) => {
        await transaction
          .table("folders")
          .toCollection()
          .modify((folder) => {
            folder.color ??= DEFAULT_FOLDER_COLOR;
          });

        await transaction
          .table("tags")
          .toCollection()
          .modify((tag) => {
            tag.color = "";
          });

        await transaction
          .table("notes")
          .toCollection()
          .modify((note) => {
            note.color ??= DEFAULT_NOTE_COLOR;
          });
      });

    this.version(5)
      .stores({
        projects: "id,updatedAt",
        folders: "id,projectId,parentId,updatedAt",
        tags: "id,name,updatedAt",
        notes:
          "id,projectId,folderId,*tagIds,updatedAt,createdAt,pinned,favorite,archived,trashedAt,syncState,conflictOriginId,color",
        assets: "id,noteId,updatedAt",
        settings: "id,syncProvider,syncStatus"
      })
      .upgrade(async (transaction) => {
        const language = detectLanguage();
        const projectId = crypto.randomUUID();
        const timestamp = now();

        await transaction.table("projects").add({
          id: projectId,
          name: language === "ru" ? "Проект 1" : "Project 1",
          x: 0,
          y: 0,
          createdAt: timestamp,
          updatedAt: timestamp
        });

        await transaction
          .table("folders")
          .toCollection()
          .modify((folder) => {
            folder.projectId ??= projectId;
            folder.color ??= DEFAULT_FOLDER_COLOR;
          });

        await transaction
          .table("notes")
          .toCollection()
          .modify((note) => {
            note.projectId ??= projectId;
            note.color ??= DEFAULT_NOTE_COLOR;
          });
      });

    this.version(6)
      .stores({
        projects: "id,updatedAt",
        folders: "id,projectId,parentId,updatedAt",
        tags: "id,name,updatedAt",
        notes:
          "id,projectId,folderId,*tagIds,updatedAt,createdAt,pinned,favorite,archived,trashedAt,syncState,conflictOriginId,color",
        assets: "id,noteId,updatedAt",
        settings: "id,syncProvider,syncStatus"
      })
      .upgrade(async (transaction) => {
        await transaction
          .table("projects")
          .toCollection()
          .modify((project) => {
            project.color ??= DEFAULT_PROJECT_COLOR;
          });
      });

    this.version(7)
      .stores({
        projects: "id,updatedAt",
        folders: "id,projectId,parentId,updatedAt",
        tags: "id,name,updatedAt",
        notes:
          "id,projectId,contentType,folderId,*tagIds,updatedAt,createdAt,pinned,favorite,archived,trashedAt,syncState,conflictOriginId,color",
        assets: "id,noteId,updatedAt",
        settings: "id,syncProvider,syncStatus"
      })
      .upgrade(async (transaction) => {
        await transaction
          .table("notes")
          .toCollection()
          .modify((note) => {
            note.contentType ??= "note";
            note.canvasContent ??= null;
          });

        await transaction
          .table("assets")
          .toCollection()
          .modify((asset) => {
            asset.version ??= 0;
          });
      });

    this.version(8)
      .stores({
        projects: "id,updatedAt",
        folders: "id,projectId,parentId,updatedAt",
        tags: "id,name,updatedAt",
        notes:
          "id,projectId,contentType,folderId,*tagIds,updatedAt,createdAt,pinned,favorite,archived,trashedAt,syncState,conflictOriginId,color",
        assets: "id,noteId,updatedAt",
        settings: "id,syncProvider,syncStatus,syncCursor",
        syncShadows: "key,entityType,entityId",
        syncTombstones: "key,entityType,entityId,deletedAt"
      })
      .upgrade(async (transaction) => {
        await transaction
          .table("settings")
          .toCollection()
          .modify((settings) => {
            settings.syncCursor ??= null;
          });
      });

    this.version(9)
      .stores({
        projects: "id,updatedAt",
        folders: "id,projectId,parentId,updatedAt",
        tags: "id,name,updatedAt",
        notes:
          "id,projectId,contentType,folderId,*tagIds,updatedAt,createdAt,pinned,favorite,archived,trashedAt,syncState,conflictOriginId,color",
        assets: "id,noteId,updatedAt",
        settings: "id,syncProvider,syncStatus,syncCursor,selfHostedVaultId",
        syncShadows: "key,entityType,entityId",
        syncTombstones: "key,entityType,entityId,deletedAt"
      })
      .upgrade(async (transaction) => {
        await transaction
          .table("settings")
          .toCollection()
          .modify((settings) => {
            settings.selfHostedVaultId ??= "default";
          });
      });

    this.version(10)
      .stores({
        projects: "id,updatedAt",
        folders: "id,projectId,parentId,updatedAt",
        tags: "id,name,updatedAt",
        notes:
          "id,projectId,contentType,folderId,*tagIds,updatedAt,createdAt,pinned,favorite,archived,trashedAt,syncState,conflictOriginId,color",
        assets: "id,noteId,updatedAt",
        settings:
          "id,syncProvider,syncStatus,syncCursor,selfHostedVaultId,hostedVaultId,hostedUserId",
        syncShadows: "key,entityType,entityId",
        syncTombstones: "key,entityType,entityId,deletedAt"
      })
      .upgrade(async (transaction) => {
        await transaction
          .table("settings")
          .toCollection()
          .modify((settings) => {
            settings.hostedUrl ??= "";
            settings.hostedSessionToken ??= "";
            settings.hostedUserId ??= null;
            settings.hostedUserName ??= "";
            settings.hostedUserEmail ??= "";
            settings.hostedVaultId ??= "";
            settings.hostedSyncToken ??= "";
          });
      });

    this.version(11)
      .stores({
        projects: "id,updatedAt",
        folders: "id,projectId,parentId,updatedAt",
        tags: "id,name,updatedAt",
        notes:
          "id,projectId,contentType,folderId,*tagIds,updatedAt,createdAt,pinned,favorite,archived,trashedAt,syncState,conflictOriginId,color",
        assets: "id,noteId,updatedAt",
        settings:
          "id,syncProvider,syncStatus,syncCursor,selfHostedVaultId,hostedVaultId,hostedUserId",
        syncDirtyEntries: "key,entityType,entityId,updatedAt,deleted",
        syncShadows: "key,entityType,entityId",
        syncTombstones: "key,entityType,entityId,deletedAt"
      })
      .upgrade(async (transaction) => {
        const [projects, folders, tags, notes, assets, shadows, tombstones] = await Promise.all([
          transaction.table("projects").toArray(),
          transaction.table("folders").toArray(),
          transaction.table("tags").toArray(),
          transaction.table("notes").toArray(),
          transaction.table("assets").toArray(),
          transaction.table("syncShadows").toArray(),
          transaction.table("syncTombstones").toArray()
        ]);
        const dirtyEntries = buildSyncDirtyEntriesFromState({
          projects,
          folders,
          tags,
          notes,
          assets,
          shadows,
          tombstones
        });

        if (dirtyEntries.length > 0) {
          await transaction.table("syncDirtyEntries").bulkPut(dirtyEntries);
        }
      });

    this.version(12)
      .stores({
        projects: "id,updatedAt",
        folders: "id,projectId,parentId,updatedAt",
        tags: "id,name,updatedAt",
        notes:
          "id,projectId,contentType,folderId,*tagIds,updatedAt,createdAt,pinned,favorite,archived,trashedAt,syncState,conflictOriginId,color",
        assets: "id,noteId,updatedAt",
        settings:
          "id,syncProvider,syncStatus,syncCursor,selfHostedVaultId,hostedVaultId,hostedUserId,encryptionKeyId",
        syncDirtyEntries: "key,entityType,entityId,updatedAt,deleted",
        syncShadows: "key,entityType,entityId",
        syncTombstones: "key,entityType,entityId,deletedAt"
      })
      .upgrade(async (transaction) => {
        await transaction
          .table("settings")
          .toCollection()
          .modify((settings) => {
            settings.encryptionVersion ??= null;
            settings.encryptionKdf ??= null;
            settings.encryptionIterations ??= null;
            settings.encryptionKeyId ??= null;
            settings.encryptionSalt ??= null;
            settings.encryptionKeyCheck ??= null;
            settings.encryptionUpdatedAt ??= null;
          });
      });

    this.version(13)
      .stores({
        projects: "id,updatedAt",
        folders: "id,projectId,parentId,updatedAt",
        tags: "id,name,updatedAt",
        notes:
          "id,projectId,contentType,folderId,*tagIds,updatedAt,createdAt,pinned,favorite,archived,trashedAt,syncState,conflictOriginId,color",
        assets: "id,noteId,updatedAt",
        settings:
          "id,syncProvider,syncStatus,syncCursor,selfHostedVaultId,hostedVaultId,hostedUserId,encryptionKeyId",
        syncDirtyEntries: "key,entityType,entityId,updatedAt,deleted",
        syncShadows: "key,entityType,entityId",
        syncTombstones: "key,entityType,entityId,deletedAt"
      })
      .upgrade(async (transaction) => {
        await transaction
          .table("settings")
          .toCollection()
          .modify((settings) => {
            settings.encryptionVersion ??= null;
            settings.encryptionKdf ??= null;
            settings.encryptionIterations ??= null;
            settings.encryptionKeyId ??= null;
            settings.encryptionSalt ??= null;
            settings.encryptionKeyCheck ??= null;
            settings.encryptionUpdatedAt ??= null;
          });
      });
  }
}

function createDatabaseForLocalVault(localVaultId: string) {
  return new ZenNotesDatabase(buildLocalVaultDatabaseName(localVaultId));
}

export let db = createDatabaseForLocalVault(getStoredActiveLocalVaultId());

export function switchActiveLocalVaultDatabase(localVaultId: string) {
  db.close();
  db = createDatabaseForLocalVault(localVaultId);
}

export async function withLocalVaultDatabase<T>(
  localVaultId: string,
  callback: (database: ZenNotesDatabase) => Promise<T>
) {
  const activeLocalVaultId = getStoredActiveLocalVaultId();
  const isActive = localVaultId === activeLocalVaultId;
  const database = isActive ? db : createDatabaseForLocalVault(localVaultId);

  try {
    return await callback(database);
  } finally {
    if (!isActive) {
      database.close();
    }
  }
}

export async function ensureSeedData() {
  const existingSettings = await db.settings.get("app");

  if (existingSettings) {
    return;
  }

  const language = detectLanguage();
  const timestamp = now();
  const project: Project = {
    id: crypto.randomUUID(),
    name: language === "ru" ? "Проект 1" : "Project 1",
    color: DEFAULT_PROJECT_COLOR,
    x: 0,
    y: 0,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  const folders: Folder[] = [
    {
      id: crypto.randomUUID(),
      projectId: project.id,
      name: language === "ru" ? "Входящие" : "Inbox",
      parentId: null,
      color: createColor(NODE_COLORS, 0),
      createdAt: timestamp,
      updatedAt: timestamp
    },
    {
      id: crypto.randomUUID(),
      projectId: project.id,
      name: language === "ru" ? "Исследования" : "Research",
      parentId: null,
      color: createColor(NODE_COLORS, 1),
      createdAt: timestamp,
      updatedAt: timestamp
    },
    {
      id: crypto.randomUUID(),
      projectId: project.id,
      name: language === "ru" ? "Прототипы" : "Prototypes",
      parentId: null,
      color: createColor(NODE_COLORS, 2),
      createdAt: timestamp,
      updatedAt: timestamp
    }
  ];

  const tags: Tag[] = [
    {
      id: crypto.randomUUID(),
      name: language === "ru" ? "идея" : "idea",
      color: "",
      createdAt: timestamp,
      updatedAt: timestamp
    },
    {
      id: crypto.randomUUID(),
      name: language === "ru" ? "дизайн" : "design",
      color: "",
      createdAt: timestamp,
      updatedAt: timestamp
    },
    {
      id: crypto.randomUUID(),
      name: language === "ru" ? "локально" : "offline",
      color: "",
      createdAt: timestamp,
      updatedAt: timestamp
    }
  ];

  const starterContent = createStarterContent(language);
  const note: Note = {
    id: crypto.randomUUID(),
    title: language === "ru" ? "Стартовая заметка" : "Starter note",
    contentType: "note",
    projectId: project.id,
    folderId: folders[0].id,
    color: DEFAULT_NOTE_COLOR,
    tagIds: [tags[0].id, tags[2].id],
    content: starterContent,
    canvasContent: null,
    excerpt: buildExcerpt(starterContent),
    plainText: extractPlainText(starterContent),
    createdAt: timestamp,
    updatedAt: timestamp,
    pinned: true,
    favorite: false,
    archived: false,
    trashedAt: null,
    syncState: "local",
    conflictOriginId: null
  };

  await db.transaction(
    "rw",
    [db.projects, db.folders, db.tags, db.notes, db.settings, db.syncDirtyEntries],
    async () => {
    await db.projects.add(project);
    await db.folders.bulkAdd(folders);
    await db.tags.bulkAdd(tags);
    await db.notes.add(note);
      await putSyncDirtyEntries([
        createSyncDirtyEntry("project", project.id, project.updatedAt),
        ...folders.map((folder) => createSyncDirtyEntry("folder", folder.id, folder.updatedAt)),
        ...tags.map((tag) => createSyncDirtyEntry("tag", tag.id, tag.updatedAt)),
        createSyncDirtyEntry("note", note.id, note.updatedAt)
      ]);
    await db.settings.add({
      ...buildDefaultAppSettings(language, note.id),
      syncStatus: "disabled"
    });
    }
  );
}

export async function patchSettings(patch: Partial<Omit<AppSettings, "id">>) {
  await db.settings.update("app", patch);
}

export async function resetSyncBinding() {
  await db.transaction("rw", [db.syncShadows, db.settings, db.notes], async () => {
    await db.syncShadows.clear();
    await db.settings.update("app", {
      syncCursor: null,
      lastSyncAt: null,
      syncStatus: "idle"
    });

    await db.notes.toCollection().modify((note) => {
      if (note.syncState !== "conflict") {
        note.syncState = "local";
      }
    });
  });
}

export async function readLocalVaultSettings(localVaultId: string) {
  return withLocalVaultDatabase(localVaultId, async (database) => {
    return (await database.settings.get("app")) ?? null;
  });
}

export async function ensureLocalVaultSettingsRecord(
  localVaultId: string,
  options?: {
    language?: AppLanguage;
    lastOpenedNoteId?: string | null;
  }
) {
  return withLocalVaultDatabase(localVaultId, async (database) => {
    const existingSettings = await database.settings.get("app");

    if (existingSettings) {
      return existingSettings;
    }

    const nextSettings = {
      ...buildDefaultAppSettings(options?.language ?? detectLanguage(), options?.lastOpenedNoteId ?? null),
      syncStatus: "disabled" as const
    };

    await database.settings.add(nextSettings);
    return nextSettings;
  });
}

export async function patchLocalVaultSettings(
  localVaultId: string,
  patch: Partial<Omit<AppSettings, "id">>
) {
  return withLocalVaultDatabase(localVaultId, async (database) => {
    await database.settings.update("app", patch);
  });
}

export async function writeImportedVaultSnapshot(
  localVaultId: string,
  input: {
    snapshot: SyncSnapshot;
    revision: string | null;
    language?: AppLanguage;
  }
) {
  return withLocalVaultDatabase(localVaultId, async (database) => {
    const existingSettings = await database.settings.get("app");
    const language = input.language ?? existingSettings?.language ?? detectLanguage();
    const notes = input.snapshot.notes.map((note) => hydrateImportedNote(note));
    const assets = input.snapshot.assets.map((asset) => hydrateImportedAsset(asset));
    const shadows = buildSyncShadowEntries(input.snapshot, input.revision);
    const nextOpenedNoteId =
      existingSettings?.lastOpenedNoteId && notes.some((note) => note.id === existingSettings.lastOpenedNoteId)
        ? existingSettings.lastOpenedNoteId
        : notes[0]?.id ?? null;

    await database.transaction(
      "rw",
      [
        database.projects,
        database.folders,
        database.tags,
        database.notes,
        database.assets,
        database.settings,
        database.syncDirtyEntries,
        database.syncShadows,
        database.syncTombstones
      ],
      async () => {
        await database.projects.clear();
        await database.folders.clear();
        await database.tags.clear();
        await database.notes.clear();
        await database.assets.clear();
        await database.syncDirtyEntries.clear();
        await database.syncShadows.clear();
        await database.syncTombstones.clear();

        if (input.snapshot.projects.length > 0) {
          await database.projects.bulkAdd(input.snapshot.projects);
        }

        if (input.snapshot.folders.length > 0) {
          await database.folders.bulkAdd(input.snapshot.folders);
        }

        if (input.snapshot.tags.length > 0) {
          await database.tags.bulkAdd(input.snapshot.tags);
        }

        if (notes.length > 0) {
          await database.notes.bulkAdd(notes);
        }

        if (assets.length > 0) {
          await database.assets.bulkAdd(assets);
        }

        if (input.snapshot.tombstones.length > 0) {
          await database.syncTombstones.bulkAdd(input.snapshot.tombstones);
        }

        if (shadows.length > 0) {
          await database.syncShadows.bulkAdd(shadows);
        }

        const nextSettings = {
          ...(existingSettings ?? buildDefaultAppSettings(language, nextOpenedNoteId)),
          language,
          syncStatus: "idle" as const,
          lastSyncAt: now(),
          syncCursor: input.revision,
          lastOpenedNoteId: nextOpenedNoteId
        };

        if (existingSettings) {
          await database.settings.put(nextSettings);
        } else {
          await database.settings.add(nextSettings);
        }
      }
    );
  });
}

export async function resetLocalVaultSyncBinding(localVaultId: string) {
  return withLocalVaultDatabase(localVaultId, async (database) => {
    await database.transaction("rw", [database.syncShadows, database.settings, database.notes], async () => {
      await database.syncShadows.clear();
      await database.settings.update("app", {
        syncCursor: null,
        lastSyncAt: null,
        syncStatus: "idle",
        syncEnabled: false,
        syncProvider: "none",
        selfHostedUrl: "",
        selfHostedVaultId: "default",
        selfHostedToken: "",
        hostedVaultId: "",
        hostedSyncToken: ""
      });

      await database.notes.toCollection().modify((note) => {
        if (note.syncState !== "conflict") {
          note.syncState = "local";
        }
      });
    });
  });
}

export async function createProject(name: string, x: number, y: number, color?: string) {
  const timestamp = now();
  const count = await db.projects.count();
  const project: Project = {
    id: crypto.randomUUID(),
    name,
    color: color ?? createColor(NODE_COLORS, count + 5),
    x,
    y,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  await db.transaction("rw", [db.projects, db.syncDirtyEntries], async () => {
    await db.projects.add(project);
    await putSyncDirtyEntry("project", project.id, timestamp);
  });
  return project;
}

export async function updateProjectPosition(projectId: string, x: number, y: number) {
  const project = await db.projects.get(projectId);

  if (!project || (project.x === x && project.y === y)) {
    return;
  }

  const timestamp = now();
  await db.transaction("rw", [db.projects, db.syncDirtyEntries], async () => {
    await db.projects.update(projectId, {
      x,
      y,
      updatedAt: timestamp
    });
    await putSyncDirtyEntry("project", projectId, timestamp);
  });
}

export async function updateProjectColor(projectId: string, color: string) {
  const project = await db.projects.get(projectId);

  if (!project || project.color === color) {
    return;
  }

  const timestamp = now();
  await db.transaction("rw", [db.projects, db.syncDirtyEntries], async () => {
    await db.projects.update(projectId, {
      color,
      updatedAt: timestamp
    });
    await putSyncDirtyEntry("project", projectId, timestamp);
  });
}

export async function renameProject(projectId: string, name: string) {
  const project = await db.projects.get(projectId);

  if (!project || project.name === name) {
    return;
  }

  const timestamp = now();
  await db.transaction("rw", [db.projects, db.syncDirtyEntries], async () => {
    await db.projects.update(projectId, {
      name,
      updatedAt: timestamp
    });
    await putSyncDirtyEntry("project", projectId, timestamp);
  });
}

export async function removeProject(projectId: string) {
  const [folders, notes, assets] = await Promise.all([
    db.folders.where("projectId").equals(projectId).toArray(),
    db.notes.where("projectId").equals(projectId).toArray(),
    db.assets.toArray()
  ]);
  const timestamp = now();
  const noteIds = new Set(notes.map((note) => note.id));
  const projectAssetIds = assets
    .filter((asset) => noteIds.has(asset.noteId))
    .map((asset) => asset.id);

  await db.transaction(
    "rw",
    [db.projects, db.folders, db.notes, db.assets, db.syncTombstones, db.syncDirtyEntries],
    async () => {
    await db.projects.delete(projectId);
    await putSyncTombstone("project", projectId, timestamp);

    const folderIds = folders.map((folder) => folder.id);

    if (folderIds.length > 0) {
      await db.folders.bulkDelete(folderIds);
      await Promise.all(
        folderIds.map((folderId) => putSyncTombstone("folder", folderId, timestamp))
      );
    }

    if (notes.length > 0) {
      await db.notes.bulkDelete(notes.map((note) => note.id));
      await Promise.all(
        notes.map((note) => putSyncTombstone("note", note.id, timestamp))
      );
    }

    if (projectAssetIds.length > 0) {
      projectAssetIds.forEach((assetId) => {
        const cachedUrl = assetUrlCache.get(assetId);

        if (cachedUrl) {
          URL.revokeObjectURL(cachedUrl);
          assetUrlCache.delete(assetId);
        }
      });

      await db.assets.bulkDelete(projectAssetIds);
      await Promise.all(
        projectAssetIds.map((assetId) => putSyncTombstone("asset", assetId, timestamp))
      );
    }
    }
  );
}

export async function createFolder(
  name: string,
  parentId: string | null,
  color?: string,
  projectId?: string
) {
  const timestamp = now();
  const count = await db.folders.count();
  let resolvedProjectId = projectId ?? null;

  if (parentId) {
    const parentFolder = await db.folders.get(parentId);

    if (parentFolder?.parentId) {
      throw new Error("FOLDER_DEPTH_LIMIT");
    }

    resolvedProjectId = parentFolder?.projectId ?? null;
  }

  if (!resolvedProjectId) {
    throw new Error("PROJECT_REQUIRED");
  }

  const folder: Folder = {
    id: crypto.randomUUID(),
    projectId: resolvedProjectId,
    name,
    parentId,
    color: color ?? createColor(NODE_COLORS, count),
    createdAt: timestamp,
    updatedAt: timestamp
  };

  await db.transaction("rw", [db.folders, db.syncDirtyEntries], async () => {
    await db.folders.add(folder);
    await putSyncDirtyEntry("folder", folder.id, timestamp);
  });
  return folder;
}

export async function renameFolder(folderId: string, name: string) {
  const folder = await db.folders.get(folderId);

  if (!folder || folder.name === name) {
    return;
  }

  const timestamp = now();
  await db.transaction("rw", [db.folders, db.syncDirtyEntries], async () => {
    await db.folders.update(folderId, {
      name,
      updatedAt: timestamp
    });
    await putSyncDirtyEntry("folder", folderId, timestamp);
  });
}

export async function updateFolderColor(folderId: string, color: string) {
  const folder = await db.folders.get(folderId);

  if (!folder || folder.color === color) {
    return;
  }

  const timestamp = now();
  await db.transaction("rw", [db.folders, db.syncDirtyEntries], async () => {
    await db.folders.update(folderId, {
      color,
      updatedAt: timestamp
    });
    await putSyncDirtyEntry("folder", folderId, timestamp);
  });
}

export async function removeFolder(folderId: string) {
  const folders = await db.folders.toArray();
  const notes = await db.notes.toArray();
  const cascade = getFolderCascade(folderId, folders, notes);
  const timestamp = now();

  await db.transaction("rw", db.folders, db.notes, db.syncTombstones, db.syncDirtyEntries, async () => {
    await db.folders.bulkDelete(cascade.folderIds);
    await Promise.all(cascade.folderIds.map((currentFolderId) => putSyncTombstone("folder", currentFolderId, timestamp)));

    await Promise.all(
      cascade.noteIds.map((noteId) =>
        db.notes.update(noteId, {
          folderId: null,
          trashedAt: timestamp,
          archived: false,
          updatedAt: timestamp,
          syncState: "dirty"
        })
      )
    );

    await putSyncDirtyEntries(
      cascade.noteIds.map((noteId) => createSyncDirtyEntry("note", noteId, timestamp))
    );
  });
}

export async function inspectFolderRemoval(folderId: string) {
  const folders = await db.folders.toArray();
  const notes = await db.notes.toArray();
  const cascade = getFolderCascade(folderId, folders, notes);

  return {
    folderCount: cascade.folderIds.length,
    noteCount: cascade.noteIds.length
  };
}

export async function createTag(name: string) {
  const normalizedName = normalizeTagName(name);

  if (!normalizedName) {
    throw new Error("TAG_NAME_REQUIRED");
  }

  const existingTag = await db.tags.where("name").equalsIgnoreCase(normalizedName).first();

  if (existingTag) {
    return existingTag;
  }

  const timestamp = now();
  const tag: Tag = {
    id: crypto.randomUUID(),
    name: normalizedName,
    color: "",
    createdAt: timestamp,
    updatedAt: timestamp
  };

  await db.transaction("rw", [db.tags, db.syncDirtyEntries], async () => {
    await db.tags.add(tag);
    await putSyncDirtyEntry("tag", tag.id, timestamp);
  });
  return tag;
}

export async function renameTag(tagId: string, name: string) {
  const normalizedName = normalizeTagName(name);

  if (!normalizedName) {
    throw new Error("TAG_NAME_REQUIRED");
  }

  await db.transaction("rw", db.tags, db.notes, db.syncTombstones, db.syncDirtyEntries, async () => {
    const existingTag = await db.tags.get(tagId);

    if (!existingTag) {
      return;
    }

    const duplicateTag = await db.tags.where("name").equalsIgnoreCase(normalizedName).first();

    if (duplicateTag && duplicateTag.id !== tagId) {
      const timestamp = now();
      const impactedNotes = await db.notes.where("tagIds").equals(tagId).toArray();

      await Promise.all(
        impactedNotes.map((note) => {
          const nextTagIds = Array.from(
            new Set(
              note.tagIds.map((currentTagId) =>
                currentTagId === tagId ? duplicateTag.id : currentTagId
              )
            )
          );

          return db.notes.update(note.id, {
            tagIds: nextTagIds,
            updatedAt: timestamp,
            syncState: nextSyncState(note.syncState)
          });
        })
      );

      await db.tags.update(duplicateTag.id, {
        updatedAt: timestamp
      });
      await putSyncDirtyEntry("tag", duplicateTag.id, timestamp);
      await putSyncDirtyEntries(
        impactedNotes.map((note) => createSyncDirtyEntry("note", note.id, timestamp))
      );
      await db.tags.delete(tagId);
      await putSyncTombstone("tag", tagId, timestamp);
      return;
    }

    if (normalizeTagLookup(existingTag.name) === normalizeTagLookup(normalizedName)) {
      if (existingTag.name !== normalizedName) {
        const timestamp = now();
        await db.tags.update(tagId, {
          name: normalizedName,
          updatedAt: timestamp
        });
        await putSyncDirtyEntry("tag", tagId, timestamp);
      }
      return;
    }

    const timestamp = now();
    await db.tags.update(tagId, {
      name: normalizedName,
      updatedAt: timestamp
    });
    await putSyncDirtyEntry("tag", tagId, timestamp);
  });
}

export async function removeTag(tagId: string) {
  await db.transaction("rw", db.tags, db.notes, db.syncTombstones, db.syncDirtyEntries, async () => {
    await db.tags.delete(tagId);
    await putSyncTombstone("tag", tagId);

    const impactedNotes = await db.notes.where("tagIds").equals(tagId).toArray();
    const timestamp = now();

    await Promise.all(
      impactedNotes.map((note) =>
        db.notes.update(note.id, {
          tagIds: note.tagIds.filter((currentTagId) => currentTagId !== tagId),
          updatedAt: timestamp,
          syncState: nextSyncState(note.syncState)
        })
      )
    );

    await putSyncDirtyEntries(
      impactedNotes.map((note) => createSyncDirtyEntry("note", note.id, timestamp))
    );
  });
}

export async function createNote(
  language: AppLanguage,
  folderId: string | null,
  tagIds: string[],
  projectId?: string
) {
  const timestamp = now();
  const content = createStarterContent(language);
  const folder = folderId ? await db.folders.get(folderId) : null;
  const resolvedProjectId = folder?.projectId ?? projectId ?? null;

  if (!resolvedProjectId) {
    throw new Error("PROJECT_REQUIRED");
  }

  const note: Note = {
    id: crypto.randomUUID(),
    title: getUntitledTitle(language),
    contentType: "note",
    projectId: resolvedProjectId,
    folderId,
    color: DEFAULT_NOTE_COLOR,
    tagIds,
    content,
    canvasContent: null,
    excerpt: buildExcerpt(content),
    plainText: extractPlainText(content),
    createdAt: timestamp,
    updatedAt: timestamp,
    pinned: false,
    favorite: false,
    archived: false,
    trashedAt: null,
    syncState: "local",
    conflictOriginId: null
  };

  await db.transaction("rw", db.notes, db.settings, db.syncDirtyEntries, async () => {
    await db.notes.add(note);
    await putSyncDirtyEntry("note", note.id, timestamp);
    await db.settings.update("app", {
      lastOpenedNoteId: note.id
    });
  });

  return note;
}

export async function createCanvas(
  language: AppLanguage,
  folderId: string | null,
  tagIds: string[],
  projectId?: string
) {
  const timestamp = now();
  const canvasContent = createStarterCanvasContent();
  const folder = folderId ? await db.folders.get(folderId) : null;
  const resolvedProjectId = folder?.projectId ?? projectId ?? null;

  if (!resolvedProjectId) {
    throw new Error("PROJECT_REQUIRED");
  }

  const note: Note = {
    id: crypto.randomUUID(),
    title: getUntitledCanvasTitle(language),
    contentType: "canvas",
    projectId: resolvedProjectId,
    folderId,
    color: DEFAULT_NOTE_COLOR,
    tagIds,
    content: [],
    canvasContent,
    excerpt: buildCanvasExcerpt(canvasContent),
    plainText: extractCanvasPlainText(canvasContent),
    createdAt: timestamp,
    updatedAt: timestamp,
    pinned: false,
    favorite: false,
    archived: false,
    trashedAt: null,
    syncState: "local",
    conflictOriginId: null
  };

  await db.transaction("rw", db.notes, db.settings, db.syncDirtyEntries, async () => {
    await db.notes.add(note);
    await putSyncDirtyEntry("note", note.id, timestamp);
    await db.settings.update("app", {
      lastOpenedNoteId: note.id
    });
  });

  return note;
}

export async function updateNoteMeta(
  noteId: string,
  patch: Partial<
    Pick<
      Note,
      | "title"
      | "projectId"
      | "folderId"
      | "color"
      | "tagIds"
      | "pinned"
      | "favorite"
      | "archived"
      | "trashedAt"
    >
  >
) {
  const existingNote = await db.notes.get(noteId);
  const nextFolder = patch.folderId ? await db.folders.get(patch.folderId) : null;
  const nextProjectId =
    patch.folderId !== undefined
      ? nextFolder?.projectId ?? patch.projectId ?? existingNote?.projectId
      : patch.projectId ?? existingNote?.projectId;

  if (!existingNote) {
    return;
  }

  const nextValues = {
    title: patch.title ?? existingNote.title,
    projectId: nextProjectId,
    folderId: patch.folderId !== undefined ? patch.folderId : existingNote.folderId,
    color: patch.color ?? existingNote.color,
    tagIds: patch.tagIds ?? existingNote.tagIds,
    pinned: patch.pinned ?? existingNote.pinned,
    favorite: patch.favorite ?? existingNote.favorite,
    archived: patch.archived ?? existingNote.archived,
    trashedAt: patch.trashedAt !== undefined ? patch.trashedAt : existingNote.trashedAt
  };

  if (
    existingNote.title === nextValues.title &&
    existingNote.projectId === nextValues.projectId &&
    existingNote.folderId === nextValues.folderId &&
    existingNote.color === nextValues.color &&
    !hasStableValueChanged(existingNote.tagIds, nextValues.tagIds) &&
    existingNote.pinned === nextValues.pinned &&
    existingNote.favorite === nextValues.favorite &&
    existingNote.archived === nextValues.archived &&
    existingNote.trashedAt === nextValues.trashedAt
  ) {
    return;
  }

  const timestamp = now();
  await db.transaction("rw", db.notes, db.syncDirtyEntries, async () => {
    await db.notes.update(noteId, {
      ...patch,
      projectId: nextProjectId,
      updatedAt: timestamp,
      syncState: nextSyncState(existingNote?.syncState)
    });
    await putSyncDirtyEntry("note", noteId, timestamp);
  });
}

export async function saveNoteContent(noteId: string, content: NoteContent) {
  const normalizedContent = normalizeNoteContent(content);
  const plainText = extractPlainText(normalizedContent);
  const excerpt = buildExcerpt(normalizedContent);
  const activeAssetIds = new Set(extractReferencedAssetIds(normalizedContent));

  const timestamp = now();
  await db.transaction("rw", db.notes, db.assets, db.syncTombstones, db.syncDirtyEntries, async () => {
    const existingNote = await db.notes.get(noteId);

    if (!existingNote) {
      return;
    }

    const noteAssets = await db.assets.where("noteId").equals(noteId).toArray();
    const staleAssets = noteAssets.filter((asset) => !activeAssetIds.has(asset.id));

    const contentChanged =
      hasStableValueChanged(normalizeNoteContent(existingNote.content), normalizedContent) ||
      existingNote.plainText !== plainText ||
      existingNote.excerpt !== excerpt;

    if (!contentChanged && staleAssets.length === 0) {
      return;
    }

    if (staleAssets.length > 0) {
      staleAssets.forEach((asset) => {
        const cachedUrl = assetUrlCache.get(asset.id);

        if (cachedUrl) {
          URL.revokeObjectURL(cachedUrl);
          assetUrlCache.delete(asset.id);
        }
      });

      await db.assets.bulkDelete(staleAssets.map((asset) => asset.id));
      await Promise.all(staleAssets.map((asset) => putSyncTombstone("asset", asset.id)));
    }

    await db.notes.update(noteId, {
      content: normalizedContent,
      plainText,
      excerpt,
      updatedAt: timestamp,
      syncState: nextSyncState(existingNote.syncState)
    });
    await putSyncDirtyEntry("note", noteId, timestamp);
  });
}

export async function loadCanvasFiles(noteId: string): Promise<BinaryFiles> {
  const assets = await db.assets.where("noteId").equals(noteId).toArray();
  const files: BinaryFiles = {};

  await Promise.all(
    assets.map(async (asset) => {
      files[asset.id] = {
        id: asset.id as BinaryFileData["id"],
        dataURL: (await getDataUrlFromBlob(asset.blob)) as BinaryFileData["dataURL"],
        mimeType: asset.mimeType as BinaryFileData["mimeType"],
        created: asset.createdAt,
        lastRetrieved: asset.updatedAt,
        version: asset.version ?? 0
      };
    })
  );

  return files;
}

async function getDataUrlFromBlob(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("FILE_READ_FAILED"));
    };

    reader.onerror = () => {
      reject(reader.error ?? new Error("FILE_READ_FAILED"));
    };

    reader.readAsDataURL(blob);
  });
}

export async function saveCanvasContent(
  noteId: string,
  content: CanvasContent,
  files: BinaryFiles,
  fileNames: Record<string, string> = {}
) {
  const normalizedContent = normalizeCanvasContent(content);
  const plainText = extractCanvasPlainText(normalizedContent);
  const excerpt = buildCanvasExcerpt(normalizedContent);
  const activeFileIds = new Set(extractCanvasReferencedFileIds(normalizedContent));

  const timestamp = now();
  await db.transaction("rw", db.notes, db.assets, db.syncTombstones, db.syncDirtyEntries, async () => {
    const existingNote = await db.notes.get(noteId);

    if (!existingNote) {
      return;
    }

    const noteAssets = await db.assets.where("noteId").equals(noteId).toArray();
    const assetsById = new Map(noteAssets.map((asset) => [asset.id, asset]));
    const staleAssets = noteAssets.filter((asset) => !activeFileIds.has(asset.id));
    let assetMutationCount = 0;

    if (staleAssets.length > 0) {
      staleAssets.forEach((asset) => {
        const cachedUrl = assetUrlCache.get(asset.id);

        if (cachedUrl) {
          URL.revokeObjectURL(cachedUrl);
          assetUrlCache.delete(asset.id);
        }
      });

      await db.assets.bulkDelete(staleAssets.map((asset) => asset.id));
      await Promise.all(staleAssets.map((asset) => putSyncTombstone("asset", asset.id)));
      assetMutationCount += staleAssets.length;
    }

    for (const fileId of activeFileIds) {
      const file = files[fileId];

      if (!file) {
        continue;
      }

      const existingAsset = assetsById.get(fileId);
      const nextVersion = file.version ?? 0;

      if (existingAsset && (existingAsset.version ?? 0) === nextVersion) {
        continue;
      }

      const blob = await dataUrlToBlob(file.dataURL);
      const nextAsset: Asset = {
        id: fileId,
        noteId,
        name:
          fileNames[fileId] ??
          existingAsset?.name ??
          getCanvasAssetName(fileId, file.mimeType),
        mimeType: file.mimeType,
        size: blob.size,
        kind: file.mimeType.startsWith("image/") ? "image" : "file",
        blob,
        version: nextVersion,
        createdAt: existingAsset?.createdAt ?? file.created ?? timestamp,
        updatedAt: timestamp
      };

      await db.assets.put(nextAsset);
      await putSyncDirtyEntry("asset", nextAsset.id, timestamp);
      assetMutationCount += 1;
    }

    const sceneChanged =
      hasStableValueChanged(existingNote.canvasContent ?? { elements: [], appState: null }, normalizedContent) ||
      existingNote.plainText !== plainText ||
      existingNote.excerpt !== excerpt;

    if (!sceneChanged && assetMutationCount === 0) {
      return;
    }

    await db.notes.update(noteId, {
      canvasContent: normalizedContent,
      plainText,
      excerpt,
      updatedAt: timestamp,
      syncState: nextSyncState(existingNote.syncState)
    });
    await putSyncDirtyEntry("note", noteId, timestamp);
  });
}

export async function moveNoteToTrash(noteId: string) {
  await updateNoteMeta(noteId, {
    trashedAt: now(),
    archived: false
  });
}

export async function restoreNoteFromTrash(noteId: string) {
  await updateNoteMeta(noteId, {
    trashedAt: null
  });
}

export async function removeNote(noteId: string) {
  await db.transaction("rw", db.notes, db.assets, db.syncTombstones, db.syncDirtyEntries, async () => {
    await db.notes.delete(noteId);
    await putSyncTombstone("note", noteId);
    const assetIds = await db.assets.where("noteId").equals(noteId).primaryKeys();
    const normalizedIds = assetIds.map((id) => String(id));

    normalizedIds.forEach((assetId) => {
      const cachedUrl = assetUrlCache.get(assetId);

      if (cachedUrl) {
        URL.revokeObjectURL(cachedUrl);
        assetUrlCache.delete(assetId);
      }
    });

    await db.assets.bulkDelete(normalizedIds);
    await Promise.all(normalizedIds.map((assetId) => putSyncTombstone("asset", assetId)));
  });
}

function detectAssetKind(file: File): AssetKind {
  if (file.type.startsWith("image/")) {
    return "image";
  }

  if (file.type.startsWith("audio/")) {
    return "audio";
  }

  if (file.type.startsWith("video/")) {
    return "video";
  }

  return "file";
}

export async function storeAsset(noteId: string, file: File) {
  const timestamp = now();
  const asset: Asset = {
    id: crypto.randomUUID(),
    noteId,
    name: file.name,
    mimeType: file.type,
    size: file.size,
    kind: detectAssetKind(file),
    blob: file,
    version: 0,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  await db.transaction("rw", db.assets, db.syncDirtyEntries, async () => {
    await db.assets.add(asset);
    await putSyncDirtyEntry("asset", asset.id, timestamp);
  });
  return `asset://${asset.id}`;
}

export function resetResolvedAssetCache() {
  assetUrlCache.forEach((objectUrl) => {
    URL.revokeObjectURL(objectUrl);
  });

  assetUrlCache.clear();
}

export async function resolveAssetUrl(url: string) {
  if (!url.startsWith("asset://")) {
    return url;
  }

  const assetId = url.replace("asset://", "");
  const cachedUrl = assetUrlCache.get(assetId);

  if (cachedUrl) {
    return cachedUrl;
  }

  const asset = await db.assets.get(assetId);

  if (!asset) {
    return url;
  }

  const objectUrl = URL.createObjectURL(asset.blob);
  assetUrlCache.set(assetId, objectUrl);
  return objectUrl;
}

export function isSyncProvider(value: string): value is SyncProvider {
  return value === "none" || value === "googleDrive" || value === "selfHosted" || value === "hosted";
}

export async function clearSyncTombstone(entityType: SyncEntityKind, entityId: string) {
  await deleteSyncTombstone(entityType, entityId);
}
