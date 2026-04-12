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
  SyncEntityKind,
  SyncShadow,
  SyncTombstone,
  SyncProvider,
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

class ZenNotesDatabase extends Dexie {
  projects!: EntityTable<Project, "id">;
  folders!: EntityTable<Folder, "id">;
  tags!: EntityTable<Tag, "id">;
  notes!: EntityTable<Note, "id">;
  assets!: EntityTable<Asset, "id">;
  settings!: EntityTable<AppSettings, "id">;
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

  await db.transaction("rw", [db.projects, db.folders, db.tags, db.notes, db.settings], async () => {
    await db.projects.add(project);
    await db.folders.bulkAdd(folders);
    await db.tags.bulkAdd(tags);
    await db.notes.add(note);
    await db.settings.add({
      id: "app",
      language,
      syncEnabled: false,
      syncStatus: "disabled",
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
      lastSyncAt: null,
      syncCursor: null,
      localDeviceId: createDeviceId(),
      lastOpenedNoteId: note.id
    });
  });
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

  await db.projects.add(project);
  return project;
}

export async function updateProjectPosition(projectId: string, x: number, y: number) {
  await db.projects.update(projectId, {
    x,
    y,
    updatedAt: now()
  });
}

export async function updateProjectColor(projectId: string, color: string) {
  await db.projects.update(projectId, {
    color,
    updatedAt: now()
  });
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

  await db.folders.add(folder);
  return folder;
}

export async function renameFolder(folderId: string, name: string) {
  await db.folders.update(folderId, {
    name,
    updatedAt: now()
  });
}

export async function updateFolderColor(folderId: string, color: string) {
  await db.folders.update(folderId, {
    color,
    updatedAt: now()
  });
}

export async function removeFolder(folderId: string) {
  const folders = await db.folders.toArray();
  const notes = await db.notes.toArray();
  const cascade = getFolderCascade(folderId, folders, notes);
  const timestamp = now();

  await db.transaction("rw", db.folders, db.notes, db.syncTombstones, async () => {
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

  await db.tags.add(tag);
  return tag;
}

export async function renameTag(tagId: string, name: string) {
  const normalizedName = normalizeTagName(name);

  if (!normalizedName) {
    throw new Error("TAG_NAME_REQUIRED");
  }

  await db.transaction("rw", db.tags, db.notes, async () => {
    const existingTag = await db.tags.get(tagId);

    if (!existingTag) {
      return;
    }

    const duplicateTag = await db.tags.where("name").equalsIgnoreCase(normalizedName).first();

    if (duplicateTag && duplicateTag.id !== tagId) {
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
            updatedAt: now(),
            syncState: nextSyncState(note.syncState)
          });
        })
      );

      await db.tags.update(duplicateTag.id, {
        updatedAt: now()
      });
      await db.tags.delete(tagId);
      return;
    }

    if (normalizeTagLookup(existingTag.name) === normalizeTagLookup(normalizedName)) {
      if (existingTag.name !== normalizedName) {
        await db.tags.update(tagId, {
          name: normalizedName,
          updatedAt: now()
        });
      }
      return;
    }

    await db.tags.update(tagId, {
      name: normalizedName,
      updatedAt: now()
    });
  });
}

export async function removeTag(tagId: string) {
  await db.transaction("rw", db.tags, db.notes, db.syncTombstones, async () => {
    await db.tags.delete(tagId);
    await putSyncTombstone("tag", tagId);

    const impactedNotes = await db.notes.where("tagIds").equals(tagId).toArray();

    await Promise.all(
      impactedNotes.map((note) =>
        db.notes.update(note.id, {
          tagIds: note.tagIds.filter((currentTagId) => currentTagId !== tagId),
          updatedAt: now(),
          syncState: nextSyncState(note.syncState)
        })
      )
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

  await db.transaction("rw", db.notes, db.settings, async () => {
    await db.notes.add(note);
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

  await db.transaction("rw", db.notes, db.settings, async () => {
    await db.notes.add(note);
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

  await db.notes.update(noteId, {
    ...patch,
    projectId: nextProjectId,
    updatedAt: now(),
    syncState: nextSyncState(existingNote?.syncState)
  });
}

export async function saveNoteContent(noteId: string, content: NoteContent) {
  const normalizedContent = normalizeNoteContent(content);
  const plainText = extractPlainText(normalizedContent);
  const excerpt = buildExcerpt(normalizedContent);
  const activeAssetIds = new Set(extractReferencedAssetIds(normalizedContent));

  await db.transaction("rw", db.notes, db.assets, db.syncTombstones, async () => {
    const noteAssets = await db.assets.where("noteId").equals(noteId).toArray();
    const staleAssets = noteAssets.filter((asset) => !activeAssetIds.has(asset.id));

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
      updatedAt: now(),
      syncState: nextSyncState((await db.notes.get(noteId))?.syncState)
    });
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

  await db.transaction("rw", db.notes, db.assets, db.syncTombstones, async () => {
    const noteAssets = await db.assets.where("noteId").equals(noteId).toArray();
    const assetsById = new Map(noteAssets.map((asset) => [asset.id, asset]));
    const staleAssets = noteAssets.filter((asset) => !activeFileIds.has(asset.id));

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
      const timestamp = now();
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
    }

    await db.notes.update(noteId, {
      canvasContent: normalizedContent,
      plainText,
      excerpt,
      updatedAt: now(),
      syncState: nextSyncState((await db.notes.get(noteId))?.syncState)
    });
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
  await db.transaction("rw", db.notes, db.assets, db.syncTombstones, async () => {
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

  await db.assets.add(asset);
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
