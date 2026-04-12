import { useMemo, useState } from "react";

import type { LocalVaultProfile } from "../lib/localVaults";
import "./LocalVaultPanel.css";

interface LocalVaultPanelProps {
  localVaults: LocalVaultProfile[];
  activeLocalVaultId: string;
  labels: {
    title: string;
    caption: string;
    active: string;
    open: string;
    create: string;
    createPlaceholder: string;
    rename: string;
    delete: string;
    save: string;
    cancel: string;
    empty: string;
    cannotDeleteLast: string;
  };
  onSelect: (localVaultId: string) => void;
  onCreate: (name: string) => void;
  onRename: (localVaultId: string, name: string) => void;
  onDelete: (localVaultId: string) => void;
}

export default function LocalVaultPanel({
  localVaults,
  activeLocalVaultId,
  labels,
  onSelect,
  onCreate,
  onRename,
  onDelete
}: LocalVaultPanelProps) {
  const [draftName, setDraftName] = useState("");
  const [editingVaultId, setEditingVaultId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const canDelete = localVaults.length > 1;
  const orderedVaults = useMemo(
    () => [...localVaults].sort((left, right) => left.createdAt - right.createdAt),
    [localVaults]
  );

  const handleSubmitCreate = () => {
    const normalized = draftName.trim();

    if (!normalized) {
      return;
    }

    onCreate(normalized);
    setDraftName("");
  };

  const startEditing = (vault: LocalVaultProfile) => {
    setEditingVaultId(vault.id);
    setEditingName(vault.name);
  };

  const handleSaveRename = () => {
    if (!editingVaultId) {
      return;
    }

    const normalized = editingName.trim();

    if (!normalized) {
      return;
    }

    onRename(editingVaultId, normalized);
    setEditingVaultId(null);
    setEditingName("");
  };

  return (
    <section className="local-vault-panel">
      <div className="local-vault-panel-copy">
        <span className="setting-label">{labels.title}</span>
        <p className="local-vault-panel-caption">{labels.caption}</p>
      </div>

      <div className="local-vault-list">
        {orderedVaults.length === 0 ? (
          <div className="local-vault-empty">{labels.empty}</div>
        ) : (
          orderedVaults.map((vault) => {
            const isActive = vault.id === activeLocalVaultId;
            const isEditing = vault.id === editingVaultId;

            return (
              <article
                key={vault.id}
                className={`local-vault-card ${isActive ? "is-active" : ""}`}
              >
                <div className="local-vault-card-main">
                  {isEditing ? (
                    <input
                      className="micro-input full"
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      placeholder={labels.createPlaceholder}
                    />
                  ) : (
                    <>
                      <strong className="local-vault-name">{vault.name}</strong>
                      <span className="local-vault-meta">{vault.id}</span>
                    </>
                  )}
                </div>

                <div className="local-vault-actions">
                  {isActive ? <span className="status-chip accent">{labels.active}</span> : null}
                  {!isActive ? (
                    <button className="micro-action" onClick={() => onSelect(vault.id)}>
                      {labels.open}
                    </button>
                  ) : null}
                  {isEditing ? (
                    <>
                      <button className="micro-action" onClick={handleSaveRename}>
                        {labels.save}
                      </button>
                      <button
                        className="micro-action"
                        onClick={() => {
                          setEditingVaultId(null);
                          setEditingName("");
                        }}
                      >
                        {labels.cancel}
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="micro-action" onClick={() => startEditing(vault)}>
                        {labels.rename}
                      </button>
                      <button
                        className="micro-action danger"
                        disabled={!canDelete}
                        title={!canDelete ? labels.cannotDeleteLast : undefined}
                        onClick={() => onDelete(vault.id)}
                      >
                        {labels.delete}
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>

      <div className="local-vault-create">
        <input
          className="micro-input full"
          value={draftName}
          onChange={(event) => setDraftName(event.target.value)}
          placeholder={labels.createPlaceholder}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleSubmitCreate();
            }
          }}
        />
        <button className="toolbar-action" onClick={handleSubmitCreate}>
          {labels.create}
        </button>
      </div>
    </section>
  );
}
