import type { AppLanguage, AppSettings, SyncProvider } from "../types";

interface SyncPanelProps {
  settings: AppSettings;
  online: boolean;
  labels: {
    title: string;
    language: string;
    provider: string;
    state: string;
    none: string;
    googleDrive: string;
    selfHosted: string;
    planned: string;
    endpoint: string;
    endpointPlaceholder: string;
    token: string;
    tokenPlaceholder: string;
    deviceId: string;
    conflictStrategy: string;
    duplicateConflict: string;
    encryption: string;
    disabled: string;
    lastSync: string;
  };
  onLanguageChange: (language: AppLanguage) => void;
  onProviderChange: (provider: SyncProvider) => void;
  onUrlChange: (value: string) => void;
  onTokenChange: (value: string) => void;
}

export default function SyncPanel({
  settings,
  online,
  labels,
  onLanguageChange,
  onProviderChange,
  onUrlChange,
  onTokenChange
}: SyncPanelProps) {
  return (
    <section className="panel sidebar-panel sync-panel workspace-panel">
      <div className="panel-head workspace-head">
        <div className="workspace-title">
          <p className="panel-kicker">{labels.title}</p>
          <h2 className="panel-title">{labels.title}</h2>
          <p className="panel-caption">{labels.planned}</p>
        </div>
        <span className={`status-chip ${online ? "online" : "offline"}`}>{online ? "NET" : "OFF"}</span>
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
            <span>{labels.planned}</span>
          </button>
        </div>
      </div>

      {settings.syncProvider === "selfHosted" ? (
        <>
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
            <span className="setting-label">{labels.token}</span>
            <input
              className="micro-input full"
              value={settings.selfHostedToken}
              onChange={(event) => onTokenChange(event.target.value)}
              placeholder={labels.tokenPlaceholder}
            />
          </label>
        </>
      ) : null}

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
        </div>
      </div>
    </section>
  );
}
