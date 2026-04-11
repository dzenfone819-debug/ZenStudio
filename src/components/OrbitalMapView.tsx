import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent
} from "react";
import { useTranslation } from "react-i18next";

import EntryStaticPreview from "./EntryStaticPreview";
import "./OrbitalChrome.css";
import {
  COLOR_PALETTE,
  DEFAULT_FOLDER_COLOR,
  DEFAULT_NOTE_COLOR,
  DEFAULT_PROJECT_COLOR
} from "../lib/palette";
import { getCanvasMetrics } from "../lib/canvas";
import { buildFolderPathMap, formatTimestamp } from "../lib/notes";
import type { AppLanguage, Asset, Folder, Note, Project, Tag } from "../types";

type SceneNodeKind = "core" | "folder" | "note";
type OrbitalChild = { folder?: FolderBranch; note?: Note };
type InspectorMenu = "overview" | "notes" | "folders" | "tags" | "files" | "pinned" | "colors";

interface OrbitalMapViewProps {
  projects: Project[];
  folders: Folder[];
  notes: Note[];
  tags: Tag[];
  assets: Asset[];
  assetCount: number;
  language: AppLanguage;
  editorOpen: boolean;
  editorMode?: Note["contentType"] | null;
  editorSlot: ReactNode;
  editorTitle?: string;
  syncModalSlot?: ReactNode;
  trashModalSlot?: ReactNode;
  showClose?: boolean;
  onClose: () => void;
  onCloseEditor: () => void;
  onCreateProject: (x: number, y: number) => Promise<Project>;
  onUpdateProjectPosition: (projectId: string, x: number, y: number) => void;
  onUpdateProjectColor: (projectId: string, color: string) => void;
  onCreateFolder: (
    name: string,
    parentId: string | null,
    color?: string,
    projectId?: string
  ) => Promise<Folder>;
  onUpdateFolderColor: (folderId: string, color: string) => void;
  onUpdateNoteColor: (noteId: string, color: string) => void;
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
    sync: string;
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
    notesStat: string;
    elementsStat: string;
    foldersStat: string;
    tagsStat: string;
    assetsStat: string;
    pinnedStat: string;
    colorsStat: string;
    projectsStat: string;
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

const VIEWBOX = {
  minX: -980,
  minY: -720,
  width: 1960,
  height: 1440
};

const CAMERA_MIN_SCALE = 0.45;
const CAMERA_MAX_SCALE = 2.2;
const FOCUS_AUTO_THRESHOLD = 34;
const PROJECT_MIN_DISTANCE = 430;
const ORBIT_INTERACTION_WINDOW_MS = 1800;
const ORBIT_ACTIVE_FRAME_MS = 1000 / 18;
const ORBIT_IDLE_FRAME_MS = 1000 / 10;
const ORBIT_ACTIVE_FRAME_MS_LARGE = 1000 / 14;
const ORBIT_IDLE_FRAME_MS_LARGE = 1000 / 7;

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

function getOrbitSlot(index: number) {
  let remaining = index;
  let ringIndex = 0;
  let capacity = 6;

  while (remaining >= capacity) {
    remaining -= capacity;
    ringIndex += 1;
    capacity += 4;
  }

  return {
    ringIndex,
    slotIndex: remaining,
    capacity
  };
}

function noteSorter(left: Note, right: Note) {
  if (left.favorite !== right.favorite) {
    return left.favorite ? -1 : 1;
  }

  if (left.pinned !== right.pinned) {
    return left.pinned ? -1 : 1;
  }

  return right.updatedAt - left.updatedAt;
}

function getNoteMass(note: Note) {
  if (note.contentType === "canvas") {
    const metrics = getCanvasMetrics(note.canvasContent, { includePlainText: false });
    return (
      1.18 +
      metrics.activeElementCount / 18 +
      metrics.imageCount * 0.28 +
      (note.favorite ? 0.45 : 0) +
      (note.pinned ? 0.3 : 0)
    );
  }

  return 1.08 + note.plainText.length / 240 + (note.favorite ? 0.45 : 0) + (note.pinned ? 0.3 : 0);
}

function getOrbitalEntryRadius(note: Note) {
  if (note.contentType === "canvas") {
    const metrics = getCanvasMetrics(note.canvasContent, { includePlainText: false });
    return clamp(
      10 + Math.min(metrics.activeElementCount / 6, 7.2) + (note.pinned ? 1.2 : 0),
      10,
      18
    );
  }

  return clamp(9 + Math.min(note.plainText.length / 180, 6.4) + (note.pinned ? 1.2 : 0), 9, 17);
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

function getProjectEntityId(projectId: string) {
  return `project:${projectId}`;
}

function buildOrbitalData(projects: Project[], folders: Folder[], notes: Note[]): OrbitalData {
  const visibleNotes = notes
    .filter((note) => note.trashedAt === null && !note.archived)
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
    const scopedChildren = visibleEntityIds
      ? children.filter((child) => visibleEntityIds.has(getChildEntityId(child)))
      : children;

    if (scopedChildren.length === 0) {
      return [];
    }

    const folderChildren = scopedChildren.filter((child) => child.folder);
    const noteChildren = scopedChildren.filter((child) => child.note);
    const folderRingSpan =
      folderChildren.length > 0 ? getOrbitSlot(folderChildren.length - 1).ringIndex + 1 : 0;
    const nodes: OrbitalLayoutNode[] = [];

    const renderGroup = (group: OrbitalChild[], bandOffset: number) => {
      group.forEach((child, index) => {
        const entityId = getChildEntityId(child);
        const seed = hashString(entityId);
        const slot = getOrbitSlot(index);
        const mass = child.folder?.mass ?? getNoteMass(child.note!);
        const kind: SceneNodeKind = child.folder ? "folder" : "note";
        const bandIndex = slot.ringIndex + bandOffset;
        const isRootFolderOrbit = parent.kind === "core" && kind === "folder";
        const ringSpacing = parent.kind === "core" ? 132 : 112;
        const orbitSpread = parent.kind === "core" ? 18 : 15;
        const centeredSlotOffset = isRootFolderOrbit
          ? 0
          : (slot.slotIndex - (slot.capacity - 1) / 2) * orbitSpread;
        const rootOrbitOffset = isRootFolderOrbit ? index * 42 : 0;
        const baseRadius =
          parent.radius +
          (parent.kind === "core" ? 232 : 154) +
          depth * 28 +
          bandIndex * ringSpacing +
          centeredSlotOffset +
          rootOrbitOffset +
          (kind === "note" ? 18 : 0);
        const rx = Math.max(
          parent.radius + 64,
          baseRadius +
            (((seed >> 5) % (isRootFolderOrbit ? 7 : 9)) - (isRootFolderOrbit ? 3 : 4)) *
              (isRootFolderOrbit ? 4 : 6)
        );
        const orbitRatio =
          (parent.kind === "core" ? 0.6 : kind === "folder" ? 0.8 : 0.74) +
          ((((seed >> 9) % 7) - 3) * 0.016);
        const ry = Math.max(parent.radius + 42, rx * orbitRatio);
        const rotation = (((seed >> 3) % 70) - 35) * (parent.kind === "core" ? 0.38 : 0.58);
        const speedSeed = seededUnit(seed, 11);
        const speedRange =
          parent.kind === "core"
            ? { min: 0.000022, max: 0.000049 }
            : { min: 0.000018, max: 0.000041 };
        const bandDrag = Math.max(0.72, 1 - bandIndex * 0.045);
        const speed =
          (speedRange.min + (speedRange.max - speedRange.min) * speedSeed) * bandDrag;
        const direction = (seed % 2 === 0 ? 1 : -1) as 1 | -1;
        const baseAngle =
          ((Math.PI * 2) / Math.max(slot.capacity, 1)) * slot.slotIndex +
          ((hashString(`${parent.entityId}:${kind}:${Math.round(bandIndex * 10)}`) % 360) *
            Math.PI) /
            180;
        const label = child.folder?.folder.name ?? child.note?.title ?? "";
        const radius = child.folder
          ? clamp(14 + child.folder.mass * 1.5, 15, 40)
          : getOrbitalEntryRadius(child.note!);
        const color = child.folder?.folder.color ?? child.note?.color ?? DEFAULT_NOTE_COLOR;
        const rotationRad = (rotation * Math.PI) / 180;
        const node: OrbitalLayoutNode = {
          id: entityId,
          entityId,
          parentEntityId: parent.entityId,
          kind,
          label,
          radius,
          color,
          depth,
          folder: child.folder?.folder,
          note: child.note,
          mass,
          favorite: child.note?.favorite,
          pinned: child.note?.pinned,
          orbit: {
            color,
            rx,
            ry,
            rotation,
            rotationCos: Math.cos(rotationRad),
            rotationSin: Math.sin(rotationRad),
            speed,
            direction,
            baseAngle,
            wobble: ((((seed >> 14) % 240) - 120) / 120) * 0.08
          },
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
    };

    renderGroup(folderChildren, 0);
    renderGroup(noteChildren, folderRingSpan > 0 ? folderRingSpan + 1.2 : 1.2);
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
  editorOpen,
  editorMode = null,
  editorSlot,
  editorTitle,
  syncModalSlot,
  trashModalSlot,
  showClose = true,
  onClose,
  onCloseEditor,
  onCreateProject,
  onUpdateProjectPosition,
  onUpdateProjectColor,
  onCreateFolder,
  onUpdateFolderColor,
  onUpdateNoteColor,
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
  const [focusModeOverride, setFocusModeOverride] = useState<boolean | null>(null);
  const [isFolderDraftOpen, setIsFolderDraftOpen] = useState(false);
  const [folderDraftParentId, setFolderDraftParentId] = useState<string | null>(null);
  const [folderDraftProjectId, setFolderDraftProjectId] = useState<string | null>(null);
  const [folderDraft, setFolderDraft] = useState("");
  const [folderDraftColor, setFolderDraftColor] = useState<string>(DEFAULT_FOLDER_COLOR);
  const [folderDraftError, setFolderDraftError] = useState<string | null>(null);
  const [projectPositionDrafts, setProjectPositionDrafts] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const [activeModal, setActiveModal] = useState<"sync" | "trash" | null>(null);
  const [isCanvasEditorFullscreen, setIsCanvasEditorFullscreen] = useState(false);
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState !== "hidden"
  );
  const [isOrbitInteractionActive, setIsOrbitInteractionActive] = useState(true);
  const [filterQuery, setFilterQuery] = useState("");
  const [activeColorFilters, setActiveColorFilters] = useState<string[]>([]);
  const [activeTagFilters, setActiveTagFilters] = useState<string[]>([]);
  const [activeFolderFilters, setActiveFolderFilters] = useState<string[]>([]);
  const [activeNoteFilters, setActiveNoteFilters] = useState<string[]>([]);
  const [activeAssetFilters, setActiveAssetFilters] = useState<string[]>([]);
  const [inspectorMenu, setInspectorMenu] = useState<InspectorMenu>("overview");
  const [inspectorQuery, setInspectorQuery] = useState("");
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
  const orbitInteractionTimeoutRef = useRef<number | null>(null);
  const orbitInteractionActiveRef = useRef(true);
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
  const isLargeVault = orbitalData.totalEntities > FOCUS_AUTO_THRESHOLD;
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
  const selectedSystemEntityIds = useMemo(() => {
    const related = new Set(selectedPrimaryEntityIds);

    selectedSecondaryEntityIds.forEach((entityId) => {
      related.add(entityId);
    });

    return related;
  }, [selectedPrimaryEntityIds, selectedSecondaryEntityIds]);
  const effectiveFocusMode = focusModeOverride ?? isLargeVault;
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
  const sceneLayout = useMemo(
    () =>
      buildOrbitalLayout(
        orbitalData,
        effectiveFocusMode && !hasActiveFilter ? selectedSystemEntityIds : null
      ),
    [effectiveFocusMode, hasActiveFilter, orbitalData, selectedSystemEntityIds]
  );
  const scene = useMemo(
    () => materializeOrbitalScene(sceneLayout, timeMs),
    [sceneLayout, timeMs]
  );
  const selectedNode = selectedEntityId ? scene.entityMap.get(selectedEntityId) ?? null : null;
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
    if (hoverPreviewAnchorSource === "inspector" && inspectorMenu !== "notes") {
      closeSelectionHoverPreview();
    }
  }, [hoverPreviewAnchorSource, inspectorMenu]);

  useEffect(() => {
    if (hoveredSelectionNoteId && noteHoverPreviewScrollRef.current) {
      noteHoverPreviewScrollRef.current.scrollTop = 0;
    }
  }, [hoveredSelectionNoteId]);

  useEffect(() => {
    return () => {
      clearHoverPreviewCloseTimeout();
    };
  }, []);

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
      if (note.pinned) {
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
    () => currentProjectNotes.filter((note) => note.pinned).length,
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
  const autoFocusEnabled = isLargeVault && focusModeOverride === null && !hasActiveFilter;
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
        setIsCanvasEditorFullscreen((current) => !current);
        return;
      }

      if (event.key === "Escape") {
        if (activeModal) {
          setActiveModal(null);
        } else if (editorOpen && editorMode === "canvas" && isCanvasEditorFullscreen) {
          setIsCanvasEditorFullscreen(false);
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

  const handleCenterSelection = () => {
    if (!anchorNode) {
      return;
    }

    animateCameraTo({
      x: -anchorNode.x,
      y: -anchorNode.y
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

    if (!name || !folderDraftProjectId) {
      return;
    }

    try {
      const createdFolder = await onCreateFolder(
        name,
        folderDraftParentId,
        folderDraftColor,
        folderDraftProjectId
      );
      setFolderDraft("");
      setFolderDraftError(null);
      setFolderDraftColor(DEFAULT_FOLDER_COLOR);
      setIsFolderDraftOpen(false);
      setFolderDraftParentId(null);
      setFolderDraftProjectId(null);
      setSelectedEntityId(`folder:${createdFolder.id}`);
    } catch (error) {
      if (error instanceof Error && error.message === "FOLDER_DEPTH_LIMIT") {
        setFolderDraftError(labels.maxDepthReached);
        return;
      }

      throw error;
    }
  };

  const handleCreateNote = async (folderId: string | null, projectId?: string) => {
    const createdNote = await onCreateNote(folderId, projectId);
    setSelectedEntityId(`note:${createdNote.id}`);
    setActiveProjectId(createdNote.projectId);
    onOpenNote(createdNote.id);
  };

  const handleCreateCanvas = async (folderId: string | null, projectId?: string) => {
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

  const openInspectorMenu = (menu: InspectorMenu) => {
    setInspectorMenu(menu);
    setInspectorQuery("");
  };

  const clearFilters = () => {
    setFilterQuery("");
    setActiveColorFilters([]);
    setActiveTagFilters([]);
    setActiveFolderFilters([]);
    setActiveNoteFilters([]);
    setActiveAssetFilters([]);
  };

  const beginFolderDraft = (parentId: string | null, projectId?: string) => {
    if (parentId) {
      const parentMeta = orbitalData.folderMeta.get(parentId);

      if ((parentMeta?.depth ?? 0) >= 1) {
        setFolderDraftError(labels.maxDepthReached);
        setIsFolderDraftOpen(false);
        setFolderDraftParentId(null);
        return;
      }
    }

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
  const folderMenuTree = useMemo(
    () =>
      currentProjectId
        ? (orbitalData.rootFoldersByProject.get(currentProjectId) ?? []).map((branch) => ({
            root: branch.folder,
            children: orbitalData.foldersByParent.get(branch.folder.id) ?? []
          }))
        : [],
    [currentProjectId, orbitalData.foldersByParent, orbitalData.rootFoldersByProject]
  );
  const filteredNotesMenu = useMemo(
    () =>
      currentProjectNotes.filter((note) =>
        [note.title, note.excerpt, note.plainText].join(" ").toLowerCase().includes(normalizedInspectorQuery)
      ),
    [currentProjectNotes, normalizedInspectorQuery]
  );
  const filteredPinnedMenu = useMemo(
    () => filteredNotesMenu.filter((note) => note.pinned),
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
    () =>
      folderMenuTree
        .map(({ root, children }) => ({
          root,
          children: children.filter((folder) =>
            (folderPathMap.get(folder.id) ?? folder.name).toLowerCase().includes(normalizedInspectorQuery)
          )
        }))
        .filter(
          ({ root, children }) =>
            !normalizedInspectorQuery ||
            (folderPathMap.get(root.id) ?? root.name).toLowerCase().includes(normalizedInspectorQuery) ||
            children.length > 0
        ),
    [folderMenuTree, folderPathMap, normalizedInspectorQuery]
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
    inspectorMenu === "notes"
      ? labels.notesMenu
      : inspectorMenu === "folders"
        ? labels.foldersMenu
        : inspectorMenu === "tags"
          ? labels.tagsMenu
          : inspectorMenu === "files"
            ? labels.filesMenu
            : inspectorMenu === "colors"
              ? labels.colorsMenu
              : labels.pinnedMenu;
  const inspectorMenuCount =
    inspectorMenu === "notes"
      ? filteredNotesMenu.length
      : inspectorMenu === "folders"
        ? filteredFoldersMenu.reduce((count, { children }) => count + 1 + children.length, 0)
        : inspectorMenu === "tags"
          ? filteredTagsMenu.length
          : inspectorMenu === "files"
            ? filteredFilesMenu.length
            : inspectorMenu === "colors"
              ? filteredColorsMenu.length
              : filteredPinnedMenu.length;
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
  const coreSparkOrbit = [
    { angle: timeMs * 0.0012, radius: 110, size: 5.2 },
    { angle: Math.PI * 0.8 - timeMs * 0.001, radius: 134, size: 3.9 },
    { angle: Math.PI * 1.55 + timeMs * 0.00086, radius: 150, size: 3.2 }
  ];
  const overviewBody = (
    <>
      <div className="orbital-inspector-header orbital-inspector-header-overview">
        <div className="orbital-inspector-heading">
          <p className="panel-kicker orbital-inspector-kicker">{labels.overview}</p>
          <h2 className="panel-title orbital-inspector-title">
            {currentProject?.name ?? labels.title}
          </h2>
        </div>
        <div className="orbital-inspector-header-actions">
          <span className="orbital-inline-count">
            {activeProjectIndex >= 0 ? activeProjectIndex + 1 : 0}/{orbitalData.projects.length}
          </span>
          <button
            type="button"
            className="toolbar-action orbital-toolbar-action orbital-icon-action accent"
            onClick={() => void handleCreateProject()}
            aria-label={labels.addProject}
            title={labels.addProject}
          >
            +
          </button>
        </div>
      </div>

      <div
        className="orbital-overview-switcher"
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
            <span className="orbital-overview-link-label">{entry.label}</span>
            <strong className="orbital-overview-link-count">{entry.count}</strong>
          </button>
        ))}
      </div>

      <p className="orbital-hints orbital-hints-quiet">{labels.hints}</p>
    </>
  );
  const inspectorMenuBody =
    inspectorMenu === "overview" ? null : (
      <>
        <div className="orbital-inspector-header orbital-inspector-header-subview">
          <button
            className="toolbar-action orbital-toolbar-action orbital-icon-action orbital-menu-back"
            onClick={() => openInspectorMenu("overview")}
            aria-label={labels.back}
            title={labels.back}
          >
            ←
          </button>
          <div className="orbital-inspector-heading orbital-inspector-heading-subview">
            <h2 className="panel-title orbital-inspector-title">{inspectorMenuTitle}</h2>
          </div>
          <span className="orbital-inline-count">{inspectorMenuCount}</span>
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

        <div className="orbital-menu-list">
          {inspectorMenu === "notes"
            ? filteredNotesMenu.map((note) => (
                <button
                  key={note.id}
                  className={`orbital-menu-item ${activeNoteFilterSet.has(note.id) ? "is-active" : ""}`}
                  onClick={() => toggleNoteFilter(note.id)}
                  onDoubleClick={() => {
                    closeSelectionHoverPreview();
                    onOpenNote(note.id);
                  }}
                  onPointerEnter={(event) => {
                    openSelectionHoverPreview(
                      note.id,
                      event.clientX,
                      event.clientY,
                      "inspector",
                      {
                        anchorRect: toHoverPreviewAnchorRect(event.currentTarget.getBoundingClientRect())
                      }
                    );
                  }}
                  onPointerMove={(event) => {
                    updateSelectionHoverPreviewCursor(event.clientX, event.clientY, {
                      anchorRect: toHoverPreviewAnchorRect(event.currentTarget.getBoundingClientRect())
                    });
                  }}
                  onPointerLeave={() => {
                    scheduleSelectionHoverPreviewClose();
                  }}
                  onPointerCancel={() => {
                    scheduleSelectionHoverPreviewClose();
                  }}
                >
                  <span className="orbital-menu-item-head">
                    <span className="orbital-menu-item-title">{note.title}</span>
                    {note.contentType === "canvas" ? (
                      <span className="orbital-menu-item-badge">{labels.canvas}</span>
                    ) : null}
                  </span>
                  <div className="orbital-menu-item-richmeta">
                    <EntryStaticPreview
                      note={note}
                      emptyLabel={labels.empty}
                      resolveFileUrl={onResolveFileUrl}
                      compact
                      interactive={false}
                      className="orbital-menu-note-preview"
                      labels={{
                        canvas: labels.canvas,
                        elements: labels.elementsStat,
                        images: labels.assetsStat,
                        emptyCanvas: labels.emptyCanvas
                      }}
                    />
                  </div>
                </button>
              ))
            : null}

          {inspectorMenu === "pinned"
            ? filteredPinnedMenu.map((note) => (
                <button
                  key={note.id}
                  className={`orbital-menu-item ${activeNoteFilterSet.has(note.id) ? "is-active" : ""}`}
                  onClick={() => toggleNoteFilter(note.id)}
                  onDoubleClick={() => {
                    closeSelectionHoverPreview();
                    onOpenNote(note.id);
                  }}
                >
                  <span className="orbital-menu-item-head">
                    <span className="orbital-menu-item-title">{note.title}</span>
                    {note.contentType === "canvas" ? (
                      <span className="orbital-menu-item-badge">{labels.canvas}</span>
                    ) : null}
                  </span>
                  <span className="orbital-menu-item-meta">{formatTimestamp(note.updatedAt, language)}</span>
                </button>
              ))
            : null}

          {inspectorMenu === "tags"
            ? filteredTagsMenu.map((tag) => (
                <button
                  key={tag.id}
                  className={`orbital-menu-item orbital-menu-chipitem ${activeTagFilterSet.has(tag.id) ? "is-active" : ""}`}
                  onClick={() => toggleTagFilter(tag.id)}
                >
                  <span className="orbital-menu-item-title">{tag.name}</span>
                  <span className="orbital-menu-item-meta">{currentProjectTagCounts.get(tag.id) ?? 0}</span>
                </button>
              ))
            : null}

          {inspectorMenu === "files"
            ? filteredFilesMenu.map((asset) => (
                <button
                  key={asset.id}
                  className={`orbital-menu-item ${activeAssetFilterSet.has(asset.id) ? "is-active" : ""}`}
                  onClick={() => toggleAssetFilter(asset.id)}
                >
                  <span className="orbital-menu-item-title">{asset.name}</span>
                  <span className="orbital-menu-item-meta">
                    {orbitalData.noteById.get(asset.noteId)?.title ?? labels.empty}
                  </span>
                </button>
              ))
            : null}

          {inspectorMenu === "folders"
            ? filteredFoldersMenu.map(({ root, children }) => (
                <div className="orbital-folder-group" key={root.id}>
                  <button
                    className={`orbital-menu-item ${activeFolderFilterSet.has(root.id) ? "is-active" : ""}`}
                    onClick={() => toggleFolderFilter(root.id)}
                  >
                    <span className="orbital-menu-item-title">{root.name}</span>
                    <span className="orbital-menu-item-meta">{folderPathMap.get(root.id) ?? root.name}</span>
                  </button>

                  {children.map((folder) => (
                    <button
                      key={folder.id}
                      className={`orbital-menu-item orbital-menu-item-child ${activeFolderFilterSet.has(folder.id) ? "is-active" : ""}`}
                      onClick={() => toggleFolderFilter(folder.id)}
                    >
                      <span className="orbital-menu-item-title">{folder.name}</span>
                      <span className="orbital-menu-item-meta">{folderPathMap.get(folder.id) ?? folder.name}</span>
                    </button>
                  ))}
                </div>
              ))
            : null}

          {inspectorMenu === "colors"
            ? filteredColorsMenu.map((entry) => (
                <button
                  key={entry.id}
                  className={`orbital-menu-item orbital-menu-coloritem ${activeColorFilterSet.has(entry.hex) ? "is-active" : ""}`}
                  onClick={() => toggleColorFilter(entry.hex)}
                  style={{ "--swatch-color": entry.hex } as CSSProperties}
                >
                  <span className="orbital-menu-colorhead">
                    <span className="orbital-menu-colorchip" />
                    <span className="orbital-menu-item-title">{entry.label}</span>
                  </span>
                  <span className="orbital-menu-item-meta">{entry.count}</span>
                </button>
              ))
            : null}

          {((inspectorMenu === "notes" && filteredNotesMenu.length === 0) ||
            (inspectorMenu === "pinned" && filteredPinnedMenu.length === 0) ||
            (inspectorMenu === "tags" && filteredTagsMenu.length === 0) ||
            (inspectorMenu === "files" && filteredFilesMenu.length === 0) ||
            (inspectorMenu === "folders" && filteredFoldersMenu.length === 0) ||
            (inspectorMenu === "colors" && filteredColorsMenu.length === 0)) ? (
            <div className="empty-card orbital-menu-empty">
              <strong>{labels.empty}</strong>
            </div>
          ) : null}
        </div>
      </>
    );

  return (
    <section
      className="orbital-overlay"
      role="dialog"
      aria-modal="true"
      onPointerDown={markOrbitInteraction}
      onWheel={markOrbitInteraction}
    >
      <div className="orbital-backdrop" aria-hidden="true" />

      <header className="orbital-topbar orbital-topbar-minimal">
        <div className="orbital-topbar-brand">
          <div className="orbital-title-stack orbital-topbar-copy">
            <p className="panel-kicker orbital-topbar-kicker">{labels.title}</p>
            <h2 className="panel-title orbital-title">{labels.subtitle}</h2>
          </div>
          <div className="orbital-title-meta orbital-topbar-meta">
            {currentProject ? <span className="orbital-context-pill">{currentProject.name}</span> : null}
            {autoFocusEnabled ? <span className="status-chip accent">{labels.autoFocus}</span> : null}
            {effectiveFocusMode ? <span className="status-chip online">{labels.focusMode}</span> : null}
          </div>
        </div>

        <div className="orbital-toolbar-shell">
          <div className="orbital-toolbar-cluster">
            <button className="toolbar-action orbital-toolbar-action" onClick={() => setIsPaused((current) => !current)}>
              {isPaused ? labels.resume : labels.pause}
            </button>
          </div>

          {(trashModalSlot || syncModalSlot) && (
            <div className="orbital-toolbar-cluster">
              {trashModalSlot ? (
                <button className="toolbar-action orbital-toolbar-action" onClick={() => setActiveModal("trash")}>
                  {labels.trash}
                </button>
              ) : null}
              {syncModalSlot ? (
                <button className="toolbar-action orbital-toolbar-action" onClick={() => setActiveModal("sync")}>
                  {labels.sync}
                </button>
              ) : null}
            </div>
          )}

          <div className="orbital-toolbar-cluster orbital-toolbar-cluster-camera">
            <button
              className="toolbar-action orbital-toolbar-action orbital-toolbar-action-icon"
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
              className="toolbar-action orbital-toolbar-action orbital-toolbar-action-icon"
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
            <button className="toolbar-action orbital-toolbar-action" onClick={handleCenterSelection}>
              {labels.centerSelection}
            </button>
            <button className="toolbar-action orbital-toolbar-action" onClick={handleResetCamera}>
              {labels.resetView}
            </button>
          </div>

          {showClose ? (
            <button className="toolbar-action orbital-toolbar-action orbital-toolbar-close danger" onClick={onClose}>
              {labels.close}
            </button>
          ) : null}
        </div>
      </header>

      <div className="orbital-layout">
        <aside className="orbital-inspector panel">
          {!selectedNode && inspectorMenu === "overview" ? (
            overviewBody
          ) : !selectedNode ? (
            inspectorMenuBody
          ) : (
            <>
              {selectedNode.kind === "core" ? (
                <>
                  <div className="panel-head">
                    <div>
                      <p className="panel-kicker">{labels.project}</p>
                      <h2 className="panel-title">{selectedNode.project?.name ?? labels.core}</h2>
                    </div>
                  </div>

                  <div className="orbital-meta-card orbital-focus-card">
                    <div className="orbital-fact-row">
                      <span>{labels.focusedSystem}</span>
                      <strong>{focusSystemLabel}</strong>
                    </div>
                    <div className="orbital-fact-row">
                      <span>{labels.visibleBodies}</span>
                      <strong>{visibleBodies}</strong>
                    </div>
                    <div className="orbital-fact-row">
                      <span>{labels.hiddenBodies}</span>
                      <strong>{hiddenBodies}</strong>
                    </div>
                  </div>

                  <div className="orbital-meta-card">
                    <div className="orbital-fact-row">
                      <span>{labels.rootFolders}</span>
                      <strong>{selectedNode.project ? (orbitalData.rootFoldersByProject.get(selectedNode.project.id) ?? []).length : 0}</strong>
                    </div>
                    <div className="orbital-fact-row">
                      <span>{labels.directNotes}</span>
                      <strong>{selectedNode.project ? (orbitalData.looseNotesByProject.get(selectedNode.project.id) ?? []).length : 0}</strong>
                    </div>
                    <div className="orbital-fact-row">
                      <span>{labels.descendants}</span>
                      <strong>{selectedNode.project ? currentProjectNotes.length : 0}</strong>
                    </div>
                    <div className="orbital-color-field">
                      <span className="orbital-color-label">{labels.projectColor}</span>
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
                  </div>
                </>
              ) : (
                <>
                  <section
                    className={`orbital-selection-shell orbital-selection-shell-${selectedNode.kind} ${
                      selectedEntryIsCanvas ? "is-canvas" : ""
                    }`}
                    style={{ "--selection-accent": selectedInspectorAccent } as CSSProperties}
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
                      <h2 className="orbital-selection-title">{selectedNode.label}</h2>
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
                          {selectedNode.note.favorite ? (
                            <span className="orbital-selection-badge">{t("note.favorite")}</span>
                          ) : null}
                          {selectedNode.note.pinned ? (
                            <span className="orbital-selection-badge">{t("note.pin")}</span>
                          ) : null}
                          {selectedNode.note.archived ? (
                            <span className="orbital-selection-badge">{t("note.archive")}</span>
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
                </>
              )}

              <div className={`orbital-action-stack ${selectedNode.kind !== "core" ? "orbital-action-stack-compact" : ""}`}>
                {selectedNode.kind === "note" && selectedNode.note ? (
                  <button className="primary-action" onClick={() => onOpenNote(selectedNode.note!.id)}>
                    {selectedEntryIsCanvas ? labels.openCanvas : labels.openNote}
                  </button>
                ) : null}

                {(selectedNode.kind === "core" || selectedNode.kind === "folder") && (
                  <>
                    {selectedNode.kind === "core" || (selectedFolderMeta?.depth ?? 0) < 1 ? (
                      <button
                        className="primary-action"
                        onClick={() =>
                          beginFolderDraft(
                            selectedNode.kind === "folder" ? selectedNode.folder!.id : null,
                            selectedNode.kind === "core"
                              ? selectedNode.project?.id
                              : selectedNode.folder?.projectId
                          )
                        }
                      >
                        {selectedNode.kind === "folder" ? labels.addChildFolder : labels.addRootFolder}
                      </button>
                    ) : null}
                    <button
                      className="toolbar-action"
                      onClick={() =>
                        void handleCreateNote(
                          selectedNode.kind === "folder" ? selectedNode.folder!.id : null,
                          selectedNode.kind === "core"
                            ? selectedNode.project?.id
                            : selectedNode.folder?.projectId
                        )
                      }
                    >
                      {labels.addNote}
                    </button>
                    <button
                      className="toolbar-action"
                      onClick={() =>
                        void handleCreateCanvas(
                          selectedNode.kind === "folder" ? selectedNode.folder!.id : null,
                          selectedNode.kind === "core"
                            ? selectedNode.project?.id
                            : selectedNode.folder?.projectId
                        )
                      }
                    >
                      {labels.addCanvas}
                    </button>
                  </>
                )}
              </div>

              {isFolderDraftOpen ? (
                <div className="orbital-create-card">
                  <input
                    value={folderDraft}
                    onChange={(event) => setFolderDraft(event.target.value)}
                    className="micro-input full"
                    placeholder={labels.folderNamePlaceholder}
                  />
                  <div className="orbital-color-field">
                    <span className="orbital-color-label">{labels.chooseColor}</span>
                    <div className="color-swatch-grid compact">
                      {COLOR_PALETTE.map((colorOption) => (
                        <button
                          key={colorOption.id}
                          type="button"
                          className={`color-swatch compact ${folderDraftColor === colorOption.hex ? "is-active" : ""}`}
                          onClick={() => setFolderDraftColor(colorOption.hex)}
                          style={{ "--swatch-color": colorOption.hex } as CSSProperties}
                          aria-label={`${labels.chooseColor}: ${t(colorOption.labelKey)}`}
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
                          value={folderDraftColor}
                          onChange={(event) => setFolderDraftColor(event.target.value)}
                          aria-label={labels.customColor}
                        />
                        <span className="orbital-custom-color-value">{folderDraftColor.toUpperCase()}</span>
                      </span>
                    </label>
                  </div>
                  <div className="orbital-create-actions">
                    <button className="micro-action primary" onClick={() => void handleCreateFolder()}>
                      {labels.create}
                    </button>
                    <button
                      className="micro-action"
                      onClick={() => {
                        setFolderDraft("");
                        setIsFolderDraftOpen(false);
                        setFolderDraftParentId(null);
                        setFolderDraftProjectId(null);
                      }}
                    >
                      {labels.cancel}
                    </button>
                  </div>
                </div>
              ) : null}

              {!isFolderDraftOpen && folderDraftError ? (
                <p className="orbital-draft-error orbital-inline-error">{folderDraftError}</p>
              ) : null}

              <p className="orbital-hints">{labels.hints}</p>
            </>
          )}
        </aside>

        <div className="orbital-scene-wrap" onWheel={handleWheel}>
          <div className="orbital-filter-dock">
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
                  (!isLargeVault && (node.depth <= 1 || (node.kind === "folder" && node.radius >= 28)));

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
                        originProjectY: node.project.y
                      };
                      event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedEntityId(node.entityId);
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
                        {coreSparkOrbit.map((spark, index) => (
                          <circle
                            key={`spark-${index}`}
                            cx={Math.cos(spark.angle) * spark.radius}
                            cy={Math.sin(spark.angle) * spark.radius * 0.82}
                            r={spark.size}
                            className="orbital-core-spark"
                          />
                        ))}
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
                          {node.favorite ? (
                            <circle
                              cx={node.radius * 0.92}
                              cy={-node.radius * 0.92}
                              r="3.2"
                              className="orbital-favorite-signal"
                            />
                          ) : null}
                          {node.pinned ? (
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

      {editorOpen ? (
        <div
          className={`orbital-modal-layer orbital-editor-modal-layer ${
            editorMode === "canvas" ? "is-canvas-mode" : ""
          } ${isCanvasEditorFullscreen ? "is-canvas-fullscreen" : ""}`}
          role="dialog"
          aria-modal="true"
        >
          <button
            className="orbital-modal-dim"
            aria-label={labels.closeEditor}
            onClick={onCloseEditor}
          />
          <div
            className={`orbital-modal-window orbital-editor-modal-window ${
              editorMode === "canvas" ? "is-canvas-mode" : ""
            } ${isCanvasEditorFullscreen ? "is-canvas-fullscreen" : ""}`}
          >
            <div className={`orbital-editor-topbar ${editorMode === "canvas" ? "is-canvas-mode" : ""}`}>
              <div className={`orbital-editor-topmeta ${editorMode === "canvas" ? "is-canvas-mode" : ""}`}>
                <p className="panel-kicker">
                  {editorMode === "canvas" ? labels.openCanvas : labels.openNote}
                </p>
                {editorMode === "canvas" ? null : (
                  <strong className="orbital-editor-title">
                    {editorTitle || labels.note}
                  </strong>
                )}
              </div>
              <div className={`orbital-editor-topactions ${editorMode === "canvas" ? "is-canvas-mode" : ""}`}>
                {editorMode === "canvas" ? (
                  <button
                    className="toolbar-action orbital-toolbar-action"
                    onClick={() => setIsCanvasEditorFullscreen((current) => !current)}
                  >
                    {isCanvasEditorFullscreen ? labels.exitFullscreen : labels.enterFullscreen}
                  </button>
                ) : null}
                <button className="toolbar-action danger" onClick={onCloseEditor}>
                  {labels.closeEditor}
                </button>
              </div>
            </div>
            <div className={`orbital-editor-scroll ${editorMode === "canvas" ? "is-canvas-mode" : ""}`}>
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
          <div className="orbital-modal-window">
            <button className="toolbar-action danger orbital-modal-close" onClick={() => setActiveModal(null)}>
              {labels.closeModal}
            </button>
            <div className="orbital-modal-content">
              {activeModal === "sync" ? syncModalSlot : trashModalSlot}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
