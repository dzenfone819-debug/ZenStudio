import { useState } from "react";

import type { AppSettings, HostedAccountUser, HostedAccountVault } from "../types";
import "./HostedSyncPanel.css";

interface HostedSyncPanelProps {
  settings: AppSettings;
  localVaultName?: string | null;
  accountUser: HostedAccountUser | null;
  accountVaults: HostedAccountVault[];
  accountLoading?: boolean;
  actionBusy?: boolean;
  syncBusy?: boolean;
  labels: {
    caption: string;
    endpoint: string;
    endpointPlaceholder: string;
    never: string;
    account: string;
    accountLoading: string;
    accountSignedOut: string;
    registerTitle: string;
    loginTitle: string;
    name: string;
    namePlaceholder: string;
    email: string;
    emailPlaceholder: string;
    password: string;
    passwordPlaceholder: string;
    register: string;
    login: string;
    logout: string;
    refresh: string;
    createVaultTitle: string;
    createVault: string;
    createVaultNamePlaceholder: string;
    createVaultIdPlaceholder: string;
    vaults: string;
    noVaults: string;
    bind: string;
    bound: string;
    selectedVault: string;
    bindingScope: string;
    accountConnected: string;
    syncNow: string;
    syncing: string;
    syncReady: string;
    syncNeedsBinding: string;
    lastRevision: string;
    lastSync: string;
  };
  onUrlChange: (value: string) => void;
  onRegister: (payload: { name: string; email: string; password: string }) => void;
  onLogin: (payload: { email: string; password: string }) => void;
  onLogout: () => void;
  onRefresh: () => void;
  onCreateVault: (payload: { name: string; id?: string }) => void;
  onBindVault: (vault: HostedAccountVault) => void;
  onRunSync: () => void;
}

function formatDate(timestamp: number | null) {
  if (!timestamp) {
    return null;
  }

  return new Date(timestamp).toLocaleString();
}

export default function HostedSyncPanel({
  settings,
  localVaultName,
  accountUser,
  accountVaults,
  accountLoading = false,
  actionBusy = false,
  syncBusy = false,
  labels,
  onUrlChange,
  onRegister,
  onLogin,
  onLogout,
  onRefresh,
  onCreateVault,
  onBindVault,
  onRunSync
}: HostedSyncPanelProps) {
  const [registerName, setRegisterName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [vaultName, setVaultName] = useState("");
  const [vaultId, setVaultId] = useState("");

  const isBound = settings.hostedVaultId.trim().length > 0 && settings.hostedSyncToken.trim().length > 0;
  const canSync =
    settings.hostedUrl.trim().length > 0 &&
    settings.hostedVaultId.trim().length > 0 &&
    settings.hostedSyncToken.trim().length > 0;

  return (
    <div className="hosted-sync-shell">
      <div className="setting-group">
        <p className="panel-caption">{labels.caption}</p>
      </div>

      <label className="setting-group">
        <span className="setting-label">{labels.endpoint}</span>
        <input
          className="micro-input full"
          value={settings.hostedUrl}
          onChange={(event) => onUrlChange(event.target.value)}
          placeholder={labels.endpointPlaceholder}
        />
      </label>

      <div className="setting-group hosted-sync-section">
        <div className="hosted-sync-head">
          <span className="setting-label">{labels.account}</span>
          {accountUser ? (
            <div className="hosted-sync-actions">
              <button className="micro-action" onClick={onRefresh} disabled={actionBusy || accountLoading}>
                {labels.refresh}
              </button>
              <button className="micro-action" onClick={onLogout} disabled={actionBusy}>
                {labels.logout}
              </button>
            </div>
          ) : null}
        </div>

        {accountLoading ? (
          <div className="sync-fact-card">
            <strong>{labels.accountLoading}</strong>
            <span>{labels.bindingScope}</span>
          </div>
        ) : accountUser ? (
          <div className="hosted-account-card">
            <div className="sync-fact-card">
              <strong>{accountUser.name}</strong>
              <span>{accountUser.email ?? labels.accountConnected}</span>
            </div>
            <div className="sync-fact-card">
              <strong>
                {settings.hostedVaultId
                  ? `${labels.selectedVault}: ${settings.hostedVaultId}`
                  : labels.syncNeedsBinding}
              </strong>
              <span>{labels.bindingScope}</span>
            </div>
          </div>
        ) : (
          <div className="hosted-auth-grid">
            <section className="hosted-auth-card">
              <span className="setting-label">{labels.registerTitle}</span>
              <input
                className="micro-input full"
                value={registerName}
                onChange={(event) => setRegisterName(event.target.value)}
                placeholder={labels.namePlaceholder}
              />
              <input
                className="micro-input full"
                type="email"
                value={registerEmail}
                onChange={(event) => setRegisterEmail(event.target.value)}
                placeholder={labels.emailPlaceholder}
              />
              <input
                className="micro-input full"
                type="password"
                value={registerPassword}
                onChange={(event) => setRegisterPassword(event.target.value)}
                placeholder={labels.passwordPlaceholder}
              />
              <button
                className="toolbar-action"
                onClick={() =>
                  onRegister({
                    name: registerName,
                    email: registerEmail,
                    password: registerPassword
                  })
                }
                disabled={actionBusy || settings.hostedUrl.trim().length === 0}
              >
                {labels.register}
              </button>
            </section>

            <section className="hosted-auth-card">
              <span className="setting-label">{labels.loginTitle}</span>
              <input
                className="micro-input full"
                type="email"
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
                placeholder={labels.emailPlaceholder}
              />
              <input
                className="micro-input full"
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                placeholder={labels.passwordPlaceholder}
              />
              <button
                className="toolbar-action"
                onClick={() =>
                  onLogin({
                    email: loginEmail,
                    password: loginPassword
                  })
                }
                disabled={actionBusy || settings.hostedUrl.trim().length === 0}
              >
                {labels.login}
              </button>
            </section>
          </div>
        )}
      </div>

      {accountUser ? (
        <>
          <div className="setting-group hosted-sync-section">
            <div className="hosted-sync-head">
              <span className="setting-label">{labels.createVaultTitle}</span>
            </div>
            <div className="hosted-create-vault-grid">
              <input
                className="micro-input full"
                value={vaultName}
                onChange={(event) => setVaultName(event.target.value)}
                placeholder={labels.createVaultNamePlaceholder}
              />
              <input
                className="micro-input full"
                value={vaultId}
                onChange={(event) => setVaultId(event.target.value)}
                placeholder={labels.createVaultIdPlaceholder}
              />
              <button
                className="toolbar-action"
                onClick={() =>
                  onCreateVault({
                    name: vaultName,
                    id: vaultId.trim() || undefined
                  })
                }
                disabled={actionBusy || vaultName.trim().length === 0}
              >
                {labels.createVault}
              </button>
            </div>
          </div>

          <div className="setting-group hosted-sync-section">
            <div className="hosted-sync-head">
              <span className="setting-label">{labels.vaults}</span>
            </div>

            {accountVaults.length === 0 ? (
              <div className="sync-fact-card">
                <strong>{labels.noVaults}</strong>
                <span>{labels.syncNeedsBinding}</span>
              </div>
            ) : (
              <div className="hosted-vault-list">
                {accountVaults.map((vault) => {
                  const vaultSelected = settings.hostedVaultId === vault.id;
                  const vaultBound = vaultSelected && isBound;

                  return (
                    <article
                      key={vault.id}
                      className={`hosted-vault-card ${vaultSelected ? "is-selected" : ""}`}
                    >
                      <div className="hosted-vault-card-head">
                        <div className="hosted-vault-copy">
                          <strong>{vault.name}</strong>
                          <span>{vault.id}</span>
                        </div>
                        <button
                          className="micro-action"
                          onClick={() => onBindVault(vault)}
                          disabled={actionBusy || vaultBound}
                        >
                          {vaultBound ? labels.bound : labels.bind}
                        </button>
                      </div>
                      <div className="hosted-vault-meta">
                        <span>
                          {labels.lastRevision}: {vault.lastRevision ?? "-"}
                        </span>
                        <span>
                          {labels.lastSync}: {formatDate(vault.lastSyncAt) ?? labels.never}
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          <div className="setting-group">
            <div className="sync-fact-card">
              <strong>{canSync ? labels.syncReady : labels.syncNeedsBinding}</strong>
              <span>
                {settings.hostedVaultId
                  ? `${labels.selectedVault}: ${settings.hostedVaultId}`
                  : labels.accountSignedOut}
              </span>
            </div>
          </div>

          <div className="setting-group">
            <button
              className="toolbar-action"
              onClick={onRunSync}
              disabled={syncBusy || !canSync}
            >
              {syncBusy ? labels.syncing : labels.syncNow}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
