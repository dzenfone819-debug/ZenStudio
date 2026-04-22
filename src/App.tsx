import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useTranslation } from "react-i18next";

import ConfirmDialog from "./components/ConfirmDialog";
import FolderPanel from "./components/FolderPanel";
import KnowledgeMap from "./components/KnowledgeMap";
import NotesPanel from "./components/NotesPanel";
import SettingsPanel from "./components/SettingsPanel";
import TrashPanel from "./components/TrashPanel";
import {
  createCanvas,
  createProject,
  createFolder,
  createNote,
  createTag,
  db,
  ensureLocalVaultSettingsRecord,
  ensureSeedData,
  inspectFolderRemoval,
  moveNoteToTrash,
  patchSettings,
  patchLocalVaultSettings,
  readLocalVaultSettings,
  resetLocalVaultSyncBinding,
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
  withLocalVaultDatabase,
  saveCanvasContent,
  saveNoteContent,
  storeAsset,
  updateFolderColor,
  updateProjectColor,
  updateProjectPosition,
  updateNoteMeta
} from "./data/db";
import { createEncryptionDescriptor, verifyEncryptionPassphrase } from "./lib/e2ee";
import {
  hasVaultEncryptionSession,
  getVaultEncryptionSessionPassphrase,
  lockVaultEncryptionSession,
  unlockVaultEncryptionSession
} from "./lib/e2eeSession";
import {
  buildFolderPathMap,
  getDescendantFolderIds,
  getFolderCascade,
  matchSearch
} from "./lib/notes";
import {
  createLocalVaultProfile,
  deleteLocalVaultDatabase,
  getLocalVaultProfileByGuid,
  getNextLocalVaultAfterDelete,
  getStoredActiveLocalVaultId,
  listLocalVaultProfiles,
  removeLocalVaultProfile,
  renameLocalVaultProfile,
  resolveUniqueLocalVaultName,
  setStoredActiveLocalVaultId,
  syncLocalVaultGuidsWithBindings,
  type LocalVaultKind,
  updateLocalVaultProfile
} from "./lib/localVaults";
import {
  connectGoogleDriveAccount,
  deleteHostedVault,
  deleteGoogleDriveVault,
  deletePersonalServerVault,
  importRemoteVaultIntoLocalVault,
  migrateRemoteVaultEncryption,
  primeRemoteVaultEncryptionMetadata,
  issueGoogleDriveVaultToken,
  issueHostedVaultToken,
  issuePersonalServerVaultToken,
  runConfiguredSync
} from "./lib/sync";
import { computePendingSyncSummaryFromDirtyEntries } from "./lib/syncStatus";
import {
  clearSyncBinding,
  createSyncConnection,
  listSyncBindings,
  listSyncConnections,
  migrateSyncRegistryFromLegacyVaultSettings,
  removeBindingsForLocalVault,
  removeSyncConnection,
  updateSyncConnection,
  updateSyncBindingState,
  upsertSyncBinding
} from "./lib/syncRegistry";
import i18n from "./i18n";
import type {
  AppSettings,
  AppLanguage,
  MobileSection,
  Note,
  NoteListView,
  RemoteVaultImportResult,
  SaveState,
  SyncConnection,
  SyncConnectionProvider,
  SyncEncryptionDescriptor,
  VaultEncryptionSummary
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
  const [selectedSyncVaultId, setSelectedSyncVaultId] = useState(() => getStoredActiveLocalVaultId());
  const [syncConnections, setSyncConnections] = useState(() => listSyncConnections());
  const [syncBindings, setSyncBindings] = useState(() => listSyncBindings());
  const [vaultEncryptionById, setVaultEncryptionById] = useState<Record<string, VaultEncryptionSummary>>({});
  const [vaultBooting, setVaultBooting] = useState(true);
  const projects = useLiveQuery(() => db.projects.toArray(), [activeLocalVaultId], []);
  const folders = useLiveQuery(() => db.folders.toArray(), [activeLocalVaultId], []);
  const tags = useLiveQuery(() => db.tags.toArray(), [activeLocalVaultId], []);
  const notes = useLiveQuery(() => db.notes.toArray(), [activeLocalVaultId], []);
  const assets = useLiveQuery(() => db.assets.toArray(), [activeLocalVaultId], []);
  const syncDirtyEntries = useLiveQuery(() => db.syncDirtyEntries.toArray(), [activeLocalVaultId], []);
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
  const [syncTransportIndicator, setSyncTransportIndicator] = useState<{
    localVaultId: string;
    tone: "default" | "success" | "warning" | "error";
    text: string;
    title: string;
  } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    typeof document === "undefined" ? true : document.visibilityState !== "hidden"
  );
  const confirmResolverRef = useRef<((value: boolean) => void) | null>(null);
  const autoSyncTimerRef = useRef<number | null>(null);
  const syncTransportTimerRef = useRef<number | null>(null);
  const syncInFlightRef = useRef(false);
  const syncRerunRequestedRef = useRef(false);
  const bootSyncKeyRef = useRef<string | null>(null);
  const lastRemoteRefreshAtRef = useRef<Record<string, number>>({});
  const previousOnlineRef = useRef(online);
  const previousVisibilityRef = useRef(isDocumentVisible);
  const previousOrbitalEditorNoteIdRef = useRef<string | null>(null);

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

  const refreshSyncRegistryState = () => {
    setSyncConnections(listSyncConnections());
    setSyncBindings(listSyncBindings());
  };

  const buildVaultEncryptionSummary = useCallback(
    (
      localVaultId: string,
      vaultSettings:
        | {
            encryptionEnabled?: boolean;
            encryptionKeyId?: string | null;
            encryptionUpdatedAt?: number | null;
          }
        | null
        | undefined
    ): VaultEncryptionSummary => {
      const enabled = Boolean(vaultSettings?.encryptionEnabled);

      return {
        enabled,
        state: enabled
          ? hasVaultEncryptionSession(localVaultId)
            ? "ready"
            : "locked"
          : "disabled",
        keyId: enabled ? vaultSettings?.encryptionKeyId ?? null : null,
        updatedAt: enabled ? vaultSettings?.encryptionUpdatedAt ?? null : null
      };
    },
    []
  );

  const refreshVaultEncryptionSummaries = useCallback(
    async (targetLocalVaultIds?: string[]) => {
      const ids =
        targetLocalVaultIds && targetLocalVaultIds.length > 0
          ? [...new Set(targetLocalVaultIds)]
          : localVaults.map((vault) => vault.id);

      const entries = await Promise.all(
        ids.map(async (localVaultId) => {
          const vaultSettings = await readLocalVaultSettings(localVaultId);

          return [localVaultId, buildVaultEncryptionSummary(localVaultId, vaultSettings)] as const;
        })
      );

      setVaultEncryptionById((current) => ({
        ...current,
        ...Object.fromEntries(entries)
      }));
    },
    [buildVaultEncryptionSummary, localVaults]
  );

  const syncVaultKindsFromEncryptionState = useCallback(
    async (targetLocalVaultIds?: string[]) => {
      const registryVaults = listLocalVaultProfiles();
      const ids =
        targetLocalVaultIds && targetLocalVaultIds.length > 0
          ? [...new Set(targetLocalVaultIds)]
          : registryVaults.map((vault) => vault.id);
      let changed = false;

      for (const localVaultId of ids) {
        const vault = registryVaults.find((entry) => entry.id === localVaultId) ?? null;

        if (!vault) {
          continue;
        }

        const vaultSettings = await readLocalVaultSettings(localVaultId);
        const nextKind: LocalVaultKind = vaultSettings?.encryptionEnabled === true ? "private" : "regular";

        if (nextKind !== vault.vaultKind) {
          updateLocalVaultProfile(localVaultId, {
            vaultKind: nextKind
          });
          changed = true;
        }
      }

      if (changed) {
        setLocalVaults(listLocalVaultProfiles());
      }
    },
    []
  );

  useEffect(() => {
    let cancelled = false;

    void migrateSyncRegistryFromLegacyVaultSettings(
      listLocalVaultProfiles().map((vault) => vault.id),
      readLocalVaultSettings
    ).then(() => {
      if (!cancelled) {
        refreshSyncRegistryState();
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (localVaults.some((vault) => vault.id === selectedSyncVaultId)) {
      return;
    }

    setSelectedSyncVaultId(activeLocalVaultId);
  }, [activeLocalVaultId, localVaults, selectedSyncVaultId]);

  useEffect(() => {
    const nextVaults = syncLocalVaultGuidsWithBindings(syncBindings);

    if (
      nextVaults.length !== localVaults.length ||
      nextVaults.some((vault, index) => vault.vaultGuid !== localVaults[index]?.vaultGuid)
    ) {
      setLocalVaults(nextVaults);
    }
  }, [localVaults, syncBindings]);

  useEffect(() => {
    let cancelled = false;

    void refreshVaultEncryptionSummaries()
      .then(() => syncVaultKindsFromEncryptionState())
      .catch(() => {
      if (!cancelled) {
        setVaultEncryptionById((current) => current);
      }
      });

    return () => {
      cancelled = true;
    };
  }, [refreshVaultEncryptionSummaries, syncVaultKindsFromEncryptionState]);

  useEffect(() => {
    let cancelled = false;

    void readLocalVaultSettings(activeLocalVaultId)
      .then((vaultSettings) => {
        if (cancelled) {
          return;
        }

        setVaultEncryptionById((current) => ({
          ...current,
          [activeLocalVaultId]: buildVaultEncryptionSummary(activeLocalVaultId, vaultSettings)
        }));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [activeLocalVaultId, buildVaultEncryptionSummary, settings]);

  useEffect(() => {
    if (!settings) {
      return;
    }

    if (i18n.language !== settings.language) {
      void i18n.changeLanguage(settings.language);
      document.documentElement.lang = settings.language;
    }
  }, [settings]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsDocumentVisible(document.visibilityState !== "hidden");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

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
  const syncBindingsByVaultId = useMemo(
    () => new Map(syncBindings.map((binding) => [binding.localVaultId, binding])),
    [syncBindings]
  );
  const syncConnectionsById = useMemo(
    () => new Map(syncConnections.map((connection) => [connection.id, connection])),
    [syncConnections]
  );
  const activeVaultBinding = syncBindingsByVaultId.get(activeLocalVaultId) ?? null;
  const activeVaultConnection = activeVaultBinding
    ? syncConnectionsById.get(activeVaultBinding.connectionId) ?? null
    : null;
  const activeVaultEncryption = vaultEncryptionById[activeLocalVaultId] ?? {
    enabled: false,
    state: "disabled" as const,
    keyId: null,
    updatedAt: null
  };
  const translateSyncError = useCallback(
    (
      error: unknown,
      provider: "selfHosted" | "hosted" | "googleDrive" | null = null
    ) => {
      const message = error instanceof Error ? error.message : "SYNC_FAILED";

      switch (message) {
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
        case "GOOGLE_DRIVE_AUTH_REQUIRED":
          return t("sync.googleDriveAuthRequired");
        case "GOOGLE_DRIVE_CLIENT_ID_REQUIRED":
          return t("sync.googleDriveClientIdRequired");
        case "GOOGLE_OAUTH_POPUP_CLOSED":
          return t("sync.googleDrivePopupClosed");
        case "GOOGLE_OAUTH_POPUP_FAILED":
          return t("sync.googleDrivePopupFailed");
        case "ENCRYPTED_SYNC_NOT_IMPLEMENTED":
          return t("sync.googleDriveEncryptedPending");
        case "VAULT_ENCRYPTION_LOCKED":
          return t("sync.vaultEncryptionSyncLocked");
        case "VAULT_ENCRYPTION_REMOTE_SYNC_REQUIRED":
          return t("sync.vaultEncryptionRemoteMigrationRequired");
        case "UNAUTHORIZED":
          return provider === "hosted"
            ? t("sync.hostedUnauthorized")
            : t("sync.unauthorized");
        case "VAULT_NOT_FOUND":
          return t("sync.vaultNotFound");
        case "LAST_VAULT_REQUIRED":
          return t("sync.lastRemoteVaultRequired");
        case "SYNC_REVISION_CONFLICT":
          return t("sync.revisionConflict");
        case "HTTP_404":
        case "SERVER_UNAVAILABLE":
          return t("sync.serverNotFound");
        default:
          return t("sync.failedGeneric");
      }
    },
    [t]
  );
  const activeVaultPendingSync = useMemo(
    () => computePendingSyncSummaryFromDirtyEntries(syncDirtyEntries),
    [syncDirtyEntries]
  );
  const syncChipTimestampFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(settings?.language ?? "en", {
        hour: "2-digit",
        minute: "2-digit"
      }),
    [settings?.language]
  );
  const activeVaultSyncChip = useMemo(() => {
    const pendingCount = activeVaultPendingSync.total;

    if (!activeVaultBinding || !activeVaultConnection) {
      return {
        tone: "default" as const,
        text: t("sync.statusLocalOnly")
      };
    }

    if (activeVaultBinding.syncStatus === "syncing") {
      return {
        tone: "warning" as const,
        text: t("sync.statusSyncing")
      };
    }

    if (
      activeVaultBinding.lastError === "VAULT_ENCRYPTION_LOCKED" ||
      (activeVaultEncryption.state === "locked" && activeVaultEncryption.enabled)
    ) {
      return {
        tone: "warning" as const,
        text:
          pendingCount > 0
            ? t("sync.statusUnlockRequiredPending", { count: pendingCount })
            : t("sync.statusUnlockRequired"),
        title: t("sync.vaultEncryptionSyncLocked")
      };
    }

    if (activeVaultBinding.lastError) {
      const isAuthError = activeVaultBinding.lastError === "UNAUTHORIZED";
      const isUnavailableError =
        activeVaultBinding.lastError === "SERVER_UNAVAILABLE" ||
        activeVaultBinding.lastError === "HTTP_404";
      let message: string;

      if (isAuthError) {
        if (pendingCount > 0) {
          message = t("sync.statusAuthRequiredPending", { count: pendingCount });
        } else {
          message = t("sync.statusAuthRequired");
        }
      } else if (isUnavailableError) {
        if (pendingCount > 0) {
          message = t("sync.statusUnavailablePending", { count: pendingCount });
        } else {
          message = t("sync.statusUnavailable");
        }
      } else {
        if (pendingCount > 0) {
          message = t("sync.statusErrorPending", { count: pendingCount });
        } else {
          message = t("sync.statusError");
        }
      }

      return {
        tone: "error" as const,
        text: message,
        title: translateSyncError(
          new Error(activeVaultBinding.lastError),
          activeVaultConnection.provider
        )
      };
    }

    if (!online && pendingCount > 0) {
      return {
        tone: "warning" as const,
        text: t("sync.statusOfflinePending", { count: pendingCount })
      };
    }

    if (pendingCount > 0) {
      return {
        tone: "warning" as const,
        text: t("sync.statusPending", { count: pendingCount })
      };
    }

    if (activeVaultBinding.lastSyncAt) {
      return {
        tone: "success" as const,
        text: t("sync.statusSyncedAt", {
          time: syncChipTimestampFormatter.format(activeVaultBinding.lastSyncAt)
        })
      };
    }

    return {
      tone: "default" as const,
      text: t("sync.statusReady")
    };
  }, [
    activeVaultBinding,
    activeVaultConnection,
    activeVaultEncryption.enabled,
    activeVaultEncryption.state,
    activeVaultPendingSync.total,
    online,
    syncChipTimestampFormatter,
    t,
    translateSyncError
  ]);
  const localVaultSwitcherItems = useMemo(
    () =>
      localVaults.map((vault) => {
        const binding = syncBindingsByVaultId.get(vault.id) ?? null;
        const connection = binding ? syncConnectionsById.get(binding.connectionId) ?? null : null;

        return {
          id: vault.id,
          name: vault.name,
          vaultKind: vault.vaultKind,
          statusLabel: !binding
            ? t("settings.statusUnbound")
            : binding.lastError === "VAULT_ENCRYPTION_LOCKED"
              ? t("settings.statusUnlockRequired")
            : binding.syncStatus === "syncing"
              ? t("settings.statusSyncing")
              : binding.syncStatus === "error"
                ? t("settings.statusError")
                : t("settings.statusReady"),
          statusTone: !binding
            ? ("default" as const)
            : binding.lastError === "VAULT_ENCRYPTION_LOCKED"
              ? ("warning" as const)
            : binding.syncStatus === "syncing"
              ? ("warning" as const)
              : binding.syncStatus === "error"
                ? ("error" as const)
                : ("success" as const),
          providerLabel: connection
            ? connection.provider === "hosted"
              ? t("sync.hosted")
              : connection.provider === "googleDrive"
                ? t("sync.googleDrive")
                : t("sync.selfHosted")
            : null,
          providerTone: connection?.provider ?? ("local" as const),
          detail: connection
            ? binding?.remoteVaultName
              ? `${connection.label} · ${binding.remoteVaultName}`
              : connection.label
            : t("sync.statusLocalOnly"),
          encryptionState: vaultEncryptionById[vault.id]?.state ?? "disabled"
        };
      }),
    [localVaults, syncBindingsByVaultId, syncConnectionsById, t, vaultEncryptionById]
  );
  const activeSyncTransportChip = useMemo(
    () =>
      syncTransportIndicator && syncTransportIndicator.localVaultId === activeLocalVaultId
        ? {
            tone: syncTransportIndicator.tone,
            text: syncTransportIndicator.text,
            title: syncTransportIndicator.title
          }
        : null,
    [activeLocalVaultId, syncTransportIndicator]
  );

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

  const clearScheduledAutoSync = useCallback(() => {
    if (autoSyncTimerRef.current !== null) {
      window.clearTimeout(autoSyncTimerRef.current);
      autoSyncTimerRef.current = null;
    }
  }, []);

  const showSyncTransportIndicator = useCallback(
    (
      localVaultId: string,
      syncMode: "delta" | "encrypted-delta" | "snapshot" | "encrypted-snapshot"
    ) => {
      if (syncTransportTimerRef.current !== null) {
        window.clearTimeout(syncTransportTimerRef.current);
        syncTransportTimerRef.current = null;
      }

      const indicator =
        syncMode === "encrypted-delta"
          ? {
              tone: "success" as const,
              text: t("sync.transportEncryptedDelta"),
              title: t("sync.transportEncryptedDeltaTitle")
            }
          : syncMode === "delta"
            ? {
                tone: "success" as const,
                text: t("sync.transportDelta"),
                title: t("sync.transportDeltaTitle")
              }
            : syncMode === "encrypted-snapshot"
              ? {
                  tone: "default" as const,
                  text: t("sync.transportEncryptedSnapshot"),
                  title: t("sync.transportEncryptedSnapshotTitle")
                }
              : {
                  tone: "default" as const,
                  text: t("sync.transportSnapshot"),
                  title: t("sync.transportSnapshotTitle")
                };

      setSyncTransportIndicator({
        localVaultId,
        ...indicator
      });

      syncTransportTimerRef.current = window.setTimeout(() => {
        setSyncTransportIndicator((current) =>
          current?.localVaultId === localVaultId ? null : current
        );
        syncTransportTimerRef.current = null;
      }, 3600);
    },
    [t]
  );

  const refreshGoogleDriveConnectionSilently = useCallback(
    async (connection: SyncConnection) => {
      if (connection.provider !== "googleDrive") {
        return null;
      }

      try {
        const result = await connectGoogleDriveAccount({
          loginHint: connection.userEmail || undefined,
          silent: true,
          prompt: "none"
        });

        const nextConnection = updateSyncConnection(connection.id, {
          sessionToken: result.accessToken,
          tokenExpiresAt: result.expiresAt,
          userId: result.userId,
          userName: result.userName,
          userEmail: result.userEmail,
          label: result.userEmail || result.userName || connection.label
        });

        refreshSyncRegistryState();
        return nextConnection;
      } catch {
        return null;
      }
    },
    []
  );

  const runBoundVaultSync = useCallback(
    async (
      localVaultId: string,
      {
        showFeedback = false
      }: {
        showFeedback?: boolean;
      } = {}
    ) => {
      const binding = syncBindingsByVaultId.get(localVaultId) ?? null;
      const connection = binding ? syncConnectionsById.get(binding.connectionId) ?? null : null;
      const isActiveVaultSync = localVaultId === activeLocalVaultId;

      if (!binding || !connection) {
        if (showFeedback) {
          setSyncFeedback({
            tone: "error",
            text: t("sync.bindingMissing")
          });
        }
        return false;
      }

      if (!online) {
        if (showFeedback) {
          setSyncFeedback({
            tone: "error",
            text: t("app.networkOffline")
          });
        }
        return false;
      }

      if (syncInFlightRef.current) {
        if (showFeedback) {
          setSyncFeedback({
            tone: "error",
            text: t("sync.syncing")
          });
        }
        if (isActiveVaultSync) {
          syncRerunRequestedRef.current = true;
        }
        return false;
      }

      if (isActiveVaultSync) {
        clearScheduledAutoSync();
      }

      syncInFlightRef.current = true;

      if (showFeedback) {
        setSyncFeedback(null);
      }

      updateSyncBindingState(localVaultId, {
        syncStatus: "syncing",
        lastError: null
      });
      refreshSyncRegistryState();

      try {
        let targetConnection = connection;
        const runSyncCycle = async (candidate: SyncConnection) =>
          runConfiguredSync(
            {
              provider: candidate.provider,
              serverUrl: candidate.serverUrl,
              vaultId: binding.remoteVaultId,
              token: candidate.provider === "googleDrive" ? candidate.sessionToken : binding.syncToken,
              localVaultId
            },
            {
              localVaultId: isActiveVaultSync ? undefined : localVaultId,
              localPendingCount: isActiveVaultSync ? activeVaultPendingSync.total : undefined,
              onStatusChange: (status) => {
                updateSyncBindingState(localVaultId, {
                  syncStatus: status
                });
                refreshSyncRegistryState();
              }
            }
          );

        if (
          targetConnection.provider === "googleDrive" &&
          targetConnection.tokenExpiresAt &&
          targetConnection.tokenExpiresAt <= Date.now() + 15_000
        ) {
          const refreshedConnection = await refreshGoogleDriveConnectionSilently(targetConnection);

          if (refreshedConnection) {
            targetConnection = refreshedConnection;
          }
        }

        let result;

        try {
          result = await runSyncCycle(targetConnection);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "SYNC_FAILED";

          if (targetConnection.provider !== "googleDrive" || errorMessage !== "GOOGLE_DRIVE_AUTH_REQUIRED") {
            throw error;
          }

          const refreshedConnection = await refreshGoogleDriveConnectionSilently(targetConnection);

          if (!refreshedConnection) {
            throw error;
          }

          targetConnection = refreshedConnection;
          result = await runSyncCycle(targetConnection);
        }

        const completedAt = Date.now();
        lastRemoteRefreshAtRef.current[localVaultId] = completedAt;
        updateSyncBindingState(localVaultId, {
          syncStatus: "idle",
          lastSyncAt: completedAt,
          syncCursor: result.revision,
          lastError: null
        });
        refreshSyncRegistryState();
        showSyncTransportIndicator(localVaultId, result.syncMode);

        if (showFeedback) {
          setSyncFeedback({
            tone: "success",
            text: t("sync.completed", {
              count: result.stats.conflicts
            })
          });
        }

        return true;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "SYNC_FAILED";
        updateSyncBindingState(localVaultId, {
          syncStatus: errorMessage === "VAULT_ENCRYPTION_LOCKED" ? "idle" : "error",
          lastError: errorMessage
        });
        refreshSyncRegistryState();

        if (showFeedback) {
          setSyncFeedback({
            tone: "error",
            text: translateSyncError(error, connection.provider)
          });
        }

        return false;
      } finally {
        syncInFlightRef.current = false;

        if (isActiveVaultSync && syncRerunRequestedRef.current) {
          syncRerunRequestedRef.current = false;
          window.setTimeout(() => {
            void runBoundVaultSync(localVaultId);
          }, 450);
        }
      }
    },
    [
      activeLocalVaultId,
      activeVaultPendingSync.total,
      clearScheduledAutoSync,
      online,
      refreshGoogleDriveConnectionSilently,
      showSyncTransportIndicator,
      syncBindingsByVaultId,
      syncConnectionsById,
      t,
      translateSyncError
    ]
  );

  const runActiveVaultSync = useCallback(
    async ({
      showFeedback = false
    }: {
      showFeedback?: boolean;
    } = {}) => runBoundVaultSync(activeLocalVaultId, { showFeedback }),
    [activeLocalVaultId, runBoundVaultSync]
  );

  const requestAutoSync = useCallback(
    ({
      delayMs = 1600,
      force = false
    }: {
      delayMs?: number;
      force?: boolean;
    } = {}) => {
      if (
        vaultBooting ||
        !activeVaultBinding ||
        !activeVaultConnection ||
        !online ||
        (activeVaultEncryption.enabled && activeVaultEncryption.state === "locked")
      ) {
        return;
      }

      clearScheduledAutoSync();
      const scheduledDelay = force ? Math.min(delayMs, 900) : delayMs;
      autoSyncTimerRef.current = window.setTimeout(() => {
        autoSyncTimerRef.current = null;
        void runActiveVaultSync();
      }, scheduledDelay);
    },
    [
      activeVaultBinding,
      activeVaultConnection,
      clearScheduledAutoSync,
      activeVaultEncryption.enabled,
      activeVaultEncryption.state,
      online,
      runActiveVaultSync,
      vaultBooting
    ]
  );

  useEffect(() => {
    return () => {
      clearScheduledAutoSync();
      if (syncTransportTimerRef.current !== null) {
        window.clearTimeout(syncTransportTimerRef.current);
        syncTransportTimerRef.current = null;
      }
    };
  }, [clearScheduledAutoSync]);

  useEffect(() => {
    if (!activeVaultBinding || !activeVaultConnection || vaultBooting || !online) {
      return;
    }

    const syncKey = `${activeLocalVaultId}:${activeVaultBinding.id}:${activeVaultBinding.remoteVaultId}`;

    if (bootSyncKeyRef.current === syncKey) {
      return;
    }

    bootSyncKeyRef.current = syncKey;
    requestAutoSync({
      delayMs: 900,
      force: true
    });
  }, [
    activeLocalVaultId,
    activeVaultBinding,
    activeVaultConnection,
    online,
    requestAutoSync,
    vaultBooting
  ]);

  useEffect(() => {
    const previousOnline = previousOnlineRef.current;
    previousOnlineRef.current = online;

    if (previousOnline || !online) {
      return;
    }

    requestAutoSync({
      delayMs: 800,
      force: true
    });
  }, [online, requestAutoSync]);

  useEffect(() => {
    const wasVisible = previousVisibilityRef.current;
    previousVisibilityRef.current = isDocumentVisible;

    if (wasVisible || !isDocumentVisible || !activeVaultBinding || !activeVaultConnection || !online) {
      return;
    }

    const lastRemoteRefreshAt =
      lastRemoteRefreshAtRef.current[activeLocalVaultId] ?? activeVaultBinding.lastSyncAt ?? 0;

    if (activeVaultPendingSync.total <= 0 && Date.now() - lastRemoteRefreshAt < 60_000) {
      return;
    }

    requestAutoSync({
      delayMs: 700,
      force: true
    });
  }, [
    activeLocalVaultId,
    activeVaultBinding,
    activeVaultConnection,
    activeVaultPendingSync.total,
    isDocumentVisible,
    online,
    requestAutoSync
  ]);

  useEffect(() => {
    const previousEditorNoteId = previousOrbitalEditorNoteIdRef.current;
    previousOrbitalEditorNoteIdRef.current = orbitalEditorNoteId;

    if (!previousEditorNoteId || orbitalEditorNoteId !== null) {
      return;
    }

    requestAutoSync({
      delayMs: 380
    });
  }, [orbitalEditorNoteId, requestAutoSync]);

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
    const folder = await createFolder(name, parentId, color, projectId);
    requestAutoSync({
      delayMs: 1500
    });
    return folder;
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
    requestAutoSync({
      delayMs: 1500
    });
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
    requestAutoSync({
      delayMs: 1500
    });
    return canvas;
  };

  const handleCreateProjectNode = async (x: number, y: number) => {
    const language = (settings?.language ?? "en") as AppLanguage;
    const name =
      language === "ru"
        ? `Проект ${projects.length + 1}`
        : `Project ${projects.length + 1}`;

    const project = await createProject(name, x, y);
    requestAutoSync({
      delayMs: 1500
    });
    return project;
  };

  const handleRenameProject = async (projectId: string, name: string) => {
    await renameProject(projectId, name);
    requestAutoSync({
      delayMs: 1800
    });
  };

  const handleUpdateProjectPosition = async (projectId: string, x: number, y: number) => {
    await updateProjectPosition(projectId, x, y);
    requestAutoSync({
      delayMs: 2600
    });
  };

  const handleUpdateProjectColor = async (projectId: string, color: string) => {
    await updateProjectColor(projectId, color);
    requestAutoSync({
      delayMs: 1800
    });
  };

  const handleRenameFolder = async (folderId: string, name: string) => {
    await renameFolder(folderId, name);
    requestAutoSync({
      delayMs: 1800
    });
  };

  const handleUpdateFolderColor = async (folderId: string, color: string) => {
    await updateFolderColor(folderId, color);
    requestAutoSync({
      delayMs: 1800
    });
  };

  const handleCreateTag = async (name: string) => {
    const tag = await createTag(name);
    requestAutoSync({
      delayMs: 1800
    });
    return tag;
  };

  const handleUpdateNoteMeta = async (
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
    >,
    delayMs = 1800
  ) => {
    await updateNoteMeta(noteId, patch);
    requestAutoSync({
      delayMs
    });
  };

  const handleToggleTagForNote = async (noteId: string, tagId: string) => {
    const note = notes.find((currentNote) => currentNote.id === noteId);

    if (!note) {
      return;
    }

    const nextTagIds = note.tagIds.includes(tagId)
      ? note.tagIds.filter((currentTagId) => currentTagId !== tagId)
      : [...note.tagIds, tagId];

    await handleUpdateNoteMeta(noteId, {
      tagIds: nextTagIds
    });
  };

  const handleSetTagIdsForNote = async (noteId: string, tagIds: string[]) => {
    await handleUpdateNoteMeta(noteId, {
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
      requestAutoSync({
        delayMs: 6000
      });
    }
  };

  const handleSaveCanvasContentForNote = async (
    noteId: string,
    content: Note["canvasContent"],
    files: Awaited<ReturnType<typeof loadCanvasFiles>>,
    fileNames: Record<string, string>,
    state: SaveState
  ) => {
    setSaveState(state);

    if (state === "saved" && content) {
      await saveCanvasContent(noteId, content, files, fileNames);
      requestAutoSync({
        delayMs: 6000
      });
    }
  };

  const handleStoreAsset = async (noteId: string, file: File) => {
    const assetUrl = await storeAsset(noteId, file);
    requestAutoSync({
      delayMs: 2400
    });
    return assetUrl;
  };

  const handleRestoreNoteById = async (noteId: string) => {
    await restoreNoteFromTrash(noteId);
    requestAutoSync({
      delayMs: 1500
    });
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

    requestAutoSync({
      delayMs: 1500
    });

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
    requestAutoSync({
      delayMs: 1500
    });

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
    requestAutoSync({
      delayMs: 1500
    });

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

  const getVaultDescriptor = (localVaultId: string) => {
    const vault =
      localVaults.find((entry) => entry.id === localVaultId) ??
      listLocalVaultProfiles().find((entry) => entry.id === localVaultId) ??
      null;

    if (!vault) {
      throw new Error("LOCAL_VAULT_NOT_FOUND");
    }

    return {
      localVaultId: vault.id,
      vaultGuid: vault.vaultGuid,
      name: vault.name,
      vaultKind: vault.vaultKind,
      schemaVersion: 1
    };
  };

  const readVaultSettings = async (localVaultId: string) => {
    if (localVaultId === activeLocalVaultId && settings) {
      return settings;
    }

    const vaultSettings = await readLocalVaultSettings(localVaultId);

    if (!vaultSettings) {
      throw new Error("SETTINGS_MISSING");
    }

    return vaultSettings;
  };

  const patchVaultSettings = async (
    localVaultId: string,
    patch: Partial<Omit<AppSettings, "id">>
  ) => {
    if (localVaultId === activeLocalVaultId) {
      await patchSettings(patch);
      return;
    }

    await patchLocalVaultSettings(localVaultId, patch);
  };

  const buildEncryptionDescriptorFromSettings = (
    vaultSettings: Awaited<ReturnType<typeof readLocalVaultSettings>>,
    state: "ready" | "locked" = "ready"
  ) => {
    if (
      !vaultSettings?.encryptionEnabled ||
      !vaultSettings.encryptionSalt ||
      !vaultSettings.encryptionKeyId ||
      !vaultSettings.encryptionKdf
    ) {
      throw new Error("VAULT_ENCRYPTION_DISABLED");
    }

    return {
      version: (vaultSettings.encryptionVersion ?? 1) as 1,
      state,
      keyId: vaultSettings.encryptionKeyId,
      kdf: vaultSettings.encryptionKdf,
      iterations: vaultSettings.encryptionIterations,
      salt: vaultSettings.encryptionSalt,
      keyCheck: vaultSettings.encryptionKeyCheck
    } satisfies SyncEncryptionDescriptor;
  };

  const handleEnableVaultEncryption = async (input: {
    localVaultId: string;
    passphrase: string;
  }) => {
    const remoteTarget = resolveRemoteEncryptionMigrationTarget(input.localVaultId);
    let descriptor: SyncEncryptionDescriptor | null = null;
    let revision: string | null = null;
    let completedAt: number | null = null;

    if (remoteTarget) {
      const migrated = await withLocalVaultDatabase(input.localVaultId, async (database) =>
        migrateRemoteVaultEncryption(
          remoteTarget.remote,
          {
            mode: "enable",
            passphrase: input.passphrase
          },
          database
        )
      );

      descriptor = migrated.descriptor;
      revision = migrated.revision;
      completedAt = Date.now();
      updateSyncBindingState(input.localVaultId, {
        syncStatus: "idle",
        lastError: null,
        lastSyncAt: completedAt,
        syncCursor: migrated.revision
      });
      refreshSyncRegistryState();
    } else {
      descriptor = await createEncryptionDescriptor(
        input.passphrase,
        getVaultDescriptor(input.localVaultId)
      );
    }

    if (!descriptor) {
      throw new Error("SYNC_FAILED");
    }

    await patchVaultSettings(input.localVaultId, {
      encryptionEnabled: true,
      encryptionVersion: descriptor.version,
      encryptionKdf: descriptor.kdf,
      encryptionIterations: descriptor.iterations,
      encryptionKeyId: descriptor.keyId,
      encryptionSalt: descriptor.salt,
      encryptionKeyCheck: descriptor.keyCheck,
      encryptionUpdatedAt: Date.now(),
      ...(completedAt !== null
        ? {
            lastSyncAt: completedAt,
            syncCursor: revision,
            syncStatus: "idle" as const
          }
        : {})
    });

    unlockVaultEncryptionSession(input.localVaultId, input.passphrase);
    await refreshVaultEncryptionSummaries([input.localVaultId]);
    setSyncFeedback({
      tone: "success",
      text: remoteTarget
        ? t("sync.vaultEncryptionEnabledAndMigrated")
        : t("sync.vaultEncryptionEnabled")
    });
  };

  const handleUnlockVaultEncryption = async (input: {
    localVaultId: string;
    passphrase: string;
  }) => {
    let vaultSettings = await readLocalVaultSettings(input.localVaultId);

    if (!vaultSettings?.encryptionEnabled || !vaultSettings.encryptionSalt || !vaultSettings.encryptionKeyId) {
      const binding = syncBindingsByVaultId.get(input.localVaultId) ?? null;
      const connection = binding ? syncConnectionsById.get(binding.connectionId) ?? null : null;

      if (binding && connection) {
        await ensureLocalVaultSettingsRecord(input.localVaultId, {
          language: (settings?.language ?? (i18n.language === "ru" ? "ru" : "en")) as AppLanguage
        });

        await primeRemoteVaultEncryptionMetadata({
          provider: connection.provider,
          localVaultId: input.localVaultId,
          serverUrl: connection.serverUrl,
          remoteVaultId: binding.remoteVaultId,
          syncToken: connection.provider === "googleDrive" ? connection.sessionToken : binding.syncToken
        });

        vaultSettings = await readLocalVaultSettings(input.localVaultId);
      }
    }

    const descriptor = buildEncryptionDescriptorFromSettings(vaultSettings, "locked");

    await verifyEncryptionPassphrase(
      input.passphrase,
      descriptor,
      getVaultDescriptor(input.localVaultId)
    );

    unlockVaultEncryptionSession(input.localVaultId, input.passphrase);
    const binding = syncBindingsByVaultId.get(input.localVaultId) ?? null;
    if (binding?.lastError === "VAULT_ENCRYPTION_LOCKED") {
      updateSyncBindingState(input.localVaultId, {
        syncStatus: "idle",
        lastError: null
      });
      refreshSyncRegistryState();
    }
    await refreshVaultEncryptionSummaries([input.localVaultId]);
    setSyncFeedback({
      tone: "success",
      text: t("sync.vaultEncryptionUnlocked")
    });
  };

  const resolveRemoteEncryptionMigrationTarget = (localVaultId: string) => {
    const binding = syncBindingsByVaultId.get(localVaultId) ?? null;

    if (!binding) {
      return null;
    }

    if (!online) {
      throw new Error("VAULT_ENCRYPTION_REMOTE_SYNC_REQUIRED");
    }

    const connection = syncConnectionsById.get(binding.connectionId) ?? null;

    if (!connection) {
      throw new Error("VAULT_ENCRYPTION_REMOTE_SYNC_REQUIRED");
    }

    const vaultProfile = localVaults.find((entry) => entry.id === localVaultId) ?? null;

    return {
      binding,
      remote: {
        provider: connection.provider,
        serverUrl: connection.serverUrl,
        vaultId: binding.remoteVaultId,
        token: connection.provider === "googleDrive" ? connection.sessionToken : binding.syncToken,
        localVaultId,
        localVaultName: vaultProfile?.name ?? binding.remoteVaultName
      } as const
    };
  };

  const handleChangeVaultEncryptionPassphrase = async (input: {
    localVaultId: string;
    currentPassphrase?: string;
    nextPassphrase: string;
  }) => {
    const currentPassphrase =
      input.currentPassphrase?.trim() || getVaultEncryptionSessionPassphrase(input.localVaultId) || "";

    if (!currentPassphrase) {
      throw new Error("VAULT_ENCRYPTION_LOCKED");
    }

    const remoteTarget = resolveRemoteEncryptionMigrationTarget(input.localVaultId);
    let nextDescriptor: SyncEncryptionDescriptor | null = null;
    let revision: string | null = null;
    let completedAt: number | null = null;

    if (remoteTarget) {
      const migrated = await withLocalVaultDatabase(input.localVaultId, async (database) =>
        migrateRemoteVaultEncryption(
          remoteTarget.remote,
          {
            mode: "changePassphrase",
            currentPassphrase,
            nextPassphrase: input.nextPassphrase
          },
          database
        )
      );

      nextDescriptor = migrated.descriptor;
      revision = migrated.revision;
      completedAt = Date.now();
      updateSyncBindingState(input.localVaultId, {
        syncStatus: "idle",
        lastError: null,
        lastSyncAt: completedAt,
        syncCursor: migrated.revision
      });
      refreshSyncRegistryState();
    } else {
      nextDescriptor = await createEncryptionDescriptor(
        input.nextPassphrase,
        getVaultDescriptor(input.localVaultId)
      );
    }

    if (!nextDescriptor) {
      throw new Error("VAULT_ENCRYPTION_DISABLED");
    }

    await patchVaultSettings(input.localVaultId, {
      encryptionEnabled: true,
      encryptionVersion: nextDescriptor.version,
      encryptionKdf: nextDescriptor.kdf,
      encryptionIterations: nextDescriptor.iterations,
      encryptionKeyId: nextDescriptor.keyId,
      encryptionSalt: nextDescriptor.salt,
      encryptionKeyCheck: nextDescriptor.keyCheck,
      encryptionUpdatedAt: Date.now(),
      syncStatus: "idle",
      ...(completedAt !== null
        ? {
            lastSyncAt: completedAt,
            syncCursor: revision
          }
        : {})
    });

    unlockVaultEncryptionSession(input.localVaultId, input.nextPassphrase);
    await refreshVaultEncryptionSummaries([input.localVaultId]);
    setSyncFeedback({
      tone: "success",
      text: remoteTarget
        ? t("sync.vaultEncryptionPassphraseChanged")
        : t("sync.vaultEncryptionPassphraseChangedLocalOnly")
    });
  };

  const handleDisableVaultEncryption = async (input: {
    localVaultId: string;
    currentPassphrase?: string;
  }) => {
    const currentPassphrase =
      input.currentPassphrase?.trim() || getVaultEncryptionSessionPassphrase(input.localVaultId) || "";

    if (!currentPassphrase) {
      throw new Error("VAULT_ENCRYPTION_LOCKED");
    }

    const remoteTarget = resolveRemoteEncryptionMigrationTarget(input.localVaultId);
    let revision: string | null = null;
    let completedAt: number | null = null;

    if (remoteTarget) {
      const migrated = await withLocalVaultDatabase(input.localVaultId, async (database) =>
        migrateRemoteVaultEncryption(
          remoteTarget.remote,
          {
            mode: "disable",
            currentPassphrase
          },
          database
        )
      );

      revision = migrated.revision;
      completedAt = Date.now();
      updateSyncBindingState(input.localVaultId, {
        syncStatus: "idle",
        lastError: null,
        lastSyncAt: completedAt,
        syncCursor: migrated.revision
      });
      refreshSyncRegistryState();
    }

    await patchVaultSettings(input.localVaultId, {
      encryptionEnabled: false,
      encryptionVersion: null,
      encryptionKdf: null,
      encryptionIterations: null,
      encryptionKeyId: null,
      encryptionSalt: null,
      encryptionKeyCheck: null,
      encryptionUpdatedAt: null,
      syncStatus: "idle",
      ...(completedAt !== null
        ? {
            lastSyncAt: completedAt,
            syncCursor: revision
          }
        : {})
    });

    lockVaultEncryptionSession(input.localVaultId);
    await refreshVaultEncryptionSummaries([input.localVaultId]);
    setSyncFeedback({
      tone: "success",
      text: remoteTarget
        ? t("sync.vaultEncryptionDisabledAndMigrated")
        : t("sync.vaultEncryptionDisabledLocalOnly")
    });
  };

  const handleLockVaultEncryption = async (localVaultId: string) => {
    lockVaultEncryptionSession(localVaultId);
    await refreshVaultEncryptionSummaries([localVaultId]);
    setSyncFeedback({
      tone: "success",
      text: t("sync.vaultEncryptionLocked")
    });
  };

  const resetUiForVaultSwitch = () => {
    clearScheduledAutoSync();
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
    setSelectedSyncVaultId(localVaultId);
    setLocalVaults(listLocalVaultProfiles());
    resetUiForVaultSwitch();
  };

  const createPrivateVaultLocally = async (
    localVaultId: string,
    passphrase: string
  ) => {
    if (!passphrase.trim()) {
      throw new Error("VAULT_ENCRYPTION_PASSPHRASE_REQUIRED");
    }

    if (passphrase.trim().length < 8) {
      throw new Error("VAULT_ENCRYPTION_PASSPHRASE_TOO_SHORT");
    }

    await ensureLocalVaultSettingsRecord(localVaultId, {
      language: (settings?.language ?? (i18n.language === "ru" ? "ru" : "en")) as AppLanguage
    });

    const descriptor = await createEncryptionDescriptor(passphrase.trim(), getVaultDescriptor(localVaultId));

    await patchLocalVaultSettings(localVaultId, {
      encryptionEnabled: true,
      encryptionVersion: descriptor.version,
      encryptionKdf: descriptor.kdf,
      encryptionIterations: descriptor.iterations,
      encryptionKeyId: descriptor.keyId,
      encryptionSalt: descriptor.salt,
      encryptionKeyCheck: descriptor.keyCheck,
      encryptionUpdatedAt: Date.now(),
      syncStatus: "idle"
    });

    unlockVaultEncryptionSession(localVaultId, passphrase.trim());
  };

  const handleCreateLocalVault = async (input: {
    name: string;
    vaultKind: LocalVaultKind;
    passphrase?: string;
    activate?: boolean;
  }) => {
    const createdVault = createLocalVaultProfile(input.name, {
      activate: false,
      vaultKind: input.vaultKind
    });

    try {
      if (input.vaultKind === "private") {
        await createPrivateVaultLocally(createdVault.id, input.passphrase ?? "");
        await refreshVaultEncryptionSummaries([createdVault.id]);
        await syncVaultKindsFromEncryptionState([createdVault.id]);
      }
    } catch (error) {
      removeLocalVaultProfile(createdVault.id);
      await deleteLocalVaultDatabase(createdVault.id);
      setLocalVaults(listLocalVaultProfiles());
      setSelectedSyncVaultId(activeLocalVaultId);
      throw error;
    }

    setLocalVaults(listLocalVaultProfiles());

    if (input.activate) {
      activateLocalVault(createdVault.id);
    } else {
      setSelectedSyncVaultId(createdVault.id);
    }

    return createdVault.id;
  };

  const handleRenameLocalVault = (localVaultId: string, name: string) => {
    renameLocalVaultProfile(localVaultId, name);
    setLocalVaults(listLocalVaultProfiles());
  };

  const clearLocalVaultBindingState = async (localVaultId: string) => {
    const binding = syncBindingsByVaultId.get(localVaultId);

    if (!binding) {
      return false;
    }

    await resetLocalVaultSyncBinding(localVaultId);
    clearSyncBinding(localVaultId);

    if (localVaultId === activeLocalVaultId) {
      clearScheduledAutoSync();
    }

    refreshSyncRegistryState();
    return true;
  };

  const handleDeleteLocalVault = async (
    localVaultId: string,
    options?: {
      skipConfirmation?: boolean;
    }
  ) => {
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

    if (!(options?.skipConfirmation ?? false)) {
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
    }

    if (localVaultId === activeLocalVaultId) {
      const nextActiveVaultId = getNextLocalVaultAfterDelete(localVaultId);
      switchActiveLocalVaultDatabase(nextActiveVaultId);
      setStoredActiveLocalVaultId(nextActiveVaultId);
      setActiveLocalVaultId(nextActiveVaultId);
      resetUiForVaultSwitch();
    }

    removeLocalVaultProfile(localVaultId);
    removeBindingsForLocalVault(localVaultId);
    await deleteLocalVaultDatabase(localVaultId);
    setLocalVaults(listLocalVaultProfiles());
    refreshSyncRegistryState();
  };

  const handleCreateSyncConnection = (input: {
    provider: SyncConnectionProvider;
    serverUrl: string;
    label?: string;
    managementToken?: string;
    sessionToken?: string;
    tokenExpiresAt?: number | null;
    userId?: string | null;
    userName?: string;
    userEmail?: string;
  }) => {
    createSyncConnection(input);
    refreshSyncRegistryState();
  };

  const handleDeleteSyncConnection = async (connectionId: string) => {
    const affectedBindings = syncBindings.filter((binding) => binding.connectionId === connectionId);

    if (affectedBindings.length > 0) {
      const confirmed = await requestConfirmation({
        title: t("sync.connectionDelete"),
        message: t("sync.connectionDeleteConfirm", {
          count: affectedBindings.length
        }),
        confirmLabel: t("sync.connectionDelete"),
        cancelLabel: t("dialog.cancel")
      });

      if (!confirmed) {
        return;
      }
    }

    for (const binding of affectedBindings) {
      await resetLocalVaultSyncBinding(binding.localVaultId);
    }

    removeSyncConnection(connectionId);
    refreshSyncRegistryState();
  };

  const handleUpdateSyncConnection = (
    connectionId: string,
    patch: Partial<Omit<SyncConnection, "id" | "provider" | "createdAt">>
  ) => {
    updateSyncConnection(connectionId, patch);
    refreshSyncRegistryState();
  };

  const handleDeleteRemoteVault = async (input: {
    connectionId: string;
    remoteVaultId: string;
  }) => {
    const connection = syncConnectionsById.get(input.connectionId) ?? null;

    if (!connection) {
      throw new Error("SYNC_CONNECTION_NOT_FOUND");
    }

    if (connection.provider === "hosted") {
      await deleteHostedVault(connection.serverUrl, connection.sessionToken, input.remoteVaultId);
    } else if (connection.provider === "googleDrive") {
      await deleteGoogleDriveVault(connection.sessionToken, input.remoteVaultId);
    } else {
      await deletePersonalServerVault(
        connection.serverUrl,
        connection.managementToken,
        input.remoteVaultId
      );
    }

    const affectedBindings = syncBindings.filter(
      (binding) =>
        binding.connectionId === input.connectionId && binding.remoteVaultId === input.remoteVaultId
    );

    for (const binding of affectedBindings) {
      await clearLocalVaultBindingState(binding.localVaultId);
    }
  };

  const issueConnectionVaultToken = async (
    connectionId: string,
    remoteVaultId: string,
    label: string
  ) => {
    const connection = syncConnectionsById.get(connectionId) ?? null;

    if (!connection) {
      throw new Error("SYNC_CONNECTION_NOT_FOUND");
    }

    if (connection.provider === "hosted") {
      const response = await issueHostedVaultToken(
        connection.serverUrl,
        connection.sessionToken,
        remoteVaultId,
        label
      );

      return {
        connection,
        syncToken: response.token
      };
    }

    if (connection.provider === "googleDrive") {
      const response = await issueGoogleDriveVaultToken(remoteVaultId);

      return {
        connection,
        syncToken: response.token
      };
    }

    const response = await issuePersonalServerVaultToken(
      connection.serverUrl,
      connection.managementToken,
      remoteVaultId,
      label
    );

    return {
      connection,
      syncToken: response.token
    };
  };

  const applyVaultBinding = async (
    input: {
      localVaultId: string;
      connectionId: string;
      remoteVaultId: string;
      remoteVaultName?: string;
      syncToken: string;
    },
    options?: {
      resetLocalSyncState?: boolean;
      keepBindingMetadata?: boolean;
      lastSyncAt?: number | null;
      syncCursor?: string | null;
      successMessage?: string | null;
      scheduleSync?: boolean;
    }
  ) => {
    if (options?.resetLocalSyncState ?? true) {
      await resetLocalVaultSyncBinding(input.localVaultId);
    }

    updateLocalVaultProfile(input.localVaultId, {
      vaultGuid: input.remoteVaultId
    });

    upsertSyncBinding({
      ...input,
      syncStatus: "idle",
      lastError: null,
      ...(options?.keepBindingMetadata
        ? {}
        : {
            lastSyncAt: options?.lastSyncAt ?? null,
            syncCursor: options?.syncCursor ?? null
          })
    });

    setLocalVaults(listLocalVaultProfiles());
    refreshSyncRegistryState();

    if (options?.successMessage) {
      setSyncFeedback({
        tone: "success",
        text: options.successMessage
      });
    }

    if ((options?.scheduleSync ?? false) && input.localVaultId === activeLocalVaultId) {
      window.setTimeout(() => {
        requestAutoSync({
          delayMs: 700,
          force: true
        });
      }, 0);
    }
  };

  const handleBindVaultToConnection = async (input: {
    localVaultId: string;
    connectionId: string;
    remoteVaultId: string;
    remoteVaultName?: string;
    syncToken: string;
  }) => {
    await applyVaultBinding(input, {
      resetLocalSyncState: true,
      keepBindingMetadata: false,
      lastSyncAt: null,
      syncCursor: null,
      successMessage: t("sync.bindingUpdated"),
      scheduleSync: true
    });
  };

  const handleImportRemoteVault = async (input: {
    connectionId: string;
    remoteVaultId: string;
    remoteVaultName: string;
    remoteVaultKind?: LocalVaultKind;
    openAfterImport?: boolean;
  }): Promise<RemoteVaultImportResult> => {
    const remoteVaultId = input.remoteVaultId.trim();
    const remoteVaultName = input.remoteVaultName.trim() || input.remoteVaultId;

    if (!remoteVaultId) {
      throw new Error("VAULT_NOT_FOUND");
    }

    const { connection, syncToken } = await issueConnectionVaultToken(
      input.connectionId,
      remoteVaultId,
      `${remoteVaultName} · ${remoteVaultId}`
    );

    const existingLocalVault = getLocalVaultProfileByGuid(remoteVaultId);
    let targetLocalVault = existingLocalVault;
    let nameAdjusted = false;
    let disposition: RemoteVaultImportResult["disposition"] = existingLocalVault
      ? "linked"
      : "imported";
    let importedRevision: string | null | undefined;
    let importedAt: number | null | undefined;

    if (!targetLocalVault) {
      const uniqueName = resolveUniqueLocalVaultName(remoteVaultName);
      nameAdjusted = uniqueName !== remoteVaultName;
      targetLocalVault = createLocalVaultProfile(uniqueName, {
        activate: false,
        vaultGuid: remoteVaultId,
        vaultKind: input.remoteVaultKind ?? "regular"
      });
      await ensureLocalVaultSettingsRecord(targetLocalVault.id, {
        language: (settings?.language ?? (i18n.language === "ru" ? "ru" : "en")) as AppLanguage
      });
      setLocalVaults(listLocalVaultProfiles());
      setSelectedSyncVaultId(targetLocalVault.id);

      try {
        const imported = await importRemoteVaultIntoLocalVault({
          provider: connection.provider,
          localVaultId: targetLocalVault.id,
          serverUrl: connection.serverUrl,
          remoteVaultId,
          syncToken: connection.provider === "googleDrive" ? connection.sessionToken : syncToken,
          language: settings?.language ?? "en"
        });

        importedRevision = imported.revision;
        importedAt = Date.now();
        await refreshVaultEncryptionSummaries([targetLocalVault.id]);
        await syncVaultKindsFromEncryptionState([targetLocalVault.id]);
        if (imported.vaultKind === "private" && targetLocalVault.vaultKind !== "private") {
          updateLocalVaultProfile(targetLocalVault.id, {
            vaultKind: "private"
          });
          targetLocalVault = getLocalVaultProfileByGuid(remoteVaultId) ?? targetLocalVault;
          setLocalVaults(listLocalVaultProfiles());
        }
      } catch (error) {
        await refreshVaultEncryptionSummaries([targetLocalVault.id]);
        await syncVaultKindsFromEncryptionState([targetLocalVault.id]);

        if (error instanceof Error && error.message === "VAULT_ENCRYPTION_LOCKED") {
          disposition = "pendingUnlock";
        } else {
          throw error;
        }
      }
    }

    if (targetLocalVault && input.remoteVaultKind === "private" && targetLocalVault.vaultKind !== "private") {
      const targetLocalVaultId = targetLocalVault.id;
      updateLocalVaultProfile(targetLocalVault.id, {
        vaultKind: "private"
      });
      targetLocalVault =
        listLocalVaultProfiles().find((vault) => vault.id === targetLocalVaultId) ?? targetLocalVault;
      setLocalVaults(listLocalVaultProfiles());
    }

    await applyVaultBinding(
      {
        localVaultId: targetLocalVault.id,
        connectionId: input.connectionId,
        remoteVaultId,
        remoteVaultName,
        syncToken
      },
      {
        resetLocalSyncState: false,
        keepBindingMetadata: disposition === "linked",
        lastSyncAt: disposition === "imported" ? importedAt ?? null : undefined,
        syncCursor: disposition === "imported" ? importedRevision ?? null : undefined,
        successMessage:
          disposition === "pendingUnlock"
            ? null
            : disposition === "imported"
            ? nameAdjusted
              ? t("settings.remoteImportAdjusted", {
                  vault: targetLocalVault.name
                })
              : t("settings.remoteImportCreated", {
                  vault: targetLocalVault.name
                })
            : t("settings.remoteImportLinked", {
                vault: targetLocalVault.name
              }),
        scheduleSync:
          disposition !== "pendingUnlock" &&
          (input.openAfterImport === true || targetLocalVault.id === activeLocalVaultId)
      }
    );

    setSelectedSyncVaultId(targetLocalVault.id);

    if (input.openAfterImport) {
      activateLocalVault(targetLocalVault.id);
    } else {
      setLocalVaults(listLocalVaultProfiles());
    }

    return {
      localVaultId: targetLocalVault.id,
      localVaultName: targetLocalVault.name,
      disposition,
      nameAdjusted
    };
  };

  const handleClearVaultBinding = async (localVaultId: string) => {
    const binding = syncBindingsByVaultId.get(localVaultId);

    if (!binding) {
      return;
    }

    await clearLocalVaultBindingState(localVaultId);
    setSyncFeedback({
      tone: "success",
      text: t("sync.bindingCleared")
    });
  };

  const handleRunVaultSync = async (localVaultId: string) => {
    await runBoundVaultSync(localVaultId, {
      showFeedback: true
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
                  void handleUpdateNoteMeta(orbitalEditorEntry.id, {
                    title
                  })
                }
                onFolderChange={(folderId) =>
                  void handleUpdateNoteMeta(orbitalEditorEntry.id, {
                    folderId
                  })
                }
                onNoteColorChange={(color) =>
                  void handleUpdateNoteMeta(orbitalEditorEntry.id, {
                    color
                  })
                }
                onTagIdsChange={(tagIds) =>
                  void handleSetTagIdsForNote(orbitalEditorEntry.id, tagIds)
                }
                onCreateTag={handleCreateTag}
                onDelete={() => void handleDeleteNoteById(orbitalEditorEntry.id)}
                onRestore={() => void handleRestoreNoteById(orbitalEditorEntry.id)}
                onTogglePin={() =>
                  void handleUpdateNoteMeta(orbitalEditorEntry.id, {
                    pinned: !orbitalEditorEntry.pinned
                  })
                }
                onToggleFavorite={() =>
                  void handleUpdateNoteMeta(orbitalEditorEntry.id, {
                    favorite: !orbitalEditorEntry.favorite
                  })
                }
                onContentChange={(content, files, fileNames, state) => {
                  void handleSaveCanvasContentForNote(
                    orbitalEditorEntry.id,
                    content,
                    files,
                    fileNames,
                    state
                  );
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
                  void handleUpdateNoteMeta(orbitalEditorEntry.id, {
                    title
                  })
                }
                onFolderChange={(folderId) =>
                  void handleUpdateNoteMeta(orbitalEditorEntry.id, {
                    folderId
                  })
                }
                onNoteColorChange={(color) =>
                  void handleUpdateNoteMeta(orbitalEditorEntry.id, {
                    color
                  })
                }
                onTagIdsChange={(tagIds) =>
                  void handleSetTagIdsForNote(orbitalEditorEntry.id, tagIds)
                }
                onCreateTag={handleCreateTag}
                onDelete={() => void handleDeleteNoteById(orbitalEditorEntry.id)}
                onRestore={() => void handleRestoreNoteById(orbitalEditorEntry.id)}
                onTogglePin={() =>
                  void handleUpdateNoteMeta(orbitalEditorEntry.id, {
                    pinned: !orbitalEditorEntry.pinned
                  })
                }
                onToggleFavorite={() =>
                  void handleUpdateNoteMeta(orbitalEditorEntry.id, {
                    favorite: !orbitalEditorEntry.favorite
                  })
                }
                onContentChange={(content, state) =>
                  void handleContentChangeForNote(orbitalEditorEntry.id, content, state)
                }
                onUploadFile={(file) => handleStoreAsset(orbitalEditorEntry.id, file)}
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
            onRestore={(noteId) => void handleRestoreNoteById(noteId)}
            onDelete={(noteId) => void handleDeleteNoteById(noteId)}
          />
        }
        settingsModalSlot={
          <SettingsPanel
            settings={settings}
            online={online}
            localVaults={localVaults}
            activeLocalVaultId={activeLocalVaultId}
            selectedLocalVaultId={selectedSyncVaultId}
            syncConnections={syncConnections}
            syncBindings={syncBindings}
            vaultEncryptionById={vaultEncryptionById}
            syncFeedback={syncFeedback}
            onLanguageChange={(language) => void handleChangeLanguage(language)}
            onSelectLocalVault={(localVaultId) => setSelectedSyncVaultId(localVaultId)}
            onCreateLocalVault={(input) => handleCreateLocalVault(input)}
            onRenameLocalVault={(localVaultId, name) =>
              handleRenameLocalVault(localVaultId, name)
            }
            onDeleteLocalVault={(localVaultId, options) =>
              void handleDeleteLocalVault(localVaultId, options)
            }
            onCreateConnection={handleCreateSyncConnection}
            onDeleteConnection={(connectionId) => void handleDeleteSyncConnection(connectionId)}
            onUpdateConnection={handleUpdateSyncConnection}
            onBindVault={(input) => void handleBindVaultToConnection(input)}
            onImportRemoteVault={(input) => handleImportRemoteVault(input)}
            onDeleteRemoteVault={(input) => handleDeleteRemoteVault(input)}
            onClearBinding={(localVaultId) => void handleClearVaultBinding(localVaultId)}
            onRunVaultSync={(localVaultId) => void handleRunVaultSync(localVaultId)}
            onEnableVaultEncryption={(input) => void handleEnableVaultEncryption(input)}
            onUnlockVaultEncryption={(input) => void handleUnlockVaultEncryption(input)}
            onChangeVaultEncryptionPassphrase={(input) =>
              void handleChangeVaultEncryptionPassphrase(input)
            }
            onDisableVaultEncryption={(input) => void handleDisableVaultEncryption(input)}
            onLockVaultEncryption={(localVaultId) => void handleLockVaultEncryption(localVaultId)}
          />
        }
        showClose={false}
        onClose={() => undefined}
        onCloseEditor={() => setOrbitalEditorNoteId(null)}
        syncStatusChip={activeVaultSyncChip}
        syncTransportChip={activeSyncTransportChip}
        activeLocalVaultId={activeLocalVaultId}
        localVaultOptions={localVaultSwitcherItems}
        onSelectLocalVault={(localVaultId) => activateLocalVault(localVaultId)}
        onCreateLocalVault={(input) =>
          handleCreateLocalVault({
            ...input,
            activate: true
          })
        }
        onCreateProject={handleCreateProjectNode}
        onRenameProject={(projectId, name) => void handleRenameProject(projectId, name)}
        onUpdateProjectPosition={(projectId, x, y) =>
          void handleUpdateProjectPosition(projectId, x, y)
        }
        onUpdateProjectColor={(projectId, color) =>
          void handleUpdateProjectColor(projectId, color)
        }
        onDeleteProject={(projectId) => void handleDeleteProject(projectId)}
        onUpdateFolderColor={(folderId, color) => void handleUpdateFolderColor(folderId, color)}
        onRenameFolder={(folderId, name) => void handleRenameFolder(folderId, name)}
        onDeleteFolder={(folderId) => void handleDeleteFolder(folderId)}
        onRenameNote={(noteId, name) =>
          void handleUpdateNoteMeta(noteId, {
            title: name
          })
        }
        onUpdateNoteColor={(noteId, color) =>
          void handleUpdateNoteMeta(noteId, {
            color
          })
        }
        onSetNotePinned={(noteId, pinned) =>
          void handleUpdateNoteMeta(noteId, {
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
          settings: t("orbit.settings"),
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
          renameAction: t("orbit.renameAction"),
          totalBodies: t("orbit.totalBodies")
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
