import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent
} from "react";
import { useTranslation } from "react-i18next";

import EntryStaticPreview from "./EntryStaticPreview";
import LocalVaultSwitcher, { type LocalVaultSwitcherItem } from "./LocalVaultSwitcher";
import OrbitalInspectorContextMenu, {
  type OrbitalInspectorContextMenuAction
} from "./OrbitalInspectorContextMenu";
import "./OrbitalChrome.css";
import {
  COLOR_PALETTE,
  DEFAULT_FOLDER_COLOR,
  DEFAULT_NOTE_COLOR,
  DEFAULT_PROJECT_COLOR
} from "../lib/palette";
import type { LocalVaultKind } from "../lib/localVaults";
import { getCanvasMetrics } from "../lib/canvas";
import { buildFolderPathMap, formatTimestamp } from "../lib/notes";
import type { AppLanguage, Asset, Folder, Note, Project, Tag } from "../types";

type SceneNodeKind = "core" | "folder" | "note";
type OrbitalChild = { folder?: FolderBranch; note?: Note };
type InspectorMenu = "overview" | "notes" | "folders" | "tags" | "files" | "pinned" | "colors";
type InspectorHierarchyItemKind = "core" | "folder" | "note" | "canvas";
type InspectorCompactIconKind = InspectorHierarchyItemKind | "tag" | "file" | "color" | "core";

const PROJECT_DRAG_THRESHOLD_PX = 5;

interface OrbitalMapViewProps {
  projects: Project[];
  folders: Folder[];
  notes: Note[];
  tags: Tag[];
  assets: Asset[];
  assetCount: number;
  language: AppLanguage;
  activeLocalVaultId: string;
  localVaultOptions: LocalVaultSwitcherItem[];
  syncStatusChip?: {
    tone: "default" | "success" | "warning" | "error";
    text: string;
    title?: string;
  };
  syncTransportChip?: {
    tone: "default" | "success" | "warning" | "error";
    text: string;
    title?: string;
  } | null;
  editorOpen: boolean;
  editorMode?: Note["contentType"] | null;
  editorSlot: ReactNode;
  editorTitle?: string;
  editorAccentColor?: string | null;
  settingsModalSlot?: ReactNode;
  trashModalSlot?: ReactNode;
  showClose?: boolean;
  onClose: () => void;
  onSelectLocalVault: (localVaultId: string) => void;
  onCreateLocalVault?: (input: {
    name: string;
    vaultKind: LocalVaultKind;
    passphrase?: string;
  }) => string | void | Promise<string | void>;
  onCloseEditor: () => void;
  onCreateProject: (x: number, y: number) => Promise<Project>;
  onRenameProject: (projectId: string, name: string) => Promise<void> | void;
  onUpdateProjectPosition: (projectId: string, x: number, y: number) => void;
  onUpdateProjectColor: (projectId: string, color: string) => void;
  onDeleteProject: (projectId: string) => Promise<void> | void;
  onCreateFolder: (
    name: string,
    parentId: string | null,
    color?: string,
    projectId?: string
  ) => Promise<Folder>;
  onRenameFolder: (folderId: string, name: string) => Promise<void> | void;
  onUpdateFolderColor: (folderId: string, color: string) => void;
  onDeleteFolder: (folderId: string) => Promise<void> | void;
  onRenameNote: (noteId: string, name: string) => Promise<void> | void;
  onUpdateNoteColor: (noteId: string, color: string) => void;
  onSetNotePinned: (noteId: string, pinned: boolean) => Promise<void> | void;
  onDeleteNote: (noteId: string) => Promise<void> | void;
  onCreateNote: (folderId: string | null, projectId?: string) => Promise<Note>;
  onCreateCanvas: (folderId: string | null, projectId?: string) => Promise<Note>;
  onOpenNote: (noteId: string) => void;
  onResolveFileUrl?: (url: string) => Promise<string>;
  labels: {
    title: string;
    subtitle: string;
    close: string;
    pause: string;
    resume: string;
    zoomIn: string;
    zoomOut: string;
    resetView: string;
    centerSelection: string;
    focusMode: string;
    showAll: string;
    autoFocus: string;
    visibleBodies: string;
    hiddenBodies: string;
    focusedSystem: string;
    openNote: string;
    openCanvas: string;
    enterFullscreen: string;
    exitFullscreen: string;
    closeEditor: string;
    addRootFolder: string;
    addChildFolder: string;
    addNote: string;
    addCanvas: string;
    addProject: string;
    create: string;
    cancel: string;
    folderNamePlaceholder: string;
    previousProject: string;
    nextProject: string;
    project: string;
    core: string;
    folder: string;
    note: string;
    canvas: string;
    uncategorized: string;
    rootFolders: string;
    directNotes: string;
    subfolders: string;
    descendants: string;
    updated: string;
    empty: string;
    emptyCanvas: string;
    hints: string;
    settings: string;
    trash: string;
    closeModal: string;
    overview: string;
    searchPlaceholder: string;
    clearFilters: string;
    back: string;
    notesMenu: string;
    foldersMenu: string;
    tagsMenu: string;
    filesMenu: string;
    pinnedMenu: string;
    colorsMenu: string;
    maxDepthReached: string;
    projectColor: string;
    folderColor: string;
    noteColor: string;
    chooseColor: string;
    customColor: string;
    deleteSystem: string;
    deleteFolder: string;
    moveToTrash: string;
    notesStat: string;
    elementsStat: string;
    foldersStat: string;
    tagsStat: string;
    assetsStat: string;
    pinnedStat: string;
    colorsStat: string;
    projectsStat: string;
    localVault: string;
    renameAction: string;
    totalBodies: string;
  };
}

interface FolderBranch {
  folder: Folder;
  children: FolderBranch[];
  notes: Note[];
  directNoteCount: number;
  descendantNoteCount: number;
  descendantFolderCount: number;
  mass: number;
  depth: number;
}

interface OrbitalData {
  projects: Project[];
  rootFoldersByProject: Map<string, FolderBranch[]>;
  looseNotesByProject: Map<string, Note[]>;
  visibleNoteCount: number;
  totalEntities: number;
  folderMeta: Map<
    string,
    {
      directNoteCount: number;
      descendantNoteCount: number;
      descendantFolderCount: number;
      depth: number;
      mass: number;
    }
  >;
  foldersByParent: Map<string | null, Folder[]>;
  notesByFolder: Map<string | null, Note[]>;
  projectById: Map<string, Project>;
  folderById: Map<string, Folder>;
  noteById: Map<string, Note>;
}

interface OrbitalSceneOrbit {
  id: string;
  entityId: string;
  parentEntityId: string;
  color: string;
  x: number;
  y: number;
  rx: number;
  ry: number;
  rotation: number;
  depth: number;
  kind: Exclude<SceneNodeKind, "core">;
}

interface OrbitalSceneLink {
  id: string;
  entityId: string;
  parentEntityId: string;
  color: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  depth: number;
  kind: Exclude<SceneNodeKind, "core">;
}

interface OrbitalSceneNode {
  id: string;
  entityId: string;
  parentEntityId: string | null;
  kind: SceneNodeKind;
  label: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  depth: number;
  note?: Note;
  folder?: Folder;
  project?: Project;
  mass: number;
  favorite?: boolean;
  pinned?: boolean;
  orbit?: Omit<OrbitalSceneOrbit, "id" | "entityId" | "kind" | "parentEntityId" | "depth">;
}

interface OrbitalScene {
  nodes: OrbitalSceneNode[];
  orbits: OrbitalSceneOrbit[];
  links: OrbitalSceneLink[];
  entityMap: Map<string, OrbitalSceneNode>;
}

interface InspectorHierarchyItem {
  id: string;
  entityId: string;
  kind: InspectorHierarchyItemKind;
  label: string;
  color: string;
  project?: Project;
  folder?: Folder;
  note?: Note;
  searchText: string;
  children: InspectorHierarchyItem[];
}

interface OrbitalLayoutOrbit {
  color: string;
  rx: number;
  ry: number;
  rotation: number;
  rotationCos: number;
  rotationSin: number;
  speed: number;
  direction: 1 | -1;
  baseAngle: number;
  wobble: number;
}

interface OrbitalLayoutNode {
  id: string;
  entityId: string;
  parentEntityId: string | null;
  kind: SceneNodeKind;
  label: string;
  radius: number;
  color: string;
  depth: number;
  note?: Note;
  folder?: Folder;
  project?: Project;
  mass: number;
  favorite?: boolean;
  pinned?: boolean;
  x?: number;
  y?: number;
  orbit?: OrbitalLayoutOrbit;
  children: OrbitalLayoutNode[];
}

interface OrbitalLayout {
  roots: OrbitalLayoutNode[];
  entityMap: Map<string, OrbitalLayoutNode>;
}

type HoverPreviewAnchorRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

type HoverPreviewAnchorSource = "scene" | "inspector";
type OrbitalChildKind = "folder" | "canvas" | "note";
type InspectorContextMenuTarget =
  | {
      kind: "folder";
      folder: Folder;
      label: string;
      color: string;
      canCreateFolder: boolean;
    }
  | {
      kind: "note" | "canvas";
      note: Note;
      label: string;
      color: string;
      pinned: boolean;
    };

type InspectorContextMenuState = {
  target: InspectorContextMenuTarget;
  presentation: "popover" | "sheet";
  position?: {
    x: number;
    y: number;
  } | null;
};

type InspectorRenameState = {
  kind: InspectorContextMenuTarget["kind"];
  id: string;
};

const VIEWBOX = {
  minX: -980,
  minY: -720,
  width: 1960,
  height: 1440
};

const CAMERA_MIN_SCALE = 0.45;
const CAMERA_MAX_SCALE = 2.2;
const ORBITAL_SCENE_BODY_BUDGET = 70;
const PROJECT_MIN_DISTANCE = 430;
const ORBIT_INTERACTION_WINDOW_MS = 1800;
const ORBIT_ACTIVE_FRAME_MS = 1000 / 18;
const ORBIT_IDLE_FRAME_MS = 1000 / 10;
const ORBIT_ACTIVE_FRAME_MS_LARGE = 1000 / 14;
const ORBIT_IDLE_FRAME_MS_LARGE = 1000 / 7;
const INSPECTOR_LONG_PRESS_MS = 460;
const INSPECTOR_LONG_PRESS_MOVE_TOLERANCE = 12;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toHoverPreviewAnchorRect(
  rect: Pick<DOMRect, "left" | "top" | "right" | "bottom" | "width" | "height">
): HoverPreviewAnchorRect {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
    centerX: rect.left + rect.width / 2,
    centerY: rect.top + rect.height / 2
  };
}

function hashString(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function seededUnit(seed: number, shift: number) {
  return ((seed >>> shift) % 1024) / 1023;
}

function isEditableTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;

  if (!element) {
    return false;
  }

  const tagName = element.tagName.toLowerCase();
  return (
    element.isContentEditable ||
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    Boolean(element.closest("[contenteditable='true']"))
  );
}

function isEntryFavorite(entry: { favorite?: boolean; pinned?: boolean }) {
  return Boolean(entry.pinned || entry.favorite);
}

function noteSorter(left: Note, right: Note) {
  const leftFavorite = isEntryFavorite(left);
  const rightFavorite = isEntryFavorite(right);

  if (leftFavorite !== rightFavorite) {
    return leftFavorite ? -1 : 1;
  }

  if (left.pinned !== right.pinned) {
    return left.pinned ? -1 : 1;
  }

  return right.updatedAt - left.updatedAt;
}

function getNoteMass(note: Note) {
  const favoriteWeight = isEntryFavorite(note) ? 0.45 : 0;

  if (note.contentType === "canvas") {
    const metrics = getCanvasMetrics(note.canvasContent, { includePlainText: false });
    return (
      1.18 +
      metrics.activeElementCount / 18 +
      metrics.imageCount * 0.28 +
      favoriteWeight
    );
  }

  return 1.08 + note.plainText.length / 240 + favoriteWeight;
}

function getOrbitalEntryRadius(note: Note) {
  if (note.contentType === "canvas") {
    const metrics = getCanvasMetrics(note.canvasContent, { includePlainText: false });
    return clamp(
      10 + Math.min(metrics.activeElementCount / 6, 7.2) + (isEntryFavorite(note) ? 1.2 : 0),
      10,
      18
    );
  }

  return clamp(9 + Math.min(note.plainText.length / 180, 6.4) + (isEntryFavorite(note) ? 1.2 : 0), 9, 17);
}

function truncateLabel(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function estimateLabelWidth(value: string) {
  return clamp(value.length * 7.3 + 24, 72, 198);
}

function buildStarburstPoints(innerRadius: number, outerRadius: number, points: number) {
  return Array.from({ length: points * 2 }, (_, index) => {
    const angle = (Math.PI / points) * index - Math.PI / 2;
    const radius = index % 2 === 0 ? outerRadius : innerRadius;
    return `${Math.cos(angle) * radius},${Math.sin(angle) * radius}`;
  }).join(" ");
}

function getChildEntityId(child: OrbitalChild) {
  return child.folder ? `folder:${child.folder.folder.id}` : `note:${child.note!.id}`;
}

function getOrbitalChildKind(child: OrbitalChild): OrbitalChildKind {
  if (child.folder) {
    return "folder";
  }

  return child.note?.contentType === "canvas" ? "canvas" : "note";
}

function getOrbitalChildCreatedAt(child: OrbitalChild) {
  return child.folder?.folder.createdAt ?? child.note?.createdAt ?? 0;
}

function getOrbitalChildStableId(child: OrbitalChild) {
  return child.folder?.folder.id ?? child.note?.id ?? "";
}

function getOrbitalChildGroupOrder(kind: OrbitalChildKind) {
  if (kind === "folder") {
    return 0;
  }

  if (kind === "canvas") {
    return 1;
  }

  return 2;
}

function compareOrbitalChildren(left: OrbitalChild, right: OrbitalChild) {
  const leftKind = getOrbitalChildKind(left);
  const rightKind = getOrbitalChildKind(right);
  const groupDelta = getOrbitalChildGroupOrder(leftKind) - getOrbitalChildGroupOrder(rightKind);

  if (groupDelta !== 0) {
    return groupDelta;
  }

  const createdAtDelta = getOrbitalChildCreatedAt(left) - getOrbitalChildCreatedAt(right);

  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return getOrbitalChildStableId(left).localeCompare(getOrbitalChildStableId(right));
}

type OrbitPlanningProfile = {
  innerPadding: number;
  laneGap: number;
  planeRatio: number;
  rotationRange: number;
  kindBandOffset: Record<OrbitalChildKind, number>;
  transitionGap: {
    folderToCanvas: number;
    folderToNote: number;
    canvasToNote: number;
  };
  speedRange: {
    min: number;
    max: number;
  };
};

function getOrbitPlanningProfile(
  parentKind: SceneNodeKind,
  depth: number
): OrbitPlanningProfile {
  if (parentKind === "core") {
    return {
      innerPadding: 188,
      laneGap: 24,
      planeRatio: 0.66,
      rotationRange: 12,
      kindBandOffset: {
        folder: 0,
        canvas: 42,
        note: 82
      },
      transitionGap: {
        folderToCanvas: 34,
        folderToNote: 58,
        canvasToNote: 24
      },
      speedRange: {
        min: 0.000022,
        max: 0.000049
      }
    };
  }

  if (depth <= 1) {
    return {
      innerPadding: 126,
      laneGap: 18,
      planeRatio: 0.78,
      rotationRange: 8,
      kindBandOffset: {
        folder: 0,
        canvas: 30,
        note: 58
      },
      transitionGap: {
        folderToCanvas: 24,
        folderToNote: 40,
        canvasToNote: 18
      },
      speedRange: {
        min: 0.000018,
        max: 0.000041
      }
    };
  }

  return {
    innerPadding: 108,
    laneGap: 15,
    planeRatio: 0.84,
    rotationRange: 6,
    kindBandOffset: {
      folder: 0,
      canvas: 24,
      note: 46
    },
    transitionGap: {
      folderToCanvas: 18,
      folderToNote: 30,
      canvasToNote: 14
    },
    speedRange: {
      min: 0.000018,
      max: 0.000041
    }
  };
}

function getOrbitTransitionGap(
  previousKind: OrbitalChildKind | null,
  nextKind: OrbitalChildKind,
  profile: OrbitPlanningProfile
) {
  if (!previousKind || previousKind === nextKind) {
    return 0;
  }

  if (previousKind === "folder" && nextKind === "canvas") {
    return profile.transitionGap.folderToCanvas;
  }

  if (previousKind === "folder" && nextKind === "note") {
    return profile.transitionGap.folderToNote;
  }

  if (previousKind === "canvas" && nextKind === "note") {
    return profile.transitionGap.canvasToNote;
  }

  return profile.transitionGap.canvasToNote;
}

function getProjectEntityId(projectId: string) {
  return `project:${projectId}`;
}

function buildOrbitalData(projects: Project[], folders: Folder[], notes: Note[]): OrbitalData {
  const visibleNotes = notes
    .filter((note) => note.trashedAt === null)
    .sort(noteSorter);
  const orderedProjects = [...projects].sort((left, right) => left.createdAt - right.createdAt);
  const rootFoldersByProject = new Map<string, FolderBranch[]>();
  const looseNotesByProject = new Map<string, Note[]>();
  const foldersByParent = new Map<string | null, Folder[]>();
  const notesByFolder = new Map<string | null, Note[]>();
  const projectById = new Map<string, Project>();
  const folderById = new Map<string, Folder>();
  const noteById = new Map<string, Note>();
  const folderMeta = new Map<
    string,
    {
      directNoteCount: number;
      descendantNoteCount: number;
      descendantFolderCount: number;
      depth: number;
      mass: number;
    }
  >();

  orderedProjects.forEach((project) => {
    projectById.set(project.id, project);
  });

  folders.forEach((folder) => {
    folderById.set(folder.id, folder);
    const bucket = foldersByParent.get(folder.parentId) ?? [];
    bucket.push(folder);
    foldersByParent.set(folder.parentId, bucket);
  });

  visibleNotes.forEach((note) => {
    noteById.set(note.id, note);
    const bucket = notesByFolder.get(note.folderId) ?? [];
    bucket.push(note);
    notesByFolder.set(note.folderId, bucket);
  });

  foldersByParent.forEach((bucket) => {
    bucket.sort((left, right) => left.name.localeCompare(right.name));
  });

  notesByFolder.forEach((bucket) => {
    bucket.sort(noteSorter);
  });

  const buildBranch = (folder: Folder, depth: number): FolderBranch => {
    const children = (foldersByParent.get(folder.id) ?? []).map((child) => buildBranch(child, depth + 1));
    const directNotes = notesByFolder.get(folder.id) ?? [];
    const descendantNoteCount =
      directNotes.length + children.reduce((sum, child) => sum + child.descendantNoteCount, 0);
    const descendantFolderCount =
      children.length + children.reduce((sum, child) => sum + child.descendantFolderCount, 0);
    const mass =
      1 +
      directNotes.length * 0.8 +
      descendantNoteCount * 0.38 +
      descendantFolderCount * 0.72;

    folderMeta.set(folder.id, {
      directNoteCount: directNotes.length,
      descendantNoteCount,
      descendantFolderCount,
      depth,
      mass
    });

    return {
      folder,
      children,
      notes: directNotes,
      directNoteCount: directNotes.length,
      descendantNoteCount,
      descendantFolderCount,
      mass,
      depth
    };
  };

  orderedProjects.forEach((project) => {
    rootFoldersByProject.set(
      project.id,
      (foldersByParent.get(null) ?? [])
        .filter((folder) => folder.projectId === project.id)
        .map((folder) => buildBranch(folder, 0))
    );

    looseNotesByProject.set(
      project.id,
      (notesByFolder.get(null) ?? []).filter((note) => note.projectId === project.id)
    );
  });

  return {
    projects: orderedProjects,
    rootFoldersByProject,
    looseNotesByProject,
    visibleNoteCount: visibleNotes.length,
    totalEntities: folders.length + visibleNotes.length + orderedProjects.length,
    folderMeta,
    foldersByParent,
    notesByFolder,
    projectById,
    folderById,
    noteById
  };
}

function collectFolderSubtreeEntityIds(folderId: string, data: OrbitalData) {
  const related = new Set<string>();

  const visit = (currentFolderId: string) => {
    const currentFolder = data.folderById.get(currentFolderId);

    if (!currentFolder) {
      return;
    }

    related.add(`folder:${currentFolder.id}`);

    (data.notesByFolder.get(currentFolder.id) ?? []).forEach((note) => {
      related.add(`note:${note.id}`);
    });

    (data.foldersByParent.get(currentFolder.id) ?? []).forEach((childFolder) => {
      visit(childFolder.id);
    });
  };

  visit(folderId);
  return related;
}

function collectFolderAncestryEntityIds(folderId: string, data: OrbitalData) {
  const chain: string[] = [];
  let currentFolder = data.folderById.get(folderId) ?? null;

  while (currentFolder) {
    chain.unshift(`folder:${currentFolder.id}`);
    currentFolder = currentFolder.parentId
      ? data.folderById.get(currentFolder.parentId) ?? null
      : null;
  }

  return chain;
}

function buildSelectedSystemEntitySet(selectedEntityId: string, data: OrbitalData) {
  const related = new Set<string>();
  const addProjectSystem = (projectId: string) => {
    related.add(getProjectEntityId(projectId));
    (data.rootFoldersByProject.get(projectId) ?? []).forEach((branch) => {
      related.add(`folder:${branch.folder.id}`);
    });
    (data.looseNotesByProject.get(projectId) ?? []).forEach((note) => {
      related.add(`note:${note.id}`);
    });
  };

  if (selectedEntityId.startsWith("project:")) {
    const projectId = selectedEntityId.slice("project:".length);
    if (!data.projectById.has(projectId)) {
      return related;
    }
    addProjectSystem(projectId);
    return related;
  }

  if (selectedEntityId.startsWith("folder:")) {
    const folderId = selectedEntityId.slice("folder:".length);
    if (!data.folderById.has(folderId)) {
      return related;
    }

    collectFolderSubtreeEntityIds(folderId, data).forEach((entityId) => {
      related.add(entityId);
    });
    return related;
  }

  if (selectedEntityId.startsWith("note:")) {
    const noteId = selectedEntityId.slice("note:".length);
    const note = data.noteById.get(noteId);

    if (!note) {
      return related;
    }

    related.add(`note:${note.id}`);
  }

  return related;
}

function getEntityVisibilityChain(entityId: string, data: OrbitalData) {
  const projectId = getEntityProjectId(entityId, data);

  if (!projectId || !data.projectById.has(projectId)) {
    return [];
  }

  const chain = [getProjectEntityId(projectId)];

  if (entityId.startsWith("project:")) {
    return chain;
  }

  if (entityId.startsWith("folder:")) {
    const folderId = entityId.slice("folder:".length);

    if (!data.folderById.has(folderId)) {
      return chain;
    }

    return [...chain, ...collectFolderAncestryEntityIds(folderId, data)];
  }

  if (entityId.startsWith("note:")) {
    const noteId = entityId.slice("note:".length);
    const note = data.noteById.get(noteId);

    if (!note) {
      return chain;
    }

    return note.folderId
      ? [...chain, ...collectFolderAncestryEntityIds(note.folderId, data), `note:${note.id}`]
      : [...chain, `note:${note.id}`];
  }

  return chain;
}

function getVisibilityChainAdditionalCost(chain: string[], visibleEntityIds: Set<string>) {
  return chain.reduce((total, entityId) => {
    if (entityId.startsWith("project:") || visibleEntityIds.has(entityId)) {
      return total;
    }

    return total + 1;
  }, 0);
}

function addVisibilityChain(chain: string[], visibleEntityIds: Set<string>) {
  let addedBodies = 0;

  chain.forEach((entityId) => {
    if (visibleEntityIds.has(entityId)) {
      return;
    }

    visibleEntityIds.add(entityId);

    if (!entityId.startsWith("project:")) {
      addedBodies += 1;
    }
  });

  return addedBodies;
}

function buildAdaptiveVisibilitySet({
  data,
  budget,
  currentProjectId,
  priorityProjectId,
  selectedEntityId,
  filterPrimaryEntityIds,
  filterSecondaryEntityIds
}: {
  data: OrbitalData;
  budget: number;
  currentProjectId: string | null;
  priorityProjectId: string | null;
  selectedEntityId: string | null;
  filterPrimaryEntityIds: Set<string>;
  filterSecondaryEntityIds: Set<string>;
}) {
  const visibleEntityIds = new Set<string>();
  const totalBodyCount = Math.max(data.totalEntities - data.projects.length, 0);
  let remainingBudget = Math.min(budget, totalBodyCount);

  data.projects.forEach((project) => {
    visibleEntityIds.add(getProjectEntityId(project.id));
  });

  const selectedAncestryEntityIds = new Set<string>();
  const selectedSubtreeEntityIds = new Set<string>();
  const selectedDirectChildEntityIds = new Set<string>();

  if (selectedEntityId?.startsWith("project:")) {
    const selectedProjectId = selectedEntityId.slice("project:".length);

    data.rootFoldersByProject.get(selectedProjectId)?.forEach((branch) => {
      selectedDirectChildEntityIds.add(`folder:${branch.folder.id}`);
    });

    data.looseNotesByProject.get(selectedProjectId)?.forEach((note) => {
      selectedDirectChildEntityIds.add(`note:${note.id}`);
    });

    data.folderById.forEach((folder) => {
      if (folder.projectId === selectedProjectId) {
        selectedSubtreeEntityIds.add(`folder:${folder.id}`);
      }
    });

    data.noteById.forEach((note) => {
      if (note.projectId === selectedProjectId) {
        selectedSubtreeEntityIds.add(`note:${note.id}`);
      }
    });
  }

  if (selectedEntityId?.startsWith("folder:")) {
    const selectedFolderId = selectedEntityId.slice("folder:".length);

    collectFolderAncestryEntityIds(selectedFolderId, data).forEach((entityId) => {
      selectedAncestryEntityIds.add(entityId);
    });

    collectFolderSubtreeEntityIds(selectedFolderId, data).forEach((entityId) => {
      selectedSubtreeEntityIds.add(entityId);
    });

    (data.foldersByParent.get(selectedFolderId) ?? []).forEach((folder) => {
      selectedDirectChildEntityIds.add(`folder:${folder.id}`);
    });

    (data.notesByFolder.get(selectedFolderId) ?? []).forEach((note) => {
      selectedDirectChildEntityIds.add(`note:${note.id}`);
    });
  }

  if (selectedEntityId?.startsWith("note:")) {
    const selectedNoteId = selectedEntityId.slice("note:".length);
    const selectedNote = data.noteById.get(selectedNoteId);

    if (selectedNote?.folderId) {
      collectFolderAncestryEntityIds(selectedNote.folderId, data).forEach((entityId) => {
        selectedAncestryEntityIds.add(entityId);
      });
    }
  }

  const tryAddEntity = (entityId: string) => {
    if (visibleEntityIds.has(entityId)) {
      return 0;
    }

    const chain = getEntityVisibilityChain(entityId, data);
    const additionalCost = getVisibilityChainAdditionalCost(chain, visibleEntityIds);

    if (additionalCost === 0) {
      return 0;
    }

    if (additionalCost > remainingBudget) {
      return -1;
    }

    remainingBudget -= additionalCost;
    return addVisibilityChain(chain, visibleEntityIds);
  };

  if (selectedEntityId) {
    tryAddEntity(selectedEntityId);
  }

  const updatedAtValues = [
    ...Array.from(data.folderById.values(), (folder) => folder.updatedAt),
    ...Array.from(data.noteById.values(), (note) => note.updatedAt)
  ];
  const minUpdatedAt = updatedAtValues.length > 0 ? Math.min(...updatedAtValues) : 0;
  const maxUpdatedAt = updatedAtValues.length > 0 ? Math.max(...updatedAtValues) : 0;
  const updatedAtRange = Math.max(maxUpdatedAt - minUpdatedAt, 1);
  const hasActiveFilter = filterPrimaryEntityIds.size > 0 || filterSecondaryEntityIds.size > 0;
  const filterMatchedProjectIds = new Set<string>();

  filterPrimaryEntityIds.forEach((entityId) => {
    const projectId = getEntityProjectId(entityId, data);

    if (projectId) {
      filterMatchedProjectIds.add(projectId);
    }
  });

  type VisibilityCandidate = {
    entityId: string;
    projectId: string;
    score: number;
    isRootLevel: boolean;
  };

  const candidates: VisibilityCandidate[] = [];
  const rootCandidatesByProject = new Map<string, VisibilityCandidate[]>();

  const registerCandidate = (candidate: VisibilityCandidate) => {
    candidates.push(candidate);

    if (!candidate.isRootLevel) {
      return;
    }

    const queue = rootCandidatesByProject.get(candidate.projectId) ?? [];
    queue.push(candidate);
    rootCandidatesByProject.set(candidate.projectId, queue);
  };

  data.folderById.forEach((folder) => {
    const entityId = `folder:${folder.id}`;
    const meta = data.folderMeta.get(folder.id);
    const isRootLevel = folder.parentId === null;
    const recencyScore = ((folder.updatedAt - minUpdatedAt) / updatedAtRange) * 180;
    let score =
      recencyScore +
      Math.min(360, (meta?.mass ?? 1) * 42) +
      Math.min(
        280,
        (meta?.descendantNoteCount ?? 0) * 24 + (meta?.descendantFolderCount ?? 0) * 30
      ) +
      (isRootLevel ? 540 : 0);

    if (currentProjectId && folder.projectId === currentProjectId) {
      score += 180;
    }

    if (priorityProjectId && folder.projectId === priorityProjectId) {
      score += isRootLevel ? 1460 : 980;
    }

    if (selectedEntityId === entityId) {
      score += 8400;
    }

    if (selectedAncestryEntityIds.has(entityId)) {
      score += 3200;
    }

    if (selectedDirectChildEntityIds.has(entityId)) {
      score += 3000;
    } else if (selectedSubtreeEntityIds.has(entityId)) {
      score += 2480;
    }

    if (filterPrimaryEntityIds.has(entityId)) {
      score += 7200;
    }

    if (filterSecondaryEntityIds.has(entityId)) {
      score += 4400;
    }

    if (filterMatchedProjectIds.has(folder.projectId)) {
      score += isRootLevel ? 1400 : 420;
    }

    registerCandidate({
      entityId,
      projectId: folder.projectId,
      score,
      isRootLevel
    });
  });

  data.noteById.forEach((note) => {
    const entityId = `note:${note.id}`;
    const isRootLevel = note.folderId === null;
    const recencyScore = ((note.updatedAt - minUpdatedAt) / updatedAtRange) * 190;
    let score =
      recencyScore +
      Math.min(160, note.plainText.length / 24) +
      (isEntryFavorite(note) ? 760 : 0) +
      (note.contentType === "canvas" ? 120 : 0) +
      (isRootLevel ? 510 : 0);

    if (currentProjectId && note.projectId === currentProjectId) {
      score += 190;
    }

    if (priorityProjectId && note.projectId === priorityProjectId) {
      score += isRootLevel ? 1340 : 920;
    }

    if (selectedEntityId === entityId) {
      score += 8600;
    }

    if (selectedDirectChildEntityIds.has(entityId)) {
      score += 2900;
    } else if (selectedSubtreeEntityIds.has(entityId)) {
      score += 2380;
    }

    if (filterPrimaryEntityIds.has(entityId)) {
      score += 7200;
    }

    if (filterSecondaryEntityIds.has(entityId)) {
      score += 4400;
    }

    if (filterMatchedProjectIds.has(note.projectId)) {
      score += isRootLevel ? 1400 : 420;
    }

    registerCandidate({
      entityId,
      projectId: note.projectId,
      score,
      isRootLevel
    });
  });

  rootCandidatesByProject.forEach((queue) => {
    queue.sort((left, right) => right.score - left.score);
  });

  const orderedProjectIds = [...data.projects]
    .sort((left, right) => {
      const leftPriority = left.id === priorityProjectId ? 1 : 0;
      const rightPriority = right.id === priorityProjectId ? 1 : 0;

      if (leftPriority !== rightPriority) {
        return rightPriority - leftPriority;
      }

      const leftCurrent = left.id === currentProjectId ? 1 : 0;
      const rightCurrent = right.id === currentProjectId ? 1 : 0;

      if (leftCurrent !== rightCurrent) {
        return rightCurrent - leftCurrent;
      }

      return right.updatedAt - left.updatedAt;
    })
    .map((project) => project.id);

  const takeNextRootCandidate = (projectId: string) => {
    const queue = rootCandidatesByProject.get(projectId);

    while (queue && queue.length > 0) {
      const candidate = queue.shift()!;

      if (!visibleEntityIds.has(candidate.entityId)) {
        return candidate;
      }
    }

    return null;
  };

  const globalCandidates = [...candidates].sort((left, right) => right.score - left.score);

  if (!hasActiveFilter) {
    if (priorityProjectId) {
      let seededPriorityRoots = 0;

      while (seededPriorityRoots < 4 && remainingBudget > 0) {
        const candidate = takeNextRootCandidate(priorityProjectId);

        if (!candidate) {
          break;
        }

        if (tryAddEntity(candidate.entityId) > 0) {
          seededPriorityRoots += 1;
        }
      }

      orderedProjectIds.forEach((projectId) => {
        if (projectId === priorityProjectId || remainingBudget <= 0) {
          return;
        }

        const candidate = takeNextRootCandidate(projectId);

        if (candidate) {
          tryAddEntity(candidate.entityId);
        }
      });
    } else {
      const rootPasses =
        data.projects.length <= 3 ? 3 : data.projects.length <= 8 ? 2 : 1;

      for (let pass = 0; pass < rootPasses && remainingBudget > 0; pass += 1) {
        orderedProjectIds.forEach((projectId) => {
          if (remainingBudget <= 0) {
            return;
          }

          const candidate = takeNextRootCandidate(projectId);

          if (candidate) {
            tryAddEntity(candidate.entityId);
          }
        });
      }
    }
  }

  if (priorityProjectId && remainingBudget > 0) {
    let priorityBodiesAdded = 0;
    const priorityBodyBudget = Math.min(
      Math.round(budget * 0.62),
      Math.max(24, budget - Math.min(data.projects.length, 10))
    );

    for (const candidate of globalCandidates) {
      if (candidate.projectId !== priorityProjectId || remainingBudget <= 0) {
        continue;
      }

      if (priorityBodiesAdded >= priorityBodyBudget) {
        break;
      }

      const addedBodies = tryAddEntity(candidate.entityId);

      if (addedBodies > 0) {
        priorityBodiesAdded += addedBodies;
      }
    }
  }

  for (const candidate of globalCandidates) {
    if (remainingBudget <= 0) {
      break;
    }

    tryAddEntity(candidate.entityId);
  }

  return visibleEntityIds;
}

function buildOrbitalLayout(
  data: OrbitalData,
  visibleEntityIds: Set<string> | null
): OrbitalLayout {
  const roots: OrbitalLayoutNode[] = [];
  const entityMap = new Map<string, OrbitalLayoutNode>();

  const renderChildren = (
    parent: Pick<OrbitalLayoutNode, "entityId" | "kind" | "radius">,
    children: OrbitalChild[],
    depth: number
  ) => {
    const orderedChildren = [...children].sort(compareOrbitalChildren);
    const visibleChildren = visibleEntityIds
      ? orderedChildren.filter((child) => visibleEntityIds.has(getChildEntityId(child)))
      : orderedChildren;

    if (visibleChildren.length === 0) {
      return [];
    }

    const profile = getOrbitPlanningProfile(parent.kind, depth);
    const planeSeed = hashString(`${parent.entityId}:plane`);
    const planeRotation =
      ((((planeSeed >> 3) % 1000) / 999) * 2 - 1) * profile.rotationRange;
    const planeRatio =
      profile.planeRatio + ((((planeSeed >> 12) % 9) - 4) * 0.0045);
    const rotationRad = (planeRotation * Math.PI) / 180;
    const parentPhase = ((hashString(`${parent.entityId}:phase`) % 360) * Math.PI) / 180;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const orbitPlanByEntityId = new Map<
      string,
      {
        mass: number;
        radius: number;
        color: string;
        label: string;
        kind: SceneNodeKind;
        orbit: OrbitalLayoutOrbit;
      }
    >();

    let orbitRadius = 0;
    let previousChildKind: OrbitalChildKind | null = null;
    let previousChildRadius = 0;

    orderedChildren.forEach((child, orderIndex) => {
      const entityId = getChildEntityId(child);
      const childKind = getOrbitalChildKind(child);
      const seed = hashString(entityId);
      const mass = child.folder?.mass ?? getNoteMass(child.note!);
      const kind: SceneNodeKind = child.folder ? "folder" : "note";
      const label = child.folder?.folder.name ?? child.note?.title ?? "";
      const radius = child.folder
        ? clamp(14 + child.folder.mass * 1.5, 15, 40)
        : getOrbitalEntryRadius(child.note!);
      const color = child.folder?.folder.color ?? child.note?.color ?? DEFAULT_NOTE_COLOR;

      if (orderIndex === 0) {
        orbitRadius =
          parent.radius + profile.innerPadding + profile.kindBandOffset[childKind] + radius;
      } else {
        orbitRadius +=
          previousChildRadius +
          radius +
          profile.laneGap +
          getOrbitTransitionGap(previousChildKind, childKind, profile);
      }

      const speedSeed = seededUnit(seed, 11);
      const speed =
        profile.speedRange.min + (profile.speedRange.max - profile.speedRange.min) * speedSeed;
      const direction = (seed % 2 === 0 ? 1 : -1) as 1 | -1;
      const baseAngle =
        parentPhase +
        orderIndex * goldenAngle +
        ((((seed >> 17) % 120) - 60) / 60) * 0.08;

      orbitPlanByEntityId.set(entityId, {
        mass,
        radius,
        color,
        label,
        kind,
        orbit: {
          color,
          rx: orbitRadius,
          ry: Math.max(parent.radius + profile.innerPadding * 0.58, orbitRadius * planeRatio),
          rotation: planeRotation,
          rotationCos: Math.cos(rotationRad),
          rotationSin: Math.sin(rotationRad),
          speed,
          direction,
          baseAngle,
          wobble: ((((seed >> 14) % 240) - 120) / 120) * 0.035
        }
      });

      previousChildKind = childKind;
      previousChildRadius = radius;
    });

    const nodes: OrbitalLayoutNode[] = [];
    visibleChildren.forEach((child) => {
      const entityId = getChildEntityId(child);
      const orbitPlan = orbitPlanByEntityId.get(entityId);

      if (!orbitPlan) {
        return;
      }

      const node: OrbitalLayoutNode = {
        id: entityId,
        entityId,
        parentEntityId: parent.entityId,
        kind: orbitPlan.kind,
        label: orbitPlan.label,
        radius: orbitPlan.radius,
        color: orbitPlan.color,
        depth,
        folder: child.folder?.folder,
        note: child.note,
        mass: orbitPlan.mass,
        favorite: child.note?.favorite,
        pinned: child.note?.pinned,
        orbit: orbitPlan.orbit,
        children: []
      };

      entityMap.set(entityId, node);

      if (child.folder) {
        node.children = renderChildren(
          node,
          [
            ...child.folder.children.map((branch) => ({ folder: branch })),
            ...child.folder.notes.map((note) => ({ note }))
          ],
          depth + 1
        );
      }

      nodes.push(node);
    });

    return nodes;
  };

  data.projects.forEach((project) => {
    const coreEntityId = getProjectEntityId(project.id);

    if (visibleEntityIds && !visibleEntityIds.has(coreEntityId)) {
      return;
    }

    const coreNode: OrbitalLayoutNode = {
      id: coreEntityId,
      entityId: coreEntityId,
      parentEntityId: null,
      kind: "core",
      label: project.name,
      x: project.x,
      y: project.y,
      radius: 58,
      color: project.color ?? DEFAULT_PROJECT_COLOR,
      depth: 0,
      project,
      mass: 10,
      children: []
    };

    entityMap.set(coreEntityId, coreNode);
    coreNode.children = renderChildren(
      coreNode,
      [
        ...(data.rootFoldersByProject.get(project.id) ?? []).map((folder) => ({ folder })),
        ...(data.looseNotesByProject.get(project.id) ?? []).map((note) => ({ note }))
      ],
      0
    );
    roots.push(coreNode);
  });

  return {
    roots,
    entityMap
  };
}

function materializeOrbitalScene(layout: OrbitalLayout, timeMs: number): OrbitalScene {
  const nodes: OrbitalSceneNode[] = [];
  const orbits: OrbitalSceneOrbit[] = [];
  const links: OrbitalSceneLink[] = [];
  const entityMap = new Map<string, OrbitalSceneNode>();

  const visit = (
    layoutNode: OrbitalLayoutNode,
    parent: OrbitalSceneNode | null
  ) => {
    let x = layoutNode.x ?? 0;
    let y = layoutNode.y ?? 0;
    let orbit:
      | Omit<OrbitalSceneOrbit, "id" | "entityId" | "kind" | "parentEntityId" | "depth">
      | undefined;

    if (parent && layoutNode.orbit) {
      const angle =
        layoutNode.orbit.baseAngle +
        timeMs * layoutNode.orbit.speed * layoutNode.orbit.direction +
        layoutNode.orbit.wobble;
      const localX = Math.cos(angle) * layoutNode.orbit.rx;
      const localY = Math.sin(angle) * layoutNode.orbit.ry;

      x =
        parent.x +
        localX * layoutNode.orbit.rotationCos -
        localY * layoutNode.orbit.rotationSin;
      y =
        parent.y +
        localX * layoutNode.orbit.rotationSin +
        localY * layoutNode.orbit.rotationCos;
      orbit = {
        x: parent.x,
        y: parent.y,
        rx: layoutNode.orbit.rx,
        ry: layoutNode.orbit.ry,
        rotation: layoutNode.orbit.rotation,
        color: layoutNode.orbit.color
      };
    }

    const sceneNode: OrbitalSceneNode = {
      id: layoutNode.id,
      entityId: layoutNode.entityId,
      parentEntityId: layoutNode.parentEntityId,
      kind: layoutNode.kind,
      label: layoutNode.label,
      x,
      y,
      radius: layoutNode.radius,
      color: layoutNode.color,
      depth: layoutNode.depth,
      note: layoutNode.note,
      folder: layoutNode.folder,
      project: layoutNode.project,
      mass: layoutNode.mass,
      favorite: layoutNode.favorite,
      pinned: layoutNode.pinned,
      orbit
    };

    nodes.push(sceneNode);
    entityMap.set(sceneNode.entityId, sceneNode);

    if (parent && orbit) {
      orbits.push({
        id: `${sceneNode.entityId}:orbit`,
        entityId: sceneNode.entityId,
        parentEntityId: parent.entityId,
        color: orbit.color,
        x: orbit.x,
        y: orbit.y,
        rx: orbit.rx,
        ry: orbit.ry,
        rotation: orbit.rotation,
        depth: sceneNode.depth,
        kind: sceneNode.kind === "note" ? "note" : "folder"
      });
      links.push({
        id: `${parent.entityId}->${sceneNode.entityId}`,
        entityId: sceneNode.entityId,
        parentEntityId: parent.entityId,
        color: orbit.color,
        x1: parent.x,
        y1: parent.y,
        x2: sceneNode.x,
        y2: sceneNode.y,
        depth: sceneNode.depth,
        kind: sceneNode.kind === "note" ? "note" : "folder"
      });
    }

    layoutNode.children.forEach((child) => {
      visit(child, sceneNode);
    });
  };

  layout.roots.forEach((root) => {
    visit(root, null);
  });

  return {
    nodes,
    orbits,
    links,
    entityMap
  };
}

function filterInspectorHierarchy(
  items: InspectorHierarchyItem[],
  query: string
): InspectorHierarchyItem[] {
  if (!query) {
    return items;
  }

  return items.flatMap((item) => {
    const filteredChildren = filterInspectorHierarchy(item.children, query);
    const matchesSelf = item.searchText.includes(query);

    if (!matchesSelf && filteredChildren.length === 0) {
      return [];
    }

    return [
      {
        ...item,
        children: filteredChildren
      }
    ];
  });
}

function countInspectorHierarchyItems(items: InspectorHierarchyItem[]): number {
  return items.reduce((total, item) => total + 1 + countInspectorHierarchyItems(item.children), 0);
}

function getEntityProjectId(entityId: string | null, data: OrbitalData) {
  if (!entityId) {
    return null;
  }

  if (entityId.startsWith("project:")) {
    return entityId.slice("project:".length);
  }

  if (entityId.startsWith("folder:")) {
    return data.folderById.get(entityId.slice("folder:".length))?.projectId ?? null;
  }

  if (entityId.startsWith("note:")) {
    return data.noteById.get(entityId.slice("note:".length))?.projectId ?? null;
  }

  return null;
}

function findOpenProjectPosition(projects: Project[]) {
  const horizontalPadding = 180;
  const verticalPadding = 180;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const x =
      VIEWBOX.minX +
      horizontalPadding +
      Math.random() * (VIEWBOX.width - horizontalPadding * 2);
    const y =
      VIEWBOX.minY +
      verticalPadding +
      Math.random() * (VIEWBOX.height - verticalPadding * 2);

    const isOpen = projects.every((project) => {
      const dx = project.x - x;
      const dy = project.y - y;
      return Math.sqrt(dx * dx + dy * dy) >= PROJECT_MIN_DISTANCE;
    });

    if (isOpen) {
      return { x, y };
    }
  }

  const fallbackIndex = projects.length;
  return {
    x: VIEWBOX.minX + 260 + (fallbackIndex % 4) * 360,
    y: VIEWBOX.minY + 240 + Math.floor(fallbackIndex / 4) * 320
  };
}

export default function OrbitalMapView({
  projects,
  folders,
  notes,
  tags,
  assets,
  assetCount,
  language,
  activeLocalVaultId,
  localVaultOptions,
  syncStatusChip,
  syncTransportChip,
  editorOpen,
  editorMode = null,
  editorSlot,
  editorTitle,
  editorAccentColor,
  settingsModalSlot,
  trashModalSlot,
  showClose = true,
  onClose,
  onSelectLocalVault,
  onCreateLocalVault,
  onCloseEditor,
  onCreateProject,
  onRenameProject,
  onUpdateProjectPosition,
  onUpdateProjectColor,
  onDeleteProject,
  onCreateFolder,
  onRenameFolder,
  onUpdateFolderColor,
  onRenameNote,
  onUpdateNoteColor,
  onSetNotePinned,
  onDeleteFolder,
  onDeleteNote,
  onCreateNote,
  onCreateCanvas,
  onOpenNote,
  onResolveFileUrl,
  labels
}: OrbitalMapViewProps) {
  const { t } = useTranslation();
  const tagMap = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const [isPaused, setIsPaused] = useState(false);
  const [timeMs, setTimeMs] = useState(0);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 });
  const [isFolderDraftOpen, setIsFolderDraftOpen] = useState(false);
  const [folderDraftParentId, setFolderDraftParentId] = useState<string | null>(null);
  const [folderDraftProjectId, setFolderDraftProjectId] = useState<string | null>(null);
  const [folderDraft, setFolderDraft] = useState("");
  const [folderDraftColor, setFolderDraftColor] = useState<string>(DEFAULT_FOLDER_COLOR);
  const [folderDraftError, setFolderDraftError] = useState<string | null>(null);
  const [projectPositionDrafts, setProjectPositionDrafts] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const [activeModal, setActiveModal] = useState<"settings" | "trash" | null>(null);
  const [isCanvasEditorFullscreen, setIsCanvasEditorFullscreen] = useState(false);
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState !== "hidden"
  );
  const [isOrbitInteractionActive, setIsOrbitInteractionActive] = useState(true);
  const [filterQuery, setFilterQuery] = useState("");
  const [activeColorFilters, setActiveColorFilters] = useState<string[]>([]);
  const editorModalRef = useRef<HTMLDivElement | null>(null);

  const toggleCanvasEditorFullscreen = async () => {
    if (typeof document === "undefined") {
      setIsCanvasEditorFullscreen((current) => !current);
      return;
    }

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setIsCanvasEditorFullscreen(false);
        return;
      }

      if (editorModalRef.current?.requestFullscreen) {
        await editorModalRef.current.requestFullscreen();
      }

      setIsCanvasEditorFullscreen(true);
    } catch {
      setIsCanvasEditorFullscreen((current) => !current);
    }
  };
  const [activeTagFilters, setActiveTagFilters] = useState<string[]>([]);
  const [activeFolderFilters, setActiveFolderFilters] = useState<string[]>([]);
  const [activeNoteFilters, setActiveNoteFilters] = useState<string[]>([]);
  const [activeAssetFilters, setActiveAssetFilters] = useState<string[]>([]);
  const [collapsedInspectorFolders, setCollapsedInspectorFolders] = useState<string[]>([]);
  const [inspectorMenu, setInspectorMenu] = useState<InspectorMenu>("overview");
  const [inspectorQuery, setInspectorQuery] = useState("");
  const [hierarchyFocusedEntityId, setHierarchyFocusedEntityId] = useState<string | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [inspectorRenameState, setInspectorRenameState] = useState<InspectorRenameState | null>(null);
  const [inspectorRenameDraft, setInspectorRenameDraft] = useState("");
  const [contextMenuState, setContextMenuState] = useState<InspectorContextMenuState | null>(null);
  const [hoveredSelectionNoteId, setHoveredSelectionNoteId] = useState<string | null>(null);
  const [hoverPreviewAnchorSource, setHoverPreviewAnchorSource] =
    useState<HoverPreviewAnchorSource | null>(null);
  const [hoverPreviewFallbackRect, setHoverPreviewFallbackRect] =
    useState<HoverPreviewAnchorRect | null>(null);
  const [hoverPreviewCursor, setHoverPreviewCursor] = useState({ x: 0, y: 0 });
  const timeRef = useRef(0);
  const cameraRef = useRef({ x: 0, y: 0, scale: 1 });
  const cameraAnimationFrameRef = useRef<number | null>(null);
  const projectPositionDraftsRef = useRef<Record<string, { x: number; y: number }>>({});
  const noteHoverPreviewScrollRef = useRef<HTMLDivElement | null>(null);
  const hoverPreviewCloseTimeoutRef = useRef<number | null>(null);
  const hoverPreviewSceneAnchorRef = useRef<SVGGElement | null>(null);
  const folderDraftRowRef = useRef<HTMLDivElement | null>(null);
  const folderDraftInputRef = useRef<HTMLInputElement | null>(null);
  const inspectorPanelRef = useRef<HTMLElement | null>(null);
  const inspectorMenuListRef = useRef<HTMLDivElement | null>(null);
  const inspectorHierarchyItemRefs = useRef(new Map<string, HTMLElement>());
  const orbitInteractionTimeoutRef = useRef<number | null>(null);
  const orbitInteractionActiveRef = useRef(true);
  const suppressInspectorClickRef = useRef(false);
  const inspectorLongPressRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    timeoutId: number;
  } | null>(null);
  const dragRef = useRef<
    | {
        mode: "camera";
        pointerId: number;
        startX: number;
        startY: number;
        originX: number;
        originY: number;
      }
    | {
        mode: "project";
        pointerId: number;
        projectId: string;
        startX: number;
        startY: number;
        originProjectX: number;
        originProjectY: number;
        hasMoved: boolean;
      }
    | null
  >(null);
  const folderPathMap = useMemo(() => buildFolderPathMap(folders), [folders]);
  const projectsWithDraftPositions = useMemo(
    () =>
      projects.map((project) => {
        const draft = projectPositionDrafts[project.id];
        return draft ? { ...project, x: draft.x, y: draft.y } : project;
      }),
    [projectPositionDrafts, projects]
  );
  const orbitalData = useMemo(
    () => buildOrbitalData(projectsWithDraftPositions, folders, notes),
    [folders, notes, projectsWithDraftPositions]
  );
  const normalizedFilterQuery = filterQuery.trim().toLowerCase();
  const normalizedInspectorQuery = inspectorQuery.trim().toLowerCase();
  const activeColorFilterSet = useMemo(() => new Set(activeColorFilters), [activeColorFilters]);
  const activeTagFilterSet = useMemo(() => new Set(activeTagFilters), [activeTagFilters]);
  const activeFolderFilterSet = useMemo(() => new Set(activeFolderFilters), [activeFolderFilters]);
  const activeNoteFilterSet = useMemo(() => new Set(activeNoteFilters), [activeNoteFilters]);
  const activeAssetFilterSet = useMemo(() => new Set(activeAssetFilters), [activeAssetFilters]);
  const collapsedInspectorFolderSet = useMemo(
    () => new Set(collapsedInspectorFolders),
    [collapsedInspectorFolders]
  );
  const searchableFolders = useMemo(
    () =>
      [...folders].sort((left, right) =>
        (folderPathMap.get(left.id) ?? left.name).localeCompare(folderPathMap.get(right.id) ?? right.name)
      ),
    [folderPathMap, folders]
  );
  const assetNamesByNoteId = useMemo(() => {
    const namesByNoteId = new Map<string, string[]>();

    assets.forEach((asset) => {
      const bucket = namesByNoteId.get(asset.noteId) ?? [];
      bucket.push(asset.name);
      namesByNoteId.set(asset.noteId, bucket);
    });

    return namesByNoteId;
  }, [assets]);
  const visibleNotes = useMemo(() => [...orbitalData.noteById.values()].sort(noteSorter), [orbitalData.noteById]);
  const currentProjectId = activeProjectId ?? orbitalData.projects[0]?.id ?? null;
  const currentProjectEntityId = currentProjectId ? getProjectEntityId(currentProjectId) : null;
  const currentProject = currentProjectId
    ? orbitalData.projectById.get(currentProjectId) ?? null
    : null;
  const currentProjectFolders = useMemo(
    () => (currentProjectId ? folders.filter((folder) => folder.projectId === currentProjectId) : []),
    [currentProjectId, folders]
  );
  const currentProjectNotes = useMemo(
    () => (currentProjectId ? visibleNotes.filter((note) => note.projectId === currentProjectId) : []),
    [currentProjectId, visibleNotes]
  );
  const currentProjectAssets = useMemo(
    () =>
      currentProjectId
        ? assets.filter((asset) => orbitalData.noteById.get(asset.noteId)?.projectId === currentProjectId)
        : [],
    [assets, currentProjectId, orbitalData.noteById]
  );
  const currentProjectTagCounts = useMemo(() => {
    const counts = new Map<string, number>();

    currentProjectNotes.forEach((note) => {
      note.tagIds.forEach((tagId) => {
        counts.set(tagId, (counts.get(tagId) ?? 0) + 1);
      });
    });

    return counts;
  }, [currentProjectNotes]);
  const colorCounts = useMemo(() => {
    const counts = new Map<string, number>();

    if (currentProject?.color) {
      counts.set(currentProject.color, (counts.get(currentProject.color) ?? 0) + 1);
    }

    currentProjectFolders.forEach((folder) => {
      counts.set(folder.color, (counts.get(folder.color) ?? 0) + 1);
    });

    currentProjectNotes.forEach((note) => {
      const color = note.color || DEFAULT_NOTE_COLOR;
      counts.set(color, (counts.get(color) ?? 0) + 1);
    });

    return counts;
  }, [currentProject, currentProjectFolders, currentProjectNotes]);
  const totalSceneBodyCount = Math.max(orbitalData.totalEntities - orbitalData.projects.length, 0);
  const isSceneBudgetConstrained = totalSceneBodyCount > ORBITAL_SCENE_BODY_BUDGET;
  const selectedPrimaryEntityIds = useMemo(() => {
    if (selectedEntityId) {
      return new Set<string>([selectedEntityId]);
    }

    return currentProjectEntityId
      ? buildSelectedSystemEntitySet(currentProjectEntityId, orbitalData)
      : new Set<string>();
  }, [currentProjectEntityId, selectedEntityId, orbitalData]);
  const selectedSecondaryEntityIds = useMemo(() => {
    if (!selectedEntityId) {
      return new Set<string>();
    }

    const related = buildSelectedSystemEntitySet(selectedEntityId, orbitalData);
    related.delete(selectedEntityId);
    return related;
  }, [selectedEntityId, orbitalData]);
  const isPriorityFocusMode = false;
  const searchMatchedEntityIds = useMemo(() => {
    const matches = new Set<string>();

    if (!normalizedFilterQuery) {
      return matches;
    }

    orbitalData.projects.forEach((project) => {
      if (project.name.toLowerCase().includes(normalizedFilterQuery)) {
        matches.add(getProjectEntityId(project.id));
      }
    });

    folders.forEach((folder) => {
      const path = folderPathMap.get(folder.id) ?? folder.name;
      const haystack = `${folder.name} ${path}`.toLowerCase();

      if (haystack.includes(normalizedFilterQuery)) {
        matches.add(`folder:${folder.id}`);
      }
    });

    orbitalData.noteById.forEach((note) => {
      const tagNames = note.tagIds
        .map((tagId) => tagMap.get(tagId)?.name ?? "")
        .join(" ");
      const folderPath = note.folderId ? folderPathMap.get(note.folderId) ?? "" : "";
      const assetNames = (assetNamesByNoteId.get(note.id) ?? []).join(" ");
      const haystack = [note.title, note.excerpt, note.plainText, tagNames, folderPath, assetNames]
        .join(" ")
        .toLowerCase();

      if (haystack.includes(normalizedFilterQuery)) {
        matches.add(`note:${note.id}`);
      }
    });

    return matches;
  }, [assetNamesByNoteId, folderPathMap, folders, normalizedFilterQuery, orbitalData.noteById, tagMap]);
  const tagFilteredEntityIds = useMemo(() => {
    const matches = new Set<string>();

    if (activeTagFilterSet.size === 0) {
      return matches;
    }

    orbitalData.noteById.forEach((note) => {
      if (note.tagIds.some((tagId) => activeTagFilterSet.has(tagId))) {
        matches.add(`note:${note.id}`);
      }
    });

    return matches;
  }, [activeTagFilterSet, orbitalData.noteById]);
  const colorFilteredEntityIds = useMemo(() => {
    const matches = new Set<string>();

    if (activeColorFilterSet.size === 0) {
      return matches;
    }

    if (currentProject && activeColorFilterSet.has(currentProject.color)) {
      matches.add(getProjectEntityId(currentProject.id));
    }

    currentProjectFolders.forEach((folder) => {
      if (activeColorFilterSet.has(folder.color)) {
        matches.add(`folder:${folder.id}`);
      }
    });

    currentProjectNotes.forEach((note) => {
      if (activeColorFilterSet.has(note.color || DEFAULT_NOTE_COLOR)) {
        matches.add(`note:${note.id}`);
      }
    });

    return matches;
  }, [activeColorFilterSet, currentProject, currentProjectFolders, currentProjectNotes]);
  const folderPrimaryFilteredEntityIds = useMemo(() => {
    const matches = new Set<string>();

    activeFolderFilterSet.forEach((folderId) => {
      if (orbitalData.folderById.has(folderId)) {
        matches.add(`folder:${folderId}`);
      }
    });

    return matches;
  }, [activeFolderFilterSet, orbitalData.folderById]);
  const folderDescendantFilteredEntityIds = useMemo(() => {
    const matches = new Set<string>();

    activeFolderFilterSet.forEach((folderId) => {
      if (!orbitalData.folderById.has(folderId)) {
        return;
      }

      collectFolderSubtreeEntityIds(folderId, orbitalData).forEach((entityId) => {
        if (entityId === `folder:${folderId}`) {
          return;
        }

        if (
          entityId.startsWith("folder:") &&
          activeFolderFilterSet.has(entityId.slice("folder:".length))
        ) {
          return;
        }

        matches.add(entityId);
      });
    });

    return matches;
  }, [activeFolderFilterSet, orbitalData]);
  const noteFilteredEntityIds = useMemo(() => {
    const matches = new Set<string>();

    activeNoteFilterSet.forEach((noteId) => {
      if (orbitalData.noteById.has(noteId)) {
        matches.add(`note:${noteId}`);
      }
    });

    return matches;
  }, [activeNoteFilterSet, orbitalData.noteById]);
  const assetFilteredEntityIds = useMemo(() => {
    const matches = new Set<string>();

    assets.forEach((asset) => {
      if (activeAssetFilterSet.has(asset.id) && orbitalData.noteById.has(asset.noteId)) {
        matches.add(`note:${asset.noteId}`);
      }
    });

    return matches;
  }, [activeAssetFilterSet, assets, orbitalData.noteById]);
  const hasActiveFilter =
    normalizedFilterQuery.length > 0 ||
    activeColorFilters.length > 0 ||
    activeTagFilters.length > 0 ||
    activeFolderFilters.length > 0 ||
    activeNoteFilters.length > 0 ||
    activeAssetFilters.length > 0;
  const filterPrimaryEntityIds = useMemo(() => {
    const matches = new Set<string>();

    searchMatchedEntityIds.forEach((entityId) => matches.add(entityId));
    colorFilteredEntityIds.forEach((entityId) => matches.add(entityId));
    tagFilteredEntityIds.forEach((entityId) => matches.add(entityId));
    folderPrimaryFilteredEntityIds.forEach((entityId) => matches.add(entityId));
    noteFilteredEntityIds.forEach((entityId) => matches.add(entityId));
    assetFilteredEntityIds.forEach((entityId) => matches.add(entityId));

    [
      ...searchMatchedEntityIds,
      ...colorFilteredEntityIds,
      ...tagFilteredEntityIds,
      ...noteFilteredEntityIds,
      ...assetFilteredEntityIds
    ].forEach((entityId) => {
      const projectId = getEntityProjectId(entityId, orbitalData);
      if (projectId) {
        matches.add(getProjectEntityId(projectId));
      }
    });

    return matches;
  }, [
    assetFilteredEntityIds,
    colorFilteredEntityIds,
    folderDescendantFilteredEntityIds,
    folderPrimaryFilteredEntityIds,
    noteFilteredEntityIds,
    orbitalData,
    searchMatchedEntityIds,
    tagFilteredEntityIds
  ]);
  const filterSecondaryEntityIds = useMemo(() => {
    const matches = new Set<string>();

    folderDescendantFilteredEntityIds.forEach((entityId) => {
      if (!filterPrimaryEntityIds.has(entityId)) {
        matches.add(entityId);
      }
    });

    return matches;
  }, [filterPrimaryEntityIds, folderDescendantFilteredEntityIds]);
  const sceneVisibleEntityIds = useMemo(() => {
    if (!isSceneBudgetConstrained) {
      return null;
    }

    return buildAdaptiveVisibilitySet({
      data: orbitalData,
      budget: ORBITAL_SCENE_BODY_BUDGET,
      currentProjectId,
      priorityProjectId: isPriorityFocusMode
        ? selectedEntityId
          ? getEntityProjectId(selectedEntityId, orbitalData)
          : currentProjectId
        : null,
      selectedEntityId,
      filterPrimaryEntityIds,
      filterSecondaryEntityIds
    });
  }, [
    currentProjectId,
    filterPrimaryEntityIds,
    filterSecondaryEntityIds,
    isPriorityFocusMode,
    isSceneBudgetConstrained,
    orbitalData,
    selectedEntityId
  ]);
  const sceneLayout = useMemo(
    () => buildOrbitalLayout(orbitalData, sceneVisibleEntityIds),
    [orbitalData, sceneVisibleEntityIds]
  );
  const scene = useMemo(
    () => materializeOrbitalScene(sceneLayout, timeMs),
    [sceneLayout, timeMs]
  );
  const selectedNode = selectedEntityId ? scene.entityMap.get(selectedEntityId) ?? null : null;
  const inspectorProjectId =
    selectedNode?.kind === "core"
      ? selectedNode.project?.id ?? currentProjectId
      : currentProjectId;
  const inspectorProjectFolders = useMemo(
    () => (inspectorProjectId ? folders.filter((folder) => folder.projectId === inspectorProjectId) : []),
    [folders, inspectorProjectId]
  );
  const inspectorProjectNotes = useMemo(
    () => (inspectorProjectId ? visibleNotes.filter((note) => note.projectId === inspectorProjectId) : []),
    [inspectorProjectId, visibleNotes]
  );
  const inspectorProjectAssets = useMemo(
    () =>
      inspectorProjectId
        ? assets.filter((asset) => orbitalData.noteById.get(asset.noteId)?.projectId === inspectorProjectId)
        : [],
    [assets, inspectorProjectId, orbitalData.noteById]
  );
  const inspectorProjectSubfolderCount = useMemo(
    () => inspectorProjectFolders.filter((folder) => folder.parentId !== null).length,
    [inspectorProjectFolders]
  );
  const inspectorProjectNoteCount = useMemo(
    () => inspectorProjectNotes.filter((note) => note.contentType !== "canvas").length,
    [inspectorProjectNotes]
  );
  const inspectorProjectCanvasCount = useMemo(
    () => inspectorProjectNotes.filter((note) => note.contentType === "canvas").length,
    [inspectorProjectNotes]
  );
  const inspectorProjectBodyCount = inspectorProjectFolders.length + inspectorProjectNotes.length;
  const shouldShowHierarchyInspector =
    selectedNode?.kind === "folder" || selectedNode?.kind === "note";
  const effectiveInspectorMenu = shouldShowHierarchyInspector ? "folders" : inspectorMenu;
  const selectedHierarchyExpandedFolderSet = useMemo(() => {
    const expandedFolders = new Set<string>();

    if (!selectedNode || selectedNode.kind === "core") {
      return expandedFolders;
    }

    let currentFolderId =
      selectedNode.kind === "folder"
        ? selectedNode.folder?.id ?? null
        : selectedNode.note?.folderId ?? null;

    while (currentFolderId) {
      expandedFolders.add(currentFolderId);
      currentFolderId = orbitalData.folderById.get(currentFolderId)?.parentId ?? null;
    }

    return expandedFolders;
  }, [orbitalData.folderById, selectedNode]);
  const registerInspectorHierarchyItemRef = (entityId: string, node: HTMLElement | null) => {
    if (node) {
      inspectorHierarchyItemRefs.current.set(entityId, node);
      return;
    }

    inspectorHierarchyItemRefs.current.delete(entityId);
  };
  const currentProjectNode = currentProjectEntityId
    ? scene.entityMap.get(currentProjectEntityId)
    : undefined;
  const hoverPreviewNote = hoveredSelectionNoteId
    ? orbitalData.noteById.get(hoveredSelectionNoteId) ?? null
    : null;
  const clearHoverPreviewCloseTimeout = () => {
    if (hoverPreviewCloseTimeoutRef.current !== null) {
      window.clearTimeout(hoverPreviewCloseTimeoutRef.current);
      hoverPreviewCloseTimeoutRef.current = null;
    }
  };

  const closeSelectionHoverPreview = () => {
    clearHoverPreviewCloseTimeout();
    setHoveredSelectionNoteId(null);
    setHoverPreviewAnchorSource(null);
    setHoverPreviewFallbackRect(null);
    hoverPreviewSceneAnchorRef.current = null;
  };

  const scheduleSelectionHoverPreviewClose = () => {
    clearHoverPreviewCloseTimeout();
    hoverPreviewCloseTimeoutRef.current = window.setTimeout(() => {
      setHoveredSelectionNoteId(null);
      hoverPreviewCloseTimeoutRef.current = null;
    }, 180);
  };

  const openSelectionHoverPreview = (
    noteId: string,
    clientX: number,
    clientY: number,
    source: HoverPreviewAnchorSource,
    options?: {
      anchorRect?: HoverPreviewAnchorRect | null;
      sceneAnchorElement?: SVGGElement | null;
    }
  ) => {
    clearHoverPreviewCloseTimeout();
    markOrbitInteraction();
    setHoveredSelectionNoteId(noteId);
    setHoverPreviewAnchorSource(source);
    setHoverPreviewFallbackRect(options?.anchorRect ?? null);
    hoverPreviewSceneAnchorRef.current = options?.sceneAnchorElement ?? null;
    setHoverPreviewCursor({ x: clientX, y: clientY });
  };

  const updateSelectionHoverPreviewCursor = (
    clientX: number,
    clientY: number,
    options?: {
      anchorRect?: HoverPreviewAnchorRect | null;
      sceneAnchorElement?: SVGGElement | null;
    }
  ) => {
    markOrbitInteraction();

    if (typeof options?.anchorRect !== "undefined") {
      setHoverPreviewFallbackRect(options.anchorRect);
    }

    if (typeof options?.sceneAnchorElement !== "undefined") {
      hoverPreviewSceneAnchorRef.current = options.sceneAnchorElement ?? null;
    }

    setHoverPreviewCursor({ x: clientX, y: clientY });
  };

  const markOrbitInteraction = () => {
    if (!orbitInteractionActiveRef.current) {
      orbitInteractionActiveRef.current = true;
      setIsOrbitInteractionActive(true);
    }

    if (orbitInteractionTimeoutRef.current !== null) {
      window.clearTimeout(orbitInteractionTimeoutRef.current);
    }

    orbitInteractionTimeoutRef.current = window.setTimeout(() => {
      orbitInteractionActiveRef.current = false;
      setIsOrbitInteractionActive(false);
      orbitInteractionTimeoutRef.current = null;
    }, ORBIT_INTERACTION_WINDOW_MS);
  };

  useEffect(() => {
    if (editorOpen || (hoveredSelectionNoteId && !hoverPreviewNote)) {
      closeSelectionHoverPreview();
    }
  }, [editorOpen, hoverPreviewNote, hoveredSelectionNoteId]);

  useEffect(() => {
    if (!editorOpen || editorMode !== "canvas") {
      setIsCanvasEditorFullscreen(false);
    }
  }, [editorMode, editorOpen]);

  useEffect(() => {
    if (
      hoverPreviewAnchorSource === "inspector" &&
      effectiveInspectorMenu !== "notes" &&
      effectiveInspectorMenu !== "folders" &&
      effectiveInspectorMenu !== "pinned"
    ) {
      closeSelectionHoverPreview();
    }
  }, [effectiveInspectorMenu, hoverPreviewAnchorSource]);

  useEffect(() => {
    if (hoveredSelectionNoteId && noteHoverPreviewScrollRef.current) {
      noteHoverPreviewScrollRef.current.scrollTop = 0;
    }
  }, [hoveredSelectionNoteId]);

  useEffect(() => {
    const targetEntityId = hierarchyFocusedEntityId ?? selectedEntityId;

    if (effectiveInspectorMenu !== "folders" || !targetEntityId) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const container = inspectorMenuListRef.current;
      const target = inspectorHierarchyItemRefs.current.get(targetEntityId);

      if (!container || !target) {
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const isVisible =
        targetRect.top >= containerRect.top + 8 &&
        targetRect.bottom <= containerRect.bottom - 8;

      if (!isVisible) {
        target.scrollIntoView({
          block: "nearest",
          inline: "nearest",
          behavior: "smooth"
        });
      }
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [
    effectiveInspectorMenu,
    hierarchyFocusedEntityId,
    normalizedInspectorQuery,
    selectedEntityId,
    selectedHierarchyExpandedFolderSet
  ]);

  useEffect(() => {
    return () => {
      clearHoverPreviewCloseTimeout();
      clearInspectorLongPress();
    };
  }, []);

  useEffect(() => {
    setCollapsedInspectorFolders((current) =>
      current.filter((folderId) => orbitalData.folderById.has(folderId))
    );
  }, [orbitalData.folderById]);

  useEffect(() => {
    if (editingProjectId && !orbitalData.projectById.has(editingProjectId)) {
      setEditingProjectId(null);
      setProjectNameDraft("");
    }
  }, [editingProjectId, orbitalData.projectById]);

  useEffect(() => {
    if (!inspectorRenameState) {
      return;
    }

    const exists =
      inspectorRenameState.kind === "folder"
        ? orbitalData.folderById.has(inspectorRenameState.id)
        : orbitalData.noteById.has(inspectorRenameState.id);

    if (!exists) {
      cancelInspectorRename();
    }
  }, [inspectorRenameState, orbitalData.folderById, orbitalData.noteById]);

  useEffect(() => {
    if (!contextMenuState) {
      return;
    }

    const exists =
      contextMenuState.target.kind === "folder"
        ? orbitalData.folderById.has(contextMenuState.target.folder.id)
        : orbitalData.noteById.has(contextMenuState.target.note.id);

    if (!exists) {
      closeInspectorContextMenu();
    }
  }, [contextMenuState, orbitalData.folderById, orbitalData.noteById]);

  useEffect(() => {
    closeInspectorContextMenu();
  }, [inspectorMenu]);

  useEffect(() => {
    if (editorOpen || activeModal) {
      closeInspectorContextMenu();
    }
  }, [activeModal, editorOpen]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsDocumentVisible(document.visibilityState !== "hidden");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    markOrbitInteraction();

    return () => {
      if (orbitInteractionTimeoutRef.current !== null) {
        window.clearTimeout(orbitInteractionTimeoutRef.current);
      }
    };
  }, []);

  const anchorNode = selectedNode || currentProjectNode || scene.nodes.find((node) => node.kind === "core");
  const visibleBodies = Math.max(scene.nodes.filter((node) => node.kind !== "core").length, 0);
  const hiddenBodies = Math.max(orbitalData.totalEntities - scene.nodes.length, 0);
  const passivePinnedHighlightEntityIds = useMemo(() => {
    if (selectedEntityId || hasActiveFilter) {
      return new Set<string>();
    }

    const related = new Set<string>();

    orbitalData.noteById.forEach((note) => {
      if (isEntryFavorite(note)) {
        related.add(`note:${note.id}`);
      }
    });

    return related;
  }, [hasActiveFilter, orbitalData.noteById, selectedEntityId]);
  const topFolders = useMemo(
    () => (currentProjectId ? (orbitalData.rootFoldersByProject.get(currentProjectId) ?? []).slice(0, 5).map((branch) => branch.folder) : []),
    [currentProjectId, orbitalData.rootFoldersByProject]
  );
  const topTags = useMemo(
    () =>
      [...currentProjectTagCounts.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 5)
        .map(([tagId]) => tagMap.get(tagId))
        .filter((tag): tag is Tag => Boolean(tag)),
    [currentProjectTagCounts, tagMap]
  );
  const pinnedCount = useMemo(
    () => currentProjectNotes.filter((note) => isEntryFavorite(note)).length,
    [currentProjectNotes]
  );
  const stars = useMemo(
    () =>
      Array.from({ length: 56 }, (_, index) => {
        const seed = hashString(`star-${index}`);
        return {
          id: `star-${index}`,
          x: (seed % VIEWBOX.width) + VIEWBOX.minX,
          y: ((seed * 13) % VIEWBOX.height) + VIEWBOX.minY,
          r: 0.8 + ((seed % 10) / 10) * 2.2,
          opacity: 0.12 + ((seed % 100) / 100) * 0.62
        };
      }),
    []
  );
  const autoFocusEnabled = isSceneBudgetConstrained && !isPriorityFocusMode;
  const isSceneFocusActive = isSceneBudgetConstrained && isPriorityFocusMode;
  const isDenseOrbitalScene = orbitalData.totalEntities > 80;
  const orbitFrameInterval = isOrbitInteractionActive
    ? isDenseOrbitalScene
      ? ORBIT_ACTIVE_FRAME_MS_LARGE
      : ORBIT_ACTIVE_FRAME_MS
    : isDenseOrbitalScene
      ? ORBIT_IDLE_FRAME_MS_LARGE
      : ORBIT_IDLE_FRAME_MS;
  const isOrbitAnimationSuspended =
    isPaused || editorOpen || activeModal !== null || !isDocumentVisible;
  const focusSystemLabel =
    !anchorNode
      ? labels.core
      : anchorNode.kind === "core" && anchorNode.project
        ? anchorNode.project.name
      : anchorNode.kind === "folder" && anchorNode.folder
        ? folderPathMap.get(anchorNode.folder.id) ?? anchorNode.folder.name
        : anchorNode.kind === "note" && anchorNode.note?.folderId
          ? folderPathMap.get(anchorNode.note.folderId) ?? labels.uncategorized
          : currentProject?.name ?? labels.core;

  useEffect(() => {
    timeRef.current = timeMs;
  }, [timeMs]);

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  useEffect(() => {
    projectPositionDraftsRef.current = projectPositionDrafts;
  }, [projectPositionDrafts]);

  useEffect(() => {
    if (!orbitalData.projects.length) {
      if (activeProjectId !== null) {
        setActiveProjectId(null);
      }
      return;
    }

    if (!activeProjectId || !orbitalData.projectById.has(activeProjectId)) {
      setActiveProjectId(orbitalData.projects[0]?.id ?? null);
    }
  }, [activeProjectId, orbitalData.projectById, orbitalData.projects]);

  useEffect(() => {
    const selectedProjectId = getEntityProjectId(selectedEntityId, orbitalData);

    if (selectedProjectId && selectedProjectId !== activeProjectId) {
      setActiveProjectId(selectedProjectId);
    }
  }, [activeProjectId, orbitalData, selectedEntityId]);

  useEffect(() => {
    if (!currentProjectEntityId) {
      setHierarchyFocusedEntityId(null);
      return;
    }

    if (!hierarchyFocusedEntityId) {
      setHierarchyFocusedEntityId(currentProjectEntityId);
      return;
    }

    const focusedProjectId = getEntityProjectId(hierarchyFocusedEntityId, orbitalData);

    if (!focusedProjectId || focusedProjectId !== currentProjectId) {
      setHierarchyFocusedEntityId(currentProjectEntityId);
    }
  }, [
    currentProjectEntityId,
    currentProjectId,
    hierarchyFocusedEntityId,
    orbitalData
  ]);

  useEffect(() => {
    if (!selectedEntityId || effectiveInspectorMenu !== "folders") {
      return;
    }

    const selectedProjectId = getEntityProjectId(selectedEntityId, orbitalData);

    if (selectedProjectId && selectedProjectId === currentProjectId) {
      setHierarchyFocusedEntityId(selectedEntityId);
    }
  }, [currentProjectId, effectiveInspectorMenu, orbitalData, selectedEntityId]);

  useEffect(() => {
    if (!isFolderDraftOpen) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      folderDraftRowRef.current?.scrollIntoView({
        block: "nearest",
        behavior: "smooth"
      });
      folderDraftInputRef.current?.focus();
      folderDraftInputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isFolderDraftOpen]);

  useEffect(() => {
    setProjectPositionDrafts((current) => {
      let changed = false;
      const next = { ...current };

      Object.entries(current).forEach(([projectId, draft]) => {
        const project = projects.find((entry) => entry.id === projectId);

        if (!project) {
          delete next[projectId];
          changed = true;
          return;
        }

        if (project.x === draft.x && project.y === draft.y) {
          delete next[projectId];
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [projects]);

  useEffect(() => {
    let frameId = 0;
    let timeoutId = 0;

    if (isOrbitAnimationSuspended) {
      return undefined;
    }

    const startedAt = performance.now() - timeRef.current;

    const tick = (now: number) => {
      setTimeMs(now - startedAt);
      timeoutId = window.setTimeout(() => {
        frameId = window.requestAnimationFrame(tick);
      }, orbitFrameInterval);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [isOrbitAnimationSuspended, orbitFrameInterval]);

  useEffect(
    () => () => {
      if (cameraAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(cameraAnimationFrameRef.current);
      }

      if (orbitInteractionTimeoutRef.current !== null) {
        window.clearTimeout(orbitInteractionTimeoutRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!selectedEntityId || sceneLayout.entityMap.has(selectedEntityId)) {
      return;
    }

    setSelectedEntityId(null);
  }, [sceneLayout.entityMap, selectedEntityId]);

  useEffect(() => {
    setFolderDraftError(null);
  }, [selectedEntityId, inspectorMenu]);

  useEffect(() => {
    setActiveColorFilters((current) =>
      current.filter((color) => colorCounts.has(color))
    );
  }, [colorCounts]);

  const stopCameraAnimation = () => {
    if (cameraAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(cameraAnimationFrameRef.current);
      cameraAnimationFrameRef.current = null;
    }
  };

  const animateCameraTo = (
    target: Partial<{ x: number; y: number; scale: number }>,
    duration = 620
  ) => {
    const from = cameraRef.current;
    const to = {
      x: target.x ?? from.x,
      y: target.y ?? from.y,
      scale: target.scale ?? from.scale
    };

    if (
      Math.abs(from.x - to.x) < 0.1 &&
      Math.abs(from.y - to.y) < 0.1 &&
      Math.abs(from.scale - to.scale) < 0.001
    ) {
      return;
    }

    stopCameraAnimation();
    const startedAt = performance.now();
    const easeOutCubic = (value: number) => 1 - Math.pow(1 - value, 3);

    const step = (frameTime: number) => {
      const progress = clamp((frameTime - startedAt) / duration, 0, 1);
      const eased = easeOutCubic(progress);
      const next = {
        x: from.x + (to.x - from.x) * eased,
        y: from.y + (to.y - from.y) * eased,
        scale: from.scale + (to.scale - from.scale) * eased
      };

      cameraRef.current = next;
      setCamera(next);

      if (progress < 1) {
        cameraAnimationFrameRef.current = window.requestAnimationFrame(step);
      } else {
        cameraAnimationFrameRef.current = null;
      }
    };

    cameraAnimationFrameRef.current = window.requestAnimationFrame(step);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      markOrbitInteraction();

      if (event.key === " " && !isEditableTarget(event.target)) {
        event.preventDefault();
        setIsPaused((current) => !current);
        return;
      }

      if (
        event.key.toLowerCase() === "f" &&
        editorOpen &&
        editorMode === "canvas" &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        void toggleCanvasEditorFullscreen();
        return;
      }

      if (event.key === "Escape") {
        if (activeModal) {
          setActiveModal(null);
        } else if (editorOpen && editorMode === "canvas" && isCanvasEditorFullscreen) {
          void toggleCanvasEditorFullscreen();
        } else if (editorOpen) {
          onCloseEditor();
        } else if (selectedEntityId) {
          setSelectedEntityId(null);
        } else {
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    activeModal,
    editorMode,
    editorOpen,
    isCanvasEditorFullscreen,
    onClose,
    onCloseEditor,
    selectedEntityId
  ]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }

    const handleFullscreenChange = () => {
      setIsCanvasEditorFullscreen(document.fullscreenElement === editorModalRef.current);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined" || editorOpen) {
      return;
    }

    if (document.fullscreenElement === editorModalRef.current) {
      void document.exitFullscreen();
    }

    setIsCanvasEditorFullscreen(false);
  }, [editorOpen]);

  const handleCenterSelection = () => {
    if (orbitalData.projects.length === 0) {
      return;
    }

    const center = orbitalData.projects.reduce(
      (result, project) => ({
        x: result.x + project.x,
        y: result.y + project.y
      }),
      { x: 0, y: 0 }
    );
    const divisor = orbitalData.projects.length;

    animateCameraTo({
      x: -(center.x / divisor),
      y: -(center.y / divisor)
    });
  };

  const handleResetCamera = () => {
    animateCameraTo({
      x: 0,
      y: 0,
      scale: 1
    });
  };

  const centerOnProject = (projectId: string, duration = 620) => {
    const project = orbitalData.projectById.get(projectId);

    if (!project) {
      return;
    }

    animateCameraTo({
      x: -project.x,
      y: -project.y
    }, duration);
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    markOrbitInteraction();

    if ((event.target as HTMLElement).closest("[data-orbital-node='true']")) {
      return;
    }

    stopCameraAnimation();
    setSelectedEntityId(null);
    dragRef.current = {
      mode: "camera",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: camera.x,
      originY: camera.y
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    markOrbitInteraction();

    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) {
      return;
    }

    if (dragRef.current.mode === "camera") {
      const deltaX = (event.clientX - dragRef.current.startX) / camera.scale;
      const deltaY = (event.clientY - dragRef.current.startY) / camera.scale;

      setCamera((current) => ({
        ...current,
        x: dragRef.current?.mode === "camera" ? dragRef.current.originX + deltaX : current.x,
        y: dragRef.current?.mode === "camera" ? dragRef.current.originY + deltaY : current.y
      }));
      return;
    }

    const projectDrag = dragRef.current;

    if (!projectDrag || projectDrag.mode !== "project") {
      return;
    }

    const deltaX = (event.clientX - projectDrag.startX) / camera.scale;
    const deltaY = (event.clientY - projectDrag.startY) / camera.scale;
    const pointerDistance = Math.hypot(event.clientX - projectDrag.startX, event.clientY - projectDrag.startY);

    if (!projectDrag.hasMoved && pointerDistance < PROJECT_DRAG_THRESHOLD_PX) {
      return;
    }

    projectDrag.hasMoved = true;

    setProjectPositionDrafts((current) => {
      const next = {
        ...current,
        [projectDrag.projectId]: {
          x: projectDrag.originProjectX + deltaX,
          y: projectDrag.originProjectY + deltaY
        }
      };
      projectPositionDraftsRef.current = next;
      return next;
    });
  };

  const releaseDrag = (pointerId: number) => {
    if (dragRef.current?.pointerId !== pointerId) {
      return;
    }

    if (dragRef.current.mode === "project") {
      if (!dragRef.current.hasMoved) {
        dragRef.current = null;
        return;
      }

      const projectId = dragRef.current.projectId;
      const draft = projectPositionDraftsRef.current[projectId];
      const persisted = orbitalData.projectById.get(projectId);
      const nextPosition = draft ?? (persisted ? { x: persisted.x, y: persisted.y } : null);

      if (nextPosition) {
        onUpdateProjectPosition(projectId, nextPosition.x, nextPosition.y);
      }
    }

    dragRef.current = null;
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    markOrbitInteraction();

    if (
      hoverPreviewAnchorSource === "scene" &&
      hoveredSelectionNoteId &&
      noteHoverPreviewScrollRef.current
    ) {
      event.preventDefault();
      event.stopPropagation();
      noteHoverPreviewScrollRef.current.scrollTop += event.deltaY;
      return;
    }

    event.preventDefault();
    stopCameraAnimation();
    const multiplier = event.deltaY > 0 ? 0.92 : 1.08;

    setCamera((current) => ({
      ...current,
      scale: clamp(current.scale * multiplier, CAMERA_MIN_SCALE, CAMERA_MAX_SCALE)
    }));
  };

  const handleCreateFolder = async () => {
    const name = folderDraft.trim();

    if (!folderDraftProjectId) {
      return;
    }

    if (!name) {
      resetFolderDraft();
      return;
    }

    try {
      const createdFolder = await onCreateFolder(
        name,
        folderDraftParentId,
        folderDraftColor,
        folderDraftProjectId
      );
      resetFolderDraft();
      setFolderDraftError(null);
      setSelectedEntityId(`folder:${createdFolder.id}`);
      setHierarchyFocusedEntityId(`folder:${createdFolder.id}`);
    } catch (error) {
      if (error instanceof Error && error.message === "FOLDER_DEPTH_LIMIT") {
        setFolderDraftError(labels.maxDepthReached);
        return;
      }

      throw error;
    }
  };

  const handleCreateNote = async (folderId: string | null, projectId?: string) => {
    resetFolderDraft();
    const createdNote = await onCreateNote(folderId, projectId);
    setSelectedEntityId(`note:${createdNote.id}`);
    setActiveProjectId(createdNote.projectId);
    onOpenNote(createdNote.id);
  };

  const handleCreateCanvas = async (folderId: string | null, projectId?: string) => {
    resetFolderDraft();
    const createdCanvas = await onCreateCanvas(folderId, projectId);
    setSelectedEntityId(`note:${createdCanvas.id}`);
    setActiveProjectId(createdCanvas.projectId);
    onOpenNote(createdCanvas.id);
  };

  const handleCreateProject = async () => {
    const position = findOpenProjectPosition(projectsWithDraftPositions);
    const project = await onCreateProject(position.x, position.y);
    setActiveProjectId(project.id);
    setSelectedEntityId(null);
    setInspectorMenu("overview");
    animateCameraTo({
      x: -position.x,
      y: -position.y
    }, 760);
  };

  const toggleTagFilter = (tagId: string) => {
    setActiveTagFilters((current) =>
      current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId]
    );
  };

  const toggleColorFilter = (color: string) => {
    setActiveColorFilters((current) =>
      current.includes(color) ? current.filter((value) => value !== color) : [...current, color]
    );
  };

  const toggleFolderFilter = (folderId: string) => {
    setActiveFolderFilters((current) =>
      current.includes(folderId) ? current.filter((id) => id !== folderId) : [...current, folderId]
    );
  };

  const toggleNoteFilter = (noteId: string) => {
    setActiveNoteFilters((current) =>
      current.includes(noteId) ? current.filter((id) => id !== noteId) : [...current, noteId]
    );
  };

  const toggleAssetFilter = (assetId: string) => {
    setActiveAssetFilters((current) =>
      current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId]
    );
  };

  const beginProjectRename = (project: Project) => {
    setEditingProjectId(project.id);
    setProjectNameDraft(project.name);
  };

  const cancelProjectRename = () => {
    setEditingProjectId(null);
    setProjectNameDraft("");
  };

  const submitProjectRename = async () => {
    if (!editingProjectId) {
      return;
    }

    const project = orbitalData.projectById.get(editingProjectId);

    if (!project) {
      cancelProjectRename();
      return;
    }

    const normalizedName = projectNameDraft.trim();

    if (!normalizedName) {
      setProjectNameDraft(project.name);
      cancelProjectRename();
      return;
    }

    if (normalizedName === project.name) {
      cancelProjectRename();
      return;
    }

    await onRenameProject(editingProjectId, normalizedName);
    cancelProjectRename();
  };

  const clearInspectorLongPress = () => {
    if (inspectorLongPressRef.current) {
      window.clearTimeout(inspectorLongPressRef.current.timeoutId);
      inspectorLongPressRef.current = null;
    }
  };

  const closeInspectorContextMenu = () => {
    setContextMenuState(null);
  };

  const consumeSuppressedInspectorClick = () => {
    if (!suppressInspectorClickRef.current) {
      return false;
    }

    suppressInspectorClickRef.current = false;
    return true;
  };

  const applySingleInspectorTargetSelection = (target: InspectorContextMenuTarget) => {
    if (target.kind === "folder") {
      setActiveFolderFilters([target.folder.id]);
      setActiveNoteFilters([]);
      return;
    }

    setActiveNoteFilters([target.note.id]);
    setActiveFolderFilters([]);
  };

  const openInspectorContextMenu = (
    target: InspectorContextMenuTarget,
    presentation: "popover" | "sheet",
    position?: { x: number; y: number } | null,
    options?: {
      selectTarget?: boolean;
    }
  ) => {
    clearInspectorLongPress();
    closeSelectionHoverPreview();

    if (options?.selectTarget !== false) {
      applySingleInspectorTargetSelection(target);
    }

    setContextMenuState({
      target,
      presentation,
      position
    });
  };

  const handleInspectorContextPointerDown = (
    target: InspectorContextMenuTarget,
    event: ReactPointerEvent<HTMLElement>
  ) => {
    if (event.pointerType !== "touch") {
      return;
    }

    clearInspectorLongPress();
    inspectorLongPressRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      timeoutId: window.setTimeout(() => {
        suppressInspectorClickRef.current = true;
        inspectorLongPressRef.current = null;
        openInspectorContextMenu(target, "sheet", null);
      }, INSPECTOR_LONG_PRESS_MS)
    };
  };

  const handleInspectorContextPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const activeLongPress = inspectorLongPressRef.current;

    if (!activeLongPress || activeLongPress.pointerId !== event.pointerId) {
      return;
    }

    if (
      Math.abs(event.clientX - activeLongPress.startX) > INSPECTOR_LONG_PRESS_MOVE_TOLERANCE ||
      Math.abs(event.clientY - activeLongPress.startY) > INSPECTOR_LONG_PRESS_MOVE_TOLERANCE
    ) {
      clearInspectorLongPress();
    }
  };

  const handleInspectorContextPointerEnd = (pointerId: number) => {
    if (inspectorLongPressRef.current?.pointerId === pointerId) {
      clearInspectorLongPress();
    }
  };

  const beginInspectorRename = (target: InspectorContextMenuTarget) => {
    closeInspectorContextMenu();
    setInspectorRenameState({
      kind: target.kind,
      id: target.kind === "folder" ? target.folder.id : target.note.id
    });
    setInspectorRenameDraft(target.label);
  };

  const cancelInspectorRename = () => {
    setInspectorRenameState(null);
    setInspectorRenameDraft("");
  };

  const submitInspectorRename = async () => {
    if (!inspectorRenameState) {
      return;
    }

    const normalizedName = inspectorRenameDraft.trim();

    if (!normalizedName) {
      cancelInspectorRename();
      return;
    }

    if (inspectorRenameState.kind === "folder") {
      const folder = orbitalData.folderById.get(inspectorRenameState.id);

      if (!folder || normalizedName === folder.name) {
        cancelInspectorRename();
        return;
      }

      await onRenameFolder(folder.id, normalizedName);
      cancelInspectorRename();
      return;
    }

    const note = orbitalData.noteById.get(inspectorRenameState.id);

    if (!note || normalizedName === (note.title.trim() || getNoteInspectorTitle(note))) {
      cancelInspectorRename();
      return;
    }

    await onRenameNote(note.id, normalizedName);
    cancelInspectorRename();
  };

  const toggleInspectorFolderCollapse = (folderId: string) => {
    setCollapsedInspectorFolders((current) =>
      current.includes(folderId)
        ? current.filter((id) => id !== folderId)
        : [...current, folderId]
    );
  };

  const handleInspectorHierarchySelection = (
    item: InspectorHierarchyItem,
    event: ReactMouseEvent<HTMLElement>
  ) => {
    const isAdditiveSelection = event.metaKey || event.ctrlKey;
    setHierarchyFocusedEntityId(item.entityId);

    if (item.kind === "core") {
      setActiveProjectId(item.project?.id ?? currentProjectId ?? null);
      setActiveFolderFilters([]);
      setActiveNoteFilters([]);
      closeSelectionHoverPreview();
      return;
    }

    if (item.kind === "folder") {
      if (isAdditiveSelection) {
        toggleFolderFilter(item.id);
      } else {
        setActiveFolderFilters([item.id]);
        setActiveNoteFilters([]);
      }

      return;
    }

    if (isAdditiveSelection) {
      toggleNoteFilter(item.id);
    } else {
      setActiveNoteFilters([item.id]);
      setActiveFolderFilters([]);
    }
  };

  const openInspectorMenu = (menu: InspectorMenu) => {
    if (menu !== "folders") {
      resetFolderDraft();
    }

    setInspectorMenu(menu);
    setInspectorQuery("");
  };

  const handleInspectorBack = () => {
    if (shouldShowHierarchyInspector) {
      setSelectedEntityId(null);
    }

    openInspectorMenu("overview");
  };

  const clearFilters = () => {
    setFilterQuery("");
    setActiveColorFilters([]);
    setActiveTagFilters([]);
    setActiveFolderFilters([]);
    setActiveNoteFilters([]);
    setActiveAssetFilters([]);
  };

  const resetFolderDraft = () => {
    setFolderDraft("");
    setFolderDraftError(null);
    setFolderDraftColor(DEFAULT_FOLDER_COLOR);
    setIsFolderDraftOpen(false);
    setFolderDraftParentId(null);
    setFolderDraftProjectId(null);
  };

  const beginFolderDraft = (parentId: string | null, projectId?: string) => {
    if (parentId) {
      const parentMeta = orbitalData.folderMeta.get(parentId);

      if ((parentMeta?.depth ?? 0) >= 1) {
        setFolderDraftError(labels.maxDepthReached);
        setIsFolderDraftOpen(false);
        setFolderDraftParentId(null);
        setFolderDraftProjectId(null);
        return;
      }

      setCollapsedInspectorFolders((current) => current.filter((entry) => entry !== parentId));
    }

    setInspectorMenu("folders");
    setInspectorQuery("");
    setIsFolderDraftOpen(true);
    setFolderDraftParentId(parentId);
    setFolderDraftProjectId(
      parentId ? orbitalData.folderById.get(parentId)?.projectId ?? null : projectId ?? currentProjectId
    );
    setFolderDraft("");
    setFolderDraftColor(
      parentId ? orbitalData.folderById.get(parentId)?.color ?? DEFAULT_FOLDER_COLOR : DEFAULT_FOLDER_COLOR
    );
    setFolderDraftError(null);
    setHierarchyFocusedEntityId(
      parentId
        ? `folder:${parentId}`
        : projectId
          ? getProjectEntityId(projectId)
          : currentProjectEntityId
    );
  };

  const selectedFolderMeta =
    selectedNode?.folder ? orbitalData.folderMeta.get(selectedNode.folder.id) ?? null : null;
  const selectedNoteFolder =
    selectedNode?.kind === "note" && selectedNode.note?.folderId
      ? folderPathMap.get(selectedNode.note.folderId) ?? labels.uncategorized
      : labels.uncategorized;
  const selectedFolderLocation =
    selectedNode?.kind === "folder" && selectedNode.folder
      ? selectedNode.folder.parentId
        ? folderPathMap.get(selectedNode.folder.parentId) ?? focusSystemLabel
        : focusSystemLabel
      : focusSystemLabel;
  const selectedNoteTagNames =
    selectedNode?.kind === "note" && selectedNode.note
      ? selectedNode.note.tagIds
          .map((tagId) => tagMap.get(tagId)?.name ?? "")
          .filter((value) => value.length > 0)
      : [];
  const selectedEntryIsCanvas =
    selectedNode?.kind === "note" && selectedNode.note?.contentType === "canvas";
  const selectedCanvasMetrics =
    selectedNode?.kind === "note" && selectedNode.note?.contentType === "canvas"
      ? getCanvasMetrics(selectedNode.note.canvasContent, { includePlainText: false })
      : null;
  const selectedNoteVisibleTags = selectedNoteTagNames.slice(0, 3);
  const selectedNoteHiddenTagCount = Math.max(0, selectedNoteTagNames.length - selectedNoteVisibleTags.length);
  const selectedNoteAssetCount =
    selectedNode?.kind === "note" && selectedNode.note
      ? (assetNamesByNoteId.get(selectedNode.note.id) ?? []).length
      : 0;
  const selectedInspectorAccent =
    selectedNode?.kind === "core"
      ? selectedNode.project?.color ?? DEFAULT_PROJECT_COLOR
      : selectedNode?.kind === "folder"
        ? selectedNode.folder?.color ?? DEFAULT_FOLDER_COLOR
        : selectedNode?.note?.color ?? DEFAULT_NOTE_COLOR;
  const hoverPreviewAccent = hoverPreviewNote?.color ?? DEFAULT_NOTE_COLOR;
  const hoverPreviewFolder = hoverPreviewNote?.folderId
    ? folderPathMap.get(hoverPreviewNote.folderId) ?? labels.uncategorized
    : labels.uncategorized;
  const liveHoverPreviewAnchorRect =
    hoverPreviewAnchorSource === "scene" && hoverPreviewSceneAnchorRef.current
      ? toHoverPreviewAnchorRect(hoverPreviewSceneAnchorRef.current.getBoundingClientRect())
      : hoverPreviewFallbackRect;
  const hoverPreviewPosition = useMemo(() => {
    if (!hoveredSelectionNoteId) {
      return null;
    }

    const viewportWidth = typeof window === "undefined" ? 1440 : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight;
    const cardWidth = Math.max(280, Math.min(400, viewportWidth - 32));
    const cardHeight = Math.max(240, Math.min(420, viewportHeight - 32));
    const viewportPadding = 16;
    const gap = hoverPreviewAnchorSource === "scene" ? 22 : 18;
    const anchor =
      liveHoverPreviewAnchorRect ?? {
        left: hoverPreviewCursor.x,
        top: hoverPreviewCursor.y,
        right: hoverPreviewCursor.x,
        bottom: hoverPreviewCursor.y,
        width: 0,
        height: 0,
        centerX: hoverPreviewCursor.x,
        centerY: hoverPreviewCursor.y
      };
    const inspectorRect =
      hoverPreviewAnchorSource === "inspector" && inspectorPanelRef.current
        ? toHoverPreviewAnchorRect(inspectorPanelRef.current.getBoundingClientRect())
        : null;

    if (hoverPreviewAnchorSource === "inspector" && inspectorRect) {
      const rightRoom = viewportWidth - viewportPadding - (inspectorRect.right + gap);
      const leftRoom = inspectorRect.left - viewportPadding - gap;
      const anchoredTop = clamp(
        anchor.centerY - cardHeight * 0.22,
        viewportPadding,
        viewportHeight - cardHeight - viewportPadding
      );

      if (rightRoom >= Math.min(cardWidth, 240) || rightRoom >= leftRoom) {
        const width = Math.min(cardWidth, Math.max(220, rightRoom));

        return {
          left: clamp(inspectorRect.right + gap, viewportPadding, viewportWidth - width - viewportPadding),
          top: anchoredTop,
          width,
          height: cardHeight,
          placement: "right" as const
        };
      }

      if (leftRoom >= Math.min(cardWidth, 220)) {
        return {
          left: clamp(
            inspectorRect.left - gap - cardWidth,
            viewportPadding,
            viewportWidth - cardWidth - viewportPadding
          ),
          top: anchoredTop,
          width: cardWidth,
          height: cardHeight,
          placement: "left" as const
        };
      }
    }

    const available = {
      right: viewportWidth - viewportPadding - (anchor.right + gap),
      left: anchor.left - viewportPadding - gap,
      bottom: viewportHeight - viewportPadding - (anchor.bottom + gap),
      top: anchor.top - viewportPadding - gap
    };

    const candidates = {
      right: {
        side: "right" as const,
        room: available.right,
        fits: available.right >= cardWidth,
        left: anchor.right + gap,
        top: clamp(
          hoverPreviewCursor.y - cardHeight * 0.22,
          viewportPadding,
          viewportHeight - cardHeight - viewportPadding
        )
      },
      left: {
        side: "left" as const,
        room: available.left,
        fits: available.left >= cardWidth,
        left: anchor.left - gap - cardWidth,
        top: clamp(
          hoverPreviewCursor.y - cardHeight * 0.22,
          viewportPadding,
          viewportHeight - cardHeight - viewportPadding
        )
      },
      bottom: {
        side: "bottom" as const,
        room: available.bottom,
        fits: available.bottom >= cardHeight,
        left: clamp(
          hoverPreviewCursor.x - cardWidth * 0.18,
          viewportPadding,
          viewportWidth - cardWidth - viewportPadding
        ),
        top: anchor.bottom + gap
      },
      top: {
        side: "top" as const,
        room: available.top,
        fits: available.top >= cardHeight,
        left: clamp(
          hoverPreviewCursor.x - cardWidth * 0.18,
          viewportPadding,
          viewportWidth - cardWidth - viewportPadding
        ),
        top: anchor.top - gap - cardHeight
      }
    };

    const horizontalChoices = [candidates.right, candidates.left].filter((candidate) => candidate.fits);
    const verticalChoices = [candidates.bottom, candidates.top].filter((candidate) => candidate.fits);
    const chosen =
      horizontalChoices.sort((left, right) => right.room - left.room)[0] ??
      verticalChoices.sort((left, right) => right.room - left.room)[0] ??
      [candidates.right, candidates.left, candidates.bottom, candidates.top].sort(
        (left, right) => right.room - left.room
      )[0];

    return {
      left: clamp(chosen.left, viewportPadding, viewportWidth - cardWidth - viewportPadding),
      top: clamp(chosen.top, viewportPadding, viewportHeight - cardHeight - viewportPadding),
      width: cardWidth,
      height: cardHeight,
      placement: chosen.side
    };
  }, [
    hoverPreviewAnchorSource,
    hoverPreviewCursor.x,
    hoverPreviewCursor.y,
    hoveredSelectionNoteId,
    liveHoverPreviewAnchorRect,
    timeMs
  ]);
  const inspectorHierarchyTree = useMemo(() => {
    if (!currentProjectId) {
      return [];
    }

    const project = orbitalData.projectById.get(currentProjectId);

    if (!project) {
      return [];
    }

    const makeNoteItem = (note: Note): InspectorHierarchyItem => ({
      id: note.id,
      entityId: `note:${note.id}`,
      kind: note.contentType === "canvas" ? "canvas" : "note",
      label:
        note.title.trim() ||
        (note.contentType === "canvas" ? t("canvas.untitled") : t("note.untitled")),
      color: note.color || DEFAULT_NOTE_COLOR,
      note,
      searchText: [
        note.title,
        note.excerpt,
        note.plainText,
        note.folderId ? folderPathMap.get(note.folderId) ?? "" : labels.uncategorized
      ]
        .join(" ")
        .toLowerCase(),
      children: []
    });

    const makeFolderItem = (branch: FolderBranch): InspectorHierarchyItem => {
      const folderPath = folderPathMap.get(branch.folder.id) ?? branch.folder.name;

      return {
        id: branch.folder.id,
        entityId: `folder:${branch.folder.id}`,
        kind: "folder",
        label: branch.folder.name,
        color: branch.folder.color || DEFAULT_FOLDER_COLOR,
        folder: branch.folder,
        searchText: `${branch.folder.name} ${folderPath}`.toLowerCase(),
        children: [
          ...branch.children.map((childBranch) => makeFolderItem(childBranch)),
          ...branch.notes.map((note) => makeNoteItem(note))
        ]
      };
    };

    return [
      {
        id: project.id,
        entityId: getProjectEntityId(project.id),
        kind: "core" as const,
        label: project.name,
        color: project.color || DEFAULT_PROJECT_COLOR,
        project,
        searchText: `${project.name} ${labels.project} ${labels.core}`.toLowerCase(),
        children: [
          ...(orbitalData.rootFoldersByProject.get(currentProjectId) ?? []).map((branch) =>
            makeFolderItem(branch)
          ),
          ...(orbitalData.looseNotesByProject.get(currentProjectId) ?? []).map((note) =>
            makeNoteItem(note)
          )
        ]
      }
    ];
  }, [
    currentProjectId,
    folderPathMap,
    labels.core,
    labels.project,
    labels.uncategorized,
    orbitalData.looseNotesByProject,
    orbitalData.projectById,
    orbitalData.rootFoldersByProject,
    t
  ]);
  const filteredNotesMenu = useMemo(
    () =>
      currentProjectNotes.filter((note) =>
        [note.title, note.excerpt, note.plainText].join(" ").toLowerCase().includes(normalizedInspectorQuery)
      ),
    [currentProjectNotes, normalizedInspectorQuery]
  );
  const filteredPinnedMenu = useMemo(
    () => filteredNotesMenu.filter((note) => isEntryFavorite(note)),
    [filteredNotesMenu]
  );
  const filteredTagsMenu = useMemo(
    () =>
      [...tags]
        .sort((left, right) => left.name.localeCompare(right.name))
        .filter((tag) => currentProjectTagCounts.has(tag.id))
        .filter((tag) => tag.name.toLowerCase().includes(normalizedInspectorQuery)),
    [currentProjectTagCounts, normalizedInspectorQuery, tags]
  );
  const filteredFoldersMenu = useMemo(
    () => filterInspectorHierarchy(inspectorHierarchyTree, normalizedInspectorQuery),
    [inspectorHierarchyTree, normalizedInspectorQuery]
  );
  const filteredFilesMenu = useMemo(
    () =>
      currentProjectAssets.filter((asset) => {
        const note = orbitalData.noteById.get(asset.noteId);
        const haystack = `${asset.name} ${note?.title ?? ""}`.toLowerCase();
        return haystack.includes(normalizedInspectorQuery);
      }),
    [currentProjectAssets, normalizedInspectorQuery, orbitalData.noteById]
  );
  const colorMenuEntries = useMemo(
    () => {
      const paletteEntriesByHex = new Map<
        string,
        {
          id: string;
          hex: string;
          label: string;
          count: number;
          order: number;
        }
      >(
        COLOR_PALETTE.map((entry, index) => [
          entry.hex,
          {
            id: entry.id,
            hex: entry.hex,
            label: t(entry.labelKey),
            count: colorCounts.get(entry.hex) ?? 0,
            order: index
          }
        ])
      );

      return [...colorCounts.entries()]
        .map(([hex, count], index) => {
          const paletteEntry = paletteEntriesByHex.get(hex);

          if (paletteEntry) {
            return paletteEntry;
          }

          return {
            id: `custom-${hex.toLowerCase()}`,
            hex,
            label: hex.toUpperCase(),
            count,
            order: COLOR_PALETTE.length + index
          };
        })
        .sort((left, right) => left.order - right.order);
    },
    [colorCounts, t]
  );
  const filteredColorsMenu = useMemo(
    () =>
      colorMenuEntries.filter((entry) =>
        `${entry.label} ${entry.hex}`.toLowerCase().includes(normalizedInspectorQuery)
      ),
    [colorMenuEntries, normalizedInspectorQuery]
  );
  const inspectorMenuTitle =
    effectiveInspectorMenu === "notes"
      ? labels.notesMenu
      : effectiveInspectorMenu === "folders"
        ? labels.foldersMenu
        : effectiveInspectorMenu === "tags"
          ? labels.tagsMenu
          : effectiveInspectorMenu === "files"
            ? labels.filesMenu
            : effectiveInspectorMenu === "colors"
              ? labels.colorsMenu
              : labels.pinnedMenu;
  const inspectorMenuCount =
    effectiveInspectorMenu === "notes"
      ? filteredNotesMenu.length
      : effectiveInspectorMenu === "folders"
        ? countInspectorHierarchyItems(filteredFoldersMenu)
        : effectiveInspectorMenu === "tags"
          ? filteredTagsMenu.length
          : effectiveInspectorMenu === "files"
            ? filteredFilesMenu.length
            : effectiveInspectorMenu === "colors"
              ? filteredColorsMenu.length
              : filteredPinnedMenu.length;
  const showInspectorHierarchyQuickActions =
    effectiveInspectorMenu === "folders" && Boolean(currentProjectId);
  const activeProjectIndex = currentProjectId
    ? orbitalData.projects.findIndex((project) => project.id === currentProjectId)
    : -1;
  const canNavigateProjects = orbitalData.projects.length > 1;
  const overviewLinks = [
    { menu: "notes" as const, label: labels.notesStat, count: currentProjectNotes.length },
    { menu: "folders" as const, label: labels.foldersStat, count: currentProjectFolders.length },
    { menu: "tags" as const, label: labels.tagsStat, count: currentProjectTagCounts.size },
    { menu: "files" as const, label: labels.assetsStat, count: currentProjectAssets.length },
    { menu: "colors" as const, label: labels.colorsStat, count: colorCounts.size },
    { menu: "pinned" as const, label: labels.pinnedStat, count: pinnedCount }
  ];
  const preferredHierarchyContextEntityId = useMemo(() => {
    if (
      hierarchyFocusedEntityId &&
      getEntityProjectId(hierarchyFocusedEntityId, orbitalData) === currentProjectId
    ) {
      return hierarchyFocusedEntityId;
    }

    if (selectedEntityId && getEntityProjectId(selectedEntityId, orbitalData) === currentProjectId) {
      return selectedEntityId;
    }

    if (activeFolderFilters.length === 1) {
      return `folder:${activeFolderFilters[0]}`;
    }

    if (activeNoteFilters.length === 1) {
      return `note:${activeNoteFilters[0]}`;
    }

    return currentProjectEntityId;
  }, [
    activeFolderFilters,
    activeNoteFilters,
    currentProjectEntityId,
    currentProjectId,
    hierarchyFocusedEntityId,
    orbitalData,
    selectedEntityId
  ]);
  const inspectorCreateContext = useMemo(() => {
    if (!currentProjectId || !preferredHierarchyContextEntityId) {
      return null;
    }

    if (preferredHierarchyContextEntityId.startsWith("project:")) {
      const project = orbitalData.projectById.get(
        preferredHierarchyContextEntityId.slice("project:".length)
      );

      if (!project) {
        return null;
      }

      return {
        kind: "core" as const,
        entityId: preferredHierarchyContextEntityId,
        project
      };
    }

    if (preferredHierarchyContextEntityId.startsWith("folder:")) {
      const folder = orbitalData.folderById.get(
        preferredHierarchyContextEntityId.slice("folder:".length)
      );

      if (!folder) {
        return null;
      }

      return {
        kind: "folder" as const,
        entityId: preferredHierarchyContextEntityId,
        folder,
        depth: orbitalData.folderMeta.get(folder.id)?.depth ?? 0
      };
    }

    if (preferredHierarchyContextEntityId.startsWith("note:")) {
      const note = orbitalData.noteById.get(
        preferredHierarchyContextEntityId.slice("note:".length)
      );

      if (!note) {
        return null;
      }

      return {
        kind: "note" as const,
        entityId: preferredHierarchyContextEntityId,
        note,
        folderDepth: note.folderId
          ? orbitalData.folderMeta.get(note.folderId)?.depth ?? null
          : null
      };
    }

    return null;
  }, [
    currentProjectId,
    orbitalData.folderById,
    orbitalData.folderMeta,
    orbitalData.noteById,
    orbitalData.projectById,
    preferredHierarchyContextEntityId
  ]);
  const inspectorQuickCreateTargets = useMemo(() => {
    if (!inspectorCreateContext) {
      return {
        folder: null,
        note: null,
        canvas: null
      };
    }

    if (inspectorCreateContext.kind === "core") {
      return {
        folder: {
          parentId: null,
          projectId: inspectorCreateContext.project.id,
          mode: "root" as const
        },
        note: {
          folderId: null,
          projectId: inspectorCreateContext.project.id
        },
        canvas: {
          folderId: null,
          projectId: inspectorCreateContext.project.id
        }
      };
    }

    if (inspectorCreateContext.kind === "folder") {
      return {
        folder:
          inspectorCreateContext.depth < 1
            ? {
                parentId: inspectorCreateContext.folder.id,
                projectId: inspectorCreateContext.folder.projectId,
                mode: "child" as const
              }
            : null,
        note: {
          folderId: inspectorCreateContext.folder.id,
          projectId: inspectorCreateContext.folder.projectId
        },
        canvas: {
          folderId: inspectorCreateContext.folder.id,
          projectId: inspectorCreateContext.folder.projectId
        }
      };
    }

    return {
      folder:
        inspectorCreateContext.note.folderId === null
          ? {
              parentId: null,
              projectId: inspectorCreateContext.note.projectId,
              mode: "root" as const
            }
          : (inspectorCreateContext.folderDepth ?? 99) < 1
            ? {
                parentId: inspectorCreateContext.note.folderId,
                projectId: inspectorCreateContext.note.projectId,
                mode: "child" as const
              }
            : null,
      note: {
        folderId: inspectorCreateContext.note.folderId,
        projectId: inspectorCreateContext.note.projectId
      },
      canvas: {
        folderId: inspectorCreateContext.note.folderId,
        projectId: inspectorCreateContext.note.projectId
      }
    };
  }, [inspectorCreateContext]);
  const inspectorFolderActionTitle =
    inspectorQuickCreateTargets.folder?.mode === "child"
      ? labels.addChildFolder
      : inspectorQuickCreateTargets.folder
        ? labels.addRootFolder
        : inspectorCreateContext?.kind === "folder" && inspectorCreateContext.depth >= 1
          ? labels.maxDepthReached
          : inspectorCreateContext?.kind === "note" && inspectorCreateContext.note.folderId !== null
            ? labels.maxDepthReached
            : labels.addRootFolder;

  const contextMenuColorOptions = useMemo(
    () =>
      COLOR_PALETTE.map((entry) => ({
        id: entry.id,
        hex: entry.hex,
        label: t(entry.labelKey)
      })),
    [t]
  );

  const buildInspectorNoteContextTarget = (note: Note): InspectorContextMenuTarget => ({
    kind: note.contentType === "canvas" ? "canvas" : "note",
    note,
    label: getNoteInspectorTitle(note),
    color: note.color || DEFAULT_NOTE_COLOR,
    pinned: isEntryFavorite(note)
  });

  const buildInspectorHierarchyContextTarget = (
    item: InspectorHierarchyItem
  ): InspectorContextMenuTarget => {
    if (item.kind === "core") {
      throw new Error("CORE_CONTEXT_UNSUPPORTED");
    }

    if (item.kind === "folder") {
      return {
        kind: "folder",
        folder: item.folder!,
        label: item.label,
        color: item.color,
        canCreateFolder: (orbitalData.folderMeta.get(item.id)?.depth ?? 0) < 1
      };
    }

    return {
      kind: item.kind,
      note: item.note!,
      label: item.label,
      color: item.color,
      pinned: item.note ? isEntryFavorite(item.note) : false
    };
  };

  const isEditingInspectorTarget = (target: InspectorContextMenuTarget) =>
    Boolean(
      inspectorRenameState &&
        inspectorRenameState.kind === target.kind &&
        inspectorRenameState.id === (target.kind === "folder" ? target.folder.id : target.note.id)
    );

  const renderInspectorRenameField = (
    target: InspectorContextMenuTarget,
    className: string
  ) => {
    const renameLabel = t("folders.rename");
    const placeholder =
      target.kind === "folder"
        ? t("folders.createPlaceholder")
        : target.kind === "canvas"
          ? t("canvas.titlePlaceholder")
          : t("note.titlePlaceholder");

    return (
      <input
        autoFocus
        value={inspectorRenameDraft}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setInspectorRenameDraft(event.target.value)}
        onBlur={() => {
          void submitInspectorRename();
        }}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();

          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }

          if (event.key === "Escape") {
            event.preventDefault();
            cancelInspectorRename();
          }
        }}
        className={className}
        placeholder={placeholder}
        aria-label={`${renameLabel}: ${target.label}`}
      />
    );
  };

  const contextMenuActions = useMemo<OrbitalInspectorContextMenuAction[]>(() => {
    if (!contextMenuState) {
      return [];
    }

    const target = contextMenuState.target;
    const actions: OrbitalInspectorContextMenuAction[] = [
      {
        id: "rename",
        label: labels.renameAction,
        icon: "rename",
        onSelect: () => beginInspectorRename(target)
      }
    ];

    if (target.kind === "folder") {
      if (target.canCreateFolder) {
        actions.push({
          id: "create-folder",
          label: labels.addChildFolder,
          icon: "folder",
          tone: "accent",
          onSelect: () => {
            closeInspectorContextMenu();
            beginFolderDraft(target.folder.id, target.folder.projectId);
          }
        });
      }

      actions.push(
        {
          id: "create-note",
          label: labels.addNote,
          icon: "note",
          tone: "accent",
          onSelect: () => {
            closeInspectorContextMenu();
            void handleCreateNote(target.folder.id, target.folder.projectId);
          }
        },
        {
          id: "create-canvas",
          label: labels.addCanvas,
          icon: "canvas",
          tone: "accent",
          onSelect: () => {
            closeInspectorContextMenu();
            void handleCreateCanvas(target.folder.id, target.folder.projectId);
          }
        },
        {
          id: "delete-folder",
          label: labels.deleteFolder,
          icon: "trash",
          tone: "danger",
          onSelect: () => {
            closeInspectorContextMenu();
            void onDeleteFolder(target.folder.id);
          }
        }
      );

      return actions;
    }

    actions.push(
      {
        id: "toggle-pin",
        label: target.pinned ? t("note.unpin") : t("note.pin"),
        icon: target.pinned ? "unpin" : "pin",
        onSelect: () => {
          closeInspectorContextMenu();
          void onSetNotePinned(target.note.id, !target.pinned);
        }
      },
      {
        id: "delete-note",
        label: labels.moveToTrash,
        icon: "trash",
        tone: "danger",
        onSelect: () => {
          closeInspectorContextMenu();
          void onDeleteNote(target.note.id);
        }
      }
    );

    return actions;
  }, [
    beginInspectorRename,
    beginFolderDraft,
    closeInspectorContextMenu,
    contextMenuState,
    handleCreateCanvas,
    handleCreateNote,
    labels.addCanvas,
    labels.addChildFolder,
    labels.addNote,
    labels.deleteFolder,
    labels.moveToTrash,
    labels.renameAction,
    onDeleteFolder,
    onDeleteNote,
    onSetNotePinned,
    t
  ]);

  function renderInspectorItemIcon(kind: InspectorCompactIconKind, color: string) {
    const style = { "--item-color": color } as CSSProperties;

    if (kind === "folder") {
      return (
        <span
          className="orbital-tree-icon is-folder"
          style={style}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M3.5 8.4c0-1.5 1.2-2.7 2.7-2.7h3.4l1.6 1.7h6.6c1.5 0 2.7 1.2 2.7 2.7v5.7c0 1.5-1.2 2.7-2.7 2.7H6.2c-1.5 0-2.7-1.2-2.7-2.7V8.4Z" />
            <path d="M3.9 10.1h16.2" className="orbital-tree-icon-accent" />
          </svg>
        </span>
      );
    }

    if (kind === "canvas") {
      return (
        <span
          className="orbital-tree-icon is-canvas"
          style={style}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" focusable="false">
            <rect x="4.2" y="5" width="15.6" height="14" rx="3.2" />
            <path d="M8.2 9.2h7.6M8.2 12h5.8M8.2 14.8h6.8" className="orbital-tree-icon-accent" />
          </svg>
        </span>
      );
    }

    if (kind === "tag") {
      return (
        <span
          className="orbital-tree-icon is-tag"
          style={style}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M5.3 8.8c0-1.3 1.1-2.4 2.4-2.4h5.2l5.8 5.8a1.8 1.8 0 0 1 0 2.5l-3.8 3.8a1.8 1.8 0 0 1-2.5 0L6.6 12.7V8.8Z" />
            <circle cx="9.1" cy="9.4" r="1.15" className="orbital-tree-icon-dot" />
          </svg>
        </span>
      );
    }

    if (kind === "file") {
      return (
        <span
          className="orbital-tree-icon is-file"
          style={style}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M8 5.2h6.4l3.2 3.3v8.8c0 1.3-1.1 2.4-2.4 2.4H8c-1.3 0-2.4-1.1-2.4-2.4V7.6c0-1.3 1.1-2.4 2.4-2.4Z" />
            <path d="M14.4 5.5v3.4h3.2" className="orbital-tree-icon-accent" />
            <path d="M8.7 12h6.6M8.7 14.9h5.1" className="orbital-tree-icon-accent" />
          </svg>
        </span>
      );
    }

    if (kind === "color") {
      return (
        <span
          className="orbital-tree-icon is-color"
          style={style}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" focusable="false">
            <circle cx="12" cy="12" r="7.3" />
            <circle cx="12" cy="12" r="3.1" className="orbital-tree-icon-corefill" />
          </svg>
        </span>
      );
    }

    if (kind === "core") {
      return (
        <span
          className="orbital-tree-icon is-core"
          style={style}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" focusable="false">
            <circle cx="12" cy="12" r="7.2" />
            <circle cx="12" cy="12" r="3.2" className="orbital-tree-icon-corefill" />
            <path d="M12 2.9v2.2M12 18.9v2.2M2.9 12h2.2M18.9 12h2.2" className="orbital-tree-icon-accent" />
          </svg>
        </span>
      );
    }

    return (
      <span
        className="orbital-tree-icon is-note"
        style={style}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M7.1 4.5h6.7l4.1 4.1v9.3c0 1.4-1.1 2.5-2.5 2.5H7.1c-1.4 0-2.5-1.1-2.5-2.5V7c0-1.4 1.1-2.5 2.5-2.5Z" />
          <path d="M13.8 4.7V8.8h4.1" className="orbital-tree-icon-accent" />
          <path d="M8.2 11h7.2M8.2 14h6.1M8.2 17h4.8" className="orbital-tree-icon-accent" />
        </svg>
      </span>
    );
  }

  function renderInspectorCreateActionIcon(kind: "folder" | "subfolder" | "note" | "canvas") {
    if (kind === "folder") {
      return (
        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <path d="M3.8 8.3c0-1.5 1.2-2.7 2.7-2.7h3.4l1.5 1.7h6.4c1.5 0 2.7 1.2 2.7 2.7v5.5c0 1.5-1.2 2.7-2.7 2.7H6.5c-1.5 0-2.7-1.2-2.7-2.7V8.3Z" />
          <path d="M16.9 7.7v4.8M14.5 10.1h4.8" />
        </svg>
      );
    }

    if (kind === "subfolder") {
      return (
        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <path d="M4.2 7.7c0-1.4 1.1-2.5 2.5-2.5h2.6l1.4 1.5h2.6" />
          <path d="M6.4 9.6h10.9c1.4 0 2.5 1.1 2.5 2.5v3.8c0 1.4-1.1 2.5-2.5 2.5H6.4c-1.4 0-2.5-1.1-2.5-2.5v-3.8c0-1.4 1.1-2.5 2.5-2.5Z" />
          <path d="M15.9 11.1v4.6M13.6 13.4h4.6" />
        </svg>
      );
    }

    if (kind === "canvas") {
      return (
        <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
          <rect x="4.2" y="5.2" width="15.6" height="13.6" rx="3" />
          <path d="M8 10.1h6.4M8 13h4.9" />
          <path d="M17 7.6v4.2M14.9 9.7h4.2" />
        </svg>
      );
    }

    return (
      <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="M7.7 4.7h6.1l3.2 3.1v8.5c0 1.4-1.1 2.5-2.5 2.5H7.7c-1.4 0-2.5-1.1-2.5-2.5V7.2c0-1.4 1.1-2.5 2.5-2.5Z" />
        <path d="M13.8 4.9v3.4h3.1" />
        <path d="M15.8 12v4.3M13.7 14.1H18" />
      </svg>
    );
  }

  function renderInspectorCompactRow({
    isActive,
    onClick,
    title,
    meta,
    kindLabel,
    count,
    icon,
    contextMenuTarget,
    onDoubleClick,
    onPointerEnter,
    onPointerMove,
    onPointerLeave,
    onPointerCancel
  }: {
    isActive: boolean;
    onClick: () => void;
    title: string;
    meta?: string | null;
    kindLabel?: string | null;
    count?: number;
    icon: ReactNode;
    contextMenuTarget?: InspectorContextMenuTarget;
    onDoubleClick?: () => void;
    onPointerEnter?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onPointerMove?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onPointerLeave?: () => void;
    onPointerCancel?: () => void;
  }) {
    if (contextMenuTarget && isEditingInspectorTarget(contextMenuTarget)) {
      return (
        <div className="orbital-tree-item orbital-menu-compact-item is-editing">
          {icon}
          <span className="orbital-menu-compact-main">
            <span className="orbital-menu-compact-copy">
              {renderInspectorRenameField(contextMenuTarget, "orbital-menu-inline-input")}
              {meta ? <span className="orbital-menu-compact-meta">{meta}</span> : null}
            </span>
          </span>
        </div>
      );
    }

    return (
      <button
        type="button"
        className={`orbital-tree-item orbital-menu-compact-item ${isActive ? "is-active" : ""}`}
        onClick={(event) => {
          if (consumeSuppressedInspectorClick()) {
            event.preventDefault();
            return;
          }

          onClick();
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={
          contextMenuTarget
            ? (event) => {
                event.preventDefault();
                openInspectorContextMenu(contextMenuTarget, "popover", {
                  x: event.clientX,
                  y: event.clientY
                });
              }
            : undefined
        }
        onPointerDown={
          contextMenuTarget
            ? (event) => {
                handleInspectorContextPointerDown(contextMenuTarget, event);
              }
            : undefined
        }
        onPointerEnter={onPointerEnter}
        onPointerMove={(event) => {
          onPointerMove?.(event);
          if (contextMenuTarget) {
            handleInspectorContextPointerMove(event);
          }
        }}
        onPointerUp={
          contextMenuTarget
            ? (event) => {
                handleInspectorContextPointerEnd(event.pointerId);
              }
            : undefined
        }
        onPointerLeave={(event) => {
          onPointerLeave?.();
          if (contextMenuTarget) {
            handleInspectorContextPointerEnd(event.pointerId);
          }
        }}
        onPointerCancel={(event) => {
          onPointerCancel?.();
          if (contextMenuTarget) {
            handleInspectorContextPointerEnd(event.pointerId);
          }
        }}
      >
        {icon}
        <span className="orbital-menu-compact-main">
          <span className="orbital-menu-compact-copy">
            <span className="orbital-menu-compact-title">{title}</span>
            {meta ? <span className="orbital-menu-compact-meta">{meta}</span> : null}
          </span>

          {kindLabel || typeof count === "number" ? (
            <span className="orbital-menu-compact-side">
              {kindLabel ? <span className="orbital-tree-kind">{kindLabel}</span> : null}
              {typeof count === "number" ? (
                <span className="orbital-menu-compact-count">{count}</span>
              ) : null}
            </span>
          ) : null}
        </span>
      </button>
    );
  }

  function renderInspectorStaticCompactRow({
    title,
    meta,
    kindLabel,
    count,
    icon,
    className
  }: {
    title: string;
    meta?: string | null;
    kindLabel?: string | null;
    count?: number;
    icon: ReactNode;
    className?: string;
  }) {
    return (
      <div className={`orbital-tree-item orbital-menu-compact-item orbital-inspector-static-row ${className ?? ""}`.trim()}>
        {icon}
        <span className="orbital-menu-compact-main">
          <span className="orbital-menu-compact-copy">
            <span className="orbital-menu-compact-title">{title}</span>
            {meta ? <span className="orbital-menu-compact-meta">{meta}</span> : null}
          </span>

          {kindLabel || typeof count === "number" ? (
            <span className="orbital-menu-compact-side">
              {kindLabel ? <span className="orbital-tree-kind">{kindLabel}</span> : null}
              {typeof count === "number" ? (
                <span className="orbital-menu-compact-count">{count}</span>
              ) : null}
            </span>
          ) : null}
        </span>
      </div>
    );
  }

  function getNoteInspectorTitle(note: Note) {
    return (
      note.title.trim() ||
      (note.contentType === "canvas" ? t("canvas.untitled") : t("note.untitled"))
    );
  }

  function renderFolderDraftNode(depth: number) {
    return (
      <div className="orbital-tree-node" key={`folder-draft:${folderDraftParentId ?? folderDraftProjectId ?? "root"}`}>
        <div className="orbital-tree-row" style={{ "--tree-depth": depth } as CSSProperties}>
          <span className="orbital-tree-toggle-spacer" aria-hidden="true" />
          <div
            className="orbital-tree-item is-editing is-draft"
            ref={folderDraftRowRef}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.stopPropagation()}
          >
            {renderInspectorItemIcon("folder", folderDraftColor)}
            <span className="orbital-tree-item-main">
              <input
                ref={folderDraftInputRef}
                value={folderDraft}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => {
                  setFolderDraft(event.target.value);
                  if (folderDraftError) {
                    setFolderDraftError(null);
                  }
                }}
                onBlur={() => {
                  void handleCreateFolder();
                }}
                onClick={(event) => event.stopPropagation()}
                onContextMenu={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  event.stopPropagation();

                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();
                    resetFolderDraft();
                  }
                }}
                className="orbital-menu-inline-input"
                placeholder={labels.folderNamePlaceholder}
                aria-label={labels.folderNamePlaceholder}
              />
              <span className="orbital-tree-kind">{labels.folder}</span>
            </span>
          </div>
        </div>
      </div>
    );
  }

  function renderInspectorHierarchyNode(item: InspectorHierarchyItem, depth = 0): ReactNode {
    const hasChildren = item.kind !== "core" && item.children.length > 0;
    const hasDraftChild =
      isFolderDraftOpen &&
      folderDraftProjectId === currentProjectId &&
      ((item.kind === "core" &&
        folderDraftParentId === null &&
        item.project?.id === folderDraftProjectId) ||
        (item.kind === "folder" && folderDraftParentId === item.id));
    const isExpandable = item.kind === "folder" && (hasChildren || hasDraftChild);
    const isExpanded =
      item.kind === "core"
        ? true
        : isExpandable
          ? hasDraftChild ||
            normalizedInspectorQuery.length > 0 ||
            selectedHierarchyExpandedFolderSet.has(item.id) ||
            !collapsedInspectorFolderSet.has(item.id)
          : false;
    const isSceneSelected = selectedEntityId === item.entityId;
    const isHierarchyFocused = hierarchyFocusedEntityId === item.entityId;
    const isActive =
      (item.kind === "core"
        ? false
        : item.kind === "folder"
          ? activeFolderFilterSet.has(item.id)
          : activeNoteFilterSet.has(item.id)) ||
      isSceneSelected ||
      isHierarchyFocused;
    const metaLabel =
      item.kind === "core"
        ? `${labels.project}: ${item.label}`
        : item.kind === "folder"
        ? folderPathMap.get(item.id) ?? item.label
        : item.note?.folderId
          ? folderPathMap.get(item.note.folderId) ?? labels.uncategorized
          : labels.uncategorized;
    const contextMenuTarget =
      item.kind === "core" ? null : buildInspectorHierarchyContextTarget(item);
    const isEditing = contextMenuTarget ? isEditingInspectorTarget(contextMenuTarget) : false;
    const kindLabel =
      item.kind === "core"
        ? labels.project
        : item.kind === "folder"
          ? labels.folder
          : item.kind === "canvas"
            ? labels.canvas
            : labels.note;

    return (
      <div className="orbital-tree-node" key={item.entityId}>
        <div
          className="orbital-tree-row"
          style={{ "--tree-depth": depth } as CSSProperties}
          role="treeitem"
          aria-expanded={isExpandable ? isExpanded : undefined}
          aria-selected={isActive}
          aria-level={depth + 1}
        >
          {isExpandable ? (
            <button
              type="button"
              className={`orbital-tree-toggle ${isExpanded ? "is-expanded" : ""}`}
              aria-label={item.label}
              aria-expanded={isExpanded}
              disabled={normalizedInspectorQuery.length > 0}
              onClick={(event) => {
                event.stopPropagation();
                toggleInspectorFolderCollapse(item.id);
              }}
            >
              <span aria-hidden="true">›</span>
            </button>
          ) : (
            <span className="orbital-tree-toggle-spacer" aria-hidden="true" />
          )}

          {isEditing ? (
            <div
              className="orbital-tree-item is-editing"
              ref={(node) => registerInspectorHierarchyItemRef(item.entityId, node)}
            >
              {renderInspectorItemIcon(item.kind === "core" ? "core" : item.kind, item.color)}
              <span className="orbital-tree-item-main">
                {renderInspectorRenameField(contextMenuTarget!, "orbital-menu-inline-input")}
                <span className="orbital-tree-kind">{kindLabel}</span>
              </span>
            </div>
          ) : (
            <button
              type="button"
              className={`orbital-tree-item ${isActive ? "is-active" : ""} ${
                isSceneSelected ? "is-scene-selected" : ""
              }`}
              ref={(node) => registerInspectorHierarchyItemRef(item.entityId, node)}
              title={metaLabel}
              onClick={(event) => {
                if (consumeSuppressedInspectorClick()) {
                  event.preventDefault();
                  return;
                }

                handleInspectorHierarchySelection(item, event);
              }}
              onDoubleClick={
                item.kind === "core"
                  ? () => {
                      if (item.project) {
                        centerOnProject(item.project.id);
                      }
                    }
                  : item.note
                  ? () => {
                      closeSelectionHoverPreview();
                      onOpenNote(item.note!.id);
                    }
                  : undefined
              }
              onContextMenu={(event) => {
                if (!contextMenuTarget) {
                  return;
                }

                event.preventDefault();
                openInspectorContextMenu(contextMenuTarget, "popover", {
                  x: event.clientX,
                  y: event.clientY
                });
              }}
              onPointerDown={(event) => {
                if (!contextMenuTarget) {
                  return;
                }

                handleInspectorContextPointerDown(contextMenuTarget, event);
              }}
              onPointerEnter={
                item.note
                  ? (event) => {
                      openSelectionHoverPreview(
                        item.note!.id,
                        event.clientX,
                        event.clientY,
                        "inspector",
                        {
                          anchorRect: toHoverPreviewAnchorRect(
                            event.currentTarget.getBoundingClientRect()
                          )
                        }
                      );
                    }
                  : undefined
              }
              onPointerMove={(event) => {
                if (item.note) {
                  updateSelectionHoverPreviewCursor(event.clientX, event.clientY, {
                    anchorRect: toHoverPreviewAnchorRect(
                      event.currentTarget.getBoundingClientRect()
                    )
                  });
                }

                if (contextMenuTarget) {
                  handleInspectorContextPointerMove(event);
                }
              }}
              onPointerUp={(event) => {
                if (contextMenuTarget) {
                  handleInspectorContextPointerEnd(event.pointerId);
                }
              }}
              onPointerLeave={(event) => {
                if (item.note) {
                  scheduleSelectionHoverPreviewClose();
                }

                if (contextMenuTarget) {
                  handleInspectorContextPointerEnd(event.pointerId);
                }
              }}
              onPointerCancel={(event) => {
                if (item.note) {
                  scheduleSelectionHoverPreviewClose();
                }

                if (contextMenuTarget) {
                  handleInspectorContextPointerEnd(event.pointerId);
                }
              }}
            >
              {renderInspectorItemIcon(item.kind === "core" ? "core" : item.kind, item.color)}
              <span className="orbital-tree-item-main">
                <span className="orbital-tree-label">{item.label}</span>
                <span className="orbital-tree-kind">{kindLabel}</span>
              </span>
            </button>
          )}
        </div>

        {(item.kind === "core" || (isExpandable && isExpanded)) &&
        (item.children.length > 0 || hasDraftChild) ? (
          <div className="orbital-tree-children" role="group">
            {item.children.map((child) => renderInspectorHierarchyNode(child, depth + 1))}
            {hasDraftChild ? renderFolderDraftNode(depth + 1) : null}
          </div>
        ) : null}
      </div>
    );
  }

  function renderEditableProjectTitle(
    project: Project | null | undefined,
    fallbackTitle: string,
    className: string
  ) {
    const renameLabel = t("folders.rename");

    if (!project) {
      return <h2 className={className}>{fallbackTitle}</h2>;
    }

    if (editingProjectId === project.id) {
      return (
        <div className="orbital-inline-title-shell is-editing">
          <input
            autoFocus
            value={projectNameDraft}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setProjectNameDraft(event.target.value)}
            onBlur={() => {
              void submitProjectRename();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }

              if (event.key === "Escape") {
                event.preventDefault();
                cancelProjectRename();
              }
            }}
            className={`orbital-inline-title-input ${className}`}
            aria-label={`${renameLabel}: ${project.name}`}
          />
        </div>
      );
    }

    return (
      <div className="orbital-inline-title-shell">
        <button
          type="button"
          className={`orbital-inline-title-button ${className}`}
          onClick={() => beginProjectRename(project)}
          title={project.name}
        >
          {project.name}
        </button>
        <button
          type="button"
          className="orbital-inline-title-edit"
          onClick={() => beginProjectRename(project)}
          aria-label={`${renameLabel}: ${project.name}`}
          title={renameLabel}
        >
          ✎
        </button>
      </div>
    );
  }

  const cycleProject = (direction: -1 | 1) => {
    if (!orbitalData.projects.length) {
      return;
    }

    const baseIndex = activeProjectIndex >= 0 ? activeProjectIndex : 0;
    const nextIndex =
      (baseIndex + direction + orbitalData.projects.length) % orbitalData.projects.length;
    const project = orbitalData.projects[nextIndex];

    if (!project) {
      return;
    }

    setSelectedEntityId(null);
    setActiveProjectId(project.id);
    setInspectorMenu("overview");
    centerOnProject(project.id, 760);
  };
  const coreFlareRotation = (timeMs * 0.0045) % 360;
  const overviewStateChips = [
    {
      id: "index",
      label: `${activeProjectIndex >= 0 ? activeProjectIndex + 1 : 0}/${orbitalData.projects.length}`,
      tone: "default" as const
    },
    {
      id: "visible",
      label: `${labels.visibleBodies}: ${visibleBodies}`,
      tone: "success" as const
    },
    ...(hiddenBodies > 0
      ? [
          {
            id: "hidden",
            label: `${labels.hiddenBodies}: ${hiddenBodies}`,
            tone: "warning" as const
          }
        ]
      : []),
  ];
  const overviewBody = (
    <>
      <div className="orbital-inspector-header orbital-inspector-header-overview">
        <div className="orbital-inspector-heading">
          <p className="panel-kicker orbital-inspector-kicker">{labels.overview}</p>
          {renderEditableProjectTitle(
            currentProject,
            labels.title,
            "panel-title orbital-inspector-title"
          )}
        </div>
        <div className="orbital-inspector-header-actions">
          <button
            type="button"
            className="toolbar-action orbital-toolbar-action orbital-icon-action accent orbital-overview-addsystem"
            onClick={() => void handleCreateProject()}
            aria-label={labels.addProject}
            title={labels.addProject}
          >
            +
          </button>
        </div>
      </div>

      <div className="orbital-overview-chiprow">
        {overviewStateChips.map((chip) => (
          <span
            key={chip.id}
            className={`orbital-overview-chip orbital-overview-chip-${chip.tone}`}
          >
            {chip.label}
          </span>
        ))}
      </div>

      <div
        className="orbital-overview-switcher orbital-overview-systemcard"
        style={{ "--preview-accent": currentProject?.color ?? DEFAULT_PROJECT_COLOR } as CSSProperties}
      >
        <button
          type="button"
          className="orbital-overview-nav"
          onClick={() => cycleProject(-1)}
          disabled={!canNavigateProjects}
          aria-label={labels.previousProject}
          title={labels.previousProject}
        >
          ←
        </button>

        <div key={currentProjectId ?? "no-project"} className="orbital-overview-preview-stage">
          <button
            className="topology-activator orbit-preview-trigger orbital-overview-trigger"
            onClick={() => {
              if (!currentProjectId) {
                return;
              }

              setSelectedEntityId(getProjectEntityId(currentProjectId));
              centerOnProject(currentProjectId);
            }}
          >
            <svg viewBox="0 0 360 260" className="topology-map" role="img" aria-label={labels.overview}>
              <defs>
                <linearGradient id="topologyLine" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ffe08a" stopOpacity="0.95" />
                  <stop offset="100%" stopColor="#73f7ff" stopOpacity="0.4" />
                </linearGradient>
              </defs>

              <circle cx="180" cy="130" r="84" className="topology-ring topology-ring-outer" />
              <circle cx="180" cy="130" r="56" className="topology-ring topology-ring-inner" />
              <circle cx="180" cy="130" r="25" className="topology-core" />

              {topFolders.map((folder, index) => {
                const angle = ((Math.PI * 2) / Math.max(topFolders.length, 1)) * index - Math.PI / 2;
                const x = 180 + Math.cos(angle) * 84;
                const y = 130 + Math.sin(angle) * 84;

                return (
                  <g key={folder.id}>
                    <line x1="180" y1="130" x2={x} y2={y} className="topology-link" />
                    <circle cx={x} cy={y} r="10" fill={folder.color} className="topology-node" />
                    <text x={x} y={y + 22} textAnchor="middle" className="topology-label">
                      {folder.name}
                    </text>
                  </g>
                );
              })}

              {topTags.map((tag, index) => {
                const angle = ((Math.PI * 2) / Math.max(topTags.length, 1)) * index - Math.PI / 3;
                const x = 180 + Math.cos(angle) * 56;
                const y = 130 + Math.sin(angle) * 56;

                return (
                  <g key={tag.id}>
                    <line x1="180" y1="130" x2={x} y2={y} className="topology-link topology-link-soft" />
                    <circle cx={x} cy={y} r="7" className="topology-node topology-node-small topology-node-neutral" />
                  </g>
                );
              })}
            </svg>
          </button>
        </div>

        <button
          type="button"
          className="orbital-overview-nav"
          onClick={() => cycleProject(1)}
          disabled={!canNavigateProjects}
          aria-label={labels.nextProject}
          title={labels.nextProject}
        >
          →
        </button>
      </div>

      <div className="orbital-overview-grid">
        {overviewLinks.map((entry) => (
          <button
            key={entry.menu}
            className="orbital-overview-link"
            onClick={() => openInspectorMenu(entry.menu)}
          >
            <span className="orbital-overview-link-main">
              <span className="orbital-overview-link-icon">
                {renderInspectorItemIcon(
                  entry.menu === "notes"
                    ? "note"
                    : entry.menu === "folders"
                      ? "folder"
                      : entry.menu === "tags"
                        ? "tag"
                        : entry.menu === "files"
                          ? "file"
                          : entry.menu === "colors"
                            ? "color"
                            : "note",
                  entry.menu === "folders"
                    ? DEFAULT_FOLDER_COLOR
                    : entry.menu === "colors"
                      ? currentProject?.color ?? DEFAULT_PROJECT_COLOR
                      : entry.menu === "pinned"
                        ? "#ffd57e"
                        : DEFAULT_NOTE_COLOR
                )}
              </span>
              <span className="orbital-overview-link-copy">
                <span className="orbital-overview-link-label">{entry.label}</span>
                <span className="orbital-overview-link-meta">
                  {currentProject?.name ?? labels.overview}
                </span>
              </span>
            </span>
            <strong className="orbital-overview-link-count">{entry.count}</strong>
          </button>
        ))}
      </div>
    </>
  );
  const inspectorMenuBody =
    effectiveInspectorMenu === "overview" ? null : (
      <>
        <div className="orbital-inspector-subview-top">
          <div className="orbital-inspector-header orbital-inspector-header-subview">
            <button
              className="toolbar-action orbital-toolbar-action orbital-icon-action orbital-menu-back"
              onClick={handleInspectorBack}
              aria-label={labels.back}
              title={labels.back}
            >
              ←
            </button>
            <div className="orbital-inspector-heading orbital-inspector-heading-subview">
              <h2 className="panel-title orbital-inspector-title">{inspectorMenuTitle}</h2>
            </div>
            <div className="orbital-inspector-header-actions">
              {showInspectorHierarchyQuickActions ? (
                <div className="orbital-inspector-quickactions" aria-label={labels.create}>
                  <button
                    type="button"
                    className="toolbar-action orbital-toolbar-action orbital-icon-action orbital-inspector-create-action"
                    onClick={() => {
                      if (!inspectorQuickCreateTargets.folder) {
                        return;
                      }

                      beginFolderDraft(
                        inspectorQuickCreateTargets.folder.parentId,
                        inspectorQuickCreateTargets.folder.projectId
                      );
                    }}
                    disabled={!inspectorQuickCreateTargets.folder}
                    aria-label={inspectorFolderActionTitle}
                    title={inspectorFolderActionTitle}
                  >
                    {renderInspectorCreateActionIcon("folder")}
                  </button>
                  <button
                    type="button"
                    className="toolbar-action orbital-toolbar-action orbital-icon-action orbital-inspector-create-action"
                    onClick={() => {
                      if (!inspectorQuickCreateTargets.note) {
                        return;
                      }

                      void handleCreateNote(
                        inspectorQuickCreateTargets.note.folderId,
                        inspectorQuickCreateTargets.note.projectId
                      );
                    }}
                    aria-label={labels.addNote}
                    title={labels.addNote}
                  >
                    {renderInspectorCreateActionIcon("note")}
                  </button>
                  <button
                    type="button"
                    className="toolbar-action orbital-toolbar-action orbital-icon-action orbital-inspector-create-action"
                    onClick={() => {
                      if (!inspectorQuickCreateTargets.canvas) {
                        return;
                      }

                      void handleCreateCanvas(
                        inspectorQuickCreateTargets.canvas.folderId,
                        inspectorQuickCreateTargets.canvas.projectId
                      );
                    }}
                    aria-label={labels.addCanvas}
                    title={labels.addCanvas}
                  >
                    {renderInspectorCreateActionIcon("canvas")}
                  </button>
                </div>
              ) : null}
              <span className="orbital-inline-count">{inspectorMenuCount}</span>
            </div>
          </div>

          <div className="orbital-inspector-search">
            <label className="orbital-searchbar" aria-label={labels.searchPlaceholder}>
              <span className="orbital-searchbar-mark">Q</span>
              <input
                value={inspectorQuery}
                onChange={(event) => setInspectorQuery(event.target.value)}
                placeholder={labels.searchPlaceholder}
              />
            </label>
          </div>
        </div>

        {renderFolderDraftErrorMessage()}

        <div
          ref={effectiveInspectorMenu === "folders" ? inspectorMenuListRef : null}
          className={`orbital-menu-list ${effectiveInspectorMenu === "folders" ? "is-tree" : "is-compact"}`}
          role={effectiveInspectorMenu === "folders" ? "tree" : undefined}
        >
          {effectiveInspectorMenu === "notes"
            ? filteredNotesMenu.map((note) => (
                <div key={note.id}>
                  {renderInspectorCompactRow({
                    isActive: activeNoteFilterSet.has(note.id),
                    onClick: () => toggleNoteFilter(note.id),
                    onDoubleClick: () => {
                      closeSelectionHoverPreview();
                      onOpenNote(note.id);
                    },
                    onPointerEnter: (event) => {
                      openSelectionHoverPreview(
                        note.id,
                        event.clientX,
                        event.clientY,
                        "inspector",
                        {
                          anchorRect: toHoverPreviewAnchorRect(event.currentTarget.getBoundingClientRect())
                        }
                      );
                    },
                    onPointerMove: (event) => {
                      updateSelectionHoverPreviewCursor(event.clientX, event.clientY, {
                        anchorRect: toHoverPreviewAnchorRect(event.currentTarget.getBoundingClientRect())
                      });
                    },
                    onPointerLeave: scheduleSelectionHoverPreviewClose,
                    onPointerCancel: scheduleSelectionHoverPreviewClose,
                    title: getNoteInspectorTitle(note),
                    kindLabel: note.contentType === "canvas" ? labels.canvas : labels.note,
                    contextMenuTarget: buildInspectorNoteContextTarget(note),
                    icon: renderInspectorItemIcon(
                      note.contentType === "canvas" ? "canvas" : "note",
                      note.color || DEFAULT_NOTE_COLOR
                    )
                  })}
                </div>
              ))
            : null}

          {effectiveInspectorMenu === "pinned"
            ? filteredPinnedMenu.map((note) => (
                <div key={note.id}>
                  {renderInspectorCompactRow({
                    isActive: activeNoteFilterSet.has(note.id),
                    onClick: () => toggleNoteFilter(note.id),
                    onDoubleClick: () => {
                      closeSelectionHoverPreview();
                      onOpenNote(note.id);
                    },
                    onPointerEnter: (event) => {
                      openSelectionHoverPreview(
                        note.id,
                        event.clientX,
                        event.clientY,
                        "inspector",
                        {
                          anchorRect: toHoverPreviewAnchorRect(event.currentTarget.getBoundingClientRect())
                        }
                      );
                    },
                    onPointerMove: (event) => {
                      updateSelectionHoverPreviewCursor(event.clientX, event.clientY, {
                        anchorRect: toHoverPreviewAnchorRect(event.currentTarget.getBoundingClientRect())
                      });
                    },
                    onPointerLeave: scheduleSelectionHoverPreviewClose,
                    onPointerCancel: scheduleSelectionHoverPreviewClose,
                    title: getNoteInspectorTitle(note),
                    kindLabel: note.contentType === "canvas" ? labels.canvas : labels.note,
                    contextMenuTarget: buildInspectorNoteContextTarget(note),
                    icon: renderInspectorItemIcon(
                      note.contentType === "canvas" ? "canvas" : "note",
                      note.color || DEFAULT_NOTE_COLOR
                    )
                  })}
                </div>
              ))
            : null}

          {effectiveInspectorMenu === "tags"
            ? filteredTagsMenu.map((tag) => (
                <div key={tag.id}>
                  {renderInspectorCompactRow({
                    isActive: activeTagFilterSet.has(tag.id),
                    onClick: () => toggleTagFilter(tag.id),
                    title: tag.name,
                    kindLabel: labels.tagsMenu,
                    count: currentProjectTagCounts.get(tag.id) ?? 0,
                    icon: renderInspectorItemIcon("tag", currentProject?.color ?? DEFAULT_PROJECT_COLOR)
                  })}
                </div>
              ))
            : null}

          {effectiveInspectorMenu === "files"
            ? filteredFilesMenu.map((asset) => (
                <div key={asset.id}>
                  {renderInspectorCompactRow({
                    isActive: activeAssetFilterSet.has(asset.id),
                    onClick: () => toggleAssetFilter(asset.id),
                    title: asset.name,
                    icon: renderInspectorItemIcon(
                      "file",
                      orbitalData.noteById.get(asset.noteId)?.color || DEFAULT_NOTE_COLOR
                    )
                  })}
                </div>
              ))
            : null}

          {effectiveInspectorMenu === "folders"
            ? filteredFoldersMenu.map((item) => renderInspectorHierarchyNode(item))
            : null}

          {effectiveInspectorMenu === "colors"
            ? filteredColorsMenu.map((entry) => (
                <div key={entry.id}>
                  {renderInspectorCompactRow({
                    isActive: activeColorFilterSet.has(entry.hex),
                    onClick: () => toggleColorFilter(entry.hex),
                    title: entry.label,
                    meta: entry.hex.toUpperCase(),
                    count: entry.count,
                    icon: renderInspectorItemIcon("color", entry.hex)
                  })}
                </div>
              ))
            : null}

          {((effectiveInspectorMenu === "notes" && filteredNotesMenu.length === 0) ||
            (effectiveInspectorMenu === "pinned" && filteredPinnedMenu.length === 0) ||
            (effectiveInspectorMenu === "tags" && filteredTagsMenu.length === 0) ||
            (effectiveInspectorMenu === "files" && filteredFilesMenu.length === 0) ||
            (effectiveInspectorMenu === "folders" && filteredFoldersMenu.length === 0) ||
            (effectiveInspectorMenu === "colors" && filteredColorsMenu.length === 0)) ? (
            <div className="empty-card orbital-menu-empty">
              <strong>{labels.empty}</strong>
            </div>
          ) : null}
        </div>
      </>
    );
  const selectedInspectorContextTarget =
    selectedNode?.kind === "folder" && selectedNode.folder
      ? ({
          kind: "folder",
          folder: selectedNode.folder,
          label: selectedNode.label,
          color: selectedNode.folder.color || DEFAULT_FOLDER_COLOR,
          canCreateFolder: (selectedFolderMeta?.depth ?? 0) < 1
        } satisfies InspectorContextMenuTarget)
      : selectedNode?.kind === "note" && selectedNode.note
        ? buildInspectorNoteContextTarget(selectedNode.note)
        : null;
  const contextMenuTarget = contextMenuState?.target ?? null;
  const contextMenuKindLabel = !contextMenuTarget
    ? ""
    : contextMenuTarget.kind === "folder"
      ? labels.folder
      : contextMenuTarget.kind === "canvas"
        ? labels.canvas
        : labels.note;
  const handleContextMenuColorChange = contextMenuTarget
    ? (color: string) => {
        closeInspectorContextMenu();

        if (contextMenuTarget.kind === "folder") {
          onUpdateFolderColor(contextMenuTarget.folder.id, color);
          return;
        }

        onUpdateNoteColor(contextMenuTarget.note.id, color);
      }
    : undefined;

  function renderFolderDraftErrorMessage() {
    if (isFolderDraftOpen || !folderDraftError) {
      return null;
    }

    return <p className="orbital-draft-error orbital-inline-error">{folderDraftError}</p>;
  }

  return (
    <section
      className="orbital-overlay"
      role="dialog"
      aria-modal="true"
      onPointerDown={markOrbitInteraction}
      onWheel={markOrbitInteraction}
    >
      <div className="orbital-backdrop" aria-hidden="true" />

      <header className="orbital-command-bar">
        <div className="orbital-command-content">
          <div className="orbital-command-title">
            <p className="orbital-command-kicker">{labels.title}</p>
            <h2 className="orbital-command-heading">{labels.subtitle}</h2>
          </div>

          <div className="orbital-command-status">
            <div className="orbital-command-vault">
              <LocalVaultSwitcher
                label={labels.localVault}
                activeLabel={t("sync.localVaultActive")}
                items={localVaultOptions}
                activeVaultId={activeLocalVaultId}
                onSelect={onSelectLocalVault}
                onCreate={onCreateLocalVault}
              />
            </div>

            <div className="orbital-command-chips">
              {autoFocusEnabled ? (
                <span className="orbital-context-pill orbital-context-pill-state is-autofocus">
                  {labels.autoFocus}
                </span>
              ) : null}
              {isSceneFocusActive ? (
                <span className="orbital-context-pill orbital-context-pill-state is-focus">
                  {labels.focusMode}
                </span>
              ) : null}
              {syncStatusChip ? (
                <span
                  className={`orbital-context-pill orbital-sync-pill is-${syncStatusChip.tone}`}
                  title={syncStatusChip.title ?? syncStatusChip.text}
                >
                  {syncStatusChip.text}
                </span>
              ) : null}
              {syncTransportChip ? (
                <span
                  className={`orbital-context-pill orbital-sync-pill orbital-sync-transport-pill is-${syncTransportChip.tone}`}
                  title={syncTransportChip.title ?? syncTransportChip.text}
                >
                  {syncTransportChip.text}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="orbital-command-actions" aria-label={labels.title}>
          <div className="orbital-command-group">
            <button
              type="button"
              className="orbital-command-button"
              onClick={() => setIsPaused((current) => !current)}
            >
              {isPaused ? labels.resume : labels.pause}
            </button>
          </div>

          {(trashModalSlot || settingsModalSlot) && (
            <div className="orbital-command-group">
              {trashModalSlot ? (
                <button type="button" className="orbital-command-button" onClick={() => setActiveModal("trash")}>
                  {labels.trash}
                </button>
              ) : null}
              {settingsModalSlot ? (
                <button type="button" className="orbital-command-button" onClick={() => setActiveModal("settings")}>
                  {labels.settings}
                </button>
              ) : null}
            </div>
          )}

          <div className="orbital-command-group">
            <button
              type="button"
              className="orbital-command-button orbital-command-button-icon"
              onClick={() => {
                stopCameraAnimation();
                setCamera((current) => ({
                  ...current,
                  scale: clamp(current.scale * 0.9, CAMERA_MIN_SCALE, CAMERA_MAX_SCALE)
                }));
              }}
              aria-label={labels.zoomOut}
              title={labels.zoomOut}
            >
              −
            </button>
            <button
              type="button"
              className="orbital-command-button orbital-command-button-icon"
              onClick={() => {
                stopCameraAnimation();
                setCamera((current) => ({
                  ...current,
                  scale: clamp(current.scale * 1.12, CAMERA_MIN_SCALE, CAMERA_MAX_SCALE)
                }));
              }}
              aria-label={labels.zoomIn}
              title={labels.zoomIn}
            >
              +
            </button>
            <button type="button" className="orbital-command-button" onClick={handleCenterSelection}>
              {labels.centerSelection}
            </button>
            <button type="button" className="orbital-command-button" onClick={handleResetCamera}>
              {labels.resetView}
            </button>
          </div>

          {showClose ? (
            <button type="button" className="orbital-command-button orbital-command-button-danger" onClick={onClose}>
              {labels.close}
            </button>
          ) : null}
        </div>
      </header>

      <div className="orbital-layout">
        <aside className="orbital-inspector panel" ref={inspectorPanelRef}>
          {!selectedNode && effectiveInspectorMenu === "overview" ? (
            overviewBody
          ) : !selectedNode || shouldShowHierarchyInspector ? (
            inspectorMenuBody
          ) : (
            <>
              {selectedNode.kind === "core" ? (
                <>
                  <div className="orbital-core-shell">
                    <div className="panel-head orbital-core-head">
                      <div className="orbital-core-head-copy">
                        <p className="panel-kicker">{labels.project}</p>
                        {renderEditableProjectTitle(
                          selectedNode.project,
                          labels.core,
                          "panel-title orbital-core-title"
                        )}
                      </div>
                    </div>

                    <section className="orbital-core-section orbital-core-actions-section">
                      <p className="panel-kicker orbital-core-section-kicker">{labels.create}</p>
                      <div className="orbital-core-action-list">
                        {renderInspectorCompactRow({
                          isActive: false,
                          onClick: () =>
                            beginFolderDraft(
                              null,
                              selectedNode.project?.id
                            ),
                          title: labels.addRootFolder,
                          icon: renderInspectorItemIcon(
                            "folder",
                            DEFAULT_FOLDER_COLOR
                          )
                        })}
                        {renderInspectorCompactRow({
                          isActive: false,
                          onClick: () =>
                            void handleCreateNote(
                              null,
                              selectedNode.project?.id
                            ),
                          title: labels.addNote,
                          icon: renderInspectorItemIcon(
                            "note",
                            DEFAULT_NOTE_COLOR
                          )
                        })}
                        {renderInspectorCompactRow({
                          isActive: false,
                          onClick: () =>
                            void handleCreateCanvas(
                              null,
                              selectedNode.project?.id
                            ),
                          title: labels.addCanvas,
                          icon: renderInspectorItemIcon(
                            "canvas",
                            selectedNode.project?.color ?? DEFAULT_PROJECT_COLOR
                          )
                        })}
                      </div>
                    </section>

                    <section className="orbital-core-section">
                      <p className="panel-kicker orbital-core-section-kicker">{labels.project}</p>
                      <div className="orbital-core-metric-list">
                        {renderInspectorStaticCompactRow({
                          title: labels.totalBodies,
                          count: inspectorProjectBodyCount,
                          icon: renderInspectorItemIcon(
                            "core",
                            selectedNode.project?.color ?? DEFAULT_PROJECT_COLOR
                          )
                        })}
                        {renderInspectorStaticCompactRow({
                          title: labels.foldersStat,
                          count: inspectorProjectFolders.length,
                          icon: renderInspectorItemIcon(
                            "folder",
                            DEFAULT_FOLDER_COLOR
                          )
                        })}
                        {renderInspectorStaticCompactRow({
                          title: labels.subfolders,
                          count: inspectorProjectSubfolderCount,
                          icon: renderInspectorItemIcon(
                            "folder",
                            selectedNode.project?.color ?? DEFAULT_FOLDER_COLOR
                          )
                        })}
                        {renderInspectorStaticCompactRow({
                          title: labels.notesStat,
                          count: inspectorProjectNoteCount,
                          icon: renderInspectorItemIcon(
                            "note",
                            DEFAULT_NOTE_COLOR
                          )
                        })}
                        {renderInspectorStaticCompactRow({
                          title: labels.canvas,
                          count: inspectorProjectCanvasCount,
                          icon: renderInspectorItemIcon(
                            "canvas",
                            selectedNode.project?.color ?? DEFAULT_PROJECT_COLOR
                          )
                        })}
                        {renderInspectorStaticCompactRow({
                          title: labels.assetsStat,
                          count: inspectorProjectAssets.length,
                          icon: renderInspectorItemIcon(
                            "file",
                            selectedNode.project?.color ?? DEFAULT_PROJECT_COLOR
                          )
                        })}
                      </div>
                    </section>

                    <section className="orbital-core-section orbital-core-color-section">
                      <p className="panel-kicker orbital-core-section-kicker">{labels.projectColor}</p>
                      <div className="orbital-color-field">
                        <div className="color-swatch-grid compact">
                          {COLOR_PALETTE.map((colorOption) => (
                            <button
                              key={colorOption.id}
                              type="button"
                              className={`color-swatch compact ${selectedNode.project?.color === colorOption.hex ? "is-active" : ""}`}
                              onClick={() => onUpdateProjectColor(selectedNode.project!.id, colorOption.hex)}
                              style={{ "--swatch-color": colorOption.hex } as CSSProperties}
                              aria-label={`${labels.projectColor}: ${t(colorOption.labelKey)}`}
                              title={t(colorOption.labelKey)}
                            >
                              <span className="color-swatch-fill" />
                            </button>
                          ))}
                        </div>
                        <label className="orbital-custom-color-picker">
                          <span className="orbital-color-label">{labels.customColor}</span>
                          <span className="orbital-custom-color-control">
                            <input
                              type="color"
                              className="orbital-custom-color-input"
                              value={selectedNode.project?.color ?? DEFAULT_PROJECT_COLOR}
                              onChange={(event) => onUpdateProjectColor(selectedNode.project!.id, event.target.value)}
                              aria-label={labels.customColor}
                            />
                            <span className="orbital-custom-color-value">
                              {(selectedNode.project?.color ?? DEFAULT_PROJECT_COLOR).toUpperCase()}
                            </span>
                          </span>
                        </label>
                      </div>
                    </section>

                    {selectedNode.project ? (
                      <div className="orbital-core-delete-row">
                        <button
                          type="button"
                          className="orbital-core-delete-button"
                          onClick={() => void onDeleteProject(selectedNode.project!.id)}
                        >
                          <span className="orbital-core-delete-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" focusable="false">
                              <path d="M7.8 8.5v8.3M12 8.5v8.3M16.2 8.5v8.3" />
                              <path d="M5.8 6.3h12.4" />
                              <path d="M9.1 4.7h5.8" />
                              <path d="M7.2 6.3v10.1c0 1.5 1 2.4 2.4 2.4h4.8c1.4 0 2.4-.9 2.4-2.4V6.3" />
                            </svg>
                          </span>
                          <span>{labels.deleteSystem}</span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : (
                <>
                  <section
                    className={`orbital-selection-shell orbital-selection-shell-${selectedNode.kind} ${
                      selectedEntryIsCanvas ? "is-canvas" : ""
                    }`}
                    style={{ "--selection-accent": selectedInspectorAccent } as CSSProperties}
                    onContextMenu={
                      selectedInspectorContextTarget
                        ? (event) => {
                            event.preventDefault();
                            openInspectorContextMenu(selectedInspectorContextTarget, "popover", {
                              x: event.clientX,
                              y: event.clientY
                            });
                          }
                        : undefined
                    }
                    onPointerDown={
                      selectedInspectorContextTarget
                        ? (event) => {
                            handleInspectorContextPointerDown(selectedInspectorContextTarget, event);
                          }
                        : undefined
                    }
                    onPointerMove={
                      selectedInspectorContextTarget
                        ? (event) => {
                            handleInspectorContextPointerMove(event);
                          }
                        : undefined
                    }
                    onPointerUp={
                      selectedInspectorContextTarget
                        ? (event) => {
                            handleInspectorContextPointerEnd(event.pointerId);
                          }
                        : undefined
                    }
                    onPointerLeave={
                      selectedInspectorContextTarget
                        ? (event) => {
                            handleInspectorContextPointerEnd(event.pointerId);
                          }
                        : undefined
                    }
                    onPointerCancel={
                      selectedInspectorContextTarget
                        ? (event) => {
                            handleInspectorContextPointerEnd(event.pointerId);
                          }
                        : undefined
                    }
                    onDoubleClick={
                      selectedNode.kind === "note"
                        ? () => {
                            closeSelectionHoverPreview();
                            onOpenNote(selectedNode.note!.id);
                          }
                        : undefined
                    }
                  >
                    <div className="orbital-selection-head">
                      <div className="orbital-selection-eyebrow-row">
                        <span className="orbital-selection-kindchip">
                          {selectedNode.kind === "folder"
                            ? labels.folder
                            : selectedEntryIsCanvas
                              ? labels.canvas
                              : labels.note}
                        </span>
                        {selectedNode.kind === "folder" ? (
                          <span className="orbital-selection-systemchip">{focusSystemLabel}</span>
                        ) : null}
                      </div>
                      {selectedInspectorContextTarget &&
                      isEditingInspectorTarget(selectedInspectorContextTarget) ? (
                        renderInspectorRenameField(
                          selectedInspectorContextTarget,
                          "orbital-menu-inline-input orbital-selection-title-input"
                        )
                      ) : (
                        <h2 className="orbital-selection-title">{selectedNode.label}</h2>
                      )}
                      <div className="orbital-selection-context-row">
                        {selectedNode.kind === "folder" ? (
                          <span className="orbital-path-chip orbital-path-chip-soft">
                            {selectedFolderLocation}
                          </span>
                        ) : (
                          <span className="orbital-selection-context-text">{selectedNoteFolder}</span>
                        )}
                        {selectedNode.kind === "note" && selectedNode.note ? (
                          <span className="orbital-selection-updated">
                            {labels.updated}: {formatTimestamp(selectedNode.note.updatedAt, language)}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {selectedNode.kind === "note" && selectedNode.note ? (
                      <>
                        <div className="orbital-selection-preview orbital-selection-preview-note">
                          <EntryStaticPreview
                            note={selectedNode.note}
                            emptyLabel={labels.empty}
                            resolveFileUrl={onResolveFileUrl}
                            compact
                            interactive={false}
                            labels={{
                              canvas: labels.canvas,
                              elements: labels.elementsStat,
                              images: labels.assetsStat,
                              emptyCanvas: labels.emptyCanvas
                            }}
                          />
                        </div>
                        <div className="orbital-selection-meta-line">
                          {selectedEntryIsCanvas && selectedCanvasMetrics ? (
                            <span className="orbital-selection-meta-chip">
                              {selectedCanvasMetrics.activeElementCount} {labels.elementsStat}
                            </span>
                          ) : null}
                          {isEntryFavorite(selectedNode.note) ? (
                            <span className="orbital-selection-badge">{t("note.pinnedActive")}</span>
                          ) : null}
                          {selectedEntryIsCanvas && selectedCanvasMetrics && selectedCanvasMetrics.imageCount > 0 ? (
                            <span className="orbital-selection-meta-chip">
                              {selectedCanvasMetrics.imageCount} {labels.assetsStat}
                            </span>
                          ) : null}
                          {selectedNoteAssetCount > 0 && !selectedEntryIsCanvas ? (
                            <span className="orbital-selection-meta-chip">
                              {selectedNoteAssetCount} {labels.assetsStat}
                            </span>
                          ) : null}
                        </div>
                        {selectedNoteVisibleTags.length > 0 ? (
                          <div className="orbital-selection-tags">
                            {selectedNoteVisibleTags.map((tagName) => (
                              <span className="orbital-selection-tag" key={tagName}>
                                {tagName}
                              </span>
                            ))}
                            {selectedNoteHiddenTagCount > 0 ? (
                              <span className="orbital-selection-tag">+{selectedNoteHiddenTagCount}</span>
                            ) : null}
                          </div>
                        ) : null}
                      </>
                    ) : null}

                    {selectedNode.kind === "folder" && selectedFolderMeta ? (
                      <div className="orbital-selection-stats">
                        <div className="orbital-selection-stat">
                          <strong>{selectedFolderMeta.directNoteCount}</strong>
                          <span>{labels.directNotes}</span>
                        </div>
                        <div className="orbital-selection-stat">
                          <strong>{selectedFolderMeta.descendantFolderCount}</strong>
                          <span>{labels.subfolders}</span>
                        </div>
                        <div className="orbital-selection-stat">
                          <strong>{selectedFolderMeta.descendantNoteCount}</strong>
                          <span>{labels.descendants}</span>
                        </div>
                      </div>
                    ) : null}
                  </section>

                  <div
                    className={`orbital-meta-card orbital-selection-tools ${
                      selectedNode.kind === "note" ? "is-note" : ""
                    }`}
                  >
                    <div className="orbital-color-field orbital-color-field-tight">
                      <span className="orbital-color-label">
                        {selectedNode.kind === "folder" ? labels.folderColor : labels.noteColor}
                      </span>
                      <div className="color-swatch-grid compact">
                        {COLOR_PALETTE.map((colorOption) => (
                          <button
                            key={colorOption.id}
                            type="button"
                            className={`color-swatch compact ${
                              (selectedNode.kind === "folder"
                                ? selectedNode.folder?.color
                                : selectedNode.note?.color) === colorOption.hex
                                ? "is-active"
                                : ""
                            }`}
                            onClick={() =>
                              selectedNode.kind === "folder"
                                ? onUpdateFolderColor(selectedNode.folder!.id, colorOption.hex)
                                : onUpdateNoteColor(selectedNode.note!.id, colorOption.hex)
                            }
                            style={{ "--swatch-color": colorOption.hex } as CSSProperties}
                            aria-label={`${
                              selectedNode.kind === "folder" ? labels.folderColor : labels.noteColor
                            }: ${t(colorOption.labelKey)}`}
                            title={t(colorOption.labelKey)}
                          >
                            <span className="color-swatch-fill" />
                          </button>
                        ))}
                      </div>
                      <label className="orbital-custom-color-picker">
                        <span className="orbital-color-label">{labels.customColor}</span>
                        <span className="orbital-custom-color-control">
                          <input
                            type="color"
                            className="orbital-custom-color-input"
                            value={
                              selectedNode.kind === "folder"
                                ? selectedNode.folder?.color ?? DEFAULT_FOLDER_COLOR
                                : selectedNode.note?.color ?? DEFAULT_NOTE_COLOR
                            }
                            onChange={(event) =>
                              selectedNode.kind === "folder"
                                ? onUpdateFolderColor(selectedNode.folder!.id, event.target.value)
                                : onUpdateNoteColor(selectedNode.note!.id, event.target.value)
                            }
                            aria-label={labels.customColor}
                          />
                          <span className="orbital-custom-color-value">
                            {(
                              selectedNode.kind === "folder"
                                ? selectedNode.folder?.color ?? DEFAULT_FOLDER_COLOR
                                : selectedNode.note?.color ?? DEFAULT_NOTE_COLOR
                            ).toUpperCase()}
                          </span>
                        </span>
                      </label>
                    </div>
                  </div>

                  <div className="orbital-danger-actions">
                    {selectedNode.kind === "folder" && selectedNode.folder ? (
                      <button
                        className="toolbar-action danger"
                        onClick={() => void onDeleteFolder(selectedNode.folder!.id)}
                      >
                        {labels.deleteFolder}
                      </button>
                    ) : null}
                    {selectedNode.kind === "note" && selectedNode.note ? (
                      <button
                        className="toolbar-action danger"
                        onClick={() => void onDeleteNote(selectedNode.note!.id)}
                      >
                        {labels.moveToTrash}
                      </button>
                    ) : null}
                  </div>
                </>
              )}

              {selectedNode.kind !== "core" ? (
                <div className="orbital-action-stack orbital-action-stack-compact">
                  {selectedNode.kind === "note" && selectedNode.note ? (
                    <button className="primary-action" onClick={() => onOpenNote(selectedNode.note!.id)}>
                      {selectedEntryIsCanvas ? labels.openCanvas : labels.openNote}
                    </button>
                  ) : null}

                  {selectedNode.kind === "folder" ? (
                    <>
                      {(selectedFolderMeta?.depth ?? 0) < 1 ? (
                        <button
                          className="primary-action"
                          onClick={() =>
                            beginFolderDraft(
                              selectedNode.folder!.id,
                              selectedNode.folder?.projectId
                            )
                          }
                        >
                          {labels.addChildFolder}
                        </button>
                      ) : null}
                      <button
                        className="toolbar-action"
                        onClick={() =>
                          void handleCreateNote(
                            selectedNode.folder!.id,
                            selectedNode.folder?.projectId
                          )
                        }
                      >
                        {labels.addNote}
                      </button>
                      <button
                        className="toolbar-action"
                        onClick={() =>
                          void handleCreateCanvas(
                            selectedNode.folder!.id,
                            selectedNode.folder?.projectId
                          )
                        }
                      >
                        {labels.addCanvas}
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}

              {selectedNode.kind !== "core" ? (
                <p className="orbital-hints">{labels.hints}</p>
              ) : null}
            </>
          )}

          {!(!selectedNode || shouldShowHierarchyInspector) ? renderFolderDraftErrorMessage() : null}
        </aside>

        <div className="orbital-scene-wrap" onWheel={handleWheel}>
          <div className="orbital-filter-dock">
            <div className="orbital-filter-shell">
              <div className="orbital-filter-topline">
                <label className="orbital-searchbar" aria-label={labels.searchPlaceholder}>
                  <span className="orbital-searchbar-mark">Q</span>
                  <input
                    value={filterQuery}
                    onChange={(event) => setFilterQuery(event.target.value)}
                    placeholder={labels.searchPlaceholder}
                  />
                </label>

                {hasActiveFilter ? (
                  <button className="toolbar-action orbital-filter-clear" onClick={clearFilters}>
                    {labels.clearFilters}
                  </button>
                ) : null}
              </div>

              <div className="orbital-filter-chiprow">
                {currentProject ? (
                  <span className="orbital-filter-chip orbital-filter-chip-project">
                    <span
                      className="orbital-filter-chip-dot"
                      style={{ "--pill-color": currentProject.color } as CSSProperties}
                    />
                    <span>{currentProject.name}</span>
                  </span>
                ) : null}
                <span className="orbital-filter-chip is-success">
                  {labels.visibleBodies}: {visibleBodies}
                </span>
                {hiddenBodies > 0 ? (
                  <span className="orbital-filter-chip is-warning">
                    {labels.hiddenBodies}: {hiddenBodies}
                  </span>
                ) : null}
                <span className={`orbital-filter-chip ${isSceneFocusActive ? "is-accent" : ""}`}>
                  {isSceneFocusActive ? labels.focusMode : labels.showAll}
                </span>
              </div>
            </div>
          </div>

          <svg
            viewBox={`${VIEWBOX.minX} ${VIEWBOX.minY} ${VIEWBOX.width} ${VIEWBOX.height}`}
            className="orbital-scene"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={(event) => releaseDrag(event.pointerId)}
            onPointerCancel={(event) => releaseDrag(event.pointerId)}
          >
            <g className="orbital-starfield">
              {stars.map((star) => (
                <circle
                  key={star.id}
                  cx={star.x}
                  cy={star.y}
                  r={star.r}
                  opacity={star.opacity}
                  fill="#f6f1ff"
                />
              ))}
            </g>

            <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.scale})`}>
              {scene.links.map((link) => {
                const linkSelected =
                  link.entityId === selectedEntityId || link.parentEntityId === selectedEntityId;
                const linkEmphasisPrimary = selectedPrimaryEntityIds.has(link.entityId);
                const linkEmphasisRelated =
                  !linkEmphasisPrimary && selectedSecondaryEntityIds.has(link.entityId);
                const linkEmphasis = linkEmphasisPrimary || linkEmphasisRelated;
                const linkPassiveHighlight = passivePinnedHighlightEntityIds.has(link.entityId);
                const linkFilterPrimary = filterPrimaryEntityIds.has(link.entityId);
                const linkFilterRelated =
                  !linkFilterPrimary && filterSecondaryEntityIds.has(link.entityId);
                const linkFilterMatch = linkFilterPrimary || linkFilterRelated;
                const linkFilterMuted = hasActiveFilter && !linkFilterMatch && !linkSelected;

                return (
                  <line
                    key={link.id}
                    x1={link.x1}
                    y1={link.y1}
                    x2={link.x2}
                    y2={link.y2}
                    style={{ "--path-color": link.color } as CSSProperties}
                    className={`orbital-link orbital-link-${link.kind} orbital-link-depth-${Math.min(link.depth, 3)} ${linkEmphasis ? "is-emphasis" : "is-muted"} ${linkEmphasisRelated ? "is-related-emphasis" : ""} ${linkPassiveHighlight ? "is-passive-highlight" : ""} ${linkSelected ? "is-selected" : ""} ${linkFilterPrimary ? "is-filter-match" : ""} ${linkFilterRelated ? "is-filter-related" : ""} ${linkFilterMuted ? "is-filter-muted" : ""}`}
                  />
                );
              })}

              {scene.orbits.map((orbit) => {
                const orbitSelected = orbit.entityId === selectedEntityId;
                const orbitEmphasisPrimary = selectedPrimaryEntityIds.has(orbit.entityId);
                const orbitEmphasisRelated =
                  !orbitEmphasisPrimary && selectedSecondaryEntityIds.has(orbit.entityId);
                const orbitEmphasis = orbitEmphasisPrimary || orbitEmphasisRelated;
                const orbitPassiveHighlight = passivePinnedHighlightEntityIds.has(orbit.entityId);
                const orbitFilterPrimary = filterPrimaryEntityIds.has(orbit.entityId);
                const orbitFilterRelated =
                  !orbitFilterPrimary && filterSecondaryEntityIds.has(orbit.entityId);
                const orbitFilterMatch = orbitFilterPrimary || orbitFilterRelated;
                const orbitFilterMuted = hasActiveFilter && !orbitFilterMatch && !orbitSelected;

                return (
                  <ellipse
                    key={orbit.id}
                    cx={orbit.x}
                    cy={orbit.y}
                    rx={orbit.rx}
                    ry={orbit.ry}
                    transform={`rotate(${orbit.rotation} ${orbit.x} ${orbit.y})`}
                    style={{ "--path-color": orbit.color } as CSSProperties}
                    className={`orbital-orbit orbital-orbit-depth-${Math.min(orbit.depth, 3)} orbital-orbit-${orbit.kind} ${orbitEmphasis ? "is-emphasis" : "is-muted"} ${orbitEmphasisRelated ? "is-related-emphasis" : ""} ${orbitPassiveHighlight ? "is-passive-highlight" : ""} ${orbitSelected ? "is-selected" : ""} ${orbitFilterPrimary ? "is-filter-match" : ""} ${orbitFilterRelated ? "is-filter-related" : ""} ${orbitFilterMuted ? "is-filter-muted" : ""}`}
                  />
                );
              })}

              {scene.nodes.map((node) => {
                const isSelected = node.entityId === selectedEntityId;
                const isEmphasisPrimary = selectedPrimaryEntityIds.has(node.entityId);
                const isEmphasisRelated =
                  !isEmphasisPrimary && selectedSecondaryEntityIds.has(node.entityId);
                const isEmphasis = isEmphasisPrimary || isEmphasisRelated;
                const isPassiveHighlight = passivePinnedHighlightEntityIds.has(node.entityId);
                const isFilterPrimary = filterPrimaryEntityIds.has(node.entityId);
                const isFilterRelated =
                  !isFilterPrimary && filterSecondaryEntityIds.has(node.entityId);
                const isFilterMatch = isFilterPrimary || isFilterRelated;
                const isFilterMuted = hasActiveFilter && !isFilterMatch && !isSelected;
                const labelText = truncateLabel(node.label, 24);
                const labelWidth = estimateLabelWidth(labelText);
                const showLabel =
                  node.kind === "core" ||
                  isSelected ||
                  isFilterPrimary ||
                  isFilterRelated ||
                  isEmphasis ||
                  isPassiveHighlight ||
                  (!isSceneBudgetConstrained &&
                    (node.depth <= 1 || (node.kind === "folder" && node.radius >= 28)));

                return (
                  <g
                    key={node.id}
                    data-orbital-node="true"
                    className={`orbital-node orbital-node-${node.kind} ${
                      node.note?.contentType === "canvas" ? "is-canvas-entry" : ""
                    } ${isSelected ? "is-selected" : ""} ${isEmphasis ? "is-emphasis" : "is-muted"} ${isEmphasisRelated ? "is-related-emphasis" : ""} ${isPassiveHighlight ? "is-passive-highlight" : ""} ${isFilterPrimary ? "is-filter-match" : ""} ${isFilterRelated ? "is-filter-related" : ""} ${isFilterMuted ? "is-filter-muted" : ""}`}
                    style={{ "--node-color": node.color } as CSSProperties}
                    transform={`translate(${node.x} ${node.y})`}
                    onPointerDown={(event) => {
                      if (node.kind !== "core" || !node.project) {
                        return;
                      }

                      event.stopPropagation();
                      stopCameraAnimation();
                      setSelectedEntityId(node.entityId);
                      setActiveProjectId(node.project.id);
                      dragRef.current = {
                        mode: "project",
                        pointerId: event.pointerId,
                        projectId: node.project.id,
                        startX: event.clientX,
                        startY: event.clientY,
                        originProjectX: node.project.x,
                        originProjectY: node.project.y,
                        hasMoved: false
                      };
                      event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedEntityId(node.entityId);
                      if (node.kind !== "core") {
                        openInspectorMenu("folders");
                      }
                      if (node.project) {
                        setActiveProjectId(node.project.id);
                      } else if (node.folder) {
                        setActiveProjectId(node.folder.projectId);
                      } else if (node.note) {
                        setActiveProjectId(node.note.projectId);
                      }
                    }}
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      setSelectedEntityId(node.entityId);
                      if (node.kind !== "core") {
                        openInspectorMenu("folders");
                      }
                      if (node.note) {
                        closeSelectionHoverPreview();
                        onOpenNote(node.note.id);
                      } else {
                        animateCameraTo({
                          x: -node.x,
                          y: -node.y
                        }, 560);
                      }
                    }}
                    onPointerEnter={
                      node.note
                        ? (event) => {
                            openSelectionHoverPreview(
                              node.note!.id,
                              event.clientX,
                              event.clientY,
                              "scene",
                              {
                                sceneAnchorElement: event.currentTarget
                              }
                            );
                          }
                        : undefined
                    }
                    onPointerMove={
                      node.note
                        ? (event) => {
                            updateSelectionHoverPreviewCursor(event.clientX, event.clientY, {
                              sceneAnchorElement: event.currentTarget
                            });
                          }
                        : undefined
                    }
                    onPointerLeave={
                      node.note
                        ? () => {
                            scheduleSelectionHoverPreviewClose();
                          }
                        : undefined
                    }
                    onPointerCancel={
                      node.note
                        ? () => {
                            scheduleSelectionHoverPreviewClose();
                          }
                        : undefined
                    }
                  >
                    {node.kind === "core" ? (
                      <>
                        <circle r={node.radius * 2.24} className="orbital-core-corona" />
                        <g transform={`rotate(${coreFlareRotation})`}>
                          <polygon
                            points={buildStarburstPoints(node.radius * 1.06, node.radius * 1.82, 10)}
                            className="orbital-core-flare"
                          />
                          <polygon
                            points={buildStarburstPoints(node.radius * 0.96, node.radius * 1.56, 8)}
                            className="orbital-core-flare secondary"
                            transform="rotate(22)"
                          />
                        </g>
                        <circle r={node.radius * 1.28} className="orbital-node-aura" />
                        <circle r={node.radius} className="orbital-core-disc" />
                        <circle r={node.radius * 0.58} className="orbital-core-pulse" />
                      </>
                    ) : null}

                    {node.kind === "folder" ? (
                      <>
                        <circle r={node.radius * 1.38} className="orbital-node-aura" />
                        <circle r={node.radius} className="orbital-folder-disc" />
                        <circle r={node.radius * 0.42} className="orbital-folder-core" />
                      </>
                    ) : null}

                    {node.kind === "note" ? (
                      node.note?.contentType === "canvas" ? (
                        <>
                          <circle r={node.radius * 1.16} className="orbital-node-aura note-aura" />
                          <rect
                            x={-node.radius * 1.04}
                            y={-node.radius * 0.86}
                            width={node.radius * 2.08}
                            height={node.radius * 1.72}
                            rx={node.radius * 0.28}
                            className="orbital-canvas-disc"
                          />
                          <rect
                            x={-node.radius * 0.7}
                            y={-node.radius * 0.5}
                            width={node.radius * 1.4}
                            height={node.radius}
                            rx={node.radius * 0.18}
                            className="orbital-canvas-core"
                          />
                          <path
                            d={`M ${-node.radius * 0.44} ${-node.radius * 0.08} H ${node.radius * 0.44} M ${-node.radius * 0.44} ${node.radius * 0.18} H ${node.radius * 0.44}`}
                            className="orbital-canvas-lines"
                          />
                          <circle
                            cx={node.radius * 0.78}
                            cy={-node.radius * 0.72}
                            r="3.2"
                            className="orbital-canvas-beacon"
                          />
                        </>
                      ) : (
                        <>
                          <circle r={node.radius * 1.14} className="orbital-node-aura note-aura" />
                          <rect
                            x={-node.radius}
                            y={-node.radius}
                            width={node.radius * 2}
                            height={node.radius * 2}
                            rx={node.radius * 0.18}
                            className="orbital-note-disc"
                            transform="rotate(45)"
                          />
                          <rect
                            x={-node.radius * 0.52}
                            y={-node.radius * 0.52}
                            width={node.radius * 1.04}
                            height={node.radius * 1.04}
                            rx={node.radius * 0.1}
                            className="orbital-note-core"
                            transform="rotate(45)"
                          />
                          {isEntryFavorite(node) ? (
                            <circle
                              cx={-node.radius * 0.92}
                              cy={node.radius * 0.92}
                              r="2.8"
                              className="orbital-pinned-signal"
                            />
                          ) : null}
                        </>
                      )
                    ) : null}

                    {isSelected ? <circle r={node.radius * 1.82} className="orbital-selection-ring" /> : null}

                    {showLabel ? (
                      <g
                        className={`orbital-label-group orbital-label-group-${node.kind} ${isSelected ? "is-selected" : ""} ${isEmphasis ? "is-emphasis" : "is-muted"} ${isEmphasisRelated ? "is-related-emphasis" : ""} ${isPassiveHighlight ? "is-passive-highlight" : ""} ${isFilterPrimary ? "is-filter-match" : ""} ${isFilterRelated ? "is-filter-related" : ""} ${isFilterMuted ? "is-filter-muted" : ""}`}
                        transform={`translate(0 ${node.radius + 24})`}
                      >
                        <rect
                          x={-labelWidth / 2}
                          y={-14}
                          width={labelWidth}
                          height={24}
                          rx={12}
                          className="orbital-label-badge"
                        />
                        <text y={2} textAnchor="middle" className="orbital-label-text">
                          {labelText}
                        </text>
                      </g>
                    ) : null}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>

      </div>

      {hoverPreviewNote && hoverPreviewPosition ? (
        <div
          className="orbital-note-hovercard"
          style={{
            left: hoverPreviewPosition.left,
            top: hoverPreviewPosition.top,
            width: hoverPreviewPosition.width,
            height: hoverPreviewPosition.height,
            "--hovercard-accent": hoverPreviewAccent,
            "--hovercard-placement": hoverPreviewPosition.placement
          } as CSSProperties}
          onPointerEnter={clearHoverPreviewCloseTimeout}
          onPointerLeave={scheduleSelectionHoverPreviewClose}
        >
          <div className="orbital-note-hovercard-head">
            <p className="panel-kicker">
              {hoverPreviewNote.contentType === "canvas" ? labels.canvas : labels.note}
            </p>
            <h3>{hoverPreviewNote.title}</h3>
            <div className="orbital-note-hovercard-meta">
              <span>{hoverPreviewFolder}</span>
              <span>{labels.updated}: {formatTimestamp(hoverPreviewNote.updatedAt, language)}</span>
            </div>
          </div>
          <div className="orbital-note-hovercard-scroll" ref={noteHoverPreviewScrollRef}>
            <EntryStaticPreview
              note={hoverPreviewNote}
              emptyLabel={labels.empty}
              resolveFileUrl={onResolveFileUrl}
              interactive
              className="orbital-note-hovercard-copy"
              labels={{
                canvas: labels.canvas,
                elements: labels.elementsStat,
                images: labels.assetsStat,
                emptyCanvas: labels.emptyCanvas
              }}
            />
          </div>
        </div>
      ) : null}

      {contextMenuTarget ? (
        <OrbitalInspectorContextMenu
          open
          presentation={contextMenuState?.presentation ?? "popover"}
          position={contextMenuState?.position}
          accentColor={contextMenuTarget.color}
          title={contextMenuTarget.label}
          kindLabel={contextMenuKindLabel}
          actions={contextMenuActions}
          colorOptions={contextMenuColorOptions}
          activeColor={contextMenuTarget.color}
          chooseColorLabel={labels.chooseColor}
          customColorLabel={labels.customColor}
          closeLabel={labels.cancel}
          onClose={closeInspectorContextMenu}
          onColorChange={handleContextMenuColorChange}
        />
      ) : null}

      {editorOpen ? (
        <div
          className={`orbital-modal-layer orbital-editor-modal-layer ${
            editorMode === "canvas" ? "is-canvas-mode" : ""
          } ${editorMode === "note" ? "is-note-mode" : ""} ${
            isCanvasEditorFullscreen ? "is-canvas-fullscreen" : ""
          }`}
          role="dialog"
          aria-modal="true"
        >
          <button
            className="orbital-modal-dim"
            aria-label={labels.closeEditor}
            onClick={onCloseEditor}
          />
          <div
            ref={editorModalRef}
            className={`orbital-modal-window orbital-editor-modal-window ${
              editorMode === "canvas" ? "is-canvas-mode" : ""
            } ${editorMode === "note" ? "is-note-mode" : ""} ${
              isCanvasEditorFullscreen ? "is-canvas-fullscreen" : ""
            }`}
            style={
              {
                "--editor-modal-accent": editorAccentColor || DEFAULT_NOTE_COLOR
              } as CSSProperties
            }
          >
            <div
              className={`orbital-editor-topbar ${editorMode === "canvas" ? "is-canvas-mode" : ""} ${
                editorMode === "note" ? "is-note-mode" : ""
              }`}
              aria-label={editorMode === "canvas" ? labels.openCanvas : labels.openNote}
            >
              <div
                className={`orbital-editor-topactions ${editorMode === "canvas" ? "is-canvas-mode" : ""} ${
                  editorMode === "note" ? "is-note-mode" : ""
                }`}
              >
                {editorMode === "canvas" ? (
                  <button
                    className="toolbar-action orbital-toolbar-action"
                    onClick={() => void toggleCanvasEditorFullscreen()}
                  >
                    {isCanvasEditorFullscreen ? labels.exitFullscreen : labels.enterFullscreen}
                  </button>
                ) : null}
                <button
                  className="toolbar-action danger orbital-editor-close-action"
                  onClick={onCloseEditor}
                  aria-label={labels.closeEditor}
                  title={labels.closeEditor}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            </div>
            <div
              className={`orbital-editor-scroll ${editorMode === "canvas" ? "is-canvas-mode" : ""} ${
                editorMode === "note" ? "is-note-mode" : ""
              }`}
            >
              {editorSlot}
            </div>
          </div>
        </div>
      ) : null}

      {activeModal ? (
        <div className="orbital-modal-layer" role="dialog" aria-modal="true">
          <button
            className="orbital-modal-dim"
            aria-label={labels.closeModal}
            onClick={() => setActiveModal(null)}
          />
          <div
            className={`orbital-modal-window orbital-utility-modal-window ${
              activeModal === "settings" ? "is-settings-mode" : "is-trash-mode"
            }`}
          >
            <div className="orbital-utility-modal-head">
              <div className="orbital-utility-modal-heading">
                <p className="panel-kicker orbital-utility-modal-kicker">
                  {activeModal === "settings" ? labels.settings : labels.trash}
                </p>
              </div>
              <button
                className="toolbar-action orbital-utility-modal-close"
                onClick={() => setActiveModal(null)}
              >
                {labels.closeModal}
              </button>
            </div>
            <div className="orbital-modal-content orbital-utility-modal-content">
              {activeModal === "settings" ? settingsModalSlot : trashModalSlot}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
