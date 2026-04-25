import {
  bumpVersion,
  CaptureUpdateAction,
  Excalidraw,
  MainMenu
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
import ConfirmDialog from "./ConfirmDialog";
import FolderPicker from "./FolderPicker";
import TagInputField from "./TagInputField";
import {
  DEFAULT_CANVAS_BACKGROUND,
  DEFAULT_CANVAS_ELEMENT_BACKGROUND,
  DEFAULT_CANVAS_FONT_FAMILY,
  DEFAULT_CANVAS_THEME,
  getCanvasRuntimeAppStateDefaults,
  getCanvasStrokeColorForBackground,
  normalizeCanvasHexColor,
  shouldMigrateLegacyCanvasStrokeColor,
  shouldAutoAdaptCanvasStrokeColor
} from "../lib/canvas";
import {
  persistExcalidrawLibrary,
  readPersistedExcalidrawLibrary
} from "../lib/excalidrawLibrary";
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
  libraryStorageScopeId: string;
  immersive?: boolean;
}

const EXCALIDRAW_UI_OPTIONS: Partial<UIOptions> = {
  canvasActions: {
    changeViewBackgroundColor: false,
    clearCanvas: false,
    export: false,
    loadScene: false,
    saveToActiveFile: false,
    saveAsImage: true,
    toggleTheme: false
  },
  welcomeScreen: false,
  tools: {
    image: true
  }
};

const CANVAS_BACKGROUND_PRESETS = [
  { id: "void", color: "#000000" },
  { id: "slate", color: "#111827" },
  { id: "blue", color: "#081423" },
  { id: "amber", color: "#1b1605" },
  { id: "bronze", color: "#1c1311" }
] as const;

const ELEMENT_STROKE_TOP_PICK_OVERRIDES = [
  ["#1e1e1e", "#ffffff"],
  ["#e03131", "#000000"],
  ["#2f9e44", "#8f5662"],
  ["#1971c2", "#4d735f"],
  ["#f08c00", "#4e6f8f"]
] as const;

const ELEMENT_BACKGROUND_TOP_PICK_OVERRIDES = [
  ["#ffc9c9", "#181116"],
  ["#b2f2bb", "#102019"]
] as const;

const ELEMENT_STROKE_TOP_PICK_OVERRIDE_MAP = new Map<string, string>(ELEMENT_STROKE_TOP_PICK_OVERRIDES);
const ELEMENT_BACKGROUND_TOP_PICK_OVERRIDE_MAP = new Map<string, string>(
  ELEMENT_BACKGROUND_TOP_PICK_OVERRIDES
);

function normalizeCanvasUiColorValue(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function resolveCanvasTopPickOverride(value: string) {
  const normalized = normalizeCanvasUiColorValue(value);

  if (ELEMENT_STROKE_TOP_PICK_OVERRIDE_MAP.has(normalized)) {
    return {
      kind: "stroke" as const,
      replacement: ELEMENT_STROKE_TOP_PICK_OVERRIDE_MAP.get(normalized)!
    };
  }

  if (ELEMENT_BACKGROUND_TOP_PICK_OVERRIDE_MAP.has(normalized)) {
    return {
      kind: "background" as const,
      replacement: ELEMENT_BACKGROUND_TOP_PICK_OVERRIDE_MAP.get(normalized)!
    };
  }

  return null;
}

function markCanvasElementUpdated<T extends ExcalidrawElement>(element: T) {
  const nextElement = { ...element } as T;
  bumpVersion(nextElement);
  return nextElement;
}

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

function shouldUseDefaultCanvasBackground(content: CanvasContent | null | undefined) {
  return isBlankCanvasContent(content) && isMissingOrDefaultCanvasBackground(content?.appState?.viewBackgroundColor);
}

function getInitialCanvasAppState(content: CanvasContent | null | undefined) {
  const storedAppState = content?.appState ?? {};
  const resolvedBackground = shouldUseDefaultCanvasBackground(content)
    ? DEFAULT_CANVAS_BACKGROUND
    : storedAppState.viewBackgroundColor;
  const runtimeDefaults = getCanvasRuntimeAppStateDefaults(resolvedBackground);
  const shouldMigrateLegacyStroke = shouldMigrateLegacyCanvasStrokeColor(
    storedAppState.theme,
    storedAppState.currentItemStrokeColor,
    runtimeDefaults.viewBackgroundColor
  );

  return {
    ...runtimeDefaults,
    ...storedAppState,
    theme: DEFAULT_CANVAS_THEME,
    viewBackgroundColor: runtimeDefaults.viewBackgroundColor,
    currentItemStrokeColor:
      typeof storedAppState.currentItemStrokeColor === "string"
        ? shouldMigrateLegacyStroke
          ? runtimeDefaults.currentItemStrokeColor
          : storedAppState.currentItemStrokeColor
        : runtimeDefaults.currentItemStrokeColor,
    currentItemBackgroundColor:
      typeof storedAppState.currentItemBackgroundColor === "string"
        ? storedAppState.currentItemBackgroundColor
        : runtimeDefaults.currentItemBackgroundColor,
    exportBackground: true,
    exportWithDarkMode: false
  } as unknown as Partial<ExcalidrawAppState>;
}

function BackgroundIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 2.25a4.75 4.75 0 1 0 0 9.5 4.75 4.75 0 0 0 0-9.5Zm0 1.5a3.25 3.25 0 0 1 0 6.5 3.25 3.25 0 0 1 0-6.5Z"
        fill="currentColor"
      />
      <path d="M8 0.75a.75.75 0 0 1 .75.75v1a.75.75 0 0 1-1.5 0v-1A.75.75 0 0 1 8 .75Z" fill="currentColor" />
      <path d="M8 12.5a.75.75 0 0 1 .75.75v1a.75.75 0 0 1-1.5 0v-1A.75.75 0 0 1 8 12.5Z" fill="currentColor" />
      <path d="M3.03 3.03a.75.75 0 0 1 1.06 0l.71.72a.75.75 0 0 1-1.06 1.06l-.71-.71a.75.75 0 0 1 0-1.07Z" fill="currentColor" />
      <path d="M11.2 11.2a.75.75 0 0 1 1.06 0l.71.71a.75.75 0 0 1-1.06 1.06l-.71-.71a.75.75 0 0 1 0-1.06Z" fill="currentColor" />
      <path d="M12.5 8a.75.75 0 0 1 .75-.75h1a.75.75 0 0 1 0 1.5h-1A.75.75 0 0 1 12.5 8Z" fill="currentColor" />
      <path d="M.75 8A.75.75 0 0 1 1.5 7.25h1a.75.75 0 0 1 0 1.5h-1A.75.75 0 0 1 .75 8Z" fill="currentColor" />
      <path d="M11.2 4.8a.75.75 0 0 1 0-1.06l.71-.72a.75.75 0 1 1 1.06 1.07l-.71.71a.75.75 0 0 1-1.06 0Z" fill="currentColor" />
      <path d="M3.74 11.2a.75.75 0 0 1 1.06 0 .75.75 0 0 1 0 1.06l-.71.71a.75.75 0 1 1-1.06-1.06l.71-.71Z" fill="currentColor" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M5.5 1.75A1.75 1.75 0 0 0 3.75 3.5v.25H2.5a.75.75 0 0 0 0 1.5h.39l.52 7.16A2 2 0 0 0 5.4 14.25h5.2a2 2 0 0 0 1.99-1.84l.52-7.16h.39a.75.75 0 0 0 0-1.5h-1.25V3.5A1.75 1.75 0 0 0 10.5 1.75h-5Zm5.25 2H5.25V3.5a.25.25 0 0 1 .25-.25h5a.25.25 0 0 1 .25.25v.25ZM5.3 5.25l.47 6.5h4.46l.47-6.5H5.3Z"
        fill="currentColor"
      />
    </svg>
  );
}

interface CanvasBackgroundMenuSectionProps {
  label: string;
  customLabel: string;
  value: string;
  hexValue: string;
  presets: typeof CANVAS_BACKGROUND_PRESETS;
  onSelectPreset: (color: string) => void;
  onColorInput: (color: string) => void;
  onHexInput: (value: string) => void;
}

function CanvasBackgroundMenuSection({
  label,
  customLabel,
  value,
  hexValue,
  presets,
  onSelectPreset,
  onColorInput,
  onHexInput
}: CanvasBackgroundMenuSectionProps) {
  const normalizedValue = normalizeCanvasColorKey(value);
  const colorInputValue = normalizeCanvasHexColor(value) ?? DEFAULT_CANVAS_BACKGROUND;

  return (
    <section className="canvas-mainmenu-section">
      <div className="canvas-mainmenu-label">
        <span className="canvas-mainmenu-icon">
          <BackgroundIcon />
        </span>
        <span>{label}</span>
      </div>

      <div className="canvas-mainmenu-swatches">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`canvas-mainmenu-swatch ${normalizedValue === preset.color ? "is-active" : ""}`}
            style={{ "--canvas-menu-swatch": preset.color } as CSSProperties}
            aria-label={`${label}: ${preset.color.toUpperCase()}`}
            title={preset.color.toUpperCase()}
            onClick={() => onSelectPreset(preset.color)}
          >
            <span className="canvas-mainmenu-swatch-fill" />
          </button>
        ))}
      </div>

      <div className="canvas-mainmenu-custom">
        <span className="canvas-mainmenu-custom-label">{customLabel}</span>
        <div className="canvas-mainmenu-custom-controls">
          <input
            type="color"
            className="canvas-mainmenu-color-input"
            value={colorInputValue}
            aria-label={customLabel}
            onChange={(event) => onColorInput(event.target.value)}
          />
          <input
            type="text"
            inputMode="text"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="canvas-mainmenu-hex-input"
            value={hexValue}
            aria-label={`${label} HEX`}
            onChange={(event) => onHexInput(event.target.value)}
          />
        </div>
      </div>
    </section>
  );
}

interface CanvasMenuActionProps {
  label: string;
  onSelect: () => void;
}

function CanvasMenuAction({ label, onSelect }: CanvasMenuActionProps) {
  return (
    <button type="button" className="canvas-mainmenu-action" onClick={onSelect}>
      <span className="canvas-mainmenu-icon is-danger">
        <TrashIcon />
      </span>
      <span>{label}</span>
    </button>
  );
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
  libraryStorageScopeId,
  immersive = false
}: CanvasPaneProps) {
  const { t } = useTranslation();
  const [titleDraft, setTitleDraft] = useState(note.title);
  const [activeSurface, setActiveSurface] = useState<"canvas" | "info">("canvas");
  const [currentCanvasBackground, setCurrentCanvasBackground] = useState(
    getInitialCanvasAppState(note.canvasContent).viewBackgroundColor ?? DEFAULT_CANVAS_BACKGROUND
  );
  const [backgroundHexDraft, setBackgroundHexDraft] = useState(
    (getInitialCanvasAppState(note.canvasContent).viewBackgroundColor ?? DEFAULT_CANVAS_BACKGROUND).toUpperCase()
  );
  const [isClearCanvasDialogOpen, setIsClearCanvasDialogOpen] = useState(false);
  const canvasStageShellRef = useRef<HTMLDivElement | null>(null);
  const titleTimeoutRef = useRef<number | null>(null);
  const contentTimeoutRef = useRef<number | null>(null);
  const excalidrawApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
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
    const initialCanvasBackground =
      getInitialCanvasAppState(note.canvasContent).viewBackgroundColor ?? DEFAULT_CANVAS_BACKGROUND;
    setCurrentCanvasBackground(initialCanvasBackground);
    setBackgroundHexDraft(initialCanvasBackground.toUpperCase());
    setIsClearCanvasDialogOpen(false);
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
    if (typeof document === "undefined") {
      return undefined;
    }

    const root = document.documentElement;
    const previousAccent = root.style.getPropertyValue("--canvas-dialog-accent");
    root.style.setProperty("--canvas-dialog-accent", note.color || DEFAULT_NOTE_COLOR);

    return () => {
      if (previousAccent) {
        root.style.setProperty("--canvas-dialog-accent", previousAccent);
      } else {
        root.style.removeProperty("--canvas-dialog-accent");
      }
    };
  }, [note.color]);

  const persistedLibraryItems = useMemo(
    () => readPersistedExcalidrawLibrary(libraryStorageScopeId),
    [libraryStorageScopeId]
  );

  const applyCanvasQuickColor = (
    kind: "stroke" | "background",
    nextColor: string
  ) => {
    const api = excalidrawApiRef.current;

    if (!api) {
      return;
    }

    const normalizedColor = normalizeCanvasHexColor(nextColor) ?? nextColor;
    const appState = api.getAppState();
    const selectedElementIds = appState.selectedElementIds ?? {};
    const hasSelection = Object.keys(selectedElementIds).length > 0;
    const currentElements = api.getSceneElementsIncludingDeleted();
    let didChangeElement = false;
    const nextElements = hasSelection
      ? currentElements.map((element) => {
          if (!selectedElementIds[element.id] || element.isDeleted) {
            return element;
          }

          if (kind === "stroke" && !("strokeColor" in element)) {
            return element;
          }

          if (kind === "background" && !("backgroundColor" in element)) {
            return element;
          }

          const currentColor =
            kind === "stroke"
              ? normalizeCanvasUiColorValue((element as { strokeColor?: string }).strokeColor)
              : normalizeCanvasUiColorValue((element as { backgroundColor?: string }).backgroundColor);

          if (currentColor === normalizeCanvasUiColorValue(normalizedColor)) {
            return element;
          }

          const updatedElement =
            kind === "stroke"
              ? markCanvasElementUpdated({
                  ...element,
                  strokeColor: normalizedColor
                } as ExcalidrawElement)
              : markCanvasElementUpdated({
                  ...element,
                  backgroundColor: normalizedColor
                } as ExcalidrawElement);

          didChangeElement = true;
          return updatedElement;
        })
      : currentElements;

    api.updateScene({
      ...(didChangeElement ? { elements: nextElements } : {}),
      appState: {
        currentItemStrokeColor:
          kind === "stroke" ? normalizedColor : appState.currentItemStrokeColor,
        currentItemBackgroundColor:
          kind === "background" ? normalizedColor : appState.currentItemBackgroundColor
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY
    });
  };

  const syncCanvasUiChrome = () => {
    const stageShell = canvasStageShellRef.current;
    const canvasRoot = stageShell?.querySelector<HTMLElement>(".excalidraw");

    if (canvasRoot) {
      const colorPickers = canvasRoot.querySelectorAll<HTMLElement>(".color-picker-container");

      colorPickers.forEach((picker) => {
        const activeTrigger = picker.querySelector<HTMLElement>(".color-picker__button.active-color");
        const activeColor = normalizeCanvasUiColorValue(
          activeTrigger?.style.getPropertyValue("--swatch-color") ??
            activeTrigger?.getAttribute("title") ??
            ""
        );

        picker
          .querySelectorAll<HTMLButtonElement>(".color-picker__top-picks .color-picker__button")
          .forEach((button) => {
            const originalColor =
              button.dataset.canvasQuickPickOriginal ??
              button.getAttribute("title") ??
              button.dataset.testid ??
              "";
            const override = resolveCanvasTopPickOverride(originalColor);

            if (!override) {
              button.classList.remove("is-canvas-override-active");
              button.removeAttribute("data-canvas-quick-color");
              return;
            }

            button.dataset.canvasQuickPickOriginal = originalColor;
            button.dataset.canvasQuickColor = override.replacement;
            button.dataset.canvasQuickColorKind = override.kind;
            button.style.setProperty("--swatch-color", override.replacement);
            button.title = override.replacement.toUpperCase();
            button.setAttribute("aria-label", override.replacement.toUpperCase());
            button.classList.toggle(
              "is-canvas-override-active",
              activeColor === normalizeCanvasUiColorValue(override.replacement)
            );
          });
      });

      canvasRoot
        .querySelectorAll<HTMLElement>(".properties-content")
        .forEach((popover) => {
          popover.classList.toggle(
            "canvas-font-picker-popover",
            Boolean(popover.querySelector(".dropdown-menu.fonts"))
          );
        });
    }

    document.querySelectorAll<HTMLElement>(".ImageExportModal").forEach((modal) => {
      modal.closest(".Dialog")?.classList.add("canvas-export-dialog");
      modal
        .querySelectorAll<HTMLElement>(".ImageExportModal__settings__setting")
        .forEach((setting) => {
          setting.classList.toggle(
            "canvas-export-setting-hidden",
            Boolean(setting.querySelector("#exportDarkModeSwitch"))
          );
        });
    });
  };

  const applyCanvasBackground = (nextColor: string) => {
    const api = excalidrawApiRef.current;
    const normalized = normalizeCanvasHexColor(nextColor);

    if (!api || !normalized) {
      return;
    }

    const appState = api.getAppState();
    const previousBackground =
      typeof appState.viewBackgroundColor === "string"
        ? appState.viewBackgroundColor
        : currentCanvasBackground;
    const nextStroke = getCanvasStrokeColorForBackground(normalized);
    const shouldAdaptStroke = shouldAutoAdaptCanvasStrokeColor(
      appState.currentItemStrokeColor,
      previousBackground
    );

    setCurrentCanvasBackground(normalized);
    setBackgroundHexDraft(normalized.toUpperCase());
    api.updateScene({
      appState: {
        theme: DEFAULT_CANVAS_THEME,
        viewBackgroundColor: normalized,
        currentItemStrokeColor: shouldAdaptStroke
          ? nextStroke
          : appState.currentItemStrokeColor,
        exportWithDarkMode: false
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY
    });
    window.requestAnimationFrame(syncCanvasUiChrome);
  };

  const handleBackgroundHexInput = (value: string) => {
    const draft = value.startsWith("#") ? value : `#${value}`;
    setBackgroundHexDraft(draft.toUpperCase());
    const normalized = normalizeCanvasHexColor(value);

    if (normalized) {
      applyCanvasBackground(normalized);
    }
  };

  const handleClearCanvasConfirm = () => {
    const api = excalidrawApiRef.current;

    if (!api) {
      setIsClearCanvasDialogOpen(false);
      return;
    }

    const appState = api.getAppState();
    const activeBackground =
      typeof appState.viewBackgroundColor === "string"
        ? appState.viewBackgroundColor
        : currentCanvasBackground;
    const normalizedBackground =
      normalizeCanvasHexColor(activeBackground) ?? DEFAULT_CANVAS_BACKGROUND;

    setIsClearCanvasDialogOpen(false);
    setCurrentCanvasBackground(normalizedBackground);
    setBackgroundHexDraft(normalizedBackground.toUpperCase());
    api.updateScene({
      elements: [],
      appState: ({
        theme: DEFAULT_CANVAS_THEME,
        viewBackgroundColor: normalizedBackground,
        currentItemStrokeColor: getCanvasStrokeColorForBackground(normalizedBackground),
        currentItemBackgroundColor: DEFAULT_CANVAS_ELEMENT_BACKGROUND,
        currentItemFontFamily:
          typeof appState.currentItemFontFamily === "number"
            ? appState.currentItemFontFamily
            : DEFAULT_CANVAS_FONT_FAMILY,
        exportBackground: true,
        exportWithDarkMode: false,
        selectedElementIds: {},
        hoveredElementIds: {},
        selectedGroupIds: {},
        editingTextElement: null,
        editingLinearElement: null,
        selectionElement: null,
        openPopup: null,
        openDialog: null,
        activeTool:
          appState.activeTool.type === "image"
            ? { ...appState.activeTool, type: "selection" }
            : appState.activeTool
      } as unknown as ExcalidrawAppState),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY
    });
    window.requestAnimationFrame(syncCanvasUiChrome);
  };

  const handleSceneChange = (
    elements: readonly CanvasContent["elements"][number][],
    appState: CanvasContent["appState"],
    files: BinaryFiles
  ) => {
    const runtimeDefaults = getCanvasRuntimeAppStateDefaults(appState?.viewBackgroundColor);
    const nextScene: CanvasContent = {
      elements: elements.map((element) => ({ ...element })),
      appState: appState
        ? {
            ...runtimeDefaults,
            ...appState,
            theme: DEFAULT_CANVAS_THEME,
            viewBackgroundColor:
              typeof appState.viewBackgroundColor === "string"
                ? appState.viewBackgroundColor
                : runtimeDefaults.viewBackgroundColor,
            currentItemStrokeColor:
              typeof appState.currentItemStrokeColor === "string"
                ? appState.currentItemStrokeColor
                : runtimeDefaults.currentItemStrokeColor,
            currentItemBackgroundColor:
              typeof appState.currentItemBackgroundColor === "string"
                ? appState.currentItemBackgroundColor
                : runtimeDefaults.currentItemBackgroundColor,
            exportBackground:
              typeof appState.exportBackground === "boolean"
                ? appState.exportBackground
                : true,
            exportWithDarkMode: false
          }
        : runtimeDefaults
    };

    const nextBackground =
      nextScene.appState?.viewBackgroundColor ??
      runtimeDefaults.viewBackgroundColor ??
      DEFAULT_CANVAS_BACKGROUND;

    setCurrentCanvasBackground(nextBackground);
    setBackgroundHexDraft(nextBackground.toUpperCase());

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

    window.requestAnimationFrame(syncCanvasUiChrome);
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

  useEffect(() => {
    const stageShell = canvasStageShellRef.current;

    if (!stageShell) {
      return undefined;
    }

    const scheduleSync = () => {
      window.requestAnimationFrame(syncCanvasUiChrome);
    };

    const handleTopPickClickCapture = (event: Event) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      const button = event.target.closest<HTMLButtonElement>(
        ".color-picker__top-picks .color-picker__button"
      );

      if (!button) {
        return;
      }

      const originalColor =
        button.dataset.canvasQuickPickOriginal ??
        button.getAttribute("title") ??
        button.dataset.testid ??
        "";
      const override = resolveCanvasTopPickOverride(originalColor);

      if (!override) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      applyCanvasQuickColor(override.kind, override.replacement);
      scheduleSync();
    };

    const stageObserver = new MutationObserver(scheduleSync);
    const bodyObserver = new MutationObserver(scheduleSync);

    stageShell.addEventListener("click", handleTopPickClickCapture, true);
    stageObserver.observe(stageShell, { childList: true, subtree: true });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
    scheduleSync();

    return () => {
      stageShell.removeEventListener("click", handleTopPickClickCapture, true);
      stageObserver.disconnect();
      bodyObserver.disconnect();
    };
  }, [note.id]);

  return (
    <section
      className={`canvas-pane ${immersive ? "is-immersive" : ""} ${
        activeSurface === "info" ? "is-details-open" : ""
      }`}
      style={{ "--note-accent": note.color || DEFAULT_NOTE_COLOR } as CSSProperties}
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
            <div ref={canvasStageShellRef} className="canvas-stage-shell">
              <Excalidraw
                key={note.id}
                excalidrawAPI={(api) => {
                  excalidrawApiRef.current = api;

                  window.requestAnimationFrame(() => {
                    api.updateScene({
                      appState: getCanvasRuntimeAppStateDefaults(
                        getInitialCanvasAppState(note.canvasContent).viewBackgroundColor
                      ) as unknown as ExcalidrawAppState,
                      captureUpdate: CaptureUpdateAction.NEVER
                    });
                    syncCanvasUiChrome();
                  });
                }}
                name={note.title}
                langCode={language === "ru" ? "ru-RU" : "en"}
                theme="light"
                UIOptions={EXCALIDRAW_UI_OPTIONS}
                initialData={async (): Promise<ExcalidrawInitialDataState> => ({
                  elements: (note.canvasContent?.elements ?? []) as unknown as readonly ExcalidrawElement[],
                  appState: getInitialCanvasAppState(note.canvasContent),
                  files: await onLoadFiles(),
                  libraryItems: persistedLibraryItems
                })}
                onChange={(elements, appState, files) =>
                  handleSceneChange(
                    elements as unknown as CanvasContent["elements"],
                    appState as unknown as CanvasContent["appState"],
                    files
                  )
                }
                onLibraryChange={(libraryItems) =>
                  persistExcalidrawLibrary(libraryStorageScopeId, libraryItems)
                }
                generateIdForFile={(file) => {
                  const id = crypto.randomUUID();
                  generatedFileNamesRef.current[id] = file.name;
                  return id;
                }}
                viewModeEnabled={false}
              >
                <MainMenu>
                  <MainMenu.DefaultItems.SaveAsImage />
                  <MainMenu.Separator />
                  <CanvasBackgroundMenuSection
                    label={t("canvas.backgroundLabel")}
                    customLabel={t("canvas.backgroundCustom")}
                    value={currentCanvasBackground}
                    hexValue={backgroundHexDraft}
                    presets={CANVAS_BACKGROUND_PRESETS}
                    onSelectPreset={applyCanvasBackground}
                    onColorInput={applyCanvasBackground}
                    onHexInput={handleBackgroundHexInput}
                  />
                  <MainMenu.Separator />
                  <CanvasMenuAction
                    label={t("canvas.clearCanvas")}
                    onSelect={() => setIsClearCanvasDialogOpen(true)}
                  />
                  <MainMenu.Separator />
                  <MainMenu.DefaultItems.Help />
                </MainMenu>
              </Excalidraw>
            </div>
            <ConfirmDialog
              open={isClearCanvasDialogOpen}
              kicker={t("canvas.clearCanvasKicker")}
              title={t("canvas.clearCanvasTitle")}
              message={t("canvas.clearCanvasMessage")}
              confirmLabel={t("canvas.clearCanvasConfirm")}
              cancelLabel={t("canvas.clearCanvasCancel")}
              onConfirm={handleClearCanvasConfirm}
              onCancel={() => setIsClearCanvasDialogOpen(false)}
            />
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
