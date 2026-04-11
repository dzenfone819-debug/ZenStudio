import { Excalidraw } from "@excalidraw/excalidraw";
import type {
  AppState as ExcalidrawAppState,
  BinaryFiles,
  ExcalidrawInitialDataState,
  UIOptions
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import "@excalidraw/excalidraw/index.css";
import "./CanvasPane.css";
import { COLOR_PALETTE, DEFAULT_NOTE_COLOR } from "../lib/palette";
import { flattenFolderOptions, formatTimestamp } from "../lib/notes";
import type {
  AppLanguage,
  CanvasContent,
  Folder,
  Note,
  SaveState,
  Tag
} from "../types";

interface CanvasPaneProps {
  note: Note;
  folders: Folder[];
  tags: Tag[];
  language: AppLanguage;
  saveState: SaveState;
  onTitleChange: (title: string) => void;
  onFolderChange: (folderId: string | null) => void;
  onNoteColorChange: (color: string) => void;
  onToggleTag: (tagId: string) => void;
  onDelete: () => void;
  onRestore: () => void;
  onTogglePin: () => void;
  onToggleFavorite: () => void;
  onToggleArchive: () => void;
  onContentChange: (
    content: CanvasContent,
    files: BinaryFiles,
    fileNames: Record<string, string>,
    state: SaveState
  ) => void;
  onLoadFiles: () => Promise<BinaryFiles>;
  immersive?: boolean;
}

const EXCALIDRAW_UI_OPTIONS: Partial<UIOptions> = {
  canvasActions: {
    export: false,
    loadScene: false,
    saveToActiveFile: false,
    toggleTheme: false
  },
  tools: {
    image: true
  }
};

export default function CanvasPane({
  note,
  folders,
  tags,
  language,
  saveState,
  onTitleChange,
  onFolderChange,
  onNoteColorChange,
  onToggleTag,
  onDelete,
  onRestore,
  onTogglePin,
  onToggleFavorite,
  onToggleArchive,
  onContentChange,
  onLoadFiles,
  immersive = false
}: CanvasPaneProps) {
  const { t } = useTranslation();
  const [titleDraft, setTitleDraft] = useState(note.title);
  const [activeSurface, setActiveSurface] = useState<"canvas" | "info">("canvas");
  const titleTimeoutRef = useRef<number | null>(null);
  const contentTimeoutRef = useRef<number | null>(null);
  const latestSceneRef = useRef<CanvasContent>(note.canvasContent ?? { elements: [], appState: null });
  const latestFilesRef = useRef<BinaryFiles>({});
  const latestFileNamesRef = useRef<Record<string, string>>({});
  const latestTitleDraftRef = useRef(titleDraft);
  const latestStoredTitleRef = useRef(note.title);
  const latestOnContentChangeRef = useRef(onContentChange);
  const latestOnTitleChangeRef = useRef(onTitleChange);
  const generatedFileNamesRef = useRef<Record<string, string>>({});
  const folderOptions = useMemo(
    () => flattenFolderOptions(folders.filter((folder) => folder.projectId === note.projectId)),
    [folders, note.projectId]
  );

  useEffect(() => {
    setTitleDraft(note.title);
  }, [note.id, note.title]);

  useEffect(() => {
    setActiveSurface("canvas");
    latestSceneRef.current = note.canvasContent ?? { elements: [], appState: null };
    latestFilesRef.current = {};
    latestFileNamesRef.current = {};
    generatedFileNamesRef.current = {};
  }, [note.canvasContent, note.id]);

  useEffect(() => {
    latestTitleDraftRef.current = titleDraft;
  }, [titleDraft]);

  useEffect(() => {
    latestStoredTitleRef.current = note.title;
  }, [note.title]);

  useEffect(() => {
    latestOnContentChangeRef.current = onContentChange;
  }, [onContentChange]);

  useEffect(() => {
    latestOnTitleChangeRef.current = onTitleChange;
  }, [onTitleChange]);

  const handleSceneChange = (
    elements: readonly CanvasContent["elements"][number][],
    appState: CanvasContent["appState"],
    files: BinaryFiles
  ) => {
    const nextScene: CanvasContent = {
      elements: elements.map((element) => ({ ...element })),
      appState: appState ? { ...appState } : null
    };

    latestSceneRef.current = nextScene;
    latestFilesRef.current = files;
    latestFileNamesRef.current = {
      ...latestFileNamesRef.current,
      ...generatedFileNamesRef.current
    };

    if (contentTimeoutRef.current) {
      window.clearTimeout(contentTimeoutRef.current);
    }

    onContentChange(nextScene, files, latestFileNamesRef.current, "saving");

    contentTimeoutRef.current = window.setTimeout(() => {
      latestOnContentChangeRef.current(
        latestSceneRef.current,
        latestFilesRef.current,
        latestFileNamesRef.current,
        "saved"
      );
    }, 360);
  };

  const handleTitleChange = (value: string) => {
    setTitleDraft(value);

    if (titleTimeoutRef.current) {
      window.clearTimeout(titleTimeoutRef.current);
    }

    titleTimeoutRef.current = window.setTimeout(() => {
      onTitleChange(value.trim() || t("canvas.untitled"));
    }, 220);
  };

  useEffect(() => {
    return () => {
      if (titleTimeoutRef.current) {
        window.clearTimeout(titleTimeoutRef.current);
      }

      if (contentTimeoutRef.current) {
        window.clearTimeout(contentTimeoutRef.current);
        latestOnContentChangeRef.current(
          latestSceneRef.current,
          latestFilesRef.current,
          latestFileNamesRef.current,
          "saved"
        );
      }

      if (latestTitleDraftRef.current !== latestStoredTitleRef.current) {
        latestOnTitleChangeRef.current(
          latestTitleDraftRef.current.trim() || t("canvas.untitled")
        );
      }
    };
  }, [t]);

  return (
    <section
      className={`canvas-pane ${immersive ? "is-immersive" : ""} ${
        activeSurface === "info" ? "is-details-open" : ""
      }`}
    >
      <div className="canvas-pane-toolbar">
        <div className="canvas-pane-toolbar-main">
          <input
            value={titleDraft}
            onChange={(event) => handleTitleChange(event.target.value)}
            className="note-title-input canvas-title-field"
            placeholder={t("canvas.titlePlaceholder")}
          />

          <div className="canvas-pane-toolbar-meta">
            <span className={`editor-save-pill is-${saveState}`}>{t(`saveState.${saveState}`)}</span>
            <span className="canvas-pane-contextmeta">
              {t("note.updated")}: {formatTimestamp(note.updatedAt, language)}
            </span>
          </div>
        </div>

        <div
          className="canvas-surface-switcher"
          role="tablist"
          aria-label={t("canvas.surfaceLabel")}
        >
          <button
            type="button"
            className={`canvas-surface-tab ${activeSurface === "canvas" ? "is-active" : ""}`}
            onClick={() => setActiveSurface("canvas")}
          >
            {t("canvas.drawTab")}
          </button>
          <button
            type="button"
            className={`canvas-surface-tab ${activeSurface === "info" ? "is-active" : ""}`}
            onClick={() => setActiveSurface("info")}
          >
            {t("canvas.infoTab")}
          </button>
        </div>
      </div>

      <div className="canvas-pane-shell">
        <div className={`canvas-stage-column ${activeSurface === "info" ? "is-hidden-mobile" : ""}`}>
          <div className="canvas-stage-frame">
            <div className="canvas-stage-shell">
              <Excalidraw
                key={note.id}
                name={note.title}
                langCode={language === "ru" ? "ru-RU" : "en"}
                theme="dark"
                UIOptions={EXCALIDRAW_UI_OPTIONS}
                initialData={async (): Promise<ExcalidrawInitialDataState> => ({
                  elements: (note.canvasContent?.elements ?? []) as unknown as readonly ExcalidrawElement[],
                  appState: (note.canvasContent?.appState ?? {}) as unknown as Partial<ExcalidrawAppState>,
                  files: await onLoadFiles()
                })}
                onChange={(elements, appState, files) =>
                  handleSceneChange(
                    elements as unknown as CanvasContent["elements"],
                    appState as unknown as CanvasContent["appState"],
                    files
                  )
                }
                generateIdForFile={(file) => {
                  const id = crypto.randomUUID();
                  generatedFileNamesRef.current[id] = file.name;
                  return id;
                }}
                viewModeEnabled={false}
              />
            </div>
          </div>
        </div>

        <aside className={`canvas-sidepanel ${activeSurface === "canvas" ? "is-hidden-mobile" : ""}`}>
          <section className="canvas-detail-card">
            <label className="canvas-detail-field">
              <span className="canvas-detail-label">{t("note.folder")}</span>
              <select
                value={note.folderId ?? ""}
                onChange={(event) => onFolderChange(event.target.value || null)}
                className="meta-select canvas-detail-select"
              >
                <option value="">{t("orbit.uncategorized")}</option>
                {folderOptions.map((folder) => (
                  <option value={folder.id} key={folder.id}>
                    {"  ".repeat(folder.depth)}
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="canvas-detail-field">
              <span className="canvas-detail-label">{t("note.tags")}</span>
              <div className="canvas-tag-selector">
                {tags.map((tag) => (
                  <button
                    type="button"
                    key={tag.id}
                    className={`tag-chip ${note.tagIds.includes(tag.id) ? "is-active" : ""}`}
                    onClick={() => onToggleTag(tag.id)}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="canvas-detail-field">
              <span className="canvas-detail-label">{t("note.color")}</span>
              <div className="color-swatch-grid compact">
                {COLOR_PALETTE.map((colorOption) => (
                  <button
                    type="button"
                    key={colorOption.id}
                    className={`color-swatch compact ${note.color === colorOption.hex ? "is-active" : ""}`}
                    onClick={() => onNoteColorChange(colorOption.hex)}
                    style={{ "--swatch-color": colorOption.hex } as CSSProperties}
                    aria-label={`${t("note.color")}: ${t(colorOption.labelKey)}`}
                    title={t(colorOption.labelKey)}
                  >
                    <span className="color-swatch-fill" />
                  </button>
                ))}
              </div>
              <label className="orbital-custom-color-picker">
                <span className="orbital-color-label">{t("orbit.customColor")}</span>
                <span className="orbital-custom-color-control">
                  <input
                    type="color"
                    className="orbital-custom-color-input"
                    value={note.color || DEFAULT_NOTE_COLOR}
                    onChange={(event) => onNoteColorChange(event.target.value)}
                    aria-label={t("orbit.customColor")}
                  />
                  <span className="orbital-custom-color-value">
                    {(note.color || DEFAULT_NOTE_COLOR).toUpperCase()}
                  </span>
                </span>
              </label>
            </div>
          </section>

          <section className="canvas-detail-card canvas-detail-card-actions">
            <div className="canvas-action-grid">
              <button
                type="button"
                className={`micro-action ${note.favorite ? "is-active" : ""}`}
                onClick={onToggleFavorite}
              >
                {note.favorite ? t("note.unfavorite") : t("note.favorite")}
              </button>
              <button
                type="button"
                className={`micro-action ${note.pinned ? "is-active" : ""}`}
                onClick={onTogglePin}
              >
                {note.pinned ? t("note.unpin") : t("note.pin")}
              </button>
              <button
                type="button"
                className={`micro-action ${note.archived ? "is-active" : ""}`}
                onClick={onToggleArchive}
              >
                {note.archived ? t("note.unarchive") : t("note.archive")}
              </button>
              {note.trashedAt ? (
                <button type="button" className="micro-action" onClick={onRestore}>
                  {t("note.restore")}
                </button>
              ) : null}
              <button type="button" className="micro-action danger" onClick={onDelete}>
                {note.trashedAt ? t("note.deletePermanently") : t("note.moveToTrash")}
              </button>
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}
