import type {
  AppLanguage,
  AppSettings,
  HostedAccountUser,
  HostedAccountVault,
  SyncProvider
} from "../types";
import LocalVaultPanel from "./LocalVaultPanel";
import HostedSyncPanel from "./HostedSyncPanel";
import type { LocalVaultProfile } from "../lib/localVaults";

interface SyncPanelProps {
  settings: AppSettings;
  online: boolean;
  localVaults: LocalVaultProfile[];
  activeLocalVaultId: string;
  localVaultName?: string | null;
  syncFeedback?: {
    tone: "success" | "error";
    text: string;
  } | null;
  syncBusy?: boolean;
  hostedAccountUser: HostedAccountUser | null;
  hostedAccountVaults: HostedAccountVault[];
  hostedAccountLoading?: boolean;
  hostedActionBusy?: boolean;
  labels: {
    title: string;
    panelCaption: string;
    language: string;
    localVaults: string;
    localVaultsCaption: string;
    localVaultActive: string;
    localVaultOpen: string;
    localVaultCreate: string;
    localVaultCreatePlaceholder: string;
    localVaultRename: string;
    localVaultDelete: string;
    localVaultSave: string;
    localVaultCancel: string;
    localVaultEmpty: string;
    localVaultCannotDeleteLast: string;
    provider: string;
    state: string;
    none: string;
    googleDrive: string;
    selfHosted: string;
    hosted: string;
    ready: string;
    planned: string;
    endpoint: string;
    endpointPlaceholder: string;
    vault: string;
    vaultPlaceholder: string;
    token: string;
    tokenPlaceholder: string;
    bindingScope: string;
    deviceId: string;
    conflictStrategy: string;
    duplicateConflict: string;
    encryption: string;
    disabled: string;
    lastSync: string;
    syncNow: string;
    syncing: string;
    selfHostedOnly: string;
    lastRevision: string;
    never: string;
    hostedCaption: string;
    hostedAccount: string;
    hostedAccountLoading: string;
    hostedAccountSignedOut: string;
    hostedRegisterTitle: string;
    hostedLoginTitle: string;
    hostedName: string;
    hostedNamePlaceholder: string;
    hostedEmail: string;
    hostedEmailPlaceholder: string;
    hostedPassword: string;
    hostedPasswordPlaceholder: string;
    hostedRegister: string;
    hostedLogin: string;
    hostedLogout: string;
    hostedRefresh: string;
    hostedCreateVaultTitle: string;
    hostedCreateVault: string;
    hostedCreateVaultNamePlaceholder: string;
    hostedCreateVaultIdPlaceholder: string;
    hostedVaults: string;
    hostedNoVaults: string;
    hostedBind: string;
    hostedBound: string;
    hostedSelectedVault: string;
    hostedAccountConnected: string;
    hostedSyncReady: string;
    hostedSyncNeedsBinding: string;
  };
  onLanguageChange: (language: AppLanguage) => void;
  onSelectLocalVault: (localVaultId: string) => void;
  onCreateLocalVault: (name: string) => void;
  onRenameLocalVault: (localVaultId: string, name: string) => void;
  onDeleteLocalVault: (localVaultId: string) => void;
  onProviderChange: (provider: SyncProvider) => void;
  onUrlChange: (value: string) => void;
  onVaultChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onHostedUrlChange: (value: string) => void;
  onHostedRegister: (payload: { name: string; email: string; password: string }) => void;
  onHostedLogin: (payload: { email: string; password: string }) => void;
  onHostedLogout: () => void;
  onHostedRefresh: () => void;
  onHostedCreateVault: (payload: { name: string; id?: string }) => void;
  onHostedBindVault: (vault: HostedAccountVault) => void;
  onRunHostedSync: () => void;
  onRunSync: () => void;
}

export default function SyncPanel({
  settings,
  online,
  localVaults,
  activeLocalVaultId,
  localVaultName,
  syncFeedback,
  syncBusy = false,
  hostedAccountUser,
  hostedAccountVaults,
  hostedAccountLoading = false,
  hostedActionBusy = false,
  labels,
  onLanguageChange,
  onSelectLocalVault,
  onCreateLocalVault,
  onRenameLocalVault,
  onDeleteLocalVault,
  onProviderChange,
  onUrlChange,
  onVaultChange,
  onTokenChange,
  onHostedUrlChange,
  onHostedRegister,
  onHostedLogin,
  onHostedLogout,
  onHostedRefresh,
  onHostedCreateVault,
  onHostedBindVault,
  onRunHostedSync,
  onRunSync
}: SyncPanelProps) {
  return (
    <section className="panel sidebar-panel sync-panel workspace-panel">
      <div className="panel-head workspace-head">
        <div className="workspace-title">
          <p className="panel-kicker">{labels.title}</p>
          <h2 className="panel-title">{labels.title}</h2>
          <p className="panel-caption">{labels.panelCaption}</p>
        </div>
        <span className={`status-chip ${online ? "online" : "offline"}`}>{online ? "NET" : "OFF"}</span>
      </div>

      <div className="setting-group">
        <LocalVaultPanel
          localVaults={localVaults}
          activeLocalVaultId={activeLocalVaultId}
          labels={{
            title: labels.localVaults,
            caption: labels.localVaultsCaption,
            active: labels.localVaultActive,
            open: labels.localVaultOpen,
            create: labels.localVaultCreate,
            createPlaceholder: labels.localVaultCreatePlaceholder,
            rename: labels.localVaultRename,
            delete: labels.localVaultDelete,
            save: labels.localVaultSave,
            cancel: labels.localVaultCancel,
            empty: labels.localVaultEmpty,
            cannotDeleteLast: labels.localVaultCannotDeleteLast
          }}
          onSelect={onSelectLocalVault}
          onCreate={onCreateLocalVault}
          onRename={onRenameLocalVault}
          onDelete={onDeleteLocalVault}
        />
      </div>

      <div className="setting-group">
        <span className="setting-label">{labels.language}</span>
        <div className="segmented-control">
          <button
            className={settings.language === "en" ? "is-active" : ""}
            onClick={() => onLanguageChange("en")}
          >
            EN
          </button>
          <button
            className={settings.language === "ru" ? "is-active" : ""}
            onClick={() => onLanguageChange("ru")}
          >
            RU
          </button>
        </div>
      </div>

      <div className="setting-group">
        <span className="setting-label">{labels.state}</span>
        <div className="sync-architecture-grid">
          <div className="sync-fact-card">
            <strong>{settings.syncStatus}</strong>
            <span>{labels.planned}</span>
          </div>
          <div className="sync-fact-card">
            <strong>{settings.localDeviceId}</strong>
            <span>{labels.deviceId}</span>
          </div>
        </div>
      </div>

      <div className="setting-group">
        <span className="setting-label">{labels.provider}</span>
        <div className="provider-grid">
          <button
            className={`provider-card ${settings.syncProvider === "none" ? "is-active" : ""}`}
            onClick={() => onProviderChange("none")}
          >
            <strong>{labels.none}</strong>
          </button>
          <button
            className={`provider-card ${settings.syncProvider === "googleDrive" ? "is-active" : ""}`}
            onClick={() => onProviderChange("googleDrive")}
          >
            <strong>{labels.googleDrive}</strong>
            <span>{labels.planned}</span>
          </button>
          <button
            className={`provider-card ${settings.syncProvider === "selfHosted" ? "is-active" : ""}`}
            onClick={() => onProviderChange("selfHosted")}
          >
            <strong>{labels.selfHosted}</strong>
            <span>{labels.ready}</span>
          </button>
          <button
            className={`provider-card ${settings.syncProvider === "hosted" ? "is-active" : ""}`}
            onClick={() => onProviderChange("hosted")}
          >
            <strong>{labels.hosted}</strong>
            <span>{labels.ready}</span>
          </button>
        </div>
      </div>

      {settings.syncProvider === "hosted" ? (
        <HostedSyncPanel
          settings={settings}
          localVaultName={localVaultName}
          accountUser={hostedAccountUser}
          accountVaults={hostedAccountVaults}
          accountLoading={hostedAccountLoading}
          actionBusy={hostedActionBusy}
          syncBusy={syncBusy}
          labels={{
            caption: labels.hostedCaption,
            endpoint: labels.endpoint,
            endpointPlaceholder: labels.endpointPlaceholder,
            never: labels.never,
            account: labels.hostedAccount,
            accountLoading: labels.hostedAccountLoading,
            accountSignedOut: labels.hostedAccountSignedOut,
            registerTitle: labels.hostedRegisterTitle,
            loginTitle: labels.hostedLoginTitle,
            name: labels.hostedName,
            namePlaceholder: labels.hostedNamePlaceholder,
            email: labels.hostedEmail,
            emailPlaceholder: labels.hostedEmailPlaceholder,
            password: labels.hostedPassword,
            passwordPlaceholder: labels.hostedPasswordPlaceholder,
            register: labels.hostedRegister,
            login: labels.hostedLogin,
            logout: labels.hostedLogout,
            refresh: labels.hostedRefresh,
            createVaultTitle: labels.hostedCreateVaultTitle,
            createVault: labels.hostedCreateVault,
            createVaultNamePlaceholder: labels.hostedCreateVaultNamePlaceholder,
            createVaultIdPlaceholder: labels.hostedCreateVaultIdPlaceholder,
            vaults: labels.hostedVaults,
            noVaults: labels.hostedNoVaults,
            bind: labels.hostedBind,
            bound: labels.hostedBound,
            selectedVault: labels.hostedSelectedVault,
            bindingScope: labels.bindingScope,
            accountConnected: labels.hostedAccountConnected,
            syncNow: labels.syncNow,
            syncing: labels.syncing,
            syncReady: labels.hostedSyncReady,
            syncNeedsBinding: labels.hostedSyncNeedsBinding,
            lastRevision: labels.lastRevision,
            lastSync: labels.lastSync
          }}
          onUrlChange={onHostedUrlChange}
          onRegister={onHostedRegister}
          onLogin={onHostedLogin}
          onLogout={onHostedLogout}
          onRefresh={onHostedRefresh}
          onCreateVault={onHostedCreateVault}
          onBindVault={onHostedBindVault}
          onRunSync={onRunHostedSync}
        />
      ) : settings.syncProvider === "selfHosted" ? (
        <>
          <div className="setting-group">
            <p className="panel-caption">{labels.bindingScope}</p>
          </div>
          <label className="setting-group">
            <span className="setting-label">{labels.endpoint}</span>
            <input
              className="micro-input full"
              value={settings.selfHostedUrl}
              onChange={(event) => onUrlChange(event.target.value)}
              placeholder={labels.endpointPlaceholder}
            />
          </label>
          <label className="setting-group">
            <span className="setting-label">{labels.vault}</span>
            <input
              className="micro-input full"
              value={settings.selfHostedVaultId}
              onChange={(event) => onVaultChange(event.target.value)}
              placeholder={labels.vaultPlaceholder}
            />
          </label>
          <label className="setting-group">
            <span className="setting-label">{labels.token}</span>
            <input
              className="micro-input full"
              value={settings.selfHostedToken}
              onChange={(event) => onTokenChange(event.target.value)}
              placeholder={labels.tokenPlaceholder}
            />
          </label>
          <div className="setting-group">
            <button
              className="toolbar-action"
              onClick={onRunSync}
              disabled={
                syncBusy ||
                settings.selfHostedUrl.trim().length === 0 ||
                settings.selfHostedVaultId.trim().length === 0 ||
                settings.selfHostedToken.trim().length === 0
              }
            >
              {syncBusy ? labels.syncing : labels.syncNow}
            </button>
          </div>
        </>
      ) : (
        <div className="setting-group">
          <div className="sync-fact-card">
            <strong>{labels.disabled}</strong>
            <span>{labels.selfHostedOnly}</span>
          </div>
        </div>
      )}

      <div className="setting-group">
        <div className="sync-architecture-grid">
          <div className="sync-fact-card">
            <strong>{labels.duplicateConflict}</strong>
            <span>{labels.conflictStrategy}</span>
          </div>
          <div className="sync-fact-card">
            <strong>{settings.encryptionEnabled ? "ON" : labels.disabled}</strong>
            <span>{labels.encryption}</span>
          </div>
          <div className="sync-fact-card">
            <strong>{settings.lastSyncAt ? new Date(settings.lastSyncAt).toLocaleString() : labels.planned}</strong>
            <span>{labels.lastSync}</span>
          </div>
          <div className="sync-fact-card">
            <strong>{settings.syncCursor ? settings.syncCursor.slice(0, 18) : labels.planned}</strong>
            <span>{labels.lastRevision}</span>
          </div>
        </div>
      </div>

      {syncFeedback ? (
        <div className="setting-group">
          <div className="sync-fact-card">
            <strong>{syncFeedback.text}</strong>
            <span>{syncFeedback.tone === "error" ? labels.state : labels.lastSync}</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
