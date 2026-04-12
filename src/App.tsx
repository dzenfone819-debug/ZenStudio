import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useTranslation } from "react-i18next";

import FolderPanel from "./components/FolderPanel";
import KnowledgeMap from "./components/KnowledgeMap";
import NotesPanel from "./components/NotesPanel";
import SyncPanel from "./components/SyncPanel";
import TrashPanel from "./components/TrashPanel";
import {
  createCanvas,
  createProject,
  createFolder,
  createNote,
  createTag,
  db,
  ensureSeedData,
  inspectFolderRemoval,
  moveNoteToTrash,
  patchSettings,
  removeFolder,
  removeNote,
  removeTag,
  restoreNoteFromTrash,
  renameFolder,
  renameTag,
  loadCanvasFiles,
  resolveAssetUrl,
  saveCanvasContent,
  saveNoteContent,
  storeAsset,
  updateFolderColor,
  updateProjectColor,
  updateProjectPosition,
  updateNoteMeta
} from "./data/db";
import {
  buildFolderPathMap,
  getDescendantFolderIds,
  getFolderCascade,
  matchSearch
} from "./lib/notes";
import i18n from "./i18n";
import type {
  AppLanguage,
  MobileSection,
  Note,
  NoteListView,
  Project,
  SaveState,
  SyncProvider
} from "./types";

const EditorPane = lazy(() => import("./components/EditorPane"));
const CanvasPane = lazy(() => import("./components/CanvasPane"));
const OrbitalMapView = lazy(() => import("./components/OrbitalMapView"));
function useOnlineStatus() {
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);

    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}

export default function App() {
  const { t } = useTranslation();
  const online = useOnlineStatus();
  const projects = useLiveQuery(() => db.projects.toArray(), [], []);
  const folders = useLiveQuery(() => db.folders.toArray(), [], []);
  const tags = useLiveQuery(() => db.tags.toArray(), [], []);
  const notes = useLiveQuery(() => db.notes.toArray(), [], []);
  const assets = useLiveQuery(() => db.assets.toArray(), [], []);
  const settings = useLiveQuery(() => db.settings.get("app"), [], undefined);

  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [mobileSection, setMobileSection] = useState<MobileSection>("notes");
  const [viewMode, setViewMode] = useState<NoteListView>("all");
  const [search, setSearch] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [orbitalOpen, setOrbitalOpen] = useState(false);
  const [orbitalEditorNoteId, setOrbitalEditorNoteId] = useState<string | null>(null);

  useEffect(() => {
    void ensureSeedData();
  }, []);

  useEffect(() => {
    if (!settings) {
      return;
    }

    if (i18n.language !== settings.language) {
      void i18n.changeLanguage(settings.language);
      document.documentElement.lang = settings.language;
    }
  }, [settings]);

  const folderMap = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const tagMap = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const folderPathMap = useMemo(() => buildFolderPathMap(folders), [folders]);
  const activeNotes = useMemo(() => notes.filter((note) => note.trashedAt === null), [notes]);
  const trashedNotes = useMemo(
    () =>
      [...notes]
        .filter((note) => note.trashedAt !== null)
        .sort((left, right) => (right.trashedAt ?? right.updatedAt) - (left.trashedAt ?? left.updatedAt)),
    [notes]
  );

  const filteredNotes = useMemo(() => {
    const folderScope =
      selectedFolderId !== null ? getDescendantFolderIds(selectedFolderId, folders) : null;

    return [...notes]
      .filter((note) => {
        if (viewMode === "trash") {
          return note.trashedAt !== null;
        }

        if (note.trashedAt !== null) {
          return false;
        }

        if (viewMode === "favorites") {
          return note.favorite;
        }

        return true;
      })
      .filter((note) => {
        if (!folderScope) {
          return true;
        }

        return note.folderId ? folderScope.has(note.folderId) : false;
      })
      .filter((note) => (selectedTagId ? note.tagIds.includes(selectedTagId) : true))
      .filter((note) => matchSearch(note, search, tagMap))
      .sort((left, right) => {
        if (left.favorite !== right.favorite) {
          return left.favorite ? -1 : 1;
        }

        if (left.pinned !== right.pinned) {
          return left.pinned ? -1 : 1;
        }

        return right.updatedAt - left.updatedAt;
      });
  }, [folders, notes, search, selectedFolderId, selectedTagId, tagMap, viewMode]);

  useEffect(() => {
    if (!settings) {
      return;
    }

    const preferredId = selectedNoteId ?? settings.lastOpenedNoteId;
    const candidate = filteredNotes.find((note) => note.id === preferredId) ?? filteredNotes[0] ?? null;

    if (candidate && candidate.id !== selectedNoteId) {
      setSelectedNoteId(candidate.id);
      return;
    }

    if (!candidate && selectedNoteId !== null) {
      setSelectedNoteId(null);
    }
  }, [filteredNotes, selectedNoteId, settings]);

  const activeNote =
    filteredNotes.find((note) => note.id === selectedNoteId) ??
    filteredNotes[0] ??
    null;
  const orbitalEditorEntry =
    notes.find((note) => note.id === orbitalEditorNoteId && note.trashedAt === null) ?? null;

  const selectedFolderName = selectedFolderId ? folderPathMap.get(selectedFolderId) ?? null : null;
  const selectedTagName = selectedTagId ? tagMap.get(selectedTagId)?.name ?? null : null;
  const totalVisibleNotes = notes.filter((note) => note.trashedAt === null).length;
  const favoriteCount = notes.filter((note) => note.trashedAt === null && note.favorite).length;
  const trashCount = notes.filter((note) => note.trashedAt !== null).length;
  const pinnedCount = notes.filter((note) => note.trashedAt === null && note.pinned).length;
  const viewModeLabel =
    viewMode === "favorites"
      ? t("filters.viewFavorites")
      : viewMode === "trash"
          ? t("filters.viewTrash")
          : t("filters.viewAll");
  const currentCollectionTitle =
    selectedFolderName ??
    selectedTagName ??
    (viewMode === "favorites"
      ? t("filters.viewFavorites")
      : viewMode === "trash"
          ? t("filters.viewTrash")
          : t("filters.allNotes"));
  const currentCollectionDescription = selectedFolderName
    ? `${t("noteList.filteredByFolder")}: ${selectedFolderName}`
    : selectedTagName
      ? `${t("noteList.filteredByTag")}: ${selectedTagName}`
      : viewMode === "favorites"
        ? `${favoriteCount} ${t("noteList.noteCount")}`
        : viewMode === "trash"
            ? `${trashCount} ${t("noteList.noteCount")}`
            : `${totalVisibleNotes} ${t("noteList.noteCount")}`;
  const contextChips = [
    `${filteredNotes.length} ${t("noteList.noteCount")}`,
    selectedFolderName ? `${t("note.folder")}: ${selectedFolderName}` : null,
    selectedTagName ? `${t("note.tags")}: ${selectedTagName}` : null,
    viewMode !== "all" ? viewModeLabel : null,
    search ? `Q: ${search}` : null
  ].filter(Boolean) as string[];

  useEffect(() => {
    if (!orbitalEditorNoteId) {
      return;
    }

    if (!orbitalEditorEntry) {
      setOrbitalEditorNoteId(null);
    }
  }, [orbitalEditorEntry, orbitalEditorNoteId]);

  const handleSelectNote = async (noteId: string) => {
    setSelectedNoteId(noteId);
    await patchSettings({
      lastOpenedNoteId: noteId
    });

    if (window.innerWidth <= 980) {
      setMobileSection("editor");
    }
  };

  const handleCreateFolderNode = async (
    name: string,
    parentId: string | null,
    color?: string,
    projectId?: string
  ) => {
    return createFolder(name, parentId, color, projectId);
  };

  const handleCreateNoteAt = async (
    folderId: string | null,
    tagIds: string[] = [],
    projectId?: string
  ) => {
    const language = (settings?.language ?? "en") as AppLanguage;
    const note = await createNote(language, folderId, tagIds, projectId);
    setSelectedNoteId(note.id);
    setSaveState("saved");
    return note;
  };

  const handleCreateCanvasAt = async (
    folderId: string | null,
    tagIds: string[] = [],
    projectId?: string
  ) => {
    const language = (settings?.language ?? "en") as AppLanguage;
    const canvas = await createCanvas(language, folderId, tagIds, projectId);
    setSelectedNoteId(canvas.id);
    setSaveState("saved");
    return canvas;
  };

  const handleCreateProjectNode = async (x: number, y: number) => {
    const language = (settings?.language ?? "en") as AppLanguage;
    const name =
      language === "ru"
        ? `Проект ${projects.length + 1}`
        : `Project ${projects.length + 1}`;

    return createProject(name, x, y);
  };

  const handleToggleTagForNote = async (noteId: string, tagId: string) => {
    const note = notes.find((currentNote) => currentNote.id === noteId);

    if (!note) {
      return;
    }

    const nextTagIds = note.tagIds.includes(tagId)
      ? note.tagIds.filter((currentTagId) => currentTagId !== tagId)
      : [...note.tagIds, tagId];

    await updateNoteMeta(noteId, {
      tagIds: nextTagIds
    });
  };

  const handleSetTagIdsForNote = async (noteId: string, tagIds: string[]) => {
    await updateNoteMeta(noteId, {
      tagIds: Array.from(new Set(tagIds))
    });
  };

  const handleContentChangeForNote = async (
    noteId: string,
    content: Note["content"],
    state: SaveState
  ) => {
    setSaveState(state);

    if (state === "saved") {
      await saveNoteContent(noteId, content);
    }
  };

  const handleDeleteNoteById = async (noteId: string) => {
    const note = notes.find((currentNote) => currentNote.id === noteId);

    if (!note) {
      return;
    }

    if (note.trashedAt) {
      if (!window.confirm(t("note.deleteConfirm"))) {
        return;
      }

      await removeNote(note.id);
    } else {
      if (!window.confirm(t("note.moveToTrashConfirm"))) {
        return;
      }

      await moveNoteToTrash(note.id);
    }

    if (selectedNoteId === note.id) {
      setSelectedNoteId(null);
    }

    if (orbitalEditorNoteId === note.id) {
      setOrbitalEditorNoteId(null);
    }
  };

  const handleCreateNote = async () => {
    setViewMode("all");
    const note = await handleCreateNoteAt(selectedFolderId, selectedTagId ? [selectedTagId] : []);

    if (window.innerWidth <= 980) {
      setMobileSection("editor");
    }
  };

  const handleDeleteNote = async () => {
    if (!activeNote) {
      return;
    }

    await handleDeleteNoteById(activeNote.id);
  };

  const handleCreateFolder = async (name: string, parentId: string | null) => {
    await handleCreateFolderNode(name, parentId);
  };

  const handleDeleteFolder = async (folderId: string) => {
    const impact = await inspectFolderRemoval(folderId);
    const folderName = folderMap.get(folderId)?.name ?? t("folders.thisFolder");

    if (impact.folderCount > 1 || impact.noteCount > 0) {
      const confirmed = window.confirm(
        t("folders.deleteCascadeConfirm", {
          name: folderName,
          folderCount: impact.folderCount,
          noteCount: impact.noteCount
        })
      );

      if (!confirmed) {
        return;
      }
    }

    const deletedFolderIds = getFolderCascade(folderId, folders, notes).folderIds;
    await removeFolder(folderId);

    if (selectedFolderId && deletedFolderIds.includes(selectedFolderId)) {
      setSelectedFolderId(null);
    }
  };

  const handleChangeLanguage = async (language: AppLanguage) => {
    await patchSettings({
      language
    });
  };

  const handleChangeProvider = async (provider: SyncProvider) => {
    await patchSettings({
      syncProvider: provider,
      syncEnabled: provider !== "none",
      syncStatus: provider === "none" ? "disabled" : "idle"
    });
  };

  const handleTagToggle = async (tagId: string) => {
    if (!activeNote) {
      return;
    }

    await handleToggleTagForNote(activeNote.id, tagId);
  };

  const handleContentChange = async (content: Note["content"], state: SaveState) => {
    if (!activeNote) {
      return;
    }

    await handleContentChangeForNote(activeNote.id, content, state);
  };

  const handleOpenOrbital = () => {
    setOrbitalOpen(true);
  };

  const handleCloseOrbital = () => {
    setOrbitalOpen(false);
    setOrbitalEditorNoteId(null);
  };

  const handleOpenOrbitalNote = async (noteId: string) => {
    await handleSelectNote(noteId);
    setOrbitalEditorNoteId(noteId);
  };

  if (!settings) {
    return (
      <div className="boot-screen">
        <div className="boot-card">
          <span className="panel-kicker">Zen Notes</span>
          <strong>Booting local vault...</strong>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={null}>
      <OrbitalMapView
        projects={projects}
        folders={folders}
        notes={notes}
        tags={tags}
        assets={assets}
        assetCount={assets.length}
        language={settings.language}
        editorOpen={Boolean(orbitalEditorEntry)}
        editorTitle={
          orbitalEditorEntry?.title?.trim() ||
          (orbitalEditorEntry?.contentType === "canvas" ? t("canvas.untitled") : t("note.untitled"))
        }
        editorMode={orbitalEditorEntry?.contentType ?? null}
        editorSlot={
          orbitalEditorEntry ? (
            orbitalEditorEntry.contentType === "canvas" ? (
              <CanvasPane
                key={`orbital-canvas-${orbitalEditorEntry.id}-${settings.language}`}
                note={orbitalEditorEntry}
                folders={folders}
                tags={tags}
                language={settings.language}
                saveState={saveState}
                immersive
                onTitleChange={(title) =>
                  void updateNoteMeta(orbitalEditorEntry.id, {
                    title
                  })
                }
                onFolderChange={(folderId) =>
                  void updateNoteMeta(orbitalEditorEntry.id, {
                    folderId
                  })
                }
                onNoteColorChange={(color) =>
                  void updateNoteMeta(orbitalEditorEntry.id, {
                    color
                  })
                }
                onTagIdsChange={(tagIds) =>
                  void handleSetTagIdsForNote(orbitalEditorEntry.id, tagIds)
                }
                onCreateTag={createTag}
                onDelete={() => void handleDeleteNoteById(orbitalEditorEntry.id)}
                onRestore={() => void restoreNoteFromTrash(orbitalEditorEntry.id)}
                onTogglePin={() =>
                  void updateNoteMeta(orbitalEditorEntry.id, {
                    pinned: !orbitalEditorEntry.pinned
                  })
                }
                onToggleFavorite={() =>
                  void updateNoteMeta(orbitalEditorEntry.id, {
                    favorite: !orbitalEditorEntry.favorite
                  })
                }
                onContentChange={(content, files, fileNames, state) => {
                  setSaveState(state);

                  if (state === "saved") {
                    void saveCanvasContent(orbitalEditorEntry.id, content, files, fileNames);
                  }
                }}
                onLoadFiles={() => loadCanvasFiles(orbitalEditorEntry.id)}
              />
            ) : (
              <EditorPane
                key={`orbital-note-${orbitalEditorEntry.id}-${settings.language}`}
                note={orbitalEditorEntry}
                folders={folders}
                tags={tags}
                language={settings.language}
                saveState={saveState}
                immersive
                onTitleChange={(title) =>
                  void updateNoteMeta(orbitalEditorEntry.id, {
                    title
                  })
                }
                onFolderChange={(folderId) =>
                  void updateNoteMeta(orbitalEditorEntry.id, {
                    folderId
                  })
                }
                onNoteColorChange={(color) =>
                  void updateNoteMeta(orbitalEditorEntry.id, {
                    color
                  })
                }
                onTagIdsChange={(tagIds) =>
                  void handleSetTagIdsForNote(orbitalEditorEntry.id, tagIds)
                }
                onCreateTag={createTag}
                onDelete={() => void handleDeleteNoteById(orbitalEditorEntry.id)}
                onRestore={() => void restoreNoteFromTrash(orbitalEditorEntry.id)}
                onTogglePin={() =>
                  void updateNoteMeta(orbitalEditorEntry.id, {
                    pinned: !orbitalEditorEntry.pinned
                  })
                }
                onToggleFavorite={() =>
                  void updateNoteMeta(orbitalEditorEntry.id, {
                    favorite: !orbitalEditorEntry.favorite
                  })
                }
                onContentChange={(content, state) =>
                  void handleContentChangeForNote(orbitalEditorEntry.id, content, state)
                }
                onUploadFile={(file) => storeAsset(orbitalEditorEntry.id, file)}
                onResolveFileUrl={resolveAssetUrl}
              />
            )
          ) : null
        }
        trashModalSlot={
          <TrashPanel
            notes={trashedNotes}
            folderPathMap={folderPathMap}
            language={settings.language}
            labels={{
              title: t("filters.viewTrash"),
              deletedAt: t("orbit.deletedAt"),
              folder: t("note.folder"),
              restore: t("note.restore"),
              deletePermanently: t("note.deletePermanently"),
              emptyTitle: t("orbit.trashEmptyTitle"),
              emptyDescription: t("orbit.trashEmptyDescription"),
              noteCount: t("noteList.noteCount"),
              allNotes: t("filters.allNotes")
            }}
            onRestore={(noteId) => void restoreNoteFromTrash(noteId)}
            onDelete={(noteId) => void handleDeleteNoteById(noteId)}
          />
        }
        syncModalSlot={
          <SyncPanel
            settings={settings}
            online={online}
            labels={{
              title: t("sections.sync"),
              language: t("sync.language"),
              provider: t("sync.provider"),
              state: t("sync.state"),
              none: t("sync.none"),
              googleDrive: t("sync.googleDrive"),
              selfHosted: t("sync.selfHosted"),
              planned: t("sync.planned"),
              endpoint: t("sync.endpoint"),
              endpointPlaceholder: t("sync.endpointPlaceholder"),
              token: t("sync.token"),
              tokenPlaceholder: t("sync.tokenPlaceholder"),
              deviceId: t("sync.deviceId"),
              conflictStrategy: t("sync.conflictStrategy"),
              duplicateConflict: t("sync.duplicateConflict"),
              encryption: t("sync.encryption"),
              disabled: t("sync.disabled"),
              lastSync: t("sync.lastSync")
            }}
            onLanguageChange={(language) => void handleChangeLanguage(language)}
            onProviderChange={(provider) => void handleChangeProvider(provider)}
            onUrlChange={(value) =>
              void patchSettings({
                selfHostedUrl: value
              })
            }
            onTokenChange={(value) =>
              void patchSettings({
                selfHostedToken: value
              })
            }
          />
        }
        showClose={false}
        onClose={() => undefined}
        onCloseEditor={() => setOrbitalEditorNoteId(null)}
        onCreateProject={handleCreateProjectNode}
        onUpdateProjectPosition={(projectId, x, y) => void updateProjectPosition(projectId, x, y)}
        onUpdateProjectColor={(projectId, color) => void updateProjectColor(projectId, color)}
        onUpdateFolderColor={(folderId, color) => void updateFolderColor(folderId, color)}
        onUpdateNoteColor={(noteId, color) =>
          void updateNoteMeta(noteId, {
            color
          })
        }
        onCreateFolder={handleCreateFolderNode}
        onCreateNote={async (folderId, projectId) => {
          const note = await handleCreateNoteAt(folderId, [], projectId);
          setOrbitalEditorNoteId(note.id);
          return note;
        }}
        onCreateCanvas={async (folderId, projectId) => {
          const canvas = await handleCreateCanvasAt(folderId, [], projectId);
          setOrbitalEditorNoteId(canvas.id);
          return canvas;
        }}
        onOpenNote={(noteId) => void handleOpenOrbitalNote(noteId)}
        onResolveFileUrl={resolveAssetUrl}
        labels={{
          title: t("orbit.title"),
          subtitle: t("orbit.subtitle"),
          close: t("orbit.close"),
          pause: t("orbit.pause"),
          resume: t("orbit.resume"),
          zoomIn: t("orbit.zoomIn"),
          zoomOut: t("orbit.zoomOut"),
          resetView: t("orbit.resetView"),
          centerSelection: t("orbit.centerSelection"),
          focusMode: t("orbit.focusMode"),
          showAll: t("orbit.showAll"),
          autoFocus: t("orbit.autoFocus"),
          visibleBodies: t("orbit.visibleBodies"),
          hiddenBodies: t("orbit.hiddenBodies"),
          focusedSystem: t("orbit.focusedSystem"),
          openNote: t("orbit.openNote"),
          openCanvas: t("orbit.openCanvas"),
          enterFullscreen: t("canvas.enterFullscreen"),
          exitFullscreen: t("canvas.exitFullscreen"),
          closeEditor: t("orbit.closeEditor"),
          addRootFolder: t("orbit.addRootFolder"),
          addChildFolder: t("orbit.addChildFolder"),
          addNote: t("orbit.addNote"),
          addCanvas: t("orbit.addCanvas"),
          create: t("orbit.create"),
          cancel: t("orbit.cancel"),
          folderNamePlaceholder: t("orbit.folderNamePlaceholder"),
          addProject: t("orbit.addProject"),
          previousProject: t("orbit.previousProject"),
          nextProject: t("orbit.nextProject"),
          project: t("orbit.project"),
          projectsStat: t("orbit.projectsStat"),
          core: t("orbit.core"),
          folder: t("orbit.folder"),
          note: t("orbit.note"),
          canvas: t("orbit.canvas"),
          uncategorized: t("orbit.uncategorized"),
          rootFolders: t("orbit.rootFolders"),
          directNotes: t("orbit.directNotes"),
          subfolders: t("orbit.subfolders"),
          descendants: t("orbit.descendants"),
          updated: t("orbit.updated"),
          empty: t("orbit.empty"),
          emptyCanvas: t("orbit.emptyCanvas"),
          hints: t("orbit.hints"),
          sync: t("orbit.sync"),
          trash: t("orbit.trash"),
          closeModal: t("orbit.closeModal"),
          overview: t("orbit.overview"),
          searchPlaceholder: t("orbit.searchPlaceholder"),
          clearFilters: t("orbit.clearFilters"),
          back: t("orbit.back"),
          notesMenu: t("orbit.notesMenu"),
          foldersMenu: t("orbit.foldersMenu"),
          tagsMenu: t("orbit.tagsMenu"),
          filesMenu: t("orbit.filesMenu"),
          pinnedMenu: t("orbit.pinnedMenu"),
          colorsMenu: t("orbit.colorsMenu"),
          maxDepthReached: t("orbit.maxDepthReached"),
          projectColor: t("orbit.projectColor"),
          folderColor: t("folders.color"),
          noteColor: t("note.color"),
          chooseColor: t("orbit.chooseColor"),
          customColor: t("orbit.customColor"),
          notesStat: t("stats.notes"),
          elementsStat: t("stats.elements"),
          foldersStat: t("stats.folders"),
          tagsStat: t("stats.tags"),
          assetsStat: t("stats.assets"),
          pinnedStat: t("stats.pinned"),
          colorsStat: t("orbit.colorsMenu")
        }}
      />
    </Suspense>
  );
}
