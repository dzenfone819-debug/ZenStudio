import { useEffect, useMemo, useRef, useState } from "react";

import "./LocalVaultSwitcher.css";

export interface LocalVaultSwitcherItem {
  id: string;
  name: string;
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
  onSelect
}: LocalVaultSwitcherProps) {
  const [open, setOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const activeItem = useMemo(
    () => items.find((item) => item.id === activeVaultId) ?? items[0] ?? null,
    [activeVaultId, items]
  );

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!shellRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
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

  return (
    <div className={`vault-switcher ${open ? "is-open" : ""}`} ref={shellRef}>
      <button
        type="button"
        className="vault-switcher-trigger"
        onClick={() => setOpen((current) => !current)}
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
                <LockGlyph unlocked={activeItem.encryptionState === "ready"} />
              </span>
            ) : null}
          </span>
        </span>
        <span className={`vault-switcher-chip is-${activeItem.statusTone}`}>{activeItem.statusLabel}</span>
        <span className="vault-switcher-trigger-chevron" aria-hidden="true">
          <ChevronGlyph open={open} />
        </span>
      </button>

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
                          <LockGlyph unlocked={item.encryptionState === "ready"} />
                        </span>
                      ) : null}
                    </span>
                    <span className="vault-switcher-item-detail" title={item.detail}>
                      {item.detail}
                    </span>
                    <span className="vault-switcher-item-chips">
                      {isActive ? <span className="vault-switcher-chip is-active">{activeLabel}</span> : null}
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
    </div>
  );
}
