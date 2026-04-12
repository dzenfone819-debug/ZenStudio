import { getTextFromElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppLanguage, CanvasContent, CanvasSceneAppState, CanvasSceneElement } from "../types";

const UNTITLED_CANVAS_TITLE: Record<AppLanguage, string> = {
  en: "Untitled canvas",
  ru: "Новый канвас"
};

const DEFAULT_CANVAS_BACKGROUND = "#090d1f";

export function getUntitledCanvasTitle(language: AppLanguage) {
  return UNTITLED_CANVAS_TITLE[language];
}

export function createStarterCanvasContent(): CanvasContent {
  return {
    elements: [],
    appState: {
      viewBackgroundColor: DEFAULT_CANVAS_BACKGROUND
    }
  };
}

export function normalizeCanvasElements(elements: readonly CanvasSceneElement[] | null | undefined) {
  if (!elements || elements.length === 0) {
    return [];
  }

  return elements.map((element) => ({
    ...element
  }));
}

export function pickCanvasAppState(appState: CanvasSceneAppState | null | undefined): CanvasSceneAppState | null {
  if (!appState) {
    return null;
  }

  return {
    viewBackgroundColor:
      typeof appState.viewBackgroundColor === "string"
        ? appState.viewBackgroundColor
        : DEFAULT_CANVAS_BACKGROUND,
    gridSize:
      typeof appState.gridSize === "number" || appState.gridSize === null
        ? appState.gridSize
        : null,
    gridStep: typeof appState.gridStep === "number" ? appState.gridStep : undefined,
    scrollX: typeof appState.scrollX === "number" ? appState.scrollX : undefined,
    scrollY: typeof appState.scrollY === "number" ? appState.scrollY : undefined,
    zoom: appState.zoom && typeof appState.zoom === "object" ? { ...appState.zoom } : undefined
  };
}

export function normalizeCanvasContent(content: CanvasContent | null | undefined): CanvasContent {
  return {
    elements: normalizeCanvasElements(content?.elements),
    appState: pickCanvasAppState(content?.appState) ?? {
      viewBackgroundColor: DEFAULT_CANVAS_BACKGROUND
    }
  };
}

export function extractCanvasPlainText(content: CanvasContent | null | undefined) {
  const normalized = normalizeCanvasContent(content);
  const activeElements = normalized.elements.filter((element) => !element.isDeleted);

  if (activeElements.length === 0) {
    return "";
  }

  return getTextFromElements(activeElements as unknown as readonly ExcalidrawElement[])
    .replace(/\s+/g, " ")
    .trim();
}

export function buildCanvasExcerpt(content: CanvasContent | null | undefined, maxLength = 180) {
  const plainText = extractCanvasPlainText(content);

  if (!plainText) {
    return "";
  }

  if (plainText.length <= maxLength) {
    return plainText;
  }

  return `${plainText.slice(0, maxLength).trim()}...`;
}

export function extractCanvasReferencedFileIds(content: CanvasContent | null | undefined) {
  const normalized = normalizeCanvasContent(content);
  const fileIds = new Set<string>();

  normalized.elements.forEach((element) => {
    if (element.isDeleted || typeof element.fileId !== "string" || element.fileId.length === 0) {
      return;
    }

    fileIds.add(element.fileId);
  });

  return [...fileIds];
}

export function remapCanvasFileIds(
  content: CanvasContent | null | undefined,
  fileIdMap: ReadonlyMap<string, string>
) {
  const normalized = normalizeCanvasContent(content);

  return {
    ...normalized,
    elements: normalized.elements.map((element) => {
      if (typeof element.fileId !== "string" || element.fileId.length === 0) {
        return {
          ...element
        };
      }

      return {
        ...element,
        fileId: fileIdMap.get(element.fileId) ?? element.fileId
      };
    })
  };
}

export function getCanvasMetrics(
  content: CanvasContent | null | undefined,
  options?: { includePlainText?: boolean }
) {
  const normalized = normalizeCanvasContent(content);
  let activeElementCount = 0;
  let imageCount = 0;
  let frameCount = 0;

  normalized.elements.forEach((element) => {
    if (element.isDeleted) {
      return;
    }

    activeElementCount += 1;

    if (element.type === "image") {
      imageCount += 1;
    }

    if (element.type === "frame" || element.type === "magicframe") {
      frameCount += 1;
    }
  });

  return {
    activeElementCount,
    imageCount,
    frameCount,
    plainText: options?.includePlainText === false ? "" : extractCanvasPlainText(normalized)
  };
}

export function getCanvasBackgroundColor(content: CanvasContent | null | undefined) {
  return normalizeCanvasContent(content).appState?.viewBackgroundColor ?? DEFAULT_CANVAS_BACKGROUND;
}
