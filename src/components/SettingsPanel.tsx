import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { LocalVaultKind, LocalVaultProfile } from "../lib/localVaults";
import type {
  AppLanguage,
  AppSettings,
  RemoteVaultImportResult,
  SyncConnection,
  SyncVaultBinding,
  VaultEncryptionSummary
} from "../types";
import SyncSettingsPanel from "./SyncSettingsPanel";
import "./SettingsPanel.css";

type SyncFeedbackState = {
  tone: "success" | "error";
  text: string;
} | null;

interface SettingsPanelProps {
  settings: AppSettings;
  online: boolean;
  localVaults: LocalVaultProfile[];
  activeLocalVaultId: string;
  selectedLocalVaultId: string;
  syncConnections: SyncConnection[];
  syncBindings: SyncVaultBinding[];
  vaultEncryptionById: Record<string, VaultEncryptionSummary>;
  syncFeedback?: SyncFeedbackState;
  onLanguageChange: (language: AppLanguage) => void;
  onSelectLocalVault: (localVaultId: string) => void;
  onCreateLocalVault: (input: {
    name: string;
    vaultKind: LocalVaultKind;
    passphrase?: string;
  }) => string | Promise<string>;
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
    remoteVaultKind?: LocalVaultKind;
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

function SettingsGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M8.2 2.5h3.6l.4 1.8a5.8 5.8 0 0 1 1.3.6l1.7-.8 2.6 2.6-.8 1.7c.24.42.45.86.6 1.33l1.8.4v3.6l-1.8.4a5.9 5.9 0 0 1-.6 1.3l.8 1.7-2.6 2.6-1.7-.8a5.8 5.8 0 0 1-1.33.6l-.4 1.8H8.2l-.4-1.8a5.8 5.8 0 0 1-1.3-.6l-1.7.8-2.6-2.6.8-1.7a5.8 5.8 0 0 1-.6-1.3l-1.8-.4v-3.6l1.8-.4a6.2 6.2 0 0 1 .6-1.33l-.8-1.7 2.6-2.6 1.7.8c.42-.24.86-.45 1.3-.6l.4-1.8Z" />
      <circle cx="10" cy="10" r="2.6" className="settings-row-icon-core" />
    </svg>
  );
}

function LanguageGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M3.2 4.5h6.2M6.3 4.5c0 5-1.9 8.4-3.6 10.6M6.3 4.5c1.2 2.4 2.8 4.8 4.9 6.8M11.8 6.8h5M14.3 6.8v8.4M11.6 12.4h5.4" />
    </svg>
  );
}

function SyncGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M4.2 6.2h4.7" />
      <path d="m7.1 3.6 2.6 2.6-2.6 2.6" className="settings-row-icon-accent" />
      <path d="M15.8 13.8h-4.7" />
      <path d="m12.9 11.2-2.6 2.6 2.6 2.6" className="settings-row-icon-accent" />
      <path d="M6.4 13.8a4.2 4.2 0 0 0 3.6 2" />
      <path d="M13.6 6.2A4.2 4.2 0 0 0 10 4.3" />
    </svg>
  );
}

function ChevronGlyph({ expanded = false }: { expanded?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path
        d={expanded ? "M5.5 7.4 10 11.9l4.5-4.5" : "M7.4 5.5 11.9 10l-4.5 4.5"}
        className="settings-row-icon-accent"
      />
    </svg>
  );
}

type SettingsView = "root" | "sync";

export default function SettingsPanel({
  settings,
  online,
  localVaults,
  activeLocalVaultId,
  selectedLocalVaultId,
  syncConnections,
  syncBindings,
  vaultEncryptionById,
  syncFeedback = null,
  onLanguageChange,
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
}: SettingsPanelProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<SettingsView>("root");
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const languageMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!languageMenuRef.current?.contains(event.target as Node)) {
        setLanguageMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  if (view === "sync") {
    return (
      <SyncSettingsPanel
        settings={settings}
        online={online}
        localVaults={localVaults}
        activeLocalVaultId={activeLocalVaultId}
        selectedLocalVaultId={selectedLocalVaultId}
        syncConnections={syncConnections}
        syncBindings={syncBindings}
        vaultEncryptionById={vaultEncryptionById}
        syncFeedback={syncFeedback}
        onBack={() => setView("root")}
        onSelectLocalVault={onSelectLocalVault}
        onCreateLocalVault={onCreateLocalVault}
        onRenameLocalVault={onRenameLocalVault}
        onDeleteLocalVault={onDeleteLocalVault}
        onCreateConnection={onCreateConnection}
        onDeleteConnection={onDeleteConnection}
        onUpdateConnection={onUpdateConnection}
        onBindVault={onBindVault}
        onImportRemoteVault={onImportRemoteVault}
        onDeleteRemoteVault={onDeleteRemoteVault}
        onClearBinding={onClearBinding}
        onRunVaultSync={onRunVaultSync}
        onEnableVaultEncryption={onEnableVaultEncryption}
        onUnlockVaultEncryption={onUnlockVaultEncryption}
        onChangeVaultEncryptionPassphrase={onChangeVaultEncryptionPassphrase}
        onDisableVaultEncryption={onDisableVaultEncryption}
        onLockVaultEncryption={onLockVaultEncryption}
      />
    );
  }

  const currentLanguageLabel =
    settings.language === "ru" ? t("settings.languageRussian") : t("settings.languageEnglish");

  return (
    <section className="settings-panel-shell">
      <header className="settings-panel-header">
        <div className="settings-panel-heading">
          <p className="panel-kicker settings-panel-kicker">{t("settings.kicker")}</p>
          <h2 className="panel-title settings-panel-title">{t("settings.title")}</h2>
          <p className="settings-panel-caption">{t("settings.caption")}</p>
        </div>
        <span className={`status-chip ${online ? "online" : "offline"}`}>
          {online ? t("settings.networkOnline") : t("settings.networkOffline")}
        </span>
      </header>

      <div className="settings-panel-block">
        <div className="settings-panel-block-head">
          <p className="panel-kicker settings-panel-block-kicker">{t("settings.general")}</p>
        </div>

        <div className="settings-row-stack">
          <div className="settings-row settings-row-static">
            <span className="settings-row-icon" aria-hidden="true">
              <LanguageGlyph />
            </span>
            <div className="settings-row-copy">
              <strong>{t("settings.language")}</strong>
              <span>{t("settings.languageDescription")}</span>
            </div>
            <div className="settings-language-picker" ref={languageMenuRef}>
              <button
                type="button"
                className="settings-row-action"
                onClick={() => setLanguageMenuOpen((current) => !current)}
                aria-expanded={languageMenuOpen}
              >
                <span>{currentLanguageLabel}</span>
                <span className="settings-row-action-icon" aria-hidden="true">
                  <ChevronGlyph expanded={languageMenuOpen} />
                </span>
              </button>

              {languageMenuOpen ? (
                <div className="settings-language-menu" role="menu">
                  <button
                    type="button"
                    className={`settings-language-option ${settings.language === "en" ? "is-active" : ""}`}
                    onClick={() => {
                      onLanguageChange("en");
                      setLanguageMenuOpen(false);
                    }}
                    role="menuitemradio"
                    aria-checked={settings.language === "en"}
                  >
                    <strong>{t("settings.languageEnglish")}</strong>
                    <span>English</span>
                  </button>
                  <button
                    type="button"
                    className={`settings-language-option ${settings.language === "ru" ? "is-active" : ""}`}
                    onClick={() => {
                      onLanguageChange("ru");
                      setLanguageMenuOpen(false);
                    }}
                    role="menuitemradio"
                    aria-checked={settings.language === "ru"}
                  >
                    <strong>{t("settings.languageRussian")}</strong>
                    <span>Русский</span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <button type="button" className="settings-row" onClick={() => setView("sync")}>
            <span className="settings-row-icon" aria-hidden="true">
              <SyncGlyph />
            </span>
            <div className="settings-row-copy">
              <strong>{t("settings.syncTitle")}</strong>
              <span>{t("settings.syncDescription", { vaultCount: localVaults.length, connectionCount: syncConnections.length })}</span>
            </div>
            <span className="settings-row-side">
              <span className="settings-row-count">{syncBindings.length}</span>
              <span className="settings-row-action-icon" aria-hidden="true">
                <ChevronGlyph />
              </span>
            </span>
          </button>
        </div>
      </div>

      <div className="settings-panel-footnote">
        <span className="settings-panel-footnote-icon" aria-hidden="true">
          <SettingsGlyph />
        </span>
        <p>{t("settings.footnote")}</p>
      </div>
    </section>
  );
}
