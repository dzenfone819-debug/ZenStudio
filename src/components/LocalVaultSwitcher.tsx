import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { LocalVaultKind } from "../lib/localVaults";
import "./LocalVaultSwitcher.css";

export interface LocalVaultSwitcherItem {
  id: string;
  name: string;
  vaultKind: LocalVaultKind;
  statusLabel: string;
  statusTone: "default" | "success" | "warning" | "error";
  providerLabel: string | null;
  providerTone: "local" | "selfHosted" | "hosted" | "googleDrive";
  detail: string;
  encryptionState: "disabled" | "ready" | "locked";
}

interface LocalVaultSwitcherProps {
  label: string;
  activeLabel: string;
  items: LocalVaultSwitcherItem[];
  activeVaultId: string;
  onSelect: (vaultId: string) => void;
  onCreate?: (input: {
    name: string;
    vaultKind: LocalVaultKind;
    passphrase?: string;
  }) => string | void | Promise<string | void>;
}

function VaultGlyph() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M3.7 6.2h12.6v8.7H3.7z" />
      <path d="M3.7 6.2 6.1 4.5h7.8l2.4 1.7" className="vault-switcher-icon-accent" />
      <path d="M7 9.1h6" className="vault-switcher-icon-accent" />
    </svg>
  );
}

function ChevronGlyph({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d={open ? "M5.5 7.4 10 11.9l4.5-4.5" : "M7.4 5.5 11.9 10l-4.5 4.5"} />
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
      <path d="M10 10.3v2.5" className="vault-switcher-icon-accent" />
    </svg>
  );
}

export default function LocalVaultSwitcher({
  label,
  activeLabel,
  items,
  activeVaultId,
  onSelect,
  onCreate
}: LocalVaultSwitcherProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createVaultKind, setCreateVaultKind] = useState<LocalVaultKind>("regular");
  const [createName, setCreateName] = useState("");
  const [createPassphrase, setCreatePassphrase] = useState("");
  const [createPassphraseConfirm, setCreatePassphraseConfirm] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const activeItem = useMemo(
    () => items.find((item) => item.id === activeVaultId) ?? items[0] ?? null,
    [activeVaultId, items]
  );

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!shellRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setCreateOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setCreateOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  if (!activeItem) {
    return null;
  }

  const resetCreateDraft = () => {
    setCreateVaultKind("regular");
    setCreateName("");
    setCreatePassphrase("");
    setCreatePassphraseConfirm("");
    setCreateError(null);
    setCreateBusy(false);
  };

  const handleCreateSubmit = async () => {
    const normalizedName = createName.trim();

    if (!normalizedName) {
      setCreateError(t("settings.createVaultNameRequired"));
      return;
    }

    if (createVaultKind === "private") {
      if (!createPassphrase.trim()) {
        setCreateError(t("sync.vaultEncryptionPassphraseRequired"));
        return;
      }

      if (createPassphrase.trim().length < 8) {
        setCreateError(t("sync.vaultEncryptionPassphraseTooShort"));
        return;
      }

      if (createPassphrase.trim() !== createPassphraseConfirm.trim()) {
        setCreateError(t("sync.vaultEncryptionPassphraseMismatch"));
        return;
      }
    }

    if (!onCreate) {
      return;
    }

    setCreateBusy(true);
    setCreateError(null);

    try {
      await Promise.resolve(
        onCreate({
          name: normalizedName,
          vaultKind: createVaultKind,
          passphrase: createVaultKind === "private" ? createPassphrase.trim() : undefined
        })
      );
      resetCreateDraft();
      setCreateOpen(false);
      setOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "SYNC_FAILED";
      setCreateError(
        message === "VAULT_ENCRYPTION_PASSPHRASE_REQUIRED"
          ? t("sync.vaultEncryptionPassphraseRequired")
          : message === "VAULT_ENCRYPTION_PASSPHRASE_TOO_SHORT"
            ? t("sync.vaultEncryptionPassphraseTooShort")
            : message === "LOCAL_VAULT_NAME_REQUIRED"
              ? t("settings.createVaultNameRequired")
              : message === "SYNC_FAILED"
                ? t("sync.failedGeneric")
                : message
      );
      setCreateBusy(false);
    }
  };

  return (
    <div className={`vault-switcher ${open ? "is-open" : ""}`} ref={shellRef}>
      <div className="vault-switcher-head">
        <button
          type="button"
          className="vault-switcher-trigger"
          onClick={() => {
            setOpen((current) => !current);
            setCreateOpen(false);
          }}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className="vault-switcher-trigger-icon" aria-hidden="true">
            <VaultGlyph />
          </span>
          <span className="vault-switcher-trigger-copy">
            <span className="vault-switcher-trigger-label">{label}</span>
            <span className="vault-switcher-trigger-titleline">
              <strong title={activeItem.name}>{activeItem.name}</strong>
              {activeItem.encryptionState !== "disabled" ? (
                <span
                  className={`vault-switcher-lock-badge is-${activeItem.encryptionState}`}
                  aria-hidden="true"
                >
                  <LockGlyph />
                </span>
              ) : null}
            </span>
          </span>
          <span className={`vault-switcher-chip is-${activeItem.statusTone}`}>{activeItem.statusLabel}</span>
          <span className="vault-switcher-trigger-chevron" aria-hidden="true">
            <ChevronGlyph open={open} />
          </span>
        </button>
        {onCreate ? (
          <button
            type="button"
            className="vault-switcher-create-trigger"
            onClick={() => {
              setCreateOpen((current) => {
                const next = !current;

                if (next) {
                  setOpen(false);
                  resetCreateDraft();
                }

                return next;
              });
            }}
            title={t("sync.localVaultCreate")}
          >
            <PlusGlyph />
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="vault-switcher-menu" role="listbox" aria-label={label}>
          <div className="vault-switcher-menu-head">
            <span className="vault-switcher-menu-title">{label}</span>
            <span className="vault-switcher-menu-count">{items.length}</span>
          </div>

          <div className="vault-switcher-menu-list">
            {items.map((item) => {
              const isActive = item.id === activeVaultId;

              return (
                <button
                  key={item.id}
                  type="button"
                  className={`vault-switcher-item ${isActive ? "is-active" : ""}`}
                  onClick={() => {
                    onSelect(item.id);
                    setOpen(false);
                  }}
                  role="option"
                  aria-selected={isActive}
                >
                  <span className="vault-switcher-item-icon" aria-hidden="true">
                    <VaultGlyph />
                  </span>
                  <span className="vault-switcher-item-copy">
                    <span className="vault-switcher-item-titleline">
                      <strong title={item.name}>{item.name}</strong>
                      {item.encryptionState !== "disabled" ? (
                        <span
                          className={`vault-switcher-lock-badge is-${item.encryptionState}`}
                          aria-hidden="true"
                        >
                          <LockGlyph />
                        </span>
                      ) : null}
                    </span>
                    <span className="vault-switcher-item-detail" title={item.detail}>
                      {item.detail}
                    </span>
                    <span className="vault-switcher-item-chips">
                      {isActive ? <span className="vault-switcher-chip is-active">{activeLabel}</span> : null}
                      <span className={`vault-switcher-chip is-${item.vaultKind === "private" ? "warning" : "default"}`}>
                        {item.vaultKind === "private"
                          ? t("settings.vaultKindPrivate")
                          : t("settings.vaultKindRegular")}
                      </span>
                      {item.providerLabel ? (
                        <span className={`vault-switcher-chip is-provider-${item.providerTone}`}>
                          {item.providerLabel}
                        </span>
                      ) : null}
                      <span className={`vault-switcher-chip is-${item.statusTone}`}>{item.statusLabel}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {createOpen ? (
        <div className="vault-switcher-create-panel" role="dialog" aria-modal="false">
          <div className="vault-switcher-menu-head">
            <span className="vault-switcher-menu-title">{t("settings.createVaultTitle")}</span>
            <button
              type="button"
              className="vault-switcher-inline-action"
              onClick={() => {
                resetCreateDraft();
                setCreateOpen(false);
              }}
            >
              {t("dialog.cancel")}
            </button>
          </div>
          <div className="vault-switcher-kind-grid">
            <button
              type="button"
              className={`vault-switcher-kind-card ${createVaultKind === "regular" ? "is-selected" : ""}`}
              onClick={() => setCreateVaultKind("regular")}
            >
              <strong>{t("settings.vaultKindRegular")}</strong>
              <span>{t("settings.createVaultRegularDescription")}</span>
            </button>
            <button
              type="button"
              className={`vault-switcher-kind-card ${createVaultKind === "private" ? "is-selected" : ""}`}
              onClick={() => setCreateVaultKind("private")}
            >
              <strong>{t("settings.vaultKindPrivate")}</strong>
              <span>{t("settings.createVaultPrivateDescription")}</span>
            </button>
          </div>
          <input
            className="vault-switcher-input"
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
            placeholder={t("sync.localVaultCreatePlaceholder")}
            autoFocus
          />
          {createVaultKind === "private" ? (
            <>
              <input
                className="vault-switcher-input"
                type="password"
                value={createPassphrase}
                onChange={(event) => setCreatePassphrase(event.target.value)}
                placeholder={t("settings.vaultEncryptionPassphrase")}
              />
              <input
                className="vault-switcher-input"
                type="password"
                value={createPassphraseConfirm}
                onChange={(event) => setCreatePassphraseConfirm(event.target.value)}
                placeholder={t("settings.vaultEncryptionConfirmPassphrase")}
              />
              <span className="vault-switcher-create-note">{t("settings.createVaultPrivateHint")}</span>
            </>
          ) : null}
          {createError ? <span className="vault-switcher-create-error">{createError}</span> : null}
          <div className="vault-switcher-create-actions">
            <button
              type="button"
              className="vault-switcher-inline-action"
              onClick={() => {
                resetCreateDraft();
                setCreateOpen(false);
              }}
            >
              {t("dialog.cancel")}
            </button>
            <button
              type="button"
              className="vault-switcher-create-submit"
              disabled={createBusy}
              onClick={() => {
                void handleCreateSubmit();
              }}
            >
              {createBusy ? t("sync.syncing") : t("orbit.create")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
