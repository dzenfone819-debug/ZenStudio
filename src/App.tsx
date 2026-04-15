import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useTranslation } from "react-i18next";

import ConfirmDialog from "./components/ConfirmDialog";
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
  resetSyncBinding,
  removeProject,
  removeFolder,
  removeNote,
  removeTag,
  restoreNoteFromTrash,
  renameFolder,
  renameProject,
  renameTag,
  loadCanvasFiles,
  resolveAssetUrl,
  switchActiveLocalVaultDatabase,
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
import {
  createLocalVaultProfile,
  deleteLocalVaultDatabase,
  getNextLocalVaultAfterDelete,
  getStoredActiveLocalVaultId,
  listLocalVaultProfiles,
  removeLocalVaultProfile,
  renameLocalVaultProfile,
  setStoredActiveLocalVaultId
} from "./lib/localVaults";
import {
  createHostedVault,
  issueHostedVaultToken,
  loadHostedAccountOverview,
  loginHostedAccount,
  logoutHostedAccount,
  registerHostedAccount,
  runHostedSync,
  runSelfHostedSync
} from "./lib/sync";
import i18n from "./i18n";
import type {
  AppLanguage,
  HostedAccountUser,
  HostedAccountVault,
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

interface ConfirmDialogState {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  details?: string[];
}

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
  const [activeLocalVaultId, setActiveLocalVaultId] = useState(() => getStoredActiveLocalVaultId());
  const [localVaults, setLocalVaults] = useState(() => listLocalVaultProfiles());
  const [vaultBooting, setVaultBooting] = useState(true);
  const projects = useLiveQuery(() => db.projects.toArray(), [activeLocalVaultId], []);
  const folders = useLiveQuery(() => db.folders.toArray(), [activeLocalVaultId], []);
  const tags = useLiveQuery(() => db.tags.toArray(), [activeLocalVaultId], []);
  const notes = useLiveQuery(() => db.notes.toArray(), [activeLocalVaultId], []);
  const assets = useLiveQuery(() => db.assets.toArray(), [activeLocalVaultId], []);
  const settings = useLiveQuery(() => db.settings.get("app"), [activeLocalVaultId], undefined);

  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [mobileSection, setMobileSection] = useState<MobileSection>("notes");
  const [viewMode, setViewMode] = useState<NoteListView>("all");
  const [search, setSearch] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [orbitalOpen, setOrbitalOpen] = useState(false);
  const [orbitalEditorNoteId, setOrbitalEditorNoteId] = useState<string | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [hostedAccountUser, setHostedAccountUser] = useState<HostedAccountUser | null>(null);
  const [hostedAccountVaults, setHostedAccountVaults] = useState<HostedAccountVault[]>([]);
  const [hostedAccountLoading, setHostedAccountLoading] = useState(false);
  const [hostedActionBusy, setHostedActionBusy] = useState(false);
  const confirmResolverRef = useRef<((value: boolean) => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    setVaultBooting(true);

    void ensureSeedData().finally(() => {
      if (!cancelled) {
        setVaultBooting(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeLocalVaultId]);

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
  const activeLocalVaultName =
    localVaults.find((vault) => vault.id === activeLocalVaultId)?.name ?? null;

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
      const confirmed = await requestConfirmation({
        title: t("note.delete"),
        message: t("note.deleteConfirm"),
        confirmLabel: t("note.deletePermanently"),
        cancelLabel: t("dialog.cancel")
      });

      if (!confirmed) {
        return;
      }

      await removeNote(note.id);
    } else {
      const confirmed = await requestConfirmation({
        title: t("note.moveToTrash"),
        message: t("note.moveToTrashConfirm"),
        confirmLabel: t("note.moveToTrash"),
        cancelLabel: t("dialog.cancel")
      });

      if (!confirmed) {
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
      const confirmed = await requestConfirmation({
        title: t("folders.delete"),
        message: t("folders.deleteCascadeConfirm", {
          name: folderName,
          folderCount: impact.folderCount,
          noteCount: impact.noteCount
        }),
        confirmLabel: t("folders.delete"),
        cancelLabel: t("dialog.cancel"),
        details: [
          `${t("stats.folders")}: ${impact.folderCount}`,
          `${t("stats.notes")}: ${impact.noteCount}`
        ]
      });

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

  const handleDeleteProject = async (projectId: string) => {
    const project = projects.find((entry) => entry.id === projectId);

    if (!project) {
      return;
    }

    const deletedFolderIds = folders
      .filter((folder) => folder.projectId === projectId)
      .map((folder) => folder.id);
    const deletedFolderIdSet = new Set(deletedFolderIds);
    const deletedNotes = notes.filter((note) => note.projectId === projectId);
    const deletedNoteIds = deletedNotes.map((note) => note.id);
    const deletedNoteIdSet = new Set(deletedNoteIds);
    const assetCount = assets.filter((asset) => deletedNoteIdSet.has(asset.noteId)).length;

    const confirmed = await requestConfirmation({
      title: t("project.delete"),
      message: t("project.deleteConfirm", {
        name: project.name,
        folderCount: deletedFolderIds.length,
        noteCount: deletedNoteIds.length,
        assetCount
      }),
      confirmLabel: t("project.delete"),
      cancelLabel: t("dialog.cancel"),
      details: [
        `${t("stats.folders")}: ${deletedFolderIds.length}`,
        `${t("stats.notes")}: ${deletedNoteIds.length}`,
        `${t("stats.assets")}: ${assetCount}`
      ]
    });

    if (!confirmed) {
      return;
    }

    await removeProject(projectId);

    if (selectedFolderId && deletedFolderIdSet.has(selectedFolderId)) {
      setSelectedFolderId(null);
    }

    if (selectedNoteId && deletedNoteIdSet.has(selectedNoteId)) {
      setSelectedNoteId(null);
    }

    if (orbitalEditorNoteId && deletedNoteIdSet.has(orbitalEditorNoteId)) {
      setOrbitalEditorNoteId(null);
    }
  };

  const handleChangeLanguage = async (language: AppLanguage) => {
    await patchSettings({
      language
    });
  };

  const resetUiForVaultSwitch = () => {
    setSelectedFolderId(null);
    setSelectedTagId(null);
    setSelectedNoteId(null);
    setMobileSection("notes");
    setViewMode("all");
    setSearch("");
    setSaveState("idle");
    setOrbitalOpen(false);
    setOrbitalEditorNoteId(null);
    setSyncFeedback(null);
  };

  const activateLocalVault = (localVaultId: string) => {
    switchActiveLocalVaultDatabase(localVaultId);
    setStoredActiveLocalVaultId(localVaultId);
    setActiveLocalVaultId(localVaultId);
    setLocalVaults(listLocalVaultProfiles());
    resetUiForVaultSwitch();
  };

  const handleCreateLocalVault = (name: string) => {
    const createdVault = createLocalVaultProfile(name);
    activateLocalVault(createdVault.id);
  };

  const handleRenameLocalVault = (localVaultId: string, name: string) => {
    renameLocalVaultProfile(localVaultId, name);
    setLocalVaults(listLocalVaultProfiles());
  };

  const handleDeleteLocalVault = async (localVaultId: string) => {
    const targetVault = localVaults.find((vault) => vault.id === localVaultId);

    if (!targetVault) {
      return;
    }

    if (localVaults.length <= 1) {
      setSyncFeedback({
        tone: "error",
        text: t("sync.localVaultCannotDeleteLast")
      });
      return;
    }

    const confirmed = await requestConfirmation({
      title: t("sync.localVaultDelete"),
      message: t("sync.localVaultDeleteConfirm", {
        name: targetVault.name
      }),
      confirmLabel: t("sync.localVaultDelete"),
      cancelLabel: t("dialog.cancel")
    });

    if (!confirmed) {
      return;
    }

    if (localVaultId === activeLocalVaultId) {
      const nextActiveVaultId = getNextLocalVaultAfterDelete(localVaultId);
      switchActiveLocalVaultDatabase(nextActiveVaultId);
      setStoredActiveLocalVaultId(nextActiveVaultId);
      setActiveLocalVaultId(nextActiveVaultId);
      resetUiForVaultSwitch();
    }

    removeLocalVaultProfile(localVaultId);
    await deleteLocalVaultDatabase(localVaultId);
    setLocalVaults(listLocalVaultProfiles());
  };

  const handleChangeProvider = async (provider: SyncProvider) => {
    setSyncFeedback(null);
    await resetSyncBinding();
    await patchSettings({
      syncProvider: provider,
      syncEnabled: provider !== "none",
      syncStatus: provider === "none" ? "disabled" : "idle"
    });
  };

  const handleChangeSelfHostedUrl = async (value: string) => {
    setSyncFeedback(null);
    await resetSyncBinding();
    await patchSettings({
      selfHostedUrl: value
    });
  };

  const handleChangeSelfHostedVaultId = async (value: string) => {
    setSyncFeedback(null);
    await resetSyncBinding();
    await patchSettings({
      selfHostedVaultId: value
    });
  };

  const handleChangeSelfHostedToken = async (value: string) => {
    setSyncFeedback(null);
    await resetSyncBinding();
    await patchSettings({
      selfHostedToken: value
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

  const closeConfirmDialog = (result: boolean) => {
    const resolve = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmDialog(null);
    resolve?.(result);
  };

  const requestConfirmation = (payload: ConfirmDialogState) => {
    if (confirmResolverRef.current) {
      confirmResolverRef.current(false);
    }

    return new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmDialog(payload);
    });
  };

  useEffect(() => {
    return () => {
      if (confirmResolverRef.current) {
        confirmResolverRef.current(false);
        confirmResolverRef.current = null;
      }
    };
  }, []);

  const clearHostedAccountState = () => {
    setHostedAccountUser(null);
    setHostedAccountVaults([]);
  };

  const clearHostedSessionSettings = async () => {
    await patchSettings({
      hostedSessionToken: "",
      hostedUserId: null,
      hostedUserName: "",
      hostedUserEmail: "",
      hostedVaultId: "",
      hostedSyncToken: ""
    });
  };

  const translateHostedAccountError = (error: unknown) => {
    const message = error instanceof Error ? error.message : "HOSTED_FAILED";

    switch (message) {
      case "EMAIL_REQUIRED":
        return t("sync.hostedEmailRequired");
      case "INVALID_EMAIL":
        return t("sync.hostedInvalidEmail");
      case "EMAIL_ALREADY_EXISTS":
        return t("sync.hostedEmailExists");
      case "PASSWORD_TOO_SHORT":
        return t("sync.hostedPasswordTooShort");
      case "EMAIL_AND_PASSWORD_REQUIRED":
        return t("sync.hostedCredentialsRequired");
      case "INVALID_CREDENTIALS":
        return t("sync.hostedInvalidCredentials");
      case "UNAUTHORIZED":
        return t("sync.hostedSessionExpired");
      case "VAULT_NOT_FOUND":
        return t("sync.vaultNotFound");
      case "HTTP_404":
        return t("sync.serverNotFound");
      default:
        return t("sync.hostedFailedGeneric");
    }
  };

  const translateSyncError = (error: unknown) => {
    const message = error instanceof Error ? error.message : "SYNC_FAILED";

    switch (message) {
      case "SELF_HOSTED_PROVIDER_REQUIRED":
        return t("sync.selfHostedOnly");
      case "HOSTED_PROVIDER_REQUIRED":
        return t("sync.hostedFailedGeneric");
      case "SELF_HOSTED_URL_REQUIRED":
        return t("sync.urlRequired");
      case "HOSTED_URL_REQUIRED":
        return t("sync.hostedUrlRequired");
      case "SELF_HOSTED_TOKEN_REQUIRED":
        return t("sync.tokenRequired");
      case "HOSTED_SYNC_TOKEN_REQUIRED":
        return t("sync.hostedTokenRequired");
      case "SELF_HOSTED_VAULT_REQUIRED":
        return t("sync.vaultRequired");
      case "HOSTED_VAULT_REQUIRED":
        return t("sync.hostedVaultRequired");
      case "UNAUTHORIZED":
        return settings?.syncProvider === "hosted"
          ? t("sync.hostedUnauthorized")
          : t("sync.unauthorized");
      case "VAULT_NOT_FOUND":
        return t("sync.vaultNotFound");
      case "SYNC_REVISION_CONFLICT":
        return t("sync.revisionConflict");
      case "HTTP_404":
        return t("sync.serverNotFound");
      default:
        return t("sync.failedGeneric");
    }
  };

  const hydrateHostedAccount = async (
    serverUrl: string,
    sessionToken: string,
    options: {
      feedbackOnError?: boolean;
    } = {}
  ) => {
    setHostedAccountLoading(true);

    try {
      const overview = await loadHostedAccountOverview(serverUrl, sessionToken);
      setHostedAccountUser(overview.user);
      setHostedAccountVaults(overview.vaults);
      await patchSettings({
        hostedUserId: overview.user.id,
        hostedUserName: overview.user.name,
        hostedUserEmail: overview.user.email ?? ""
      });
      return overview;
    } catch (error) {
      if (error instanceof Error && error.message === "UNAUTHORIZED") {
        clearHostedAccountState();
        await resetSyncBinding();
        await clearHostedSessionSettings();

        if (options.feedbackOnError !== false) {
          setSyncFeedback({
            tone: "error",
            text: t("sync.hostedSessionExpired")
          });
        }
      } else if (options.feedbackOnError) {
        setSyncFeedback({
          tone: "error",
          text: translateHostedAccountError(error)
        });
      }

      throw error;
    } finally {
      setHostedAccountLoading(false);
    }
  };

  useEffect(() => {
    if (!settings || settings.syncProvider !== "hosted") {
      setHostedAccountLoading(false);
      clearHostedAccountState();
      return;
    }

    const serverUrl = settings.hostedUrl.trim();
    const sessionToken = settings.hostedSessionToken.trim();

    if (serverUrl.length === 0 || sessionToken.length === 0) {
      setHostedAccountLoading(false);
      clearHostedAccountState();
      return;
    }

    let cancelled = false;
    setHostedAccountLoading(true);

    void loadHostedAccountOverview(serverUrl, sessionToken)
      .then(async (overview) => {
        if (cancelled) {
          return;
        }

        setHostedAccountUser(overview.user);
        setHostedAccountVaults(overview.vaults);
        await patchSettings({
          hostedUserId: overview.user.id,
          hostedUserName: overview.user.name,
          hostedUserEmail: overview.user.email ?? ""
        });

        if (
          settings.hostedVaultId &&
          !overview.vaults.some((vault) => vault.id === settings.hostedVaultId)
        ) {
          await resetSyncBinding();
          await patchSettings({
            hostedVaultId: "",
            hostedSyncToken: ""
          });
        }
      })
      .catch(async (error) => {
        if (cancelled) {
          return;
        }

        if (error instanceof Error && error.message === "UNAUTHORIZED") {
          clearHostedAccountState();
          await resetSyncBinding();
          await clearHostedSessionSettings();
          setSyncFeedback({
            tone: "error",
            text: t("sync.hostedSessionExpired")
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setHostedAccountLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    settings?.hostedSessionToken,
    settings?.hostedUrl,
    settings?.hostedVaultId,
    settings?.syncProvider,
    t
  ]);

  const handleRunSelfHostedSync = async () => {
    if (!settings) {
      return;
    }

    setSyncFeedback(null);

    try {
      const result = await runSelfHostedSync(settings, {
        onStatusChange: async (status) => {
          await patchSettings({
            syncStatus: status
          });
        }
      });

      setSyncFeedback({
        tone: "success",
        text: t("sync.completed", {
          count: result.stats.conflicts
        })
      });
    } catch (error) {
      setSyncFeedback({
        tone: "error",
        text: translateSyncError(error)
      });
    }
  };

  const handleChangeHostedUrl = async (value: string) => {
    setSyncFeedback(null);
    clearHostedAccountState();
    await resetSyncBinding();
    await clearHostedSessionSettings();
    await patchSettings({
      hostedUrl: value
    });
  };

  const handleHostedRegister = async (payload: {
    name: string;
    email: string;
    password: string;
  }) => {
    if (!settings) {
      return;
    }

    setSyncFeedback(null);
    setHostedActionBusy(true);

    try {
      const result = await registerHostedAccount(settings.hostedUrl, payload);
      clearHostedAccountState();
      await resetSyncBinding();
      await patchSettings({
        hostedSessionToken: result.session.token,
        hostedUserId: result.user.id,
        hostedUserName: result.user.name,
        hostedUserEmail: result.user.email ?? "",
        hostedVaultId: "",
        hostedSyncToken: ""
      });
      setHostedAccountUser(result.user);
      setHostedAccountVaults([]);
      setSyncFeedback({
        tone: "success",
        text: t("sync.hostedAccountCreated")
      });
    } catch (error) {
      setSyncFeedback({
        tone: "error",
        text: translateHostedAccountError(error)
      });
    } finally {
      setHostedActionBusy(false);
    }
  };

  const handleHostedLogin = async (payload: { email: string; password: string }) => {
    if (!settings) {
      return;
    }

    setSyncFeedback(null);
    setHostedActionBusy(true);

    try {
      const result = await loginHostedAccount(settings.hostedUrl, payload);
      await resetSyncBinding();
      await patchSettings({
        hostedSessionToken: result.session.token,
        hostedUserId: result.user.id,
        hostedUserName: result.user.name,
        hostedUserEmail: result.user.email ?? "",
        hostedVaultId: "",
        hostedSyncToken: ""
      });
      await hydrateHostedAccount(settings.hostedUrl, result.session.token, {
        feedbackOnError: true
      });
      setSyncFeedback({
        tone: "success",
        text: t("sync.hostedLoggedIn")
      });
    } catch (error) {
      setSyncFeedback({
        tone: "error",
        text: translateHostedAccountError(error)
      });
    } finally {
      setHostedActionBusy(false);
    }
  };

  const handleHostedLogout = async () => {
    if (!settings) {
      return;
    }

    setSyncFeedback(null);
    setHostedActionBusy(true);

    try {
      if (settings.hostedUrl.trim() && settings.hostedSessionToken.trim()) {
        await logoutHostedAccount(settings.hostedUrl, settings.hostedSessionToken);
      }
    } catch {
      // Local logout should still proceed even if the remote session has already expired.
    } finally {
      clearHostedAccountState();
      await resetSyncBinding();
      await clearHostedSessionSettings();
      setHostedActionBusy(false);
      setSyncFeedback({
        tone: "success",
        text: t("sync.hostedLoggedOut")
      });
    }
  };

  const handleRefreshHostedAccount = async () => {
    if (!settings || !settings.hostedUrl.trim() || !settings.hostedSessionToken.trim()) {
      return;
    }

    setSyncFeedback(null);

    try {
      await hydrateHostedAccount(settings.hostedUrl, settings.hostedSessionToken, {
        feedbackOnError: true
      });
    } catch {
      // Feedback already handled in hydrateHostedAccount.
    }
  };

  const handleCreateHostedVault = async (payload: { name: string; id?: string }) => {
    if (!settings) {
      return;
    }

    setSyncFeedback(null);
    setHostedActionBusy(true);

    try {
      await createHostedVault(settings.hostedUrl, settings.hostedSessionToken, payload);
      await hydrateHostedAccount(settings.hostedUrl, settings.hostedSessionToken, {
        feedbackOnError: true
      });
      setSyncFeedback({
        tone: "success",
        text: t("sync.hostedVaultCreated")
      });
    } catch (error) {
      setSyncFeedback({
        tone: "error",
        text: translateHostedAccountError(error)
      });
    } finally {
      setHostedActionBusy(false);
    }
  };

  const handleBindHostedVault = async (vault: HostedAccountVault) => {
    if (!settings) {
      return;
    }

    setSyncFeedback(null);
    setHostedActionBusy(true);

    try {
      const result = await issueHostedVaultToken(
        settings.hostedUrl,
        settings.hostedSessionToken,
        vault.id,
        `${activeLocalVaultName ?? "Local vault"} · ${settings.localDeviceId}`
      );

      await resetSyncBinding();
      await patchSettings({
        hostedVaultId: vault.id,
        hostedSyncToken: result.token
      });
      setSyncFeedback({
        tone: "success",
        text: t("sync.hostedVaultBound")
      });
    } catch (error) {
      setSyncFeedback({
        tone: "error",
        text: translateHostedAccountError(error)
      });
    } finally {
      setHostedActionBusy(false);
    }
  };

  const handleRunHostedSync = async () => {
    if (!settings) {
      return;
    }

    setSyncFeedback(null);

    try {
      const result = await runHostedSync(settings, {
        onStatusChange: async (status) => {
          await patchSettings({
            syncStatus: status
          });
        }
      });

      setSyncFeedback({
        tone: "success",
        text: t("sync.completed", {
          count: result.stats.conflicts
        })
      });
    } catch (error) {
      setSyncFeedback({
        tone: "error",
        text: translateSyncError(error)
      });
    }
  };

  if (vaultBooting || !settings) {
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
      <>
        <OrbitalMapView
        projects={projects}
        folders={folders}
        notes={notes}
        tags={tags}
        assets={assets}
        assetCount={assets.length}
        language={settings.language}
        localVaultName={activeLocalVaultName ?? undefined}
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
            localVaults={localVaults}
            activeLocalVaultId={activeLocalVaultId}
            localVaultName={activeLocalVaultName}
            syncFeedback={syncFeedback}
            syncBusy={settings.syncStatus === "syncing"}
            hostedAccountUser={hostedAccountUser}
            hostedAccountVaults={hostedAccountVaults}
            hostedAccountLoading={hostedAccountLoading}
            hostedActionBusy={hostedActionBusy}
            labels={{
              title: t("sections.sync"),
              panelCaption: t("sync.panelCaption"),
              language: t("sync.language"),
              localVaults: t("sync.localVaults"),
              localVaultsCaption: t("sync.localVaultsCaption"),
              localVaultActive: t("sync.localVaultActive"),
              localVaultOpen: t("sync.localVaultOpen"),
              localVaultCreate: t("sync.localVaultCreate"),
              localVaultCreatePlaceholder: t("sync.localVaultCreatePlaceholder"),
              localVaultRename: t("sync.localVaultRename"),
              localVaultDelete: t("sync.localVaultDelete"),
              localVaultSave: t("sync.localVaultSave"),
              localVaultCancel: t("sync.localVaultCancel"),
              localVaultEmpty: t("sync.localVaultEmpty"),
              localVaultCannotDeleteLast: t("sync.localVaultCannotDeleteLast"),
              provider: t("sync.provider"),
              state: t("sync.state"),
              none: t("sync.none"),
              googleDrive: t("sync.googleDrive"),
              selfHosted: t("sync.selfHosted"),
              hosted: t("sync.hosted"),
              ready: t("sync.ready"),
              planned: t("sync.planned"),
              endpoint: t("sync.endpoint"),
              endpointPlaceholder: t("sync.endpointPlaceholder"),
              vault: t("sync.vault"),
              vaultPlaceholder: t("sync.vaultPlaceholder"),
              token: t("sync.token"),
              tokenPlaceholder: t("sync.tokenPlaceholder"),
              bindingScope: t("sync.bindingScope"),
              deviceId: t("sync.deviceId"),
              conflictStrategy: t("sync.conflictStrategy"),
              duplicateConflict: t("sync.duplicateConflict"),
              encryption: t("sync.encryption"),
              disabled: t("sync.disabled"),
              lastSync: t("sync.lastSync"),
              syncNow: t("sync.syncNow"),
              syncing: t("sync.syncing"),
              selfHostedOnly: t("sync.selfHostedOnly"),
              lastRevision: t("sync.lastRevision"),
              never: t("sync.never"),
              hostedCaption: t("sync.hostedCaption"),
              hostedAccount: t("sync.hostedAccount"),
              hostedAccountLoading: t("sync.hostedAccountLoading"),
              hostedAccountSignedOut: t("sync.hostedAccountSignedOut"),
              hostedRegisterTitle: t("sync.hostedRegisterTitle"),
              hostedLoginTitle: t("sync.hostedLoginTitle"),
              hostedName: t("sync.hostedName"),
              hostedNamePlaceholder: t("sync.hostedNamePlaceholder"),
              hostedEmail: t("sync.hostedEmail"),
              hostedEmailPlaceholder: t("sync.hostedEmailPlaceholder"),
              hostedPassword: t("sync.hostedPassword"),
              hostedPasswordPlaceholder: t("sync.hostedPasswordPlaceholder"),
              hostedRegister: t("sync.hostedRegister"),
              hostedLogin: t("sync.hostedLogin"),
              hostedLogout: t("sync.hostedLogout"),
              hostedRefresh: t("sync.hostedRefresh"),
              hostedCreateVaultTitle: t("sync.hostedCreateVaultTitle"),
              hostedCreateVault: t("sync.hostedCreateVault"),
              hostedCreateVaultNamePlaceholder: t("sync.hostedCreateVaultNamePlaceholder"),
              hostedCreateVaultIdPlaceholder: t("sync.hostedCreateVaultIdPlaceholder"),
              hostedVaults: t("sync.hostedVaults"),
              hostedNoVaults: t("sync.hostedNoVaults"),
              hostedBind: t("sync.hostedBind"),
              hostedBound: t("sync.hostedBound"),
              hostedSelectedVault: t("sync.hostedSelectedVault"),
              hostedAccountConnected: t("sync.hostedAccountConnected"),
              hostedSyncReady: t("sync.hostedSyncReady"),
              hostedSyncNeedsBinding: t("sync.hostedSyncNeedsBinding")
            }}
            onLanguageChange={(language) => void handleChangeLanguage(language)}
            onSelectLocalVault={(localVaultId) => activateLocalVault(localVaultId)}
            onCreateLocalVault={(name) => handleCreateLocalVault(name)}
            onRenameLocalVault={(localVaultId, name) =>
              handleRenameLocalVault(localVaultId, name)
            }
            onDeleteLocalVault={(localVaultId) => void handleDeleteLocalVault(localVaultId)}
            onProviderChange={(provider) => void handleChangeProvider(provider)}
            onUrlChange={(value) => void handleChangeSelfHostedUrl(value)}
            onVaultChange={(value) => void handleChangeSelfHostedVaultId(value)}
            onTokenChange={(value) => void handleChangeSelfHostedToken(value)}
            onHostedUrlChange={(value) => void handleChangeHostedUrl(value)}
            onHostedRegister={(payload) => void handleHostedRegister(payload)}
            onHostedLogin={(payload) => void handleHostedLogin(payload)}
            onHostedLogout={() => void handleHostedLogout()}
            onHostedRefresh={() => void handleRefreshHostedAccount()}
            onHostedCreateVault={(payload) => void handleCreateHostedVault(payload)}
            onHostedBindVault={(vault) => void handleBindHostedVault(vault)}
            onRunHostedSync={() => void handleRunHostedSync()}
            onRunSync={() => void handleRunSelfHostedSync()}
          />
        }
        showClose={false}
        onClose={() => undefined}
        onCloseEditor={() => setOrbitalEditorNoteId(null)}
        onCreateProject={handleCreateProjectNode}
        onRenameProject={(projectId, name) => void renameProject(projectId, name)}
        onUpdateProjectPosition={(projectId, x, y) => void updateProjectPosition(projectId, x, y)}
        onUpdateProjectColor={(projectId, color) => void updateProjectColor(projectId, color)}
        onDeleteProject={(projectId) => void handleDeleteProject(projectId)}
        onUpdateFolderColor={(folderId, color) => void updateFolderColor(folderId, color)}
        onRenameFolder={(folderId, name) => void renameFolder(folderId, name)}
        onDeleteFolder={(folderId) => void handleDeleteFolder(folderId)}
        onRenameNote={(noteId, name) =>
          void updateNoteMeta(noteId, {
            title: name
          })
        }
        onUpdateNoteColor={(noteId, color) =>
          void updateNoteMeta(noteId, {
            color
          })
        }
        onSetNotePinned={(noteId, pinned) =>
          void updateNoteMeta(noteId, {
            pinned
          })
        }
        onDeleteNote={(noteId) => void handleDeleteNoteById(noteId)}
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
          deleteSystem: t("project.delete"),
          deleteFolder: t("folders.delete"),
          moveToTrash: t("note.moveToTrash"),
          notesStat: t("stats.notes"),
          elementsStat: t("stats.elements"),
          foldersStat: t("stats.folders"),
          tagsStat: t("stats.tags"),
          assetsStat: t("stats.assets"),
          pinnedStat: t("stats.pinned"),
          colorsStat: t("orbit.colorsMenu"),
          localVault: t("sync.localVault"),
          renameAction: t("orbit.renameAction")
        }}
        />
        <ConfirmDialog
          open={Boolean(confirmDialog)}
          kicker={t("dialog.kicker")}
          title={confirmDialog?.title ?? ""}
          message={confirmDialog?.message ?? ""}
          confirmLabel={confirmDialog?.confirmLabel ?? ""}
          cancelLabel={confirmDialog?.cancelLabel ?? ""}
          details={confirmDialog?.details}
          onConfirm={() => closeConfirmDialog(true)}
          onCancel={() => closeConfirmDialog(false)}
        />
      </>
    </Suspense>
  );
}
