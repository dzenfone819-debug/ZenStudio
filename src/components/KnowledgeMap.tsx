import type { Folder, Note, Tag } from "../types";

interface KnowledgeMapProps {
  folders: Folder[];
  notes: Note[];
  tags: Tag[];
  assetCount: number;
  onOpen: () => void;
  labels: {
    title: string;
    notes: string;
    folders: string;
    tags: string;
    assets: string;
    pinned: string;
    open: string;
  };
}

export default function KnowledgeMap({
  folders,
  notes,
  tags,
  assetCount,
  onOpen,
  labels
}: KnowledgeMapProps) {
  const topFolders = folders.slice(0, 5);
  const topTags = tags.slice(0, 5);
  const pinnedCount = notes.filter((note) => note.pinned || note.favorite).length;

  return (
    <section className="panel topology-panel orbit-preview-panel">
      <div className="panel-head orbit-preview-head">
        <div className="orbit-preview-title">
          <p className="panel-kicker">{labels.title}</p>
          <h2 className="panel-title">{labels.title}</h2>
        </div>
        <button className="toolbar-action orbit-preview-open" onClick={onOpen}>
          {labels.open}
        </button>
      </div>

      <button className="topology-body topology-activator orbit-preview-trigger" onClick={onOpen}>
        <svg viewBox="0 0 360 260" className="topology-map" role="img" aria-label={labels.title}>
          <defs>
            <linearGradient id="topologyLine" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffe08a" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#73f7ff" stopOpacity="0.4" />
            </linearGradient>
          </defs>

          <circle cx="180" cy="130" r="84" className="topology-ring topology-ring-outer" />
          <circle cx="180" cy="130" r="56" className="topology-ring topology-ring-inner" />
          <circle cx="180" cy="130" r="25" className="topology-core" />

          {topFolders.map((folder, index) => {
            const angle = ((Math.PI * 2) / Math.max(topFolders.length, 1)) * index - Math.PI / 2;
            const x = 180 + Math.cos(angle) * 84;
            const y = 130 + Math.sin(angle) * 84;

            return (
              <g key={folder.id}>
                <line x1="180" y1="130" x2={x} y2={y} className="topology-link" />
                <circle cx={x} cy={y} r="10" fill={folder.color} className="topology-node" />
                <text x={x} y={y + 22} textAnchor="middle" className="topology-label">
                  {folder.name}
                </text>
              </g>
            );
          })}

          {topTags.map((tag, index) => {
            const angle = ((Math.PI * 2) / Math.max(topTags.length, 1)) * index - Math.PI / 3;
            const x = 180 + Math.cos(angle) * 56;
            const y = 130 + Math.sin(angle) * 56;

            return (
              <g key={tag.id}>
                <line x1="180" y1="130" x2={x} y2={y} className="topology-link topology-link-soft" />
                <circle cx={x} cy={y} r="7" className="topology-node topology-node-small topology-node-neutral" />
              </g>
            );
          })}
        </svg>

        <div className="topology-stats">
          <div className="stat-cell">
            <span className="stat-label">{labels.notes}</span>
            <strong>{notes.length}</strong>
          </div>
          <div className="stat-cell">
            <span className="stat-label">{labels.folders}</span>
            <strong>{folders.length}</strong>
          </div>
          <div className="stat-cell">
            <span className="stat-label">{labels.tags}</span>
            <strong>{tags.length}</strong>
          </div>
          <div className="stat-cell">
            <span className="stat-label">{labels.assets}</span>
            <strong>{assetCount}</strong>
          </div>
          <div className="stat-cell stat-cell-wide">
            <span className="stat-label">{labels.pinned}</span>
            <strong>{pinnedCount}</strong>
          </div>
        </div>
      </button>
    </section>
  );
}
