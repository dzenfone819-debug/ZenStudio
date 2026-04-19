import type {
  Asset,
  Folder,
  Note,
  Project,
  SyncEntityKind,
  SyncShadow,
  SyncTombstone,
  Tag
} from "../types";

interface SyncPendingEntity {
  entityType: SyncEntityKind;
  entityId: string;
  updatedAt: number;
}

export interface SyncPendingSummary {
  total: number;
  projects: number;
  folders: number;
  tags: number;
  notes: number;
  assets: number;
  deletions: number;
  lastPendingAt: number | null;
}

function getSyncEntityKey(entityType: SyncEntityKind, entityId: string) {
  return `${entityType}:${entityId}`;
}

function isEntityPending(
  entityType: SyncEntityKind,
  entityId: string,
  updatedAt: number,
  shadowsByKey: Map<string, SyncShadow>
) {
  const shadow = shadowsByKey.get(getSyncEntityKey(entityType, entityId));

  return !shadow || shadow.deleted || updatedAt > shadow.syncedAt;
}

function isTombstonePending(tombstone: SyncTombstone, shadowsByKey: Map<string, SyncShadow>) {
  const shadow = shadowsByKey.get(tombstone.key);

  return !shadow || !shadow.deleted || tombstone.deletedAt > shadow.syncedAt;
}

function addPendingEntity(
  summary: SyncPendingSummary,
  entityType: SyncEntityKind,
  updatedAt: number
) {
  summary.total += 1;
  summary.lastPendingAt = Math.max(summary.lastPendingAt ?? 0, updatedAt);

  switch (entityType) {
    case "project":
      summary.projects += 1;
      break;
    case "folder":
      summary.folders += 1;
      break;
    case "tag":
      summary.tags += 1;
      break;
    case "note":
      summary.notes += 1;
      break;
    case "asset":
      summary.assets += 1;
      break;
  }
}

function createEntityList(input: {
  projects: Project[];
  folders: Folder[];
  tags: Tag[];
  notes: Note[];
  assets: Asset[];
}) {
  const entities: SyncPendingEntity[] = [];

  input.projects.forEach((project) => {
    entities.push({
      entityType: "project",
      entityId: project.id,
      updatedAt: project.updatedAt
    });
  });

  input.folders.forEach((folder) => {
    entities.push({
      entityType: "folder",
      entityId: folder.id,
      updatedAt: folder.updatedAt
    });
  });

  input.tags.forEach((tag) => {
    entities.push({
      entityType: "tag",
      entityId: tag.id,
      updatedAt: tag.updatedAt
    });
  });

  input.notes.forEach((note) => {
    entities.push({
      entityType: "note",
      entityId: note.id,
      updatedAt: note.updatedAt
    });
  });

  input.assets.forEach((asset) => {
    entities.push({
      entityType: "asset",
      entityId: asset.id,
      updatedAt: asset.updatedAt
    });
  });

  return entities;
}

export function computePendingSyncSummary(input: {
  projects: Project[];
  folders: Folder[];
  tags: Tag[];
  notes: Note[];
  assets: Asset[];
  shadows: SyncShadow[];
  tombstones: SyncTombstone[];
}): SyncPendingSummary {
  const summary: SyncPendingSummary = {
    total: 0,
    projects: 0,
    folders: 0,
    tags: 0,
    notes: 0,
    assets: 0,
    deletions: 0,
    lastPendingAt: null
  };
  const shadowsByKey = new Map(input.shadows.map((shadow) => [shadow.key, shadow]));

  createEntityList(input).forEach((entity) => {
    if (!isEntityPending(entity.entityType, entity.entityId, entity.updatedAt, shadowsByKey)) {
      return;
    }

    addPendingEntity(summary, entity.entityType, entity.updatedAt);
  });

  input.tombstones.forEach((tombstone) => {
    if (!isTombstonePending(tombstone, shadowsByKey)) {
      return;
    }

    summary.total += 1;
    summary.deletions += 1;
    summary.lastPendingAt = Math.max(summary.lastPendingAt ?? 0, tombstone.deletedAt);
  });

  return summary;
}
