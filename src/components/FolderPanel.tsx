import { useMemo, useState, type CSSProperties } from "react";

import { buildFolderCounts } from "../lib/notes";
import type { Folder, Note } from "../types";

interface FolderPanelProps {
  folders: Folder[];
  notes: Note[];
  selectedFolderId: string | null;
  labels: {
    title: string;
    all: string;
    addRoot: string;
    addChild: string;
    rename: string;
    delete: string;
    save: string;
    cancel: string;
    createPlaceholder: string;
  };
  onSelect: (folderId: string | null) => void;
  onCreate: (name: string, parentId: string | null) => Promise<void>;
  onRename: (folderId: string, name: string) => Promise<void>;
  onDelete: (folderId: string) => Promise<void>;
}

interface FolderNode extends Folder {
  children: FolderNode[];
}

export default function FolderPanel({
  folders,
  notes,
  selectedFolderId,
  labels,
  onSelect,
  onCreate,
  onRename,
  onDelete
}: FolderPanelProps) {
  const [draftParentId, setDraftParentId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const counts = buildFolderCounts(notes, folders);

  const tree = useMemo(() => {
    const byParent = new Map<string | null, Folder[]>();

    folders.forEach((folder) => {
      const bucket = byParent.get(folder.parentId) ?? [];
      bucket.push(folder);
      byParent.set(folder.parentId, bucket);
    });

    byParent.forEach((bucket) => {
      bucket.sort((left, right) => left.name.localeCompare(right.name));
    });

    const build = (parentId: string | null): FolderNode[] =>
      (byParent.get(parentId) ?? []).map((folder) => ({
        ...folder,
        children: build(folder.id)
      }));

    return build(null);
  }, [folders]);

  const submitDraft = async () => {
    const normalized = draftName.trim();

    if (!normalized) {
      return;
    }

    await onCreate(normalized, draftParentId);
    setDraftName("");
    setDraftParentId(null);
  };

  const submitRename = async () => {
    if (!editingId || !editingName.trim()) {
      return;
    }

    await onRename(editingId, editingName.trim());
    setEditingId(null);
    setEditingName("");
  };

  const renderNode = (node: FolderNode, depth = 0) => {
    const count = counts.get(node.id) ?? 0;

    return (
      <div className="tree-node" key={node.id}>
        {editingId === node.id ? (
          <div className="tree-edit-row" style={{ "--depth": depth } as CSSProperties}>
            <input
              value={editingName}
              onChange={(event) => setEditingName(event.target.value)}
              className="micro-input"
              placeholder={labels.createPlaceholder}
            />
            <button className="micro-action primary" onClick={submitRename}>
              {labels.save}
            </button>
            <button
              className="micro-action"
              onClick={() => {
                setEditingId(null);
                setEditingName("");
              }}
            >
              {labels.cancel}
            </button>
          </div>
        ) : (
          <div className={`tree-row ${selectedFolderId === node.id ? "is-active" : ""}`} style={{ "--depth": depth } as CSSProperties}>
            <button className="tree-select" onClick={() => onSelect(node.id)}>
              <span className="tree-dot" style={{ backgroundColor: node.color }} />
              <span className="tree-name">{node.name}</span>
              <span className="tree-count">{count}</span>
            </button>

            <div className="tree-actions">
              <button className="micro-action" onClick={() => setDraftParentId(node.id)}>
                {labels.addChild}
              </button>
              <button
                className="micro-action"
                onClick={() => {
                  setEditingId(node.id);
                  setEditingName(node.name);
                }}
              >
                {labels.rename}
              </button>
              <button className="micro-action danger" onClick={() => void onDelete(node.id)}>
                {labels.delete}
              </button>
            </div>
          </div>
        )}

        {draftParentId === node.id ? (
          <div className="tree-edit-row" style={{ "--depth": depth + 1 } as CSSProperties}>
            <input
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              className="micro-input"
              placeholder={labels.createPlaceholder}
            />
            <button className="micro-action primary" onClick={() => void submitDraft()}>
              {labels.save}
            </button>
            <button
              className="micro-action"
              onClick={() => {
                setDraftName("");
                setDraftParentId(null);
              }}
            >
              {labels.cancel}
            </button>
          </div>
        ) : null}

        {node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <section className="panel sidebar-panel explorer-panel">
      <div className="panel-head explorer-head">
        <div className="explorer-title">
          <p className="panel-kicker">{labels.title}</p>
          <h2 className="panel-title">{labels.title}</h2>
          <p className="panel-caption">
            {folders.length} · {notes.length}
          </p>
        </div>
        <button className="toolbar-action explorer-add" onClick={() => setDraftParentId(null)}>
          {labels.addRoot}
        </button>
      </div>

      <button
        className={`tree-row tree-root explorer-root ${selectedFolderId === null ? "is-active" : ""}`}
        onClick={() => onSelect(null)}
      >
        <span className="tree-dot tree-dot-all" />
        <span className="tree-name">{labels.all}</span>
        <span className="tree-count">{notes.length}</span>
      </button>

      {draftParentId === null ? (
        <div className="tree-edit-row explorer-composer">
          <input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            className="micro-input"
            placeholder={labels.createPlaceholder}
          />
          <button className="micro-action primary" onClick={() => void submitDraft()}>
            {labels.save}
          </button>
        </div>
      ) : null}

      <div className="tree-list">{tree.map((node) => renderNode(node))}</div>
    </section>
  );
}
