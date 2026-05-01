import "./CanvasStaticPreview.css";

import { getCanvasMetrics } from "../lib/canvas";
import type { Note } from "../types";

interface CanvasStaticPreviewProps {
  note: Note;
  emptyLabel: string;
  labels: {
    canvas: string;
    elements: string;
    images: string;
    emptyCanvas: string;
    previewHint: string;
  };
  compact?: boolean;
  className?: string;
}

export default function CanvasStaticPreview({
  note,
  emptyLabel,
  labels,
  compact = false,
  className
}: CanvasStaticPreviewProps) {
  const metrics = getCanvasMetrics(note.canvasContent);
  const classes = [
    "canvas-static-preview",
    compact ? "is-compact" : "",
    className ?? ""
  ]
    .filter(Boolean)
    .join(" ");

  const summaryText = note.excerpt || metrics.plainText;

  return (
    <div className={classes}>
      <div className="canvas-static-head">
        <span className="canvas-static-kind">{labels.canvas}</span>
        <div className="canvas-static-metrics">
          <span className="canvas-static-chip">
            {metrics.activeElementCount} {labels.elements}
          </span>
          {metrics.imageCount > 0 ? (
            <span className="canvas-static-chip">
              {metrics.imageCount} {labels.images}
            </span>
          ) : null}
        </div>
      </div>

      <div className="canvas-static-notice" role="note" aria-label={labels.previewHint}>
        <span className="canvas-static-notice-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16">
            <path
              d="M8 1.75a6.25 6.25 0 1 0 0 12.5 6.25 6.25 0 0 0 0-12.5Zm0 1.5a4.75 4.75 0 1 1 0 9.5 4.75 4.75 0 0 1 0-9.5Zm0 1.7a.75.75 0 0 1 .75.75v2.86l1.64 1.2a.75.75 0 0 1-.88 1.22L7.55 9.57A.75.75 0 0 1 7.25 9V5.7A.75.75 0 0 1 8 4.95Z"
              fill="currentColor"
            />
          </svg>
        </span>
        <span className="canvas-static-notice-text">{labels.previewHint}</span>
      </div>

      {summaryText ? (
        <p className="canvas-static-text">{summaryText}</p>
      ) : metrics.activeElementCount === 0 ? (
        <p className="canvas-static-empty">{emptyLabel}</p>
      ) : (
        <p className="canvas-static-empty">{labels.emptyCanvas}</p>
      )}
    </div>
  );
}
