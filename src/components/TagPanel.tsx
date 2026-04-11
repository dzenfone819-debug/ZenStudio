import { useState } from "react";

import { buildTagCounts } from "../lib/notes";
import type { Note, Tag } from "../types";

interface TagPanelProps {
  tags: Tag[];
  notes: Note[];
  selectedTagId: string | null;
  labels: {
    title: string;
    add: string;
    rename: string;
    delete: string;
    save: string;
    cancel: string;
    createPlaceholder: string;
  };
  onSelect: (tagId: string | null) => void;
  onCreate: (name: string) => Promise<unknown>;
  onRename: (tagId: string, name: string) => Promise<void>;
  onDelete: (tagId: string) => Promise<void>;
}

export default function TagPanel({
  tags,
  notes,
  selectedTagId,
  labels,
  onSelect,
  onCreate,
  onRename,
  onDelete
}: TagPanelProps) {
  const counts = buildTagCounts(notes, tags);
  const [draftName, setDraftName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const submitDraft = async () => {
    const normalized = draftName.trim();

    if (!normalized) {
      return;
    }

    await onCreate(normalized);
    setDraftName("");
  };

  const submitRename = async () => {
    if (!editingId || !editingName.trim()) {
      return;
    }

    await onRename(editingId, editingName.trim());
    setEditingId(null);
    setEditingName("");
  };

  return (
    <section className="panel sidebar-panel tags-panel">
      <div className="panel-head tags-head">
        <div className="tags-title">
          <p className="panel-kicker">{labels.title}</p>
          <h2 className="panel-title">{labels.title}</h2>
          <p className="panel-caption">
            {tags.length} · {notes.length}
          </p>
        </div>
        <button className="toolbar-action tags-add" onClick={() => setEditingId(null)}>
          {labels.add}
        </button>
      </div>

      <div className="tag-create-row tags-composer">
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

      <div className="tag-list">
        {tags.map((tag) => (
          <div className="tag-manage-row" key={tag.id}>
            {editingId === tag.id ? (
              <>
                <input
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                  className="micro-input"
                  placeholder={labels.createPlaceholder}
                />
                <button className="micro-action primary" onClick={() => void submitRename()}>
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
              </>
            ) : (
              <>
                <button
                  className={`tag-chip ${selectedTagId === tag.id ? "is-active" : ""}`}
                  onClick={() => onSelect(selectedTagId === tag.id ? null : tag.id)}
                >
                  <span>{tag.name}</span>
                  <span>{counts.get(tag.id) ?? 0}</span>
                </button>
                <div className="tag-actions">
                  <button
                    className="micro-action"
                    onClick={() => {
                      setEditingId(tag.id);
                      setEditingName(tag.name);
                    }}
                  >
                    {labels.rename}
                  </button>
                  <button className="micro-action danger" onClick={() => void onDelete(tag.id)}>
                    {labels.delete}
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
