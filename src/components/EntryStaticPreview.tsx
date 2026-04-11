import CanvasStaticPreview from "./CanvasStaticPreview";
import NoteStaticPreview from "./NoteStaticPreview";
import type { Note } from "../types";

interface EntryStaticPreviewProps {
  note: Note;
  emptyLabel: string;
  resolveFileUrl?: (url: string) => Promise<string>;
  compact?: boolean;
  interactive?: boolean;
  className?: string;
  labels: {
    canvas: string;
    elements: string;
    images: string;
    emptyCanvas: string;
  };
}

export default function EntryStaticPreview({
  note,
  emptyLabel,
  resolveFileUrl,
  compact,
  interactive,
  className,
  labels
}: EntryStaticPreviewProps) {
  if (note.contentType === "canvas") {
    return (
      <CanvasStaticPreview
        note={note}
        emptyLabel={emptyLabel}
        labels={labels}
        compact={compact}
        className={className}
      />
    );
  }

  return (
    <NoteStaticPreview
      content={note.content}
      emptyLabel={emptyLabel}
      resolveFileUrl={resolveFileUrl}
      compact={compact}
      interactive={interactive}
      className={className}
    />
  );
}
