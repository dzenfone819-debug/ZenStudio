import {
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
import { useTranslation } from "react-i18next";

import type { LocalVaultProfile } from "../lib/localVaults";
import {
  connectGoogleDriveAccount,
  createHostedVault,
  createGoogleDriveVault,
  createPersonalServerVault,
  getConfiguredGoogleDriveClientId,
  googleDriveClientConfigured,
  googleDriveOAuthReady,
  issueHostedVaultToken,
  issueGoogleDriveVaultToken,
  issuePersonalServerVaultToken,
  loadHostedAccountOverview,
  loadGoogleDriveVaults,
  loadPersonalServerVaults,
  loginHostedAccount,
  prepareGoogleDriveOAuth,
  probeSyncConnectionAvailability,
  registerHostedAccount
} from "../lib/sync";
import type {
  AppSettings,
  RemoteVaultImportResult,
  SyncConnection,
  SyncRemoteVault,
  SyncVaultBinding,
  VaultEncryptionSummary
} from "../types";
import "./SyncSettingsPanel.css";

type SyncFeedbackState = {
  tone: "success" | "error";
  text: string;
} | null;

interface SyncSettingsPanelProps {
  settings: AppSettings;
  online: boolean;
  localVaults: LocalVaultProfile[];
  activeLocalVaultId: string;
  selectedLocalVaultId: string;
  syncConnections: SyncConnection[];
  syncBindings: SyncVaultBinding[];
  vaultEncryptionById: Record<string, VaultEncryptionSummary>;
  syncFeedback?: SyncFeedbackState;
  onBack: () => void;
  onSelectLocalVault: (localVaultId: string) => void;
  onCreateLocalVault: (name: string) => string | Promise<string>;
  onRenameLocalVault: (localVaultId: string, name: string) => void;
  onDeleteLocalVault: (
    localVaultId: string,
    options?: {
      skipConfirmation?: boolean;
    }
  ) => void | Promise<void>;
  onCreateConnection: (input: {
    provider: "selfHosted" | "hosted" | "googleDrive";
    serverUrl: string;
    label?: string;
    managementToken?: string;
    sessionToken?: string;
    tokenExpiresAt?: number | null;
    userId?: string | null;
    userName?: string;
    userEmail?: string;
  }) => void;
  onDeleteConnection: (connectionId: string) => void;
  onUpdateConnection: (
    connectionId: string,
    patch: Partial<Omit<SyncConnection, "id" | "provider" | "createdAt">>
  ) => void;
  onBindVault: (input: {
    localVaultId: string;
    connectionId: string;
    remoteVaultId: string;
    remoteVaultName?: string;
    syncToken: string;
  }) => void | Promise<void>;
  onImportRemoteVault: (input: {
    connectionId: string;
    remoteVaultId: string;
    remoteVaultName: string;
    openAfterImport?: boolean;
  }) => Promise<RemoteVaultImportResult>;
  onDeleteRemoteVault: (input: {
    connectionId: string;
    remoteVaultId: string;
  }) => Promise<void>;
  onClearBinding: (localVaultId: string) => void | Promise<void>;
  onRunVaultSync: (localVaultId: string) => void | Promise<void>;
  onEnableVaultEncryption: (input: {
    localVaultId: string;
    passphrase: string;
  }) => void | Promise<void>;
  onUnlockVaultEncryption: (input: {
    localVaultId: string;
    passphrase: string;
  }) => void | Promise<void>;
  onChangeVaultEncryptionPassphrase: (input: {
    localVaultId: string;
    currentPassphrase?: string;
    nextPassphrase: string;
  }) => void | Promise<void>;
  onDisableVaultEncryption: (input: {
    localVaultId: string;
    currentPassphrase?: string;
  }) => void | Promise<void>;
  onLockVaultEncryption: (localVaultId: string) => void | Promise<void>;
}

type VaultEncryptionModalView = "default" | "unlock" | "changePassphrase" | "disable";
type VaultEncryptionContinuationKind = "import" | "sync" | null;

type PanelModal =
  | { kind: "createVault" }
  | { kind: "renameVault"; vault: LocalVaultProfile }
  | {
      kind: "vaultEncryption";
      vault: LocalVaultProfile;
      view?: VaultEncryptionModalView;
      continuation?: VaultEncryptionContinuationKind;
    }
  | { kind: "addConnection" }
  | { kind: "addSelfHosted" }
  | { kind: "addHosted" }
  | { kind: "addGoogleDrive" }
  | null;

type ConfirmState = {
  title: string;
  description: string;
  details?: string[];
  confirmLabel: string;
  tone?: "default" | "danger";
  action: () => Promise<void> | void;
  secondaryLabel?: string;
  secondaryTone?: "default" | "danger";
  secondaryAction?: () => Promise<void> | void;
} | null;

type HostedMode = "login" | "register";

type DraftLink = {
  vaultId: string;
  x: number;
  y: number;
  moved: boolean;
} | null;

type LinkMetric = {
  id: string;
  path: string;
  color: string;
  statusTone: "idle" | "syncing" | "error";
};

type ConnectionAvailabilityState =
  | "checking"
  | "available"
  | "unavailable"
  | "authError";

type RemoteVaultCatalogEntry = SyncRemoteVault;

function ChevronLeftGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M12.3 4.9 7.2 10l5.1 5.1" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M10 4.1v11.8M4.1 10h11.8" />
    </svg>
  );
}

function EditGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="m5.1 14.9 2.8-.7 6.1-6.1-2.1-2.1-6.1 6.1-.7 2.8Z" />
      <path d="m10.8 5.4 2.1 2.1" className="sync-settings-icon-accent" />
    </svg>
  );
}

function TrashGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M5.8 6.2h8.4" />
      <path d="M7.4 6.2v8.2c0 1 .6 1.6 1.6 1.6h2c1 0 1.6-.6 1.6-1.6V6.2" />
      <path d="M8.4 4.6h3.2" />
      <path d="M8.4 8.4v4.7M11.6 8.4v4.7" className="sync-settings-icon-accent" />
    </svg>
  );
}

function VaultGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M3.7 6.2h12.6v8.7H3.7z" />
      <path d="M3.7 6.2 6.1 4.5h7.8l2.4 1.7" className="sync-settings-icon-accent" />
      <path d="M7 9.1h6" className="sync-settings-icon-accent" />
    </svg>
  );
}

function LockGlyph({ unlocked = false }: { unlocked?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path
        d={
          unlocked
            ? "M6.2 8V6.8A3.8 3.8 0 0 1 13 4.5M5 8.1h10v7.6H5z"
            : "M6.2 8V6.7a3.8 3.8 0 1 1 7.6 0V8M5 8.1h10v7.6H5z"
        }
      />
      <path d="M10 10.3v2.5" className="sync-settings-icon-accent" />
    </svg>
  );
}

function HostedGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <circle cx="10" cy="10" r="6.4" />
      <path d="M10 3.6v12.8M3.6 10h12.8" className="sync-settings-icon-accent" />
      <path d="M5.9 5.9c1.7 1.2 4.6 1.9 8.2 0M5.9 14.1c1.7-1.2 4.6-1.9 8.2 0" className="sync-settings-icon-accent" />
    </svg>
  );
}

function SelfHostedGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <rect x="3.4" y="4.4" width="13.2" height="4.2" rx="1.4" />
      <rect x="3.4" y="11.4" width="13.2" height="4.2" rx="1.4" />
      <path d="M6.2 6.5h1.8M6.2 13.5h1.8" className="sync-settings-icon-accent" />
    </svg>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M16.2 10a6.2 6.2 0 1 1-1.8-4.4" />
      <path d="M16.2 10H10" className="sync-settings-icon-accent" />
      <path d="M13.4 7.2h2.8V10" className="sync-settings-icon-accent" />
    </svg>
  );
}

function LinkGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M7.3 12.7 5.6 14.4a2.4 2.4 0 1 1-3.4-3.4L4 9.3" />
      <path d="M12.7 7.3 14.4 5.6A2.4 2.4 0 1 1 17.8 9l-1.8 1.7" />
      <path d="m6.8 13.2 6.4-6.4" className="sync-settings-icon-accent" />
    </svg>
  );
}

function UnlinkGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M7.1 12.9 5.5 14.5a2.5 2.5 0 1 1-3.5-3.5L3.7 9.4" />
      <path d="M12.9 7.1 14.5 5.5a2.5 2.5 0 1 1 3.5 3.5l-1.6 1.6" />
      <path d="M7 7l6 6" className="sync-settings-icon-accent" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M5.4 5.4 14.6 14.6M14.6 5.4 5.4 14.6" />
    </svg>
  );
}

function RefreshGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M15.6 7.7A6.1 6.1 0 0 0 5.4 5.6" />
      <path d="M5.4 5.6h3.4v3.2" className="sync-settings-icon-accent" />
      <path d="M4.4 12.3a6.1 6.1 0 0 0 10.2 2.1" />
      <path d="M14.6 14.4h-3.4v-3.2" className="sync-settings-icon-accent" />
    </svg>
  );
}

function ChevronToggleGlyph({ expanded = false }: { expanded?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path
        d={expanded ? "M5.5 7.6 10 12.1l4.5-4.5" : "M7.6 5.5 12.1 10l-4.5 4.5"}
        className="sync-settings-icon-accent"
      />
    </svg>
  );
}

function providerAccent(provider: SyncConnection["provider"]) {
  if (provider === "hosted") {
    return "#73f7ff";
  }

  if (provider === "googleDrive") {
    return "#9cf98d";
  }

  return "#ffd27d";
}

function buildLinkPath(x1: number, y1: number, x2: number, y2: number) {
  const curve = Math.max(48, Math.abs(x2 - x1) * 0.34);
  return `M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`;
}

function maskToken(value: string) {
  if (!value) {
    return "••••";
  }

  if (value.length <= 8) {
    return "••••";
  }

  return `${value.slice(0, 4)}••••${value.slice(-3)}`;
}

function formatTime(timestamp: number | null, locale: string) {
  if (!timestamp) {
    return "—";
  }

  return new Date(timestamp).toLocaleString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short"
  });
}

function translateSyncManagerError(message: string, t: ReturnType<typeof useTranslation>["t"]) {
  switch (message) {
    case "SELF_HOSTED_URL_REQUIRED":
      return t("sync.urlRequired");
    case "HOSTED_URL_REQUIRED":
      return t("sync.hostedUrlRequired");
    case "GOOGLE_DRIVE_AUTH_REQUIRED":
      return t("sync.googleDriveAuthRequired");
    case "GOOGLE_DRIVE_CLIENT_ID_REQUIRED":
      return t("sync.googleDriveClientIdRequired");
    case "GOOGLE_OAUTH_NOT_READY":
      return t("sync.googleDrivePreparing");
    case "GOOGLE_OAUTH_POPUP_CLOSED":
      return t("sync.googleDrivePopupClosed");
    case "GOOGLE_OAUTH_POPUP_FAILED":
      return t("sync.googleDrivePopupFailed");
    case "GOOGLE_OAUTH_SCRIPT_FAILED":
    case "GOOGLE_OAUTH_UNAVAILABLE":
      return t("sync.googleDriveSdkFailed");
    case "ENCRYPTED_SYNC_NOT_IMPLEMENTED":
      return t("sync.googleDriveEncryptedPending");
    case "INVALID_PASSPHRASE":
      return t("sync.vaultEncryptionInvalidPassphrase");
    case "VAULT_ENCRYPTION_DISABLED":
      return t("sync.vaultEncryptionDisabled");
    case "VAULT_ENCRYPTION_LOCKED":
      return t("sync.vaultEncryptionSyncLocked");
    case "VAULT_ENCRYPTION_REMOTE_SYNC_REQUIRED":
      return t("sync.vaultEncryptionRemoteMigrationRequired");
    case "UNAUTHORIZED":
      return t("sync.unauthorized");
    case "SERVER_UNAVAILABLE":
    case "HTTP_404":
      return t("sync.serverNotFound");
    case "INVALID_CREDENTIALS":
      return t("sync.hostedInvalidCredentials");
    case "EMAIL_AND_PASSWORD_REQUIRED":
      return t("sync.hostedCredentialsRequired");
    case "EMAIL_REQUIRED":
      return t("sync.hostedEmailRequired");
    case "INVALID_EMAIL":
      return t("sync.hostedInvalidEmail");
    case "EMAIL_ALREADY_EXISTS":
      return t("sync.hostedEmailExists");
    case "PASSWORD_TOO_SHORT":
      return t("sync.hostedPasswordTooShort");
    case "VAULT_NOT_FOUND":
      return t("sync.vaultNotFound");
    case "LAST_VAULT_REQUIRED":
      return t("sync.lastRemoteVaultRequired");
    case "NOT_FOUND":
      return t("sync.serverNotFound");
    default:
      return message === "SYNC_FAILED" ? t("sync.failedGeneric") : message;
  }
}

function SyncConnectionIcon({
  provider
}: {
  provider: SyncConnection["provider"] | "googleDrive";
}) {
  if (provider === "hosted") {
    return <HostedGlyph />;
  }

  if (provider === "googleDrive") {
    return <GoogleGlyph />;
  }

  return <SelfHostedGlyph />;
}

export default function SyncSettingsPanel({
  settings,
  online,
  localVaults,
  activeLocalVaultId,
  selectedLocalVaultId,
  syncConnections,
  syncBindings,
  vaultEncryptionById,
  syncFeedback = null,
  onBack,
  onSelectLocalVault,
  onCreateLocalVault,
  onRenameLocalVault,
  onDeleteLocalVault,
  onCreateConnection,
  onDeleteConnection,
  onUpdateConnection,
  onBindVault,
  onImportRemoteVault,
  onDeleteRemoteVault,
  onClearBinding,
  onRunVaultSync,
  onEnableVaultEncryption,
  onUnlockVaultEncryption,
  onChangeVaultEncryptionPassphrase,
  onDisableVaultEncryption,
  onLockVaultEncryption
}: SyncSettingsPanelProps) {
  const { t, i18n } = useTranslation();
  const sortedVaults = useMemo(
    () => [...localVaults].sort((left, right) => left.createdAt - right.createdAt),
    [localVaults]
  );
  const bindingsByVaultId = useMemo(
    () => new Map(syncBindings.map((binding) => [binding.localVaultId, binding])),
    [syncBindings]
  );
  const connectionsById = useMemo(
    () => new Map(syncConnections.map((connection) => [connection.id, connection])),
    [syncConnections]
  );
  const selectedVault =
    sortedVaults.find((vault) => vault.id === selectedLocalVaultId) ??
    sortedVaults.find((vault) => vault.id === activeLocalVaultId) ??
    null;
  const selectedVaultEncryption = selectedVault
    ? vaultEncryptionById[selectedVault.id] ?? {
        enabled: false,
        state: "disabled" as const,
        keyId: null,
        updatedAt: null
      }
    : null;
  const selectedVaultBinding = selectedVault ? bindingsByVaultId.get(selectedVault.id) ?? null : null;
  const selectedVaultConnection = selectedVaultBinding
    ? connectionsById.get(selectedVaultBinding.connectionId) ?? null
    : null;
  const hostedConnectionExists = syncConnections.some((connection) => connection.provider === "hosted");
  const googleDriveConfigured = googleDriveClientConfigured();
  const googleDriveClientId = getConfiguredGoogleDriveClientId();
  const [panelModal, setPanelModal] = useState<PanelModal>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [internalFeedback, setInternalFeedback] = useState<SyncFeedbackState>(null);
  const [vaultNameDraft, setVaultNameDraft] = useState("");
  const [selfHostedLabelDraft, setSelfHostedLabelDraft] = useState("");
  const [selfHostedUrlDraft, setSelfHostedUrlDraft] = useState("");
  const [selfHostedManagementTokenDraft, setSelfHostedManagementTokenDraft] = useState("");
  const [hostedMode, setHostedMode] = useState<HostedMode>("login");
  const [hostedUrlDraft, setHostedUrlDraft] = useState("");
  const [hostedNameDraft, setHostedNameDraft] = useState("");
  const [hostedEmailDraft, setHostedEmailDraft] = useState("");
  const [hostedPasswordDraft, setHostedPasswordDraft] = useState("");
  const [encryptionPassphraseDraft, setEncryptionPassphraseDraft] = useState("");
  const [encryptionPassphraseConfirmDraft, setEncryptionPassphraseConfirmDraft] = useState("");
  const [encryptionNextPassphraseDraft, setEncryptionNextPassphraseDraft] = useState("");
  const [encryptionNextPassphraseConfirmDraft, setEncryptionNextPassphraseConfirmDraft] = useState("");
  const [pendingBindVaultId, setPendingBindVaultId] = useState<string | null>(null);
  const [draftLink, setDraftLink] = useState<DraftLink>(null);
  const [hoverConnectionId, setHoverConnectionId] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [linkMetrics, setLinkMetrics] = useState<LinkMetric[]>([]);
  const [connectionAvailability, setConnectionAvailability] = useState<Record<string, ConnectionAvailabilityState>>({});
  const [remoteVaultsByConnectionId, setRemoteVaultsByConnectionId] = useState<
    Record<string, RemoteVaultCatalogEntry[]>
  >({});
  const [remoteVaultErrors, setRemoteVaultErrors] = useState<Record<string, string | null>>({});
  const [remoteVaultLoading, setRemoteVaultLoading] = useState<Record<string, boolean>>({});
  const [expandedRemoteConnectionIds, setExpandedRemoteConnectionIds] = useState<Record<string, boolean>>({});
  const [googleDriveOAuthState, setGoogleDriveOAuthState] = useState<"idle" | "loading" | "ready" | "error">(() =>
    googleDriveConfigured ? (googleDriveOAuthReady() ? "ready" : "idle") : "idle"
  );
  const [googleDriveOAuthError, setGoogleDriveOAuthError] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const vaultListRef = useRef<HTMLDivElement | null>(null);
  const connectionListRef = useRef<HTMLDivElement | null>(null);
  const pendingVaultEncryptionContinuationRef = useRef<(() => Promise<void>) | null>(null);
  const vaultRefs = useRef(new Map<string, HTMLElement>());
  const connectionRefs = useRef(new Map<string, HTMLElement>());

  const feedback = internalFeedback ?? syncFeedback;
  const availabilitySignature = useMemo(
    () =>
      syncConnections
        .map(
          (connection) =>
            `${connection.id}:${connection.updatedAt}:${connection.serverUrl}:${connection.tokenExpiresAt ?? "none"}`
        )
        .join("|"),
    [syncConnections]
  );
  const localVaultByGuid = useMemo(
    () => new Map(sortedVaults.map((vault) => [vault.vaultGuid, vault])),
    [sortedVaults]
  );
  const localVaultNameSet = useMemo(
    () => new Set(sortedVaults.map((vault) => vault.name.trim().toLowerCase())),
    [sortedVaults]
  );

  const normalizeRemoteVaultEntries = useCallback(
    (
      entries: Array<{
        id: string;
        name: string;
        createdAt: number;
        updatedAt: number;
        lastRevision: string | null;
        lastSyncAt: number | null;
        tokenCount?: number;
      }>
    ) =>
      [...entries]
        .map(
          (entry) =>
            ({
              id: entry.id,
              name: entry.name,
              createdAt: entry.createdAt,
              updatedAt: entry.updatedAt,
              lastRevision: entry.lastRevision ?? null,
              lastSyncAt: entry.lastSyncAt ?? null,
              tokenCount: entry.tokenCount
            }) satisfies RemoteVaultCatalogEntry
        )
        .sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name)),
    []
  );

  const loadRemoteVaultCatalog = useCallback(
    async (
      connection: SyncConnection,
      options?: {
        silent?: boolean;
      }
    ) => {
      if (!options?.silent) {
        setRemoteVaultLoading((current) => ({
          ...current,
          [connection.id]: true
        }));
      }

      setRemoteVaultErrors((current) => ({
        ...current,
        [connection.id]: null
      }));

      try {
        const remoteVaults =
          connection.provider === "hosted"
            ? normalizeRemoteVaultEntries((await loadHostedAccountOverview(connection.serverUrl, connection.sessionToken)).vaults)
            : connection.provider === "googleDrive"
              ? normalizeRemoteVaultEntries((await loadGoogleDriveVaults(connection.sessionToken)).vaults)
              : normalizeRemoteVaultEntries((await loadPersonalServerVaults(connection.serverUrl, connection.managementToken)).vaults);

        setRemoteVaultsByConnectionId((current) => ({
          ...current,
          [connection.id]: remoteVaults
        }));

        setConnectionAvailability((current) => ({
          ...current,
          [connection.id]: "available"
        }));

        return remoteVaults;
      } catch (error) {
        const message = error instanceof Error ? error.message : "SYNC_FAILED";

        setRemoteVaultErrors((current) => ({
          ...current,
          [connection.id]: translateSyncManagerError(message, t)
        }));

        setConnectionAvailability((current) => ({
          ...current,
          [connection.id]:
            message === "UNAUTHORIZED" ||
            message === "INVALID_CREDENTIALS" ||
            message === "GOOGLE_DRIVE_AUTH_REQUIRED"
              ? "authError"
              : message === "SERVER_UNAVAILABLE" || message === "HTTP_404"
                ? "unavailable"
                : current[connection.id] ?? "checking"
        }));

        throw error;
      } finally {
        setRemoteVaultLoading((current) => ({
          ...current,
          [connection.id]: false
        }));
      }
    },
    [normalizeRemoteVaultEntries, t]
  );

  const registerVaultRef = (vaultId: string, node: HTMLElement | null) => {
    if (node) {
      vaultRefs.current.set(vaultId, node);
      return;
    }

    vaultRefs.current.delete(vaultId);
  };

  const registerConnectionRef = (connectionId: string, node: HTMLElement | null) => {
    if (node) {
      connectionRefs.current.set(connectionId, node);
      return;
    }

    connectionRefs.current.delete(connectionId);
  };

  const findConnectionAtPoint = (clientX: number, clientY: number) => {
    for (const [connectionId, node] of connectionRefs.current.entries()) {
      const rect = node.getBoundingClientRect();
      const hitSlop = 10;
      const isWithinBounds =
        clientX >= rect.left - hitSlop &&
        clientX <= rect.right + hitSlop &&
        clientY >= rect.top - hitSlop &&
        clientY <= rect.bottom + hitSlop;

      if (isWithinBounds) {
        return connectionId;
      }
    }

    return null;
  };

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const vaultList = vaultListRef.current;
    const connectionList = connectionListRef.current;

    if (!stage) {
      return;
    }

    let frameId: number | null = null;

    const compute = () => {
      frameId = null;
      const stageRect = stage.getBoundingClientRect();
      const nextMetrics = syncBindings
        .map((binding) => {
          const vaultNode = vaultRefs.current.get(binding.localVaultId);
          const connectionNode = connectionRefs.current.get(binding.connectionId);
          const connection = connectionsById.get(binding.connectionId);

          if (!vaultNode || !connectionNode || !connection) {
            return null;
          }

          const vaultRect = vaultNode.getBoundingClientRect();
          const connectionRect = connectionNode.getBoundingClientRect();
          const x1 = vaultRect.right - stageRect.left - 6;
          const y1 = vaultRect.top - stageRect.top + vaultRect.height / 2;
          const x2 = connectionRect.left - stageRect.left + 6;
          const y2 = connectionRect.top - stageRect.top + connectionRect.height / 2;

          return {
            id: binding.id,
            path: buildLinkPath(x1, y1, x2, y2),
            color: providerAccent(connection.provider),
            statusTone:
              binding.syncStatus === "error"
                ? "error"
                : binding.syncStatus === "syncing"
                  ? "syncing"
                  : "idle"
          } satisfies LinkMetric;
        })
        .filter(Boolean) as LinkMetric[];

      setLinkMetrics(nextMetrics);
    };

    const schedule = () => {
      if (frameId !== null) {
        return;
      }

      frameId = window.requestAnimationFrame(compute);
    };

    schedule();

    const observer = new ResizeObserver(schedule);
    observer.observe(stage);
    if (vaultList) {
      observer.observe(vaultList);
      vaultList.addEventListener("scroll", schedule, {
        passive: true
      });
    }
    if (connectionList) {
      observer.observe(connectionList);
      connectionList.addEventListener("scroll", schedule, {
        passive: true
      });
    }
    vaultRefs.current.forEach((node) => observer.observe(node));
    connectionRefs.current.forEach((node) => observer.observe(node));
    window.addEventListener("resize", schedule);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      observer.disconnect();
      if (vaultList) {
        vaultList.removeEventListener("scroll", schedule);
      }
      if (connectionList) {
        connectionList.removeEventListener("scroll", schedule);
      }
      window.removeEventListener("resize", schedule);
    };
  }, [connectionsById, syncBindings, syncConnections, sortedVaults]);

  useEffect(() => {
    if (!googleDriveConfigured) {
      setGoogleDriveOAuthState("idle");
      setGoogleDriveOAuthError(null);
      return;
    }

    if (googleDriveOAuthReady()) {
      setGoogleDriveOAuthState("ready");
      setGoogleDriveOAuthError(null);
      return;
    }

    let cancelled = false;

    setGoogleDriveOAuthState("loading");
    setGoogleDriveOAuthError(null);

    void prepareGoogleDriveOAuth()
      .then(() => {
        if (cancelled) {
          return;
        }

        setGoogleDriveOAuthState("ready");
        setGoogleDriveOAuthError(null);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        const message = error instanceof Error ? error.message : "GOOGLE_OAUTH_SCRIPT_FAILED";
        setGoogleDriveOAuthState("error");
        setGoogleDriveOAuthError(translateSyncManagerError(message, t));
      });

    return () => {
      cancelled = true;
    };
  }, [googleDriveConfigured, t]);

  useEffect(() => {
    if (!draftLink) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const stageRect = stageRef.current?.getBoundingClientRect();

      if (!stageRect) {
        return;
      }

      const connectionId = findConnectionAtPoint(event.clientX, event.clientY);

      setDraftLink((current) =>
        current
          ? {
              ...current,
              x: event.clientX - stageRect.left,
              y: event.clientY - stageRect.top,
              moved: true
            }
          : null
      );
      setHoverConnectionId((current) => (current === connectionId ? current : connectionId));
    };

    const handlePointerUp = (event: PointerEvent) => {
      const currentDraft = draftLink;
      const connectionId = findConnectionAtPoint(event.clientX, event.clientY);

      setDraftLink(null);
      setHoverConnectionId(null);

      if (connectionId) {
        void requestVaultBinding(currentDraft.vaultId, connectionId);
        return;
      }

      if (!currentDraft.moved) {
        setPendingBindVaultId(currentDraft.vaultId);
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, {
      passive: true
    });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [draftLink]);

  useEffect(() => {
    if (!draftLink) {
      setHoverConnectionId(null);
    }
  }, [draftLink]);

  useEffect(() => {
    setExpandedRemoteConnectionIds((current) => {
      const next: Record<string, boolean> = {};
      let changed = false;

      syncConnections.forEach((connection) => {
        next[connection.id] = current[connection.id] ?? true;
        if (next[connection.id] !== current[connection.id]) {
          changed = true;
        }
      });

      if (Object.keys(current).length !== Object.keys(next).length) {
        changed = true;
      }

      return changed ? next : current;
    });
  }, [syncConnections]);

  useEffect(() => {
    if (syncConnections.length === 0) {
      setConnectionAvailability({});
      return;
    }

    if (!online) {
      return;
    }

    let cancelled = false;

    setConnectionAvailability(
      Object.fromEntries(syncConnections.map((connection) => [connection.id, "checking" satisfies ConnectionAvailabilityState]))
    );

    void Promise.all(
      syncConnections.map(async (connection) => {
        const status = await probeSyncConnectionAvailability(connection);

        if (cancelled) {
          return;
        }

        setConnectionAvailability((current) => {
          if (current[connection.id] === status) {
            return current;
          }

          return {
            ...current,
            [connection.id]: status
          };
        });
      })
    );

    return () => {
      cancelled = true;
    };
  }, [availabilitySignature, online, syncConnections]);

  useEffect(() => {
    if (syncConnections.length === 0) {
      setRemoteVaultsByConnectionId({});
      setRemoteVaultErrors({});
      setRemoteVaultLoading({});
      return;
    }

    if (!online) {
      return;
    }

    let cancelled = false;

    void Promise.all(
      syncConnections.map(async (connection) => {
        try {
          const remoteVaults = await loadRemoteVaultCatalog(connection, {
            silent: false
          });

          if (cancelled) {
            return;
          }

          setRemoteVaultsByConnectionId((current) => ({
            ...current,
            [connection.id]: remoteVaults
          }));
        } catch {
          if (cancelled) {
            return;
          }
        }
      })
    );

    return () => {
      cancelled = true;
    };
  }, [availabilitySignature, loadRemoteVaultCatalog, online, syncConnections]);

  const boundVaultCountByConnectionId = useMemo(() => {
    const counts = new Map<string, number>();

    syncBindings.forEach((binding) => {
      counts.set(binding.connectionId, (counts.get(binding.connectionId) ?? 0) + 1);
    });

    return counts;
  }, [syncBindings]);

  const showFeedback = (tone: "success" | "error", text: string) => {
    setInternalFeedback({
      tone,
      text
    });
  };

  const closeModal = () => {
    setPanelModal(null);
    setConfirmState(null);
    pendingVaultEncryptionContinuationRef.current = null;
    setEncryptionPassphraseDraft("");
    setEncryptionPassphraseConfirmDraft("");
    setEncryptionNextPassphraseDraft("");
    setEncryptionNextPassphraseConfirmDraft("");
  };

  const resetConnectionDrafts = () => {
    setSelfHostedLabelDraft("");
    setSelfHostedUrlDraft("");
    setSelfHostedManagementTokenDraft("");
    setHostedMode("login");
    setHostedUrlDraft("");
    setHostedNameDraft("");
    setHostedEmailDraft("");
    setHostedPasswordDraft("");
    setEncryptionPassphraseDraft("");
    setEncryptionPassphraseConfirmDraft("");
    setEncryptionNextPassphraseDraft("");
    setEncryptionNextPassphraseConfirmDraft("");
  };

  const handleCreateVault = async () => {
    const normalizedName = vaultNameDraft.trim();

    if (!normalizedName) {
      return;
    }

    const nextVaultId = await Promise.resolve(onCreateLocalVault(normalizedName));
    if (nextVaultId) {
      onSelectLocalVault(nextVaultId);
    }
    setVaultNameDraft("");
    closeModal();
  };

  const handleRenameVault = () => {
    if (!panelModal || panelModal.kind !== "renameVault") {
      return;
    }

    const normalizedName = vaultNameDraft.trim();

    if (!normalizedName) {
      return;
    }

    onRenameLocalVault(panelModal.vault.id, normalizedName);
    setVaultNameDraft("");
    closeModal();
  };

  const handleAddSelfHostedConnection = () => {
    if (!selfHostedUrlDraft.trim() || !selfHostedManagementTokenDraft.trim()) {
      showFeedback("error", t("sync.urlRequired"));
      return;
    }

    onCreateConnection({
      provider: "selfHosted",
      serverUrl: selfHostedUrlDraft.trim(),
      label: selfHostedLabelDraft.trim() || undefined,
      managementToken: selfHostedManagementTokenDraft.trim()
    });
    resetConnectionDrafts();
    showFeedback("success", t("settings.connectionAdded"));
    closeModal();
  };

  const handleAddHostedConnection = async () => {
    if (!hostedUrlDraft.trim()) {
      showFeedback("error", t("sync.hostedUrlRequired"));
      return;
    }

    if (!hostedEmailDraft.trim() || !hostedPasswordDraft.trim()) {
      showFeedback("error", t("sync.hostedCredentialsRequired"));
      return;
    }

    setBusyKey("add-hosted");

    try {
      const result =
        hostedMode === "register"
          ? await registerHostedAccount(hostedUrlDraft.trim(), {
              name: hostedNameDraft.trim() || hostedEmailDraft.trim(),
              email: hostedEmailDraft.trim(),
              password: hostedPasswordDraft
            })
          : await loginHostedAccount(hostedUrlDraft.trim(), {
              email: hostedEmailDraft.trim(),
              password: hostedPasswordDraft
            });

      onCreateConnection({
        provider: "hosted",
        serverUrl: hostedUrlDraft.trim(),
        sessionToken: result.session.token,
        userId: result.user.id,
        userName: result.user.name,
        userEmail: result.user.email ?? ""
      });

      resetConnectionDrafts();
      showFeedback("success", hostedMode === "register" ? t("sync.hostedAccountCreated") : t("sync.hostedLoggedIn"));
      closeModal();
    } catch (error) {
      const message = error instanceof Error ? error.message : "SYNC_FAILED";
      showFeedback("error", translateSyncManagerError(message, t));
    } finally {
      setBusyKey(null);
    }
  };

  const handleAddGoogleDriveConnection = async () => {
    if (!googleDriveConfigured) {
      showFeedback("error", t("sync.googleDriveClientIdRequired"));
      return;
    }

    if (googleDriveOAuthState === "loading" || googleDriveOAuthState === "idle") {
      showFeedback("error", t("sync.googleDrivePreparing"));
      return;
    }

    if (googleDriveOAuthState === "error") {
      showFeedback("error", googleDriveOAuthError ?? t("sync.googleDriveSdkFailed"));
      return;
    }

    setBusyKey("add-google-drive");

    try {
      const result = await connectGoogleDriveAccount({
        clientId: googleDriveClientId
      });

      onCreateConnection({
        provider: "googleDrive",
        serverUrl: "https://www.googleapis.com",
        sessionToken: result.accessToken,
        tokenExpiresAt: result.expiresAt,
        userId: result.userId,
        userName: result.userName,
        userEmail: result.userEmail,
        label: result.userEmail || result.userName || t("sync.googleDrive")
      });

      resetConnectionDrafts();
      showFeedback("success", t("sync.googleDriveConnected"));
      closeModal();
    } catch (error) {
      const message = error instanceof Error ? error.message : "SYNC_FAILED";
      showFeedback("error", translateSyncManagerError(message, t));
    } finally {
      setBusyKey(null);
    }
  };

  const reauthorizeGoogleDriveConnection = async (connection: SyncConnection) => {
    if (connection.provider !== "googleDrive") {
      return connection;
    }

    const result = await connectGoogleDriveAccount({
      clientId: googleDriveClientId,
      loginHint: connection.userEmail || undefined
    });

    onUpdateConnection(connection.id, {
      sessionToken: result.accessToken,
      tokenExpiresAt: result.expiresAt,
      userId: result.userId,
      userName: result.userName,
      userEmail: result.userEmail,
      label: result.userEmail || result.userName || connection.label
    });

    return {
      ...connection,
      sessionToken: result.accessToken,
      tokenExpiresAt: result.expiresAt,
      userId: result.userId,
      userName: result.userName,
      userEmail: result.userEmail,
      label: result.userEmail || result.userName || connection.label,
      updatedAt: Date.now()
    } satisfies SyncConnection;
  };

  const performVaultBinding = async (
    vault: LocalVaultProfile,
    connection: SyncConnection,
    options?: {
      refreshCatalog?: boolean;
    }
  ) => {
    const canonicalRemoteVaultId = vault.vaultGuid;
    const existingRemoteVaults =
      remoteVaultsByConnectionId[connection.id] ??
      (await loadRemoteVaultCatalog(connection, {
        silent: true
      }));

    let remoteVault =
      existingRemoteVaults.find((entry) => entry.id === canonicalRemoteVaultId) ?? null;

    if (!remoteVault) {
      remoteVault =
        connection.provider === "selfHosted"
          ? (
              await createPersonalServerVault(connection.serverUrl, connection.managementToken, {
                name: vault.name,
                id: canonicalRemoteVaultId || undefined
              })
            ).vault
          : connection.provider === "googleDrive"
            ? (
                await createGoogleDriveVault(connection.sessionToken, {
                  name: vault.name,
                  id: canonicalRemoteVaultId || undefined
                })
              ).vault
          : (
              await createHostedVault(connection.serverUrl, connection.sessionToken, {
                name: vault.name,
                id: canonicalRemoteVaultId || undefined
              })
            ).vault;
    }

    const token =
      connection.provider === "selfHosted"
        ? await issuePersonalServerVaultToken(
            connection.serverUrl,
            connection.managementToken,
            remoteVault.id,
            `${vault.name} · ${connection.label}`
          )
        : connection.provider === "googleDrive"
          ? await issueGoogleDriveVaultToken(remoteVault.id)
        : await issueHostedVaultToken(
            connection.serverUrl,
            connection.sessionToken,
            remoteVault.id,
            `${vault.name} · ${connection.label}`
          );

    await onBindVault({
      localVaultId: vault.id,
      connectionId: connection.id,
      remoteVaultId: remoteVault.id,
      remoteVaultName: remoteVault.name,
      syncToken: token.token
    });

    if (options?.refreshCatalog ?? true) {
      await loadRemoteVaultCatalog(connection, {
        silent: true
      });
    }
  };

  const requestRemoteVaultImport = async (
    connection: SyncConnection,
    remoteVault: RemoteVaultCatalogEntry,
    options?: {
      openAfterImport?: boolean;
    }
  ) => {
    const localVault = localVaultByGuid.get(remoteVault.id) ?? null;
    const existingBinding = localVault ? bindingsByVaultId.get(localVault.id) ?? null : null;

    const runImport = async () => {
      setBusyKey(`import:${connection.id}:${remoteVault.id}`);

      try {
        const result = await onImportRemoteVault({
          connectionId: connection.id,
          remoteVaultId: remoteVault.id,
          remoteVaultName: remoteVault.name,
          openAfterImport: options?.openAfterImport
        });

        onSelectLocalVault(result.localVaultId);
        await loadRemoteVaultCatalog(connection, {
          silent: true
        });

        if (result.disposition === "pendingUnlock") {
          setInternalFeedback(null);
          openVaultEncryptionModal(
            sortedVaults.find((vault) => vault.id === result.localVaultId) ??
              buildVaultProfileFallback(
                result.localVaultId,
                remoteVault.id,
                result.localVaultName
              ),
            {
              view: "unlock",
              continuation: "import",
              continuationAction: async () => {
                await onRunVaultSync(result.localVaultId);
                await loadRemoteVaultCatalog(connection, {
                  silent: true
                });
                onSelectLocalVault(result.localVaultId);
              }
            }
          );
          return;
        }

        showFeedback(
          "success",
          result.disposition === "imported"
            ? result.nameAdjusted
              ? t("settings.remoteImportAdjusted", {
                  vault: result.localVaultName
                })
              : t("settings.remoteImportCreated", {
                  vault: result.localVaultName
                })
            : t("settings.remoteImportLinked", {
                vault: result.localVaultName
              })
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "SYNC_FAILED";
        showFeedback("error", translateSyncManagerError(message, t));
      } finally {
        setBusyKey(null);
      }
    };

    if (existingBinding && existingBinding.connectionId !== connection.id) {
      setConfirmState({
        title: t("settings.remoteReconnectTitle"),
        description: t("settings.remoteReconnectDescription", {
          vault: localVault?.name ?? remoteVault.name,
          connection: connection.label
        }),
        confirmLabel: t("settings.remoteReconnectConfirm"),
        tone: "danger",
        action: async () => {
          closeModal();
          await runImport();
        }
      });
      return;
    }

    await runImport();
  };

  const requestImportAllRemoteVaults = async (connection: SyncConnection) => {
    let remoteVaults: RemoteVaultCatalogEntry[];

    try {
      remoteVaults =
        remoteVaultsByConnectionId[connection.id] ??
        (await loadRemoteVaultCatalog(connection, {
          silent: false
        }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "SYNC_FAILED";
      showFeedback("error", translateSyncManagerError(message, t));
      return;
    }

    const candidates = remoteVaults.filter((remoteVault) => {
      const localVault = localVaultByGuid.get(remoteVault.id) ?? null;
      const binding = localVault ? bindingsByVaultId.get(localVault.id) ?? null : null;

      return !binding || binding.connectionId !== connection.id || binding.remoteVaultId !== remoteVault.id;
    });

    if (candidates.length === 0) {
      showFeedback("success", t("settings.remoteImportAllNothing"));
      return;
    }

    const reconnectCount = candidates.filter((remoteVault) => {
      const localVault = localVaultByGuid.get(remoteVault.id) ?? null;
      const binding = localVault ? bindingsByVaultId.get(localVault.id) ?? null : null;
      return Boolean(binding && binding.connectionId !== connection.id);
    }).length;
    const safeCandidates = candidates.filter((remoteVault) => {
      const localVault = localVaultByGuid.get(remoteVault.id) ?? null;
      const binding = localVault ? bindingsByVaultId.get(localVault.id) ?? null : null;
      return !binding || binding.connectionId === connection.id;
    });

    const runImportAll = async (
      targetVaults: RemoteVaultCatalogEntry[],
      options?: {
        skippedCount?: number;
      }
    ) => {
      setBusyKey(`import-all:${connection.id}`);

      try {
        let importedCount = 0;
        let linkedCount = 0;
        let pendingUnlockResult:
          | {
              localVaultId: string;
              localVaultName: string;
              remoteVault: RemoteVaultCatalogEntry;
            }
          | null = null;

        for (const remoteVault of targetVaults) {
          const result = await onImportRemoteVault({
            connectionId: connection.id,
            remoteVaultId: remoteVault.id,
            remoteVaultName: remoteVault.name,
            openAfterImport: false
          });

          if (result.disposition === "imported") {
            importedCount += 1;
          } else if (result.disposition === "linked") {
            linkedCount += 1;
          } else {
            pendingUnlockResult = {
              localVaultId: result.localVaultId,
              localVaultName: result.localVaultName,
              remoteVault
            };
            break;
          }
        }

        await loadRemoteVaultCatalog(connection, {
          silent: true
        });

        if (pendingUnlockResult) {
          setInternalFeedback(null);
          openVaultEncryptionModal(
            sortedVaults.find((vault) => vault.id === pendingUnlockResult.localVaultId) ??
              buildVaultProfileFallback(
                pendingUnlockResult.localVaultId,
                pendingUnlockResult.remoteVault.id,
                pendingUnlockResult.localVaultName
              ),
            {
              view: "unlock",
              continuation: "import",
              continuationAction: async () => {
                await onRunVaultSync(pendingUnlockResult.localVaultId);
                await loadRemoteVaultCatalog(connection, {
                  silent: true
                });
                await requestImportAllRemoteVaults(connection);
                onSelectLocalVault(pendingUnlockResult.localVaultId);
              }
            }
          );
          return;
        }

        showFeedback(
          "success",
          options?.skippedCount
            ? t("settings.remoteImportSafeCompleted", {
                imported: importedCount + linkedCount,
                skipped: options.skippedCount
              })
            : t("settings.remoteImportAllCompleted", {
                imported: importedCount,
                linked: linkedCount
              })
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "SYNC_FAILED";
        showFeedback("error", translateSyncManagerError(message, t));
      } finally {
        setBusyKey(null);
      }
    };

    if (reconnectCount > 0) {
      setConfirmState({
        title: t("settings.remoteImportAllConfirmTitle"),
        description: t("settings.remoteImportAllConfirmDescription", {
          connection: connection.label
        }),
        details: [
          t("settings.remoteImportAllDetailTotal", {
            count: candidates.length
          }),
          t("settings.remoteImportAllDetailReconnect", {
            count: reconnectCount
          }),
          t("settings.remoteImportAllDetailSafe", {
            count: safeCandidates.length
          })
        ],
        secondaryLabel:
          safeCandidates.length > 0 ? t("settings.remoteImportSafeOnly") : undefined,
        secondaryAction:
          safeCandidates.length > 0
            ? async () => {
                closeModal();
                await runImportAll(safeCandidates, {
                  skippedCount: reconnectCount
                });
              }
            : undefined,
        confirmLabel: t("settings.remoteImportAll"),
        tone: "danger",
        action: async () => {
          closeModal();
          await runImportAll(candidates);
        }
      });
      return;
    }

    await runImportAll(candidates);
  };

  const executeRemoteVaultDeletion = async (
    connection: SyncConnection,
    remoteVault: RemoteVaultCatalogEntry,
    options?: {
      deleteLocalVaultId?: string | null;
    }
  ) => {
    const actionKey = `delete-remote:${connection.id}:${remoteVault.id}`;
    setBusyKey(actionKey);

    try {
      await onDeleteRemoteVault({
        connectionId: connection.id,
        remoteVaultId: remoteVault.id
      });

      if (options?.deleteLocalVaultId) {
        await onDeleteLocalVault(options.deleteLocalVaultId, {
          skipConfirmation: true
        });
      }

      await loadRemoteVaultCatalog(connection, {
        silent: true
      });

      showFeedback(
        "success",
        options?.deleteLocalVaultId
          ? t("settings.remoteDeleteWithLocalCompleted", {
              vault: remoteVault.name
            })
          : t("settings.remoteDeleteCompleted", {
              vault: remoteVault.name
            })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "SYNC_FAILED";
      showFeedback("error", translateSyncManagerError(message, t));
    } finally {
      setBusyKey(null);
    }
  };

  const requestDeleteRemoteVault = (
    connection: SyncConnection,
    remoteVault: RemoteVaultCatalogEntry
  ) => {
    const matchingLocalVault = localVaultByGuid.get(remoteVault.id) ?? null;
    const matchingBinding = matchingLocalVault
      ? bindingsByVaultId.get(matchingLocalVault.id) ?? null
      : null;
    const linkedHere =
      matchingBinding?.connectionId === connection.id && matchingBinding.remoteVaultId === remoteVault.id;

    setConfirmState({
      title: t("settings.remoteDeleteTitle"),
      description: linkedHere
        ? t("settings.remoteDeleteDescriptionLinked", {
            vault: remoteVault.name
          })
        : t("settings.remoteDeleteDescription", {
            vault: remoteVault.name
          }),
      details: [
        t("settings.remoteDeleteDetailServer"),
        t("settings.remoteDeleteDetailLocal"),
        t("settings.remoteDeleteDetailDisconnect")
      ],
      confirmLabel: t("settings.remoteDeleteAction"),
      tone: "danger",
      action: async () => {
        closeModal();
        await executeRemoteVaultDeletion(connection, remoteVault);
      }
    });
  };

  const requestDeleteLocalVault = (vault: LocalVaultProfile) => {
    const binding = bindingsByVaultId.get(vault.id) ?? null;
    const connection = binding ? connectionsById.get(binding.connectionId) ?? null : null;

    if (!binding || !connection || localVaults.length <= 1) {
      void onDeleteLocalVault(vault.id);
      return;
    }

    setConfirmState({
      title: t("settings.localDeleteChoiceTitle"),
      description: t("settings.localDeleteChoiceDescription", {
        vault: vault.name,
        connection: connection.label
      }),
      details: [
        t("settings.localDeleteOnlyDetailLocal"),
        t("settings.localDeleteOnlyDetailRemote", {
          connection: connection.label
        }),
        t("settings.localDeleteRemoteDetailLocal"),
        t("settings.localDeleteRemoteDetailRemote", {
          connection: connection.label
        })
      ],
      secondaryLabel: t("settings.localDeleteOnlyAction"),
      secondaryAction: async () => {
        closeModal();
        await onDeleteLocalVault(vault.id, {
          skipConfirmation: true
        });
      },
      confirmLabel: t("settings.localDeleteRemoteAction"),
      tone: "danger",
      action: async () => {
        closeModal();
        await executeRemoteVaultDeletion(
          connection,
          {
            id: binding.remoteVaultId,
            name: binding.remoteVaultName,
            createdAt: 0,
            updatedAt: 0,
            lastRevision: binding.syncCursor,
            lastSyncAt: binding.lastSyncAt,
            tokenCount: 0
          },
          {
            deleteLocalVaultId: vault.id
          }
        );
      }
    });
  };

  const requestVaultBinding = async (vaultId: string, connectionId: string) => {
    const vault = sortedVaults.find((entry) => entry.id === vaultId) ?? null;
    const connection = connectionsById.get(connectionId) ?? null;

    if (!vault || !connection) {
      return;
    }

    const existingBinding = bindingsByVaultId.get(vault.id) ?? null;

    const runBinding = async () => {
      setBusyKey(`bind:${vault.id}:${connection.id}`);

      try {
        await performVaultBinding(vault, connection, {
          refreshCatalog: true
        });
        setPendingBindVaultId(null);
        setConnectionAvailability((current) => ({
          ...current,
          [connection.id]: "available"
        }));
        showFeedback("success", t("sync.bindingUpdated"));
      } catch (error) {
        const message = error instanceof Error ? error.message : "SYNC_FAILED";
        setConnectionAvailability((current) => ({
          ...current,
          [connection.id]:
            message === "UNAUTHORIZED" ||
            message === "INVALID_CREDENTIALS" ||
            message === "GOOGLE_DRIVE_AUTH_REQUIRED"
              ? "authError"
              : message === "SERVER_UNAVAILABLE" || message === "HTTP_404"
                ? "unavailable"
                : current[connection.id] ?? "checking"
        }));
        showFeedback("error", translateSyncManagerError(message, t));
      } finally {
        setBusyKey(null);
      }
    };

    if (existingBinding && existingBinding.connectionId !== connection.id) {
      setConfirmState({
        title: t("settings.rebindTitle"),
        description: t("settings.rebindDescription", {
          vault: vault.name,
          connection: connection.label
        }),
        confirmLabel: t("settings.rebindConfirm"),
        tone: "danger",
        action: async () => {
          closeModal();
          await runBinding();
        }
      });
      return;
    }

    await runBinding();
  };

  const requestBindAllVaults = (connection: SyncConnection) => {
    const rebindCount = sortedVaults.filter((vault) => {
      const existingBinding = bindingsByVaultId.get(vault.id);
      return existingBinding && existingBinding.connectionId !== connection.id;
    }).length;

    const runBindingAll = async () => {
      setBusyKey(`bind-all:${connection.id}`);

      try {
        for (const vault of sortedVaults) {
          await performVaultBinding(vault, connection, {
            refreshCatalog: false
          });
        }

        await loadRemoteVaultCatalog(connection, {
          silent: true
        });
        setPendingBindVaultId(null);
        setConnectionAvailability((current) => ({
          ...current,
          [connection.id]: "available"
        }));
        showFeedback("success", t("settings.bindAllCompleted", { count: sortedVaults.length }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "SYNC_FAILED";
        setConnectionAvailability((current) => ({
          ...current,
          [connection.id]:
            message === "UNAUTHORIZED" ||
            message === "INVALID_CREDENTIALS" ||
            message === "GOOGLE_DRIVE_AUTH_REQUIRED"
              ? "authError"
              : message === "SERVER_UNAVAILABLE" || message === "HTTP_404"
                ? "unavailable"
                : current[connection.id] ?? "checking"
        }));
        showFeedback("error", translateSyncManagerError(message, t));
      } finally {
        setBusyKey(null);
      }
    };

    if (rebindCount > 0) {
      setConfirmState({
        title: t("settings.bindAllConfirmTitle"),
        description: t("settings.bindAllConfirmDescription", {
          count: rebindCount,
          connection: connection.label
        }),
        confirmLabel: t("settings.bindAllVaults"),
        tone: "danger",
        action: async () => {
          closeModal();
          await runBindingAll();
        }
      });
      return;
    }

    void runBindingAll();
  };

  const startLinkDraft = (event: ReactPointerEvent<HTMLElement>, vaultId: string) => {
    const stageRect = stageRef.current?.getBoundingClientRect();

    if (!stageRect) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    setPendingBindVaultId(vaultId);
    setDraftLink({
      vaultId,
      x: event.clientX - stageRect.left,
      y: event.clientY - stageRect.top,
      moved: false
    });
  };

  const openCreateVaultModal = () => {
    setVaultNameDraft("");
    setPanelModal({
      kind: "createVault"
    });
  };

  const openRenameVaultModal = (vault: LocalVaultProfile) => {
    setVaultNameDraft(vault.name);
    setPanelModal({
      kind: "renameVault",
      vault
    });
  };

  const resolveVaultEncryptionSummary = (vault: LocalVaultProfile) =>
    vaultEncryptionById[vault.id] ?? {
      enabled: false,
      state: "disabled" as const,
      keyId: null,
      updatedAt: null
    };

  const buildVaultProfileFallback = (
    vaultId: string,
    vaultGuid: string,
    name: string
  ): LocalVaultProfile => ({
    id: vaultId,
    vaultGuid,
    name,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });

  const openVaultEncryptionModal = (
    vault: LocalVaultProfile,
    options?: {
      view?: VaultEncryptionModalView;
      continuation?: VaultEncryptionContinuationKind;
      continuationAction?: (() => Promise<void>) | null;
    }
  ) => {
    setEncryptionPassphraseDraft("");
    setEncryptionPassphraseConfirmDraft("");
    setEncryptionNextPassphraseDraft("");
    setEncryptionNextPassphraseConfirmDraft("");
    pendingVaultEncryptionContinuationRef.current = options?.continuationAction ?? null;
    setPanelModal({
      kind: "vaultEncryption",
      vault,
      view: options?.view,
      continuation: options?.continuation ?? null
    });
  };

  const handleVaultEncryptionSubmit = async () => {
    if (!panelModal || panelModal.kind !== "vaultEncryption") {
      return;
    }

    const vault = panelModal.vault;
    const summary = resolveVaultEncryptionSummary(vault);
    const modalView = panelModal.view ?? "default";
    const isExplicitUnlock = modalView === "unlock";
    const isEnabling = !isExplicitUnlock && summary.state === "disabled";
    const isLocked = isExplicitUnlock || summary.state === "locked";
    const passphrase = encryptionPassphraseDraft.trim();
    const continuation = pendingVaultEncryptionContinuationRef.current;

    if (isEnabling) {
      if (!passphrase) {
        showFeedback("error", t("sync.vaultEncryptionPassphraseRequired"));
        return;
      }

      if (passphrase.length < 8) {
        showFeedback("error", t("sync.vaultEncryptionPassphraseTooShort"));
        return;
      }

      if (passphrase !== encryptionPassphraseConfirmDraft.trim()) {
        showFeedback("error", t("sync.vaultEncryptionPassphraseMismatch"));
        return;
      }

      setBusyKey(`vault-encryption:${vault.id}:enable`);

      try {
        await onEnableVaultEncryption({
          localVaultId: vault.id,
          passphrase
        });
        closeModal();
      } catch (error) {
        const message = error instanceof Error ? error.message : "SYNC_FAILED";
        showFeedback("error", translateSyncManagerError(message, t));
      } finally {
        setBusyKey(null);
      }

      return;
    }

    if (isLocked) {
      if (!passphrase) {
        showFeedback("error", t("sync.vaultEncryptionPassphraseRequired"));
        return;
      }

      setBusyKey(`vault-encryption:${vault.id}:unlock`);

      try {
        await onUnlockVaultEncryption({
          localVaultId: vault.id,
          passphrase
        });

        closeModal();

        if (continuation) {
          await continuation();
        }

      } catch (error) {
        const message = error instanceof Error ? error.message : "SYNC_FAILED";
        showFeedback("error", translateSyncManagerError(message, t));
      } finally {
        setBusyKey(null);
      }
    }
  };

  const handleChangeVaultEncryptionPassphraseSubmit = async () => {
    if (!panelModal || panelModal.kind !== "vaultEncryption") {
      return;
    }

    const vault = panelModal.vault;
    const hasUnlockedSession = resolveVaultEncryptionSummary(vault).state === "ready";
    const currentPassphrase = encryptionPassphraseDraft.trim();
    const nextPassphrase = encryptionNextPassphraseDraft.trim();
    const confirmPassphrase = encryptionNextPassphraseConfirmDraft.trim();

    if (!nextPassphrase) {
      showFeedback("error", t("sync.vaultEncryptionPassphraseRequired"));
      return;
    }

    if (nextPassphrase.length < 8) {
      showFeedback("error", t("sync.vaultEncryptionPassphraseTooShort"));
      return;
    }

    if (nextPassphrase !== confirmPassphrase) {
      showFeedback("error", t("sync.vaultEncryptionPassphraseMismatch"));
      return;
    }

    if (!hasUnlockedSession && !currentPassphrase) {
      showFeedback("error", t("sync.vaultEncryptionPassphraseRequired"));
      return;
    }

    setBusyKey(`vault-encryption:${vault.id}:change`);

    try {
      await onChangeVaultEncryptionPassphrase({
        localVaultId: vault.id,
        currentPassphrase: hasUnlockedSession ? undefined : currentPassphrase,
        nextPassphrase
      });
      closeModal();
    } catch (error) {
      const message = error instanceof Error ? error.message : "SYNC_FAILED";
      showFeedback("error", translateSyncManagerError(message, t));
    } finally {
      setBusyKey(null);
    }
  };

  const handleDisableVaultEncryptionSubmit = async () => {
    if (!panelModal || panelModal.kind !== "vaultEncryption") {
      return;
    }

    const vault = panelModal.vault;
    const hasUnlockedSession = resolveVaultEncryptionSummary(vault).state === "ready";
    const currentPassphrase = encryptionPassphraseDraft.trim();

    if (!hasUnlockedSession && !currentPassphrase) {
      showFeedback("error", t("sync.vaultEncryptionPassphraseRequired"));
      return;
    }

    setBusyKey(`vault-encryption:${vault.id}:disable`);

    try {
      await onDisableVaultEncryption({
        localVaultId: vault.id,
        currentPassphrase: hasUnlockedSession ? undefined : currentPassphrase
      });
      closeModal();
    } catch (error) {
      const message = error instanceof Error ? error.message : "SYNC_FAILED";
      showFeedback("error", translateSyncManagerError(message, t));
    } finally {
      setBusyKey(null);
    }
  };

  const handleLockCurrentVaultSession = async (vault: LocalVaultProfile) => {
    setBusyKey(`vault-encryption:${vault.id}:lock`);

    try {
      await onLockVaultEncryption(vault.id);
      closeModal();
    } catch (error) {
      const message = error instanceof Error ? error.message : "SYNC_FAILED";
      showFeedback("error", translateSyncManagerError(message, t));
    } finally {
      setBusyKey(null);
    }
  };

  const connectionPreviewNames = (connectionId: string) =>
    syncBindings
      .filter((binding) => binding.connectionId === connectionId)
      .map((binding) => sortedVaults.find((vault) => vault.id === binding.localVaultId)?.name ?? binding.localVaultId)
      .slice(0, 3);

  return (
    <section className="sync-settings-shell">
      <header className="sync-settings-header">
        <div className="sync-settings-header-main">
          <button type="button" className="sync-settings-back" onClick={onBack}>
            <span className="sync-settings-back-icon" aria-hidden="true">
              <ChevronLeftGlyph />
            </span>
            <span>{t("settings.back")}</span>
          </button>
          <div className="sync-settings-heading">
            <p className="panel-kicker sync-settings-kicker">{t("settings.syncKicker")}</p>
            <h2 className="panel-title sync-settings-title">{t("settings.syncTitle")}</h2>
            <p className="sync-settings-caption">{t("settings.syncManagerIntro")}</p>
          </div>
        </div>
        <span className={`status-chip ${online ? "online" : "offline"}`}>
          {online ? t("settings.networkOnline") : t("settings.networkOffline")}
        </span>
      </header>

      <div className="sync-settings-stage" ref={stageRef}>
        <svg className="sync-settings-links" aria-hidden="true">
          {linkMetrics.map((metric) => (
            <g key={metric.id}>
              <path
                d={metric.path}
                className={`sync-settings-link-wire is-${metric.statusTone}`}
                style={{ "--link-color": metric.color } as CSSProperties}
              />
              <path
                d={metric.path}
                className={`sync-settings-link-stream is-${metric.statusTone}`}
                style={{ "--link-color": metric.color } as CSSProperties}
              />
            </g>
          ))}

          {draftLink ? (
            (() => {
              const vaultNode = vaultRefs.current.get(draftLink.vaultId);
              const stageRect = stageRef.current?.getBoundingClientRect();

              if (!vaultNode || !stageRect) {
                return null;
              }

              const vaultRect = vaultNode.getBoundingClientRect();
              const x1 = vaultRect.right - stageRect.left - 6;
              const y1 = vaultRect.top - stageRect.top + vaultRect.height / 2;
              const x2 = draftLink.x;
              const y2 = draftLink.y;

              return (
                <>
                  <path
                    d={buildLinkPath(x1, y1, x2, y2)}
                    className="sync-settings-link-wire is-draft"
                    style={{ "--link-color": "#ffe29b" } as CSSProperties}
                  />
                  <path
                    d={buildLinkPath(x1, y1, x2, y2)}
                    className="sync-settings-link-stream is-draft"
                    style={{ "--link-color": "#ffe29b" } as CSSProperties}
                  />
                </>
              );
            })()
          ) : null}
        </svg>

        <div className="sync-settings-columns">
          <section className="sync-settings-column is-vaults">
            <div className="sync-settings-column-head">
              <div className="sync-settings-column-copy">
                <span className="setting-label">{t("settings.vaultsTitle")}</span>
                <p>{t("settings.vaultsDescription")}</p>
              </div>
              <button
                type="button"
                className="sync-settings-icon-button"
                onClick={openCreateVaultModal}
                title={t("sync.localVaultCreate")}
              >
                <PlusGlyph />
              </button>
            </div>

            <div className="sync-settings-card-list" ref={vaultListRef}>
              {sortedVaults.map((vault) => {
                const isActive = vault.id === activeLocalVaultId;
                const isSelected = vault.id === selectedLocalVaultId;
                const binding = bindingsByVaultId.get(vault.id) ?? null;
                const bindingConnection = binding ? connectionsById.get(binding.connectionId) ?? null : null;
                const encryption = resolveVaultEncryptionSummary(vault);
                const needsUnlock =
                  (binding?.lastError === "VAULT_ENCRYPTION_LOCKED" || encryption.state === "locked") &&
                  encryption.enabled;
                const statusLabel = !binding
                  ? t("settings.statusUnbound")
                  : needsUnlock
                    ? t("settings.statusUnlockRequired")
                    : binding.syncStatus === "syncing"
                    ? t("settings.statusSyncing")
                    : binding.syncStatus === "error"
                      ? t("settings.statusError")
                      : t("settings.statusReady");

                return (
                  <article
                    key={vault.id}
                    ref={(node) => registerVaultRef(vault.id, node)}
                    className={`sync-settings-card sync-settings-vault-card ${isSelected ? "is-selected" : ""} ${isActive ? "is-active" : ""} ${pendingBindVaultId === vault.id ? "is-binding-source" : ""}`}
                    onClick={() => onSelectLocalVault(vault.id)}
                  >
                    <div className="sync-settings-card-main">
                      <div className="sync-settings-card-copy">
                        <div className="sync-settings-chip-row sync-settings-chip-row-card">
                          {isActive ? <span className="sync-settings-chip is-accent">{t("sync.localVaultActive")}</span> : null}
                          {encryption.enabled ? (
                            <span
                              className={`sync-settings-chip ${
                                encryption.state === "ready" ? "is-encrypted-ready" : "is-encrypted-locked"
                              }`}
                            >
                              {encryption.state === "ready"
                                ? t("settings.vaultEncryptionReady")
                                : t("settings.vaultEncryptionLocked")}
                            </span>
                          ) : null}
                          <span
                            className={`sync-settings-chip ${
                              !bindingConnection
                                ? "is-unbound"
                                : needsUnlock
                                  ? "is-info"
                                  : binding?.syncStatus === "error"
                                  ? "is-error"
                                  : binding?.syncStatus === "syncing"
                                    ? "is-info"
                                    : "is-ready"
                            }`}
                          >
                            {statusLabel}
                          </span>
                        </div>
                        <div className="sync-settings-card-titleline">
                          <span
                            className="sync-settings-card-icon"
                            style={{ "--item-color": bindingConnection ? providerAccent(bindingConnection.provider) : "#e7d6a2" } as CSSProperties}
                          >
                            <VaultGlyph />
                          </span>
                          {encryption.enabled ? (
                            <span
                              className={`sync-settings-encryption-badge ${
                                encryption.state === "ready" ? "is-ready" : "is-locked"
                              }`}
                              title={
                                encryption.state === "ready"
                                  ? t("settings.vaultEncryptionReady")
                                  : t("settings.vaultEncryptionLocked")
                              }
                            >
                              <LockGlyph unlocked={encryption.state === "ready"} />
                            </span>
                          ) : null}
                          <strong>{vault.name}</strong>
                        </div>
                        <span className="sync-settings-card-meta">
                          {bindingConnection
                            ? t("settings.boundToConnection", {
                                connection: bindingConnection.label
                              })
                            : t("sync.localVaultUnbound")}
                        </span>
                        {binding ? (
                          <span className="sync-settings-card-submeta">
                            {binding.remoteVaultName} · {formatTime(binding.lastSyncAt, i18n.language)}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="sync-settings-card-actions">
                      <button
                        type="button"
                        className={`sync-settings-icon-button ${
                          encryption.enabled && encryption.state === "ready" ? "is-encryption-ready" : ""
                        }`}
                        title={
                          encryption.enabled
                            ? encryption.state === "ready"
                              ? t("settings.manageVaultEncryption")
                              : t("settings.unlockVaultEncryption")
                            : t("settings.enableVaultEncryption")
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          openVaultEncryptionModal(vault, {
                            view: encryption.state === "locked" ? "unlock" : "default"
                          });
                        }}
                      >
                        <LockGlyph unlocked={encryption.state === "ready"} />
                      </button>
                      <button
                        type="button"
                        className="sync-settings-icon-button sync-settings-link-handle"
                        title={t("settings.linkVault")}
                        onPointerDown={(event) => startLinkDraft(event, vault.id)}
                        onClick={(event) => {
                          event.stopPropagation();
                          setPendingBindVaultId(vault.id);
                        }}
                      >
                        <LinkGlyph />
                      </button>
                      {binding ? (
                        <button
                          type="button"
                          className="sync-settings-icon-button"
                          title={t("settings.disconnectVault")}
                          onClick={(event) => {
                            event.stopPropagation();
                            void onClearBinding(vault.id);
                          }}
                        >
                          <UnlinkGlyph />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="sync-settings-icon-button"
                        title={t("sync.localVaultRename")}
                        onClick={(event) => {
                          event.stopPropagation();
                          openRenameVaultModal(vault);
                        }}
                      >
                        <EditGlyph />
                      </button>
                      <button
                        type="button"
                        className="sync-settings-icon-button is-danger"
                        title={t("sync.localVaultDelete")}
                        onClick={(event) => {
                          event.stopPropagation();
                          requestDeleteLocalVault(vault);
                        }}
                      >
                        <TrashGlyph />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="sync-settings-column is-connections">
            <div className="sync-settings-column-head">
              <div className="sync-settings-column-copy">
                <span className="setting-label">{t("settings.connectionsTitle")}</span>
                <p>{t("settings.connectionsDescription")}</p>
              </div>
              <button
                type="button"
                className="sync-settings-icon-button"
                onClick={() => setPanelModal({ kind: "addConnection" })}
                title={t("settings.addConnection")}
              >
                <PlusGlyph />
              </button>
            </div>

            <div className="sync-settings-card-list" ref={connectionListRef}>
              {syncConnections.length === 0 ? (
                <div className="sync-settings-empty-card">
                  <strong>{t("settings.noConnectionsTitle")}</strong>
                  <span>{t("settings.noConnectionsDescription")}</span>
                </div>
              ) : (
                syncConnections.map((connection) => {
                  const previewNames = connectionPreviewNames(connection.id);
                  const boundCount = boundVaultCountByConnectionId.get(connection.id) ?? 0;
                  const remoteVaults = remoteVaultsByConnectionId[connection.id] ?? [];
                  const remoteCount = remoteVaults.length;
                  const remoteError = remoteVaultErrors[connection.id] ?? null;
                  const isRemoteLoading = remoteVaultLoading[connection.id] ?? false;
                  const remoteSectionExpanded = expandedRemoteConnectionIds[connection.id] ?? true;
                  const canBindSelected = pendingBindVaultId !== null;
                  const availability = online
                    ? connectionAvailability[connection.id] ?? "checking"
                    : "offline";
                  const availabilityLabel =
                    availability === "available"
                      ? t("settings.connectionAvailable")
                      : availability === "unavailable"
                        ? t("settings.connectionUnavailable")
                        : availability === "authError"
                          ? t("settings.connectionAuthError")
                          : availability === "offline"
                            ? t("settings.connectionOffline")
                            : t("settings.connectionChecking");
                  const availabilityChipClass =
                    availability === "available"
                      ? "is-ready"
                      : availability === "unavailable"
                        ? "is-error"
                        : availability === "authError"
                          ? "is-info"
                          : availability === "offline"
                            ? "is-offline"
                            : "is-neutral";

                  return (
                    <article
                      key={connection.id}
                      data-sync-connection-id={connection.id}
                      ref={(node) => registerConnectionRef(connection.id, node)}
                      className={`sync-settings-card sync-settings-connection-card ${canBindSelected ? "is-bind-target" : ""} ${hoverConnectionId === connection.id ? "is-bind-hover" : ""}`}
                      style={{ "--connection-accent": providerAccent(connection.provider) } as CSSProperties}
                      onClick={() => {
                        if (pendingBindVaultId) {
                          void requestVaultBinding(pendingBindVaultId, connection.id);
                        }
                      }}
                    >
                      <div className="sync-settings-card-main">
                        <div className="sync-settings-card-copy">
                          <div className="sync-settings-chip-row sync-settings-chip-row-card">
                            <span
                              className={`sync-settings-chip ${
                                connection.provider === "hosted"
                                  ? "is-hosted"
                                  : connection.provider === "googleDrive"
                                    ? "is-google-drive"
                                    : "is-self-hosted"
                              }`}
                            >
                              {connection.provider === "hosted"
                                ? t("sync.hosted")
                                : connection.provider === "googleDrive"
                                  ? t("sync.googleDrive")
                                  : t("sync.selfHosted")}
                            </span>
                            <span className="sync-settings-chip is-count">
                              {t("settings.linkedVaultCount", { count: boundCount })}
                            </span>
                            <span className="sync-settings-chip is-neutral">
                              {t("settings.remoteVaultCount", { count: remoteCount })}
                            </span>
                            <span className={`sync-settings-chip ${availabilityChipClass}`}>{availabilityLabel}</span>
                          </div>
                          <div className="sync-settings-card-titleline">
                            <span className="sync-settings-card-icon" style={{ "--item-color": providerAccent(connection.provider) } as CSSProperties}>
                              <SyncConnectionIcon provider={connection.provider} />
                            </span>
                            <strong>{connection.label}</strong>
                          </div>
                          <span className="sync-settings-card-meta">
                            {connection.provider === "hosted"
                              ? connection.userEmail || connection.serverUrl
                              : connection.provider === "googleDrive"
                                ? connection.userEmail || t("settings.googleDriveAppFolder")
                              : connection.serverUrl}
                          </span>
                          <span className="sync-settings-card-submeta">
                            {connection.provider === "hosted"
                              ? connection.userName || t("sync.hostedAccountSignedOut")
                              : connection.provider === "googleDrive"
                                ? t("settings.googleDriveSessionReady")
                              : `${t("sync.managementToken")}: ${maskToken(connection.managementToken)}`}
                          </span>
                        </div>
                      </div>

                      {previewNames.length > 0 ? (
                        <div className="sync-settings-preview-chips">
                          {previewNames.map((name) => (
                            <span key={`${connection.id}-${name}`} className="sync-settings-mini-chip">
                              {name}
                            </span>
                          ))}
                          {boundCount > previewNames.length ? (
                            <span className="sync-settings-mini-chip">+{boundCount - previewNames.length}</span>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="sync-settings-remote-section" onClick={(event) => event.stopPropagation()}>
                        <div className="sync-settings-remote-head">
                          <div className="sync-settings-remote-copy">
                            <strong>{t("settings.remoteVaultsTitle")}</strong>
                            <span>{t("settings.remoteVaultsDescription")}</span>
                          </div>
                          <div className="sync-settings-remote-actions">
                            <button
                              type="button"
                              className="sync-settings-icon-button"
                              title={t("settings.remoteVaultRefresh")}
                              disabled={isRemoteLoading || busyKey !== null}
                              onClick={() => {
                                void (async () => {
                                  let nextConnection = connection;

                                  if (
                                    connection.provider === "googleDrive" &&
                                    availability === "authError"
                                  ) {
                                    try {
                                      setBusyKey(`reauth:${connection.id}`);
                                      nextConnection = await reauthorizeGoogleDriveConnection(connection);
                                    } catch (error) {
                                      const message = error instanceof Error ? error.message : "SYNC_FAILED";
                                      showFeedback("error", translateSyncManagerError(message, t));
                                      setBusyKey(null);
                                      return;
                                    }
                                  }

                                  try {
                                    await loadRemoteVaultCatalog(nextConnection, {
                                      silent: false
                                    });
                                  } finally {
                                    setBusyKey((current) =>
                                      current === `reauth:${connection.id}` ? null : current
                                    );
                                  }
                                })();
                              }}
                            >
                              <RefreshGlyph />
                            </button>
                            <button
                              type="button"
                              className="sync-settings-icon-button"
                              title={t("settings.remoteVaultExpand")}
                              onClick={() =>
                                setExpandedRemoteConnectionIds((current) => ({
                                  ...current,
                                  [connection.id]: !remoteSectionExpanded
                                }))
                              }
                            >
                              <ChevronToggleGlyph expanded={remoteSectionExpanded} />
                            </button>
                          </div>
                        </div>

                        {remoteSectionExpanded ? (
                          <>
                            <div className="sync-settings-remote-toolbar">
                              <span className="sync-settings-remote-toolbar-copy">
                                {isRemoteLoading
                                  ? t("settings.remoteVaultLoading")
                                  : t("settings.remoteVaultAvailableCount", {
                                      count: remoteCount
                                    })}
                              </span>
                              <button
                                type="button"
                                className="sync-settings-inline-action"
                                disabled={busyKey !== null || isRemoteLoading || remoteCount === 0}
                                onClick={() => {
                                  void requestImportAllRemoteVaults(connection);
                                }}
                              >
                                {t("settings.remoteImportAll")}
                              </button>
                            </div>

                            {remoteError ? (
                              <div className="sync-settings-remote-empty is-error">
                                <strong>{t("settings.remoteVaultLoadFailed")}</strong>
                                <span>{remoteError}</span>
                              </div>
                            ) : null}

                            {!remoteError && remoteCount === 0 && !isRemoteLoading ? (
                              <div className="sync-settings-remote-empty">
                                <strong>{t("sync.remoteVaults")}</strong>
                                <span>{t("sync.remoteVaultEmpty")}</span>
                              </div>
                            ) : null}

                            {remoteCount > 0 ? (
                              <div className="sync-settings-remote-list">
                                {remoteVaults.map((remoteVault) => {
                                  const matchingLocalVault = localVaultByGuid.get(remoteVault.id) ?? null;
                                  const matchingBinding = matchingLocalVault
                                    ? bindingsByVaultId.get(matchingLocalVault.id) ?? null
                                    : null;
                                  const isLinkedHere =
                                    matchingBinding?.connectionId === connection.id &&
                                    matchingBinding.remoteVaultId === remoteVault.id;
                                  const hasNameCollision =
                                    !matchingLocalVault &&
                                    localVaultNameSet.has(remoteVault.name.trim().toLowerCase());
                                  const actionKey = `import:${connection.id}:${remoteVault.id}`;
                                  const isActionBusy = busyKey === actionKey;

                                  return (
                                    <article key={remoteVault.id} className="sync-settings-remote-card">
                                      <div className="sync-settings-remote-card-copy">
                                        <div className="sync-settings-chip-row sync-settings-chip-row-card">
                                          {isLinkedHere ? (
                                            <span className="sync-settings-chip is-ready">
                                              {t("settings.remoteVaultLinkedHere")}
                                            </span>
                                          ) : null}
                                          {matchingLocalVault && !isLinkedHere ? (
                                            <span className="sync-settings-chip is-info">
                                              {t("settings.remoteVaultOnDevice")}
                                            </span>
                                          ) : null}
                                          {hasNameCollision ? (
                                            <span className="sync-settings-chip is-count">
                                              {t("settings.remoteVaultNameCollision")}
                                            </span>
                                          ) : null}
                                        </div>
                                        <div className="sync-settings-card-titleline">
                                          <span
                                            className="sync-settings-card-icon"
                                            style={{ "--item-color": providerAccent(connection.provider) } as CSSProperties}
                                          >
                                            <VaultGlyph />
                                          </span>
                                          <strong>{remoteVault.name}</strong>
                                        </div>
                                        <span className="sync-settings-card-meta">
                                          {t("settings.remoteVaultIdLabel", {
                                            id: remoteVault.id
                                          })}
                                        </span>
                                        <span className="sync-settings-card-submeta">
                                          {t("settings.remoteVaultUpdatedAt", {
                                            time: formatTime(remoteVault.lastSyncAt ?? remoteVault.updatedAt, i18n.language)
                                          })}
                                        </span>
                                        {matchingLocalVault ? (
                                          <span className="sync-settings-card-submeta">
                                            {t("settings.remoteVaultLocalMatch", {
                                              vault: matchingLocalVault.name
                                            })}
                                          </span>
                                        ) : hasNameCollision ? (
                                          <span className="sync-settings-card-submeta">
                                            {t("settings.remoteVaultWillAlias")}
                                          </span>
                                        ) : null}
                                      </div>

                                      <div className="sync-settings-card-actions">
                                        {isLinkedHere && matchingLocalVault ? (
                                          <button
                                            type="button"
                                            className="sync-settings-inline-action"
                                            onClick={() => onSelectLocalVault(matchingLocalVault.id)}
                                          >
                                            {t("settings.selectLocalVault")}
                                          </button>
                                        ) : (
                                          <button
                                            type="button"
                                            className="sync-settings-inline-action"
                                            disabled={isActionBusy || busyKey !== null}
                                            onClick={() => {
                                              void requestRemoteVaultImport(connection, remoteVault);
                                            }}
                                          >
                                            {matchingLocalVault
                                              ? t("settings.remoteImportLinkLocal")
                                              : t("settings.remoteImportAction")}
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          className="sync-settings-icon-button is-danger"
                                          title={t("settings.remoteDeleteAction")}
                                          disabled={busyKey !== null}
                                          onClick={() => {
                                            requestDeleteRemoteVault(connection, remoteVault);
                                          }}
                                        >
                                          <TrashGlyph />
                                        </button>
                                      </div>
                                    </article>
                                  );
                                })}
                              </div>
                            ) : null}
                          </>
                        ) : null}
                      </div>

                      <div className="sync-settings-card-actions sync-settings-card-actions-wide">
                        <button
                          type="button"
                          className="sync-settings-inline-action"
                          disabled={busyKey !== null}
                          onClick={(event) => {
                            event.stopPropagation();
                            requestBindAllVaults(connection);
                          }}
                        >
                          {t("settings.bindAllVaults")}
                        </button>
                        <button
                          type="button"
                          className="sync-settings-icon-button is-danger"
                          title={t("sync.connectionDelete")}
                          onClick={(event) => {
                            event.stopPropagation();
                            onDeleteConnection(connection.id);
                          }}
                        >
                          <TrashGlyph />
                        </button>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </div>

      {pendingBindVaultId ? (
        <div className="sync-settings-binding-hint">
          <div className="sync-settings-binding-copy">
            <strong>{t("settings.bindingHintTitle")}</strong>
            <span>
              {t("settings.bindingHintDescription", {
                vault:
                  sortedVaults.find((vault) => vault.id === pendingBindVaultId)?.name ??
                  t("sync.localVault")
              })}
            </span>
          </div>
          <button
            type="button"
            className="sync-settings-inline-action"
            onClick={() => {
              setPendingBindVaultId(null);
              setDraftLink(null);
            }}
          >
            {t("filters.clear")}
          </button>
        </div>
      ) : null}

      <div className="sync-settings-footer">
        <div className="sync-settings-footer-copy">
          <strong>{selectedVault?.name ?? t("sync.localVault")}</strong>
          <span>
            {selectedVaultBinding &&
            selectedVaultEncryption?.enabled &&
            (selectedVaultEncryption.state === "locked" ||
              selectedVaultBinding.lastError === "VAULT_ENCRYPTION_LOCKED")
              ? t("settings.vaultEncryptionUnlockToContinueSync")
              : selectedVaultConnection && selectedVaultBinding
              ? `${selectedVaultConnection.label} · ${formatTime(selectedVaultBinding.lastSyncAt, i18n.language)}`
              : t("settings.statusUnbound")}
          </span>
        </div>
        <div className="sync-settings-footer-actions">
          <button
            type="button"
            className="sync-settings-primary-action"
            onClick={() => {
              if (!selectedVault) {
                return;
              }

              void (async () => {
                if (
                  selectedVaultBinding &&
                  selectedVaultEncryption?.enabled &&
                  (selectedVaultEncryption.state === "locked" ||
                    selectedVaultBinding.lastError === "VAULT_ENCRYPTION_LOCKED")
                ) {
                  setInternalFeedback(null);
                  openVaultEncryptionModal(selectedVault, {
                    view: "unlock",
                    continuation: "sync",
                    continuationAction: async () => {
                      await onRunVaultSync(selectedVault.id);
                    }
                  });
                  return;
                }

                if (
                  selectedVaultConnection?.provider === "googleDrive" &&
                  connectionAvailability[selectedVaultConnection.id] === "authError"
                ) {
                  try {
                    setBusyKey(`reauth:${selectedVaultConnection.id}`);
                    await reauthorizeGoogleDriveConnection(selectedVaultConnection);
                  } catch (error) {
                    const message = error instanceof Error ? error.message : "SYNC_FAILED";
                    showFeedback("error", translateSyncManagerError(message, t));
                    setBusyKey(null);
                    return;
                  } finally {
                    setBusyKey((current) =>
                      current === `reauth:${selectedVaultConnection.id}` ? null : current
                    );
                  }
                }

                await onRunVaultSync(selectedVault.id);
              })();
            }}
            disabled={!selectedVaultBinding || selectedVaultBinding.syncStatus === "syncing"}
          >
            {selectedVaultBinding?.syncStatus === "syncing"
              ? t("sync.syncing")
              : selectedVaultBinding &&
                  selectedVaultEncryption?.enabled &&
                  (selectedVaultEncryption.state === "locked" ||
                    selectedVaultBinding.lastError === "VAULT_ENCRYPTION_LOCKED")
                ? t("settings.unlockVaultEncryption")
                : t("sync.syncNow")}
          </button>
        </div>
      </div>

      {feedback ? (
        <div className={`sync-settings-feedback ${feedback.tone === "error" ? "is-error" : "is-success"}`}>
          <span>{feedback.text}</span>
        </div>
      ) : null}

      {panelModal ? (
        <div className="sync-settings-modal-layer" role="dialog" aria-modal="true">
          <button className="sync-settings-modal-dim" aria-label={t("orbit.closeModal")} onClick={closeModal} />
          <div className="sync-settings-modal-card">
            <div className="sync-settings-modal-head">
              <div className="sync-settings-modal-heading">
                <p className="panel-kicker">
                  {panelModal.kind === "createVault"
                    ? t("sync.localVaultCreate")
                    : panelModal.kind === "renameVault"
                      ? t("sync.localVaultRename")
                      : panelModal.kind === "vaultEncryption"
                        ? t("settings.vaultEncryptionKicker")
                        : panelModal.kind === "addConnection"
                          ? t("settings.addConnection")
                          : panelModal.kind === "addGoogleDrive"
                            ? t("sync.googleDrive")
                            : panelModal.kind === "addHosted"
                              ? t("sync.hosted")
                              : t("sync.selfHosted")}
                </p>
                <h3>
                  {panelModal.kind === "createVault"
                    ? t("settings.createVaultTitle")
                    : panelModal.kind === "renameVault"
                      ? t("settings.renameVaultTitle")
                      : panelModal.kind === "vaultEncryption"
                        ? t("settings.vaultEncryptionTitle", {
                            vault: panelModal.vault.name
                          })
                        : panelModal.kind === "addConnection"
                          ? t("settings.connectionCatalogTitle")
                          : panelModal.kind === "addGoogleDrive"
                            ? t("settings.googleDriveConnectionTitle")
                            : panelModal.kind === "addHosted"
                              ? t("settings.hostedConnectionTitle")
                              : t("settings.selfHostedConnectionTitle")}
                </h3>
              </div>
              <button type="button" className="sync-settings-icon-button" onClick={closeModal} title={t("orbit.closeModal")}>
                <CloseGlyph />
              </button>
            </div>

            {panelModal.kind === "createVault" || panelModal.kind === "renameVault" ? (
              <div className="sync-settings-modal-body">
                <p className="sync-settings-modal-copy">
                  {panelModal.kind === "createVault"
                    ? t("settings.createVaultDescription")
                    : t("settings.renameVaultDescription")}
                </p>
                <input
                  className="sync-settings-input"
                  value={vaultNameDraft}
                  onChange={(event) => setVaultNameDraft(event.target.value)}
                  placeholder={t("sync.localVaultCreatePlaceholder")}
                  autoFocus
                />
                <div className="sync-settings-modal-actions">
                  <button type="button" className="sync-settings-inline-action" onClick={closeModal}>
                    {t("dialog.cancel")}
                  </button>
                  <button
                    type="button"
                    className="sync-settings-primary-action"
                    onClick={panelModal.kind === "createVault" ? handleCreateVault : handleRenameVault}
                  >
                    {panelModal.kind === "createVault" ? t("orbit.create") : t("sync.localVaultSave")}
                  </button>
                </div>
              </div>
            ) : null}

            {panelModal.kind === "vaultEncryption" ? (
              <div className="sync-settings-modal-body">
                {(() => {
                  const summary = resolveVaultEncryptionSummary(panelModal.vault);
                  const modalView = panelModal.view ?? "default";
                  const isExplicitUnlock = modalView === "unlock";
                  const isEnabling = !isExplicitUnlock && summary.state === "disabled";
                  const isLocked = isExplicitUnlock || summary.state === "locked";
                  const isReady = !isEnabling && !isLocked;
                  const hasUnlockedSession = summary.state === "ready";
                  const needsCurrentPassphrase =
                    (modalView === "changePassphrase" || modalView === "disable") &&
                    !hasUnlockedSession;
                  const hasBinding = Boolean(bindingsByVaultId.get(panelModal.vault.id) ?? null);
                  const enableBusyKey = `vault-encryption:${panelModal.vault.id}:enable`;
                  const unlockBusyKey = `vault-encryption:${panelModal.vault.id}:unlock`;
                  const lockBusyKey = `vault-encryption:${panelModal.vault.id}:lock`;
                  const changeBusyKey = `vault-encryption:${panelModal.vault.id}:change`;
                  const disableBusyKey = `vault-encryption:${panelModal.vault.id}:disable`;
                  const submitBusyKey = isEnabling ? enableBusyKey : unlockBusyKey;

                  return (
                    <>
                      <p className="sync-settings-modal-copy">
                        {isEnabling
                          ? t("settings.vaultEncryptionEnableDescription")
                          : isLocked
                            ? panelModal.continuation === "import"
                              ? t("settings.vaultEncryptionUnlockToContinueImport")
                              : panelModal.continuation === "sync"
                                ? t("settings.vaultEncryptionUnlockToContinueSync")
                                : t("settings.vaultEncryptionUnlockDescription")
                            : modalView === "changePassphrase"
                              ? t("settings.vaultEncryptionChangeDescription")
                              : modalView === "disable"
                                ? t("settings.vaultEncryptionDisableDescription")
                                : t("settings.vaultEncryptionReadyDescription")}
                      </p>

                      <div className="sync-settings-note-shell">
                        <span className="sync-settings-note-chip">E2EE</span>
                        <div className="sync-settings-encryption-stack">
                          <span className="sync-settings-note-copy">
                            {isEnabling
                              ? t("settings.vaultEncryptionEnableHint")
                              : isLocked
                                ? t("settings.vaultEncryptionLockedHint")
                                : modalView === "changePassphrase"
                                  ? hasBinding
                                    ? t("settings.vaultEncryptionBoundMigrationHint")
                                    : t("settings.vaultEncryptionChangeHint")
                                  : modalView === "disable"
                                    ? hasBinding
                                      ? t("settings.vaultEncryptionDisableRemoteHint")
                                      : t("settings.vaultEncryptionDisableLocalHint")
                                    : t("settings.vaultEncryptionReadyHint")}
                          </span>
                          {summary.keyId ? (
                            <div className="sync-settings-encryption-meta">
                              <span>{t("settings.vaultEncryptionKeyId")}</span>
                              <code className="sync-settings-code-pill">{summary.keyId}</code>
                            </div>
                          ) : null}
                          {summary.updatedAt ? (
                            <div className="sync-settings-encryption-meta">
                              <span>{t("settings.vaultEncryptionUpdatedAt")}</span>
                              <strong>{formatTime(summary.updatedAt, i18n.language)}</strong>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {isEnabling ? (
                        <>
                          <input
                            className="sync-settings-input"
                            value={encryptionPassphraseDraft}
                            onChange={(event) => setEncryptionPassphraseDraft(event.target.value)}
                            placeholder={t("settings.vaultEncryptionPassphrase")}
                            type="password"
                            autoFocus
                          />
                          <input
                            className="sync-settings-input"
                            value={encryptionPassphraseConfirmDraft}
                            onChange={(event) => setEncryptionPassphraseConfirmDraft(event.target.value)}
                            placeholder={t("settings.vaultEncryptionConfirmPassphrase")}
                            type="password"
                          />
                        </>
                      ) : null}

                      {isLocked ? (
                        <input
                          className="sync-settings-input"
                          value={encryptionPassphraseDraft}
                          onChange={(event) => setEncryptionPassphraseDraft(event.target.value)}
                          placeholder={t("settings.vaultEncryptionPassphrase")}
                          type="password"
                          autoFocus
                        />
                      ) : null}

                      {isReady && modalView === "changePassphrase" ? (
                        <>
                          {needsCurrentPassphrase ? (
                            <input
                              className="sync-settings-input"
                              value={encryptionPassphraseDraft}
                              onChange={(event) => setEncryptionPassphraseDraft(event.target.value)}
                              placeholder={t("settings.vaultEncryptionCurrentPassphrase")}
                              type="password"
                              autoFocus
                            />
                          ) : null}
                          <input
                            className="sync-settings-input"
                            value={encryptionNextPassphraseDraft}
                            onChange={(event) => setEncryptionNextPassphraseDraft(event.target.value)}
                            placeholder={t("settings.vaultEncryptionNewPassphrase")}
                            type="password"
                            autoFocus={!needsCurrentPassphrase}
                          />
                          <input
                            className="sync-settings-input"
                            value={encryptionNextPassphraseConfirmDraft}
                            onChange={(event) =>
                              setEncryptionNextPassphraseConfirmDraft(event.target.value)
                            }
                            placeholder={t("settings.vaultEncryptionConfirmNewPassphrase")}
                            type="password"
                          />
                        </>
                      ) : null}

                      {isReady && modalView === "disable" ? (
                        <>
                          {needsCurrentPassphrase ? (
                            <input
                              className="sync-settings-input"
                              value={encryptionPassphraseDraft}
                              onChange={(event) => setEncryptionPassphraseDraft(event.target.value)}
                              placeholder={t("settings.vaultEncryptionCurrentPassphrase")}
                              type="password"
                              autoFocus
                            />
                          ) : null}
                          <div className="sync-settings-confirm-detail">
                            {t("settings.vaultEncryptionDisableConfirm")}
                          </div>
                        </>
                      ) : null}

                      <div className="sync-settings-modal-actions">
                        {isReady && modalView !== "default" ? (
                          <button
                            type="button"
                            className="sync-settings-inline-action"
                            onClick={() =>
                              setPanelModal((current) =>
                                current && current.kind === "vaultEncryption"
                                  ? {
                                      ...current,
                                      view: "default"
                                    }
                                  : current
                              )
                            }
                          >
                            {t("settings.back")}
                          </button>
                        ) : (
                          <button type="button" className="sync-settings-inline-action" onClick={closeModal}>
                            {t("dialog.cancel")}
                          </button>
                        )}
                        {isReady && modalView === "default" ? (
                          <>
                            <button
                              type="button"
                              className="sync-settings-inline-action"
                              onClick={() =>
                                setPanelModal((current) =>
                                  current && current.kind === "vaultEncryption"
                                    ? {
                                        ...current,
                                        view: "changePassphrase"
                                      }
                                    : current
                                )
                              }
                            >
                              {t("settings.vaultEncryptionChangePassphrase")}
                            </button>
                            <button
                              type="button"
                              className="sync-settings-inline-action is-danger"
                              onClick={() =>
                                setPanelModal((current) =>
                                  current && current.kind === "vaultEncryption"
                                    ? {
                                        ...current,
                                        view: "disable"
                                      }
                                    : current
                                )
                              }
                            >
                              {t("settings.vaultEncryptionDisable")}
                            </button>
                            <button
                              type="button"
                              className="sync-settings-primary-action"
                              disabled={busyKey === lockBusyKey}
                              onClick={() => {
                                void handleLockCurrentVaultSession(panelModal.vault);
                              }}
                            >
                              {busyKey === lockBusyKey
                                ? t("sync.syncing")
                                : t("settings.vaultEncryptionLockDevice")}
                            </button>
                          </>
                        ) : isReady && modalView === "changePassphrase" ? (
                          <button
                            type="button"
                            className="sync-settings-primary-action"
                            disabled={busyKey === changeBusyKey}
                            onClick={() => {
                              void handleChangeVaultEncryptionPassphraseSubmit();
                            }}
                          >
                            {busyKey === changeBusyKey
                              ? t("sync.syncing")
                              : t("settings.vaultEncryptionChangePassphrase")}
                          </button>
                        ) : isReady && modalView === "disable" ? (
                          <button
                            type="button"
                            className="sync-settings-primary-action is-danger"
                            disabled={busyKey === disableBusyKey}
                            onClick={() => {
                              void handleDisableVaultEncryptionSubmit();
                            }}
                          >
                            {busyKey === disableBusyKey
                              ? t("sync.syncing")
                              : t("settings.vaultEncryptionDisable")}
                          </button>
                        ) : summary.state === "ready" ? (
                          <button
                            type="button"
                            className="sync-settings-primary-action"
                            disabled={busyKey === lockBusyKey}
                            onClick={() => {
                              void handleLockCurrentVaultSession(panelModal.vault);
                            }}
                          >
                            {busyKey === lockBusyKey
                              ? t("sync.syncing")
                              : t("settings.vaultEncryptionLockDevice")}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="sync-settings-primary-action"
                            disabled={busyKey === submitBusyKey}
                            onClick={() => {
                              void handleVaultEncryptionSubmit();
                            }}
                          >
                            {busyKey === submitBusyKey
                              ? t("sync.syncing")
                              : isEnabling
                                ? t("settings.enableVaultEncryption")
                                : t("settings.unlockVaultEncryption")}
                          </button>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>
            ) : null}

            {panelModal.kind === "addConnection" ? (
              <div className="sync-settings-modal-body">
                <p className="sync-settings-modal-copy">{t("settings.connectionCatalogDescription")}</p>
                <div className="sync-settings-provider-grid">
                  {!hostedConnectionExists ? (
                    <button
                      type="button"
                      className="sync-settings-provider-card"
                      onClick={() => setPanelModal({ kind: "addHosted" })}
                    >
                      <span className="sync-settings-provider-icon" style={{ "--item-color": providerAccent("hosted") } as CSSProperties}>
                        <HostedGlyph />
                      </span>
                      <div className="sync-settings-provider-copy">
                        <strong>{t("sync.hosted")}</strong>
                        <span>{t("settings.hostedConnectionDescription")}</span>
                      </div>
                    </button>
                  ) : null}

                  <button
                    type="button"
                    className="sync-settings-provider-card"
                    onClick={() => setPanelModal({ kind: "addSelfHosted" })}
                  >
                    <span className="sync-settings-provider-icon" style={{ "--item-color": providerAccent("selfHosted") } as CSSProperties}>
                      <SelfHostedGlyph />
                    </span>
                    <div className="sync-settings-provider-copy">
                      <strong>{t("sync.selfHosted")}</strong>
                      <span>{t("settings.selfHostedConnectionDescription")}</span>
                    </div>
                  </button>

                  <button
                    type="button"
                    className={`sync-settings-provider-card ${!googleDriveConfigured ? "is-disabled" : ""}`}
                    onClick={() => {
                      setPanelModal({ kind: "addGoogleDrive" });
                    }}
                  >
                    <span className="sync-settings-provider-icon" style={{ "--item-color": providerAccent("googleDrive") } as CSSProperties}>
                      <GoogleGlyph />
                    </span>
                    <div className="sync-settings-provider-copy">
                      <strong>{t("sync.googleDrive")}</strong>
                      <span>
                        {googleDriveConfigured
                          ? t("settings.googleDriveConnectionDescription")
                          : t("settings.googleDriveClientMissing")}
                      </span>
                    </div>
                    <span className={`sync-settings-chip ${googleDriveConfigured ? "is-ready" : "is-neutral"}`}>
                      {googleDriveConfigured ? t("sync.ready") : t("sync.planned")}
                    </span>
                  </button>
                </div>
              </div>
            ) : null}

            {panelModal.kind === "addSelfHosted" ? (
              <div className="sync-settings-modal-body">
                <p className="sync-settings-modal-copy">{t("settings.selfHostedModalDescription")}</p>
                <input
                  className="sync-settings-input"
                  value={selfHostedUrlDraft}
                  onChange={(event) => setSelfHostedUrlDraft(event.target.value)}
                  placeholder={t("sync.endpointPlaceholder")}
                  autoFocus
                />
                <input
                  className="sync-settings-input"
                  value={selfHostedManagementTokenDraft}
                  onChange={(event) => setSelfHostedManagementTokenDraft(event.target.value)}
                  placeholder={t("sync.managementTokenPlaceholder")}
                />
                <input
                  className="sync-settings-input"
                  value={selfHostedLabelDraft}
                  onChange={(event) => setSelfHostedLabelDraft(event.target.value)}
                  placeholder={t("settings.connectionLabelOptional")}
                />
                <div className="sync-settings-modal-actions">
                  <button type="button" className="sync-settings-inline-action" onClick={closeModal}>
                    {t("dialog.cancel")}
                  </button>
                  <button type="button" className="sync-settings-primary-action" onClick={handleAddSelfHostedConnection}>
                    {t("settings.addConnection")}
                  </button>
                </div>
              </div>
            ) : null}

            {panelModal.kind === "addHosted" ? (
              <div className="sync-settings-modal-body">
                <p className="sync-settings-modal-copy">{t("settings.hostedModalDescription")}</p>
                <div className="sync-settings-mode-switch">
                  <button
                    type="button"
                    className={hostedMode === "login" ? "is-active" : ""}
                    onClick={() => setHostedMode("login")}
                  >
                    {t("sync.hostedLogin")}
                  </button>
                  <button
                    type="button"
                    className={hostedMode === "register" ? "is-active" : ""}
                    onClick={() => setHostedMode("register")}
                  >
                    {t("sync.hostedRegister")}
                  </button>
                </div>
                <input
                  className="sync-settings-input"
                  value={hostedUrlDraft}
                  onChange={(event) => setHostedUrlDraft(event.target.value)}
                  placeholder={t("sync.endpointPlaceholder")}
                  autoFocus
                />
                {hostedMode === "register" ? (
                  <input
                    className="sync-settings-input"
                    value={hostedNameDraft}
                    onChange={(event) => setHostedNameDraft(event.target.value)}
                    placeholder={t("sync.hostedNamePlaceholder")}
                  />
                ) : null}
                <input
                  className="sync-settings-input"
                  value={hostedEmailDraft}
                  onChange={(event) => setHostedEmailDraft(event.target.value)}
                  placeholder={t("sync.hostedEmailPlaceholder")}
                  type="email"
                />
                <input
                  className="sync-settings-input"
                  value={hostedPasswordDraft}
                  onChange={(event) => setHostedPasswordDraft(event.target.value)}
                  placeholder={t("sync.hostedPasswordPlaceholder")}
                  type="password"
                />
                <div className="sync-settings-modal-actions">
                  <button type="button" className="sync-settings-inline-action" onClick={closeModal}>
                    {t("dialog.cancel")}
                  </button>
                  <button
                    type="button"
                    className="sync-settings-primary-action"
                    disabled={busyKey === "add-hosted"}
                    onClick={() => void handleAddHostedConnection()}
                  >
                    {busyKey === "add-hosted"
                      ? t("sync.syncing")
                      : hostedMode === "register"
                        ? t("sync.hostedRegister")
                        : t("sync.hostedLogin")}
                  </button>
                </div>
              </div>
            ) : null}

            {panelModal.kind === "addGoogleDrive" ? (
              <div className="sync-settings-modal-body">
                <p className="sync-settings-modal-copy">
                  {googleDriveConfigured
                    ? t("settings.googleDriveModalDescription")
                    : t("settings.googleDriveClientMissing")}
                </p>
                {!googleDriveConfigured ? (
                  <div className="sync-settings-note-shell">
                    <span className="sync-settings-note-chip">ENV</span>
                    <span className="sync-settings-note-copy">
                      {t("sync.googleDriveClientIdRequired")}
                    </span>
                    <code className="sync-settings-code-pill">VITE_GOOGLE_DRIVE_CLIENT_ID=your-client-id.apps.googleusercontent.com</code>
                  </div>
                ) : null}
                <div className="sync-settings-note-shell">
                  <span className="sync-settings-note-chip">{t("settings.googleDriveAppFolder")}</span>
                  <span className="sync-settings-note-copy">{t("settings.googleDriveAppFolderDescription")}</span>
                </div>
                {googleDriveConfigured ? (
                  <div className="sync-settings-note-shell">
                    <span className="sync-settings-note-chip">SDK</span>
                    <span className="sync-settings-note-copy">
                      {googleDriveOAuthState === "ready"
                        ? t("settings.googleDriveSdkReady")
                        : googleDriveOAuthState === "error"
                          ? googleDriveOAuthError ?? t("sync.googleDriveSdkFailed")
                          : t("settings.googleDriveSdkLoading")}
                    </span>
                  </div>
                ) : null}
                <div className="sync-settings-modal-actions">
                  <button type="button" className="sync-settings-inline-action" onClick={closeModal}>
                    {t("dialog.cancel")}
                  </button>
                  <button
                    type="button"
                    className="sync-settings-primary-action"
                    disabled={
                      busyKey === "add-google-drive" ||
                      !googleDriveConfigured ||
                      googleDriveOAuthState !== "ready"
                    }
                    onClick={() => {
                      void handleAddGoogleDriveConnection();
                    }}
                  >
                    {busyKey === "add-google-drive"
                      ? t("sync.syncing")
                      : googleDriveOAuthState === "loading" || googleDriveOAuthState === "idle"
                        ? t("sync.googleDrivePreparing")
                        : t("settings.googleDriveConnect")}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {confirmState ? (
        <div className="sync-settings-modal-layer" role="dialog" aria-modal="true">
          <button className="sync-settings-modal-dim" aria-label={t("orbit.closeModal")} onClick={closeModal} />
          <div className="sync-settings-modal-card is-compact">
            <div className="sync-settings-modal-head">
              <div className="sync-settings-modal-heading">
                <p className="panel-kicker">{t("dialog.kicker")}</p>
                <h3>{confirmState.title}</h3>
              </div>
              <button type="button" className="sync-settings-icon-button" onClick={closeModal} title={t("orbit.closeModal")}>
                <CloseGlyph />
              </button>
            </div>
            <div className="sync-settings-modal-body">
              <p className="sync-settings-modal-copy">{confirmState.description}</p>
              {confirmState.details && confirmState.details.length > 0 ? (
                <div className="sync-settings-confirm-details">
                  {confirmState.details.map((detail) => (
                    <span key={detail} className="sync-settings-confirm-detail">
                      {detail}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="sync-settings-modal-actions">
                <button type="button" className="sync-settings-inline-action" onClick={closeModal}>
                  {t("dialog.cancel")}
                </button>
                {confirmState.secondaryAction && confirmState.secondaryLabel ? (
                  <button
                    type="button"
                    className={`sync-settings-inline-action ${confirmState.secondaryTone === "danger" ? "is-danger" : ""}`}
                    onClick={() => void confirmState.secondaryAction?.()}
                  >
                    {confirmState.secondaryLabel}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`sync-settings-primary-action ${confirmState.tone === "danger" ? "is-danger" : ""}`}
                  onClick={() => void confirmState.action()}
                >
                  {confirmState.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
