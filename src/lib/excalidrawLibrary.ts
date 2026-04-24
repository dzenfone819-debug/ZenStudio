import { restoreLibraryItems } from "@excalidraw/excalidraw";
import type { LibraryItems } from "@excalidraw/excalidraw/types";

const EXCALIDRAW_LIBRARY_STORAGE_PREFIX = "zen:excalidraw-library:";

function getExcalidrawLibraryStorageKey(scopeId: string) {
  return `${EXCALIDRAW_LIBRARY_STORAGE_PREFIX}${scopeId}`;
}

export function readPersistedExcalidrawLibrary(scopeId: string): LibraryItems {
  if (typeof window === "undefined" || !scopeId) {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(getExcalidrawLibraryStorageKey(scopeId));

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as Parameters<typeof restoreLibraryItems>[0];

    return restoreLibraryItems(parsed, "unpublished");
  } catch {
    return [];
  }
}

export function persistExcalidrawLibrary(scopeId: string, libraryItems: LibraryItems) {
  if (typeof window === "undefined" || !scopeId) {
    return;
  }

  const storageKey = getExcalidrawLibraryStorageKey(scopeId);

  try {
    if (!libraryItems.length) {
      window.localStorage.removeItem(storageKey);
      return;
    }

    window.localStorage.setItem(storageKey, JSON.stringify(libraryItems));
  } catch {
    // Ignore storage quota / privacy mode failures and let the editor continue working.
  }
}
