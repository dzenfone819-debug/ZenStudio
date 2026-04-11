import type { AppLanguage, Note } from "../types";
import { formatTimestamp } from "../lib/notes";

interface TrashPanelProps {
  notes: Note[];
  folderPathMap: Map<string, string>;
  language: AppLanguage;
  labels: {
    title: string;
    deletedAt: string;
    folder: string;
    restore: string;
    deletePermanently: string;
    emptyTitle: string;
    emptyDescription: string;
    noteCount: string;
    allNotes: string;
  };
  onRestore: (noteId: string) => void;
  onDelete: (noteId: string) => void;
}

export default function TrashPanel({
  notes,
  folderPathMap,
  language,
  labels,
  onRestore,
  onDelete
}: TrashPanelProps) {
  return (
    <section className="panel trash-panel">
      <div className="panel-head trash-panel-head">
        <div>
          <p className="panel-kicker">{labels.title}</p>
          <h2 className="panel-title">{labels.title}</h2>
          <p className="panel-caption">
            {notes.length} {labels.noteCount}
          </p>
        </div>
      </div>

      {notes.length === 0 ? (
        <div className="empty-card trash-empty-card">
          <strong>{labels.emptyTitle}</strong>
          <p>{labels.emptyDescription}</p>
        </div>
      ) : (
        <div className="trash-list">
          {notes.map((note) => (
            <article className="trash-card" key={note.id}>
              <div className="trash-card-head">
                <div className="trash-card-copy">
                  <h3>{note.title}</h3>
                  <p>{note.excerpt || note.plainText || "..."}</p>
                </div>
                <span className="status-chip">{formatTimestamp(note.trashedAt ?? note.updatedAt, language)}</span>
              </div>

              <div className="trash-card-meta">
                <span>
                  {labels.folder}: {note.folderId ? folderPathMap.get(note.folderId) ?? labels.allNotes : labels.allNotes}
                </span>
                <span>
                  {labels.deletedAt}: {formatTimestamp(note.trashedAt ?? note.updatedAt, language)}
                </span>
              </div>

              <div className="trash-card-actions">
                <button className="primary-action" onClick={() => onRestore(note.id)}>
                  {labels.restore}
                </button>
                <button className="toolbar-action danger" onClick={() => onDelete(note.id)}>
                  {labels.deletePermanently}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
