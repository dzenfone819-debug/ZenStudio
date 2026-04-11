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
