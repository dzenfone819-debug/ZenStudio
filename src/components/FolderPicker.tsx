import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import "./FolderPicker.css";
import type { Folder } from "../types";

type FolderPickerOption = Folder & { depth: number };

interface FolderPickerProps {
  options: FolderPickerOption[];
  value: string | null;
  emptyLabel: string;
  ariaLabel: string;
  onChange: (folderId: string | null) => void;
}

function FolderIcon({ color, isEmpty = false }: { color: string; isEmpty?: boolean }) {
  return (
    <span
      className={`folder-picker-icon ${isEmpty ? "is-empty" : "is-folder"}`}
      style={{ "--folder-picker-color": color } as CSSProperties}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" focusable="false">
        {isEmpty ? (
          <>
            <circle cx="12" cy="12" r="7.1" />
            <path d="M8.4 12h7.2" className="folder-picker-icon-accent" />
          </>
        ) : (
          <>
            <path d="M3.7 8.3c0-1.5 1.2-2.7 2.7-2.7h3.3l1.6 1.7h6.4c1.5 0 2.7 1.2 2.7 2.7v5.7c0 1.5-1.2 2.7-2.7 2.7H6.4c-1.5 0-2.7-1.2-2.7-2.7V8.3Z" />
            <path d="M4.1 10.1h15.8" className="folder-picker-icon-accent" />
          </>
        )}
      </svg>
    </span>
  );
}

export default function FolderPicker({
  options,
  value,
  emptyLabel,
  ariaLabel,
  onChange
}: FolderPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedFolder = useMemo(
    () => options.find((folder) => folder.id === value) ?? null,
    [options, value]
  );
  const selectedColor = selectedFolder?.color ?? "#73f7ff";

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleSelect = (folderId: string | null) => {
    onChange(folderId);
    setIsOpen(false);
  };

  return (
    <div className="folder-picker" ref={rootRef}>
      <button
        type="button"
        className="folder-picker-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <FolderIcon color={selectedColor} isEmpty={!selectedFolder} />
        <span className="folder-picker-trigger-copy">
          <span className="folder-picker-title">
            {selectedFolder?.name ?? emptyLabel}
          </span>
          <span className="folder-picker-meta">
            {selectedFolder ? ariaLabel : emptyLabel}
          </span>
        </span>
        <span className={`folder-picker-chevron ${isOpen ? "is-open" : ""}`} aria-hidden="true">
          ›
        </span>
      </button>

      {isOpen ? (
        <div className="folder-picker-menu" role="listbox" aria-label={ariaLabel}>
          <button
            type="button"
            className={`folder-picker-option ${!selectedFolder ? "is-active" : ""}`}
            role="option"
            aria-selected={!selectedFolder}
            style={{ "--folder-depth": 0 } as CSSProperties}
            onClick={() => handleSelect(null)}
          >
            <FolderIcon color="#73f7ff" isEmpty />
            <span className="folder-picker-option-title">{emptyLabel}</span>
          </button>

          {options.map((folder) => (
            <button
              type="button"
              className={`folder-picker-option ${folder.id === value ? "is-active" : ""}`}
              role="option"
              aria-selected={folder.id === value}
              key={folder.id}
              style={{ "--folder-depth": folder.depth } as CSSProperties}
              onClick={() => handleSelect(folder.id)}
            >
              <FolderIcon color={folder.color} />
              <span className="folder-picker-option-title">{folder.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
