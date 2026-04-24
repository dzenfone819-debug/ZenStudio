import {
  CaptureUpdateAction,
  Excalidraw,
  exportToBlob,
  exportToSvg,
  getNonDeletedElements,
  serializeAsJSON
} from "@excalidraw/excalidraw";
import type {
  AppState as ExcalidrawAppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  UIOptions
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import "@excalidraw/excalidraw/index.css";
import "./CanvasPane.css";
import "./CanvasPane.excalidraw.css";
import FolderPicker from "./FolderPicker";
import TagInputField from "./TagInputField";
import { DEFAULT_CANVAS_BACKGROUND } from "../lib/canvas";
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
  onTagIdsChange: (tagIds: string[]) => Promise<void> | void;
  onCreateTag: (name: string) => Promise<Tag>;
  onDelete: () => void;
  onRestore: () => void;
  onTogglePin: () => void;
  onContentChange: (
    content: CanvasContent,
    files: BinaryFiles,
    fileNames: Record<string, string>,
    state: SaveState
  ) => void;
  onLoadFiles: () => Promise<BinaryFiles>;
  immersive?: boolean;
}

type CanvasExportStatus = "png" | "svg" | "json" | "error" | null;

type CanvasBackgroundQuickPickMarker = "void" | "slate" | "blue" | "amber" | "bronze";

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

const CANVAS_BACKGROUND_QUICK_PICKS: ReadonlyArray<{
  source: string;
  target: string;
  marker: CanvasBackgroundQuickPickMarker;
}> = [
  { source: "#ffffff", target: "#000000", marker: "void" },
  { source: "#f8f9fa", target: "#111827", marker: "slate" },
  { source: "#f5faff", target: "#081423", marker: "blue" },
  { source: "#fffce8", target: "#1b1605", marker: "amber" },
  { source: "#fdf8f6", target: "#1c1311", marker: "bronze" }
];

const DEFAULT_CANVAS_BACKGROUND_ALIASES = new Set([
  "black",
  "#000",
  "#000000",
  "rgb(0,0,0)",
  "rgb(0, 0, 0)"
]);

function isBlankCanvasContent(content: CanvasContent | null | undefined) {
  return !(content?.elements ?? []).some((element) => !element.isDeleted);
}

function normalizeCanvasColorKey(color: unknown) {
  return typeof color === "string" ? color.trim().toLowerCase() : "";
}

function isMissingOrDefaultCanvasBackground(background: unknown) {
  const normalized = normalizeCanvasColorKey(background);

  if (normalized.length === 0) {
    return true;
  }

  return DEFAULT_CANVAS_BACKGROUND_ALIASES.has(normalized);
}

function getCanvasBackgroundQuickPickFromSource(color: unknown) {
  const normalized = normalizeCanvasColorKey(color);

  return CANVAS_BACKGROUND_QUICK_PICKS.find((entry) => entry.source === normalized) ?? null;
}

function getCanvasBackgroundQuickPickFromTarget(color: unknown) {
  const normalized = normalizeCanvasColorKey(color);

  return CANVAS_BACKGROUND_QUICK_PICKS.find((entry) => entry.target === normalized) ?? null;
}

function isDefaultCanvasBackground(background: unknown) {
  return (
    typeof background === "string" &&
    background.trim().toLowerCase() === DEFAULT_CANVAS_BACKGROUND.toLowerCase()
  );
}

function shouldUseDefaultCanvasBackground(content: CanvasContent | null | undefined) {
  return isBlankCanvasContent(content) && isMissingOrDefaultCanvasBackground(content?.appState?.viewBackgroundColor);
}

function shouldHydrateDefaultCanvasBackground(content: CanvasContent | null | undefined) {
  const background = content?.appState?.viewBackgroundColor;

  return (
    isBlankCanvasContent(content) &&
    (isMissingOrDefaultCanvasBackground(background) || isDefaultCanvasBackground(background))
  );
}

function getInitialCanvasAppState(content: CanvasContent | null | undefined) {
  const storedAppState = content?.appState ?? {};

  return {
    viewBackgroundColor: DEFAULT_CANVAS_BACKGROUND,
    ...storedAppState,
    ...(shouldUseDefaultCanvasBackground(content)
      ? { viewBackgroundColor: DEFAULT_CANVAS_BACKGROUND }
      : {})
  } as unknown as Partial<ExcalidrawAppState>;
}

export default function CanvasPane({
  note,
  folders,
  tags,
  language,
  saveState,
  onTitleChange,
  onFolderChange,
  onNoteColorChange,
  onTagIdsChange,
  onCreateTag,
  onDelete,
  onRestore,
  onTogglePin,
  onContentChange,
  onLoadFiles,
  immersive = false
}: CanvasPaneProps) {
  const { t } = useTranslation();
  const [titleDraft, setTitleDraft] = useState(note.title);
  const [activeSurface, setActiveSurface] = useState<"canvas" | "info">("canvas");
  const [exportStatus, setExportStatus] = useState<CanvasExportStatus>(null);
  const exportStatusTimeoutRef = useRef<number | null>(null);
  const titleTimeoutRef = useRef<number | null>(null);
  const contentTimeoutRef = useRef<number | null>(null);
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const stageShellRef = useRef<HTMLDivElement | null>(null);
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
    latestFilesRef.current = {};
    latestFileNamesRef.current = {};
    generatedFileNamesRef.current = {};
  }, [note.id]);

  useEffect(() => {
    latestSceneRef.current = note.canvasContent ?? { elements: [], appState: null };
  }, [note.canvasContent]);

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

  useEffect(() => {
    const stageShell = stageShellRef.current;

    if (!stageShell) {
      return;
    }

    const applyMappedCanvasBackground = (eventTarget: EventTarget | null) => {
      if (!(eventTarget instanceof Element)) {
        return false;
      }

      const button = eventTarget.closest('button[data-testid^="color-top-pick-"]');

      if (!(button instanceof HTMLButtonElement)) {
        return false;
      }

      const quickPick = getCanvasBackgroundQuickPickFromSource(
        button.getAttribute("title") ?? button.dataset.testid ?? ""
      );

      if (!quickPick || !excalidrawApiRef.current) {
        return false;
      }

      excalidrawApiRef.current.updateScene({
        appState: {
          viewBackgroundColor: quickPick.target
        },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY
      });

      return true;
    };

    const handleClickCapture = (event: MouseEvent) => {
      if (!applyMappedCanvasBackground(event.target)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    };

    const handleKeydownCapture = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      if (!applyMappedCanvasBackground(event.target)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    };

    stageShell.addEventListener("click", handleClickCapture, true);
    stageShell.addEventListener("keydown", handleKeydownCapture, true);

    return () => {
      stageShell.removeEventListener("click", handleClickCapture, true);
      stageShell.removeEventListener("keydown", handleKeydownCapture, true);
    };
  }, []);

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

  const showExportStatus = (status: Exclude<CanvasExportStatus, null>) => {
    setExportStatus(status);

    if (exportStatusTimeoutRef.current) {
      window.clearTimeout(exportStatusTimeoutRef.current);
    }

    exportStatusTimeoutRef.current = window.setTimeout(() => {
      setExportStatus(null);
      exportStatusTimeoutRef.current = null;
    }, 2400);
  };

  const getCanvasFilename = (extension: "png" | "svg" | "excalidraw") => {
    const safeTitle = (titleDraft.trim() || note.title || t("canvas.untitled"))
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);

    return `${safeTitle || "canvas"}.${extension}`;
  };

  const downloadCanvasBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const getCurrentCanvasExportData = () => {
    const api = excalidrawApiRef.current;
    const elements = (api?.getSceneElements() ??
      latestSceneRef.current.elements) as readonly ExcalidrawElement[];
    const appState = (api?.getAppState() ??
      latestSceneRef.current.appState ??
      {}) as Partial<ExcalidrawAppState>;
    const files = api?.getFiles() ?? latestFilesRef.current;

    return {
      elements: getNonDeletedElements(elements),
      appState: {
        ...appState,
        name: titleDraft.trim() || note.title || t("canvas.untitled"),
        exportBackground: true,
        exportWithDarkMode: false,
        viewBackgroundColor:
          appState.viewBackgroundColor ?? DEFAULT_CANVAS_BACKGROUND
      } as Partial<ExcalidrawAppState>,
      files
    };
  };

  const handleExportCanvas = async (format: "png" | "svg" | "json") => {
    try {
      const { elements, appState, files } = getCurrentCanvasExportData();

      if (format === "json") {
        const json = serializeAsJSON(elements, appState, files, "local");
        downloadCanvasBlob(
          new Blob([json], { type: "application/vnd.excalidraw+json;charset=utf-8" }),
          getCanvasFilename("excalidraw")
        );
        showExportStatus("json");
        return;
      }

      if (format === "svg") {
        const svg = await exportToSvg({
          elements,
          appState,
          files,
          exportPadding: 16,
          skipInliningFonts: true
        });
        const svgText = new XMLSerializer().serializeToString(svg);
        downloadCanvasBlob(
          new Blob([svgText], { type: "image/svg+xml;charset=utf-8" }),
          getCanvasFilename("svg")
        );
        showExportStatus("svg");
        return;
      }

      const png = await exportToBlob({
        elements,
        appState,
        files,
        mimeType: "image/png",
        exportPadding: 16
      });
      downloadCanvasBlob(png, getCanvasFilename("png"));
      showExportStatus("png");
    } catch {
      showExportStatus("error");
    }
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

      if (exportStatusTimeoutRef.current) {
        window.clearTimeout(exportStatusTimeoutRef.current);
      }

      if (latestTitleDraftRef.current !== latestStoredTitleRef.current) {
        latestOnTitleChangeRef.current(
          latestTitleDraftRef.current.trim() || t("canvas.untitled")
        );
      }
    };
  }, [t]);

  const activeCanvasBackgroundQuickPick =
    getCanvasBackgroundQuickPickFromTarget(note.canvasContent?.appState?.viewBackgroundColor)?.marker ?? "";

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

        <div className="canvas-pane-tools">
          <div className="canvas-export-actions" aria-label={t("canvas.exportActions")}>
            <button
              type="button"
              className="canvas-export-action"
              onClick={() => void handleExportCanvas("png")}
            >
              {t("canvas.exportPng")}
            </button>
            <button
              type="button"
              className="canvas-export-action"
              onClick={() => void handleExportCanvas("svg")}
            >
              {t("canvas.exportSvg")}
            </button>
            <button
              type="button"
              className="canvas-export-action"
              onClick={() => void handleExportCanvas("json")}
            >
              {t("canvas.exportJson")}
            </button>
            {exportStatus ? (
              <span className={`canvas-export-status is-${exportStatus}`}>
                {t(`canvas.exportStatus.${exportStatus}`)}
              </span>
            ) : null}
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
      </div>

      <div className="canvas-pane-shell">
        <div className={`canvas-stage-column ${activeSurface === "info" ? "is-hidden-mobile" : ""}`}>
          <div className="canvas-stage-frame">
            <div
              ref={stageShellRef}
              className="canvas-stage-shell"
              data-canvas-background-quick-pick={activeCanvasBackgroundQuickPick}
            >
              <Excalidraw
                key={note.id}
                excalidrawAPI={(api) => {
                  excalidrawApiRef.current = api;

                  if (shouldHydrateDefaultCanvasBackground(note.canvasContent)) {
                    window.requestAnimationFrame(() => {
                      api.updateScene({
                        appState: {
                          viewBackgroundColor: DEFAULT_CANVAS_BACKGROUND
                        },
                        captureUpdate: CaptureUpdateAction.NEVER
                      });
                    });
                  }
                }}
                name={note.title}
                langCode={language === "ru" ? "ru-RU" : "en"}
                theme="dark"
                UIOptions={EXCALIDRAW_UI_OPTIONS}
                initialData={async (): Promise<ExcalidrawInitialDataState> => ({
                  elements: (note.canvasContent?.elements ?? []) as unknown as readonly ExcalidrawElement[],
                  appState: getInitialCanvasAppState(note.canvasContent),
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
            <div className="canvas-detail-field">
              <span className="canvas-detail-label">{t("note.folder")}</span>
              <FolderPicker
                options={folderOptions}
                value={note.folderId}
                emptyLabel={t("orbit.uncategorized")}
                ariaLabel={t("note.folder")}
                onChange={onFolderChange}
              />
            </div>

            <div className="canvas-detail-field">
              <span className="canvas-detail-label">{t("note.tags")}</span>
              <TagInputField
                tags={tags}
                selectedTagIds={note.tagIds}
                language={language}
                onChangeTagIds={onTagIdsChange}
                onCreateTag={onCreateTag}
              />
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
                className={`micro-action ${note.pinned || note.favorite ? "is-active" : ""}`}
                onClick={onTogglePin}
              >
                {note.pinned || note.favorite ? t("note.unpin") : t("note.pin")}
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
