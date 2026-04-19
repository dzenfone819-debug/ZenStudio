import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent
} from "react";
import { useTranslation } from "react-i18next";

import type { LocalVaultProfile } from "../lib/localVaults";
import {
  createHostedVault,
  createPersonalServerVault,
  issueHostedVaultToken,
  issuePersonalServerVaultToken,
  loadHostedAccountOverview,
  loadPersonalServerVaults,
  loginHostedAccount,
  probeSyncConnectionAvailability,
  registerHostedAccount
} from "../lib/sync";
import type { AppSettings, SyncConnection, SyncVaultBinding } from "../types";
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
  syncFeedback?: SyncFeedbackState;
  syncBusy?: boolean;
  onBack: () => void;
  onSelectLocalVault: (localVaultId: string) => void;
  onOpenLocalVault: (localVaultId: string) => void;
  onCreateLocalVault: (name: string) => void;
  onRenameLocalVault: (localVaultId: string, name: string) => void;
  onDeleteLocalVault: (localVaultId: string) => void;
  onCreateConnection: (input: {
    provider: "selfHosted" | "hosted";
    serverUrl: string;
    label?: string;
    managementToken?: string;
    sessionToken?: string;
    userId?: string | null;
    userName?: string;
    userEmail?: string;
  }) => void;
  onDeleteConnection: (connectionId: string) => void;
  onBindVault: (input: {
    localVaultId: string;
    connectionId: string;
    remoteVaultId: string;
    remoteVaultName?: string;
    syncToken: string;
  }) => void | Promise<void>;
  onClearBinding: (localVaultId: string) => void | Promise<void>;
  onRunActiveSync: () => void;
}

type PanelModal =
  | { kind: "createVault" }
  | { kind: "renameVault"; vault: LocalVaultProfile }
  | { kind: "addConnection" }
  | { kind: "addSelfHosted" }
  | { kind: "addHosted" }
  | null;

type ConfirmState = {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "default" | "danger";
  action: () => Promise<void> | void;
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

function OpenGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M7 6.2h6.8v6.8" />
      <path d="M6.2 13.8 13.8 6.2" className="sync-settings-icon-accent" />
      <path d="M14.1 10.5v4.1H5.9V5.4H10" />
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

function providerAccent(provider: SyncConnection["provider"]) {
  if (provider === "hosted") {
    return "#73f7ff";
  }

  if (provider === "googleDrive") {
    return "#9cf98d";
  }

  return "#ffd27d";
}

function deriveRemoteVaultId(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
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
  syncFeedback = null,
  syncBusy = false,
  onBack,
  onSelectLocalVault,
  onOpenLocalVault,
  onCreateLocalVault,
  onRenameLocalVault,
  onDeleteLocalVault,
  onCreateConnection,
  onDeleteConnection,
  onBindVault,
  onClearBinding,
  onRunActiveSync
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
  const activeVault = sortedVaults.find((vault) => vault.id === activeLocalVaultId) ?? null;
  const selectedVault =
    sortedVaults.find((vault) => vault.id === selectedLocalVaultId) ??
    sortedVaults.find((vault) => vault.id === activeLocalVaultId) ??
    null;
  const activeVaultBinding = activeVault ? bindingsByVaultId.get(activeVault.id) ?? null : null;
  const activeVaultConnection = activeVaultBinding
    ? connectionsById.get(activeVaultBinding.connectionId) ?? null
    : null;
  const hostedConnectionExists = syncConnections.some((connection) => connection.provider === "hosted");
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
  const [pendingBindVaultId, setPendingBindVaultId] = useState<string | null>(null);
  const [draftLink, setDraftLink] = useState<DraftLink>(null);
  const [hoverConnectionId, setHoverConnectionId] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [linkMetrics, setLinkMetrics] = useState<LinkMetric[]>([]);
  const [connectionAvailability, setConnectionAvailability] = useState<Record<string, ConnectionAvailabilityState>>({});
  const stageRef = useRef<HTMLDivElement | null>(null);
  const vaultListRef = useRef<HTMLDivElement | null>(null);
  const connectionListRef = useRef<HTMLDivElement | null>(null);
  const vaultRefs = useRef(new Map<string, HTMLElement>());
  const connectionRefs = useRef(new Map<string, HTMLElement>());

  const feedback = internalFeedback ?? syncFeedback;
  const availabilitySignature = useMemo(
    () =>
      syncConnections
        .map((connection) => `${connection.id}:${connection.updatedAt}:${connection.serverUrl}`)
        .join("|"),
    [syncConnections]
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
  };

  const handleCreateVault = () => {
    const normalizedName = vaultNameDraft.trim();

    if (!normalizedName) {
      return;
    }

    onCreateLocalVault(normalizedName);
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

  const performVaultBinding = async (vault: LocalVaultProfile, connection: SyncConnection) => {
    if (connection.provider === "selfHosted") {
      const payload = await loadPersonalServerVaults(connection.serverUrl, connection.managementToken);
      const derivedVaultId = deriveRemoteVaultId(vault.name);

      let remoteVault =
        payload.vaults.find((entry) => entry.name === vault.name) ??
        payload.vaults.find((entry) => entry.id === derivedVaultId) ??
        null;

      if (!remoteVault) {
        remoteVault = (
          await createPersonalServerVault(connection.serverUrl, connection.managementToken, {
            name: vault.name,
            id: derivedVaultId || undefined
          })
        ).vault;
      }

      const token = await issuePersonalServerVaultToken(
        connection.serverUrl,
        connection.managementToken,
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
      return;
    }

    const overview = await loadHostedAccountOverview(connection.serverUrl, connection.sessionToken);
    const derivedVaultId = deriveRemoteVaultId(vault.name);

    let remoteVault =
      overview.vaults.find((entry) => entry.name === vault.name) ??
      overview.vaults.find((entry) => entry.id === derivedVaultId) ??
      null;

    if (!remoteVault) {
      remoteVault = (
        await createHostedVault(connection.serverUrl, connection.sessionToken, {
          name: vault.name,
          id: derivedVaultId || undefined
        })
      ).vault;
    }

    const token = await issueHostedVaultToken(
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
        await performVaultBinding(vault, connection);
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
            message === "UNAUTHORIZED" || message === "INVALID_CREDENTIALS"
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
          await performVaultBinding(vault, connection);
        }

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
            message === "UNAUTHORIZED" || message === "INVALID_CREDENTIALS"
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
                const statusLabel = !binding
                  ? t("settings.statusUnbound")
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
                          <span
                            className={`sync-settings-chip ${
                              !bindingConnection
                                ? "is-unbound"
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
                      {!isActive ? (
                        <button
                          type="button"
                          className="sync-settings-icon-button"
                          title={t("sync.localVaultOpen")}
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpenLocalVault(vault.id);
                          }}
                        >
                          <OpenGlyph />
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
                          onDeleteLocalVault(vault.id);
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
                            <span className={`sync-settings-chip ${connection.provider === "hosted" ? "is-hosted" : "is-self-hosted"}`}>
                              {connection.provider === "hosted" ? t("sync.hosted") : t("sync.selfHosted")}
                            </span>
                            <span className="sync-settings-chip is-count">
                              {t("settings.boundVaultCount", { count: boundCount })}
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
                              : connection.serverUrl}
                          </span>
                          <span className="sync-settings-card-submeta">
                            {connection.provider === "hosted"
                              ? connection.userName || t("sync.hostedAccountSignedOut")
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
          <strong>{activeVault?.name ?? t("sync.localVault")}</strong>
          <span>
            {activeVaultConnection && activeVaultBinding
              ? `${activeVaultConnection.label} · ${formatTime(activeVaultBinding.lastSyncAt, i18n.language)}`
              : t("sync.bindingMissing")}
          </span>
        </div>
        <div className="sync-settings-footer-actions">
          {selectedVault && selectedVault.id !== activeLocalVaultId ? (
            <button type="button" className="sync-settings-inline-action" onClick={() => onOpenLocalVault(selectedVault.id)}>
              {t("settings.openSelectedVault")}
            </button>
          ) : null}
          <button
            type="button"
            className="sync-settings-primary-action"
            onClick={onRunActiveSync}
            disabled={syncBusy || !activeVaultBinding}
          >
            {syncBusy ? t("sync.syncing") : t("sync.syncNow")}
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
                      : panelModal.kind === "addConnection"
                        ? t("settings.addConnection")
                        : panelModal.kind === "addHosted"
                          ? t("sync.hosted")
                          : t("sync.selfHosted")}
                </p>
                <h3>
                  {panelModal.kind === "createVault"
                    ? t("settings.createVaultTitle")
                    : panelModal.kind === "renameVault"
                      ? t("settings.renameVaultTitle")
                      : panelModal.kind === "addConnection"
                        ? t("settings.connectionCatalogTitle")
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

                  <div className="sync-settings-provider-card is-disabled">
                    <span className="sync-settings-provider-icon" style={{ "--item-color": providerAccent("googleDrive") } as CSSProperties}>
                      <GoogleGlyph />
                    </span>
                    <div className="sync-settings-provider-copy">
                      <strong>{t("sync.googleDrive")}</strong>
                      <span>{t("settings.googleDriveComingSoon")}</span>
                    </div>
                    <span className="sync-settings-chip is-neutral">{t("sync.planned")}</span>
                  </div>
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
              <div className="sync-settings-modal-actions">
                <button type="button" className="sync-settings-inline-action" onClick={closeModal}>
                  {t("dialog.cancel")}
                </button>
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
