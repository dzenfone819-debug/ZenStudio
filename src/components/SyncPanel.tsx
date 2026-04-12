import type { AppLanguage, AppSettings, SyncProvider } from "../types";
import LocalVaultPanel from "./LocalVaultPanel";
import type { LocalVaultProfile } from "../lib/localVaults";

interface SyncPanelProps {
  settings: AppSettings;
  online: boolean;
  localVaults: LocalVaultProfile[];
  activeLocalVaultId: string;
  syncFeedback?: {
    tone: "success" | "error";
    text: string;
  } | null;
  syncBusy?: boolean;
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
  onRunSync: () => void;
}

export default function SyncPanel({
  settings,
  online,
  localVaults,
  activeLocalVaultId,
  syncFeedback,
  syncBusy = false,
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
        </div>
      </div>

      {settings.syncProvider === "selfHosted" ? (
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
