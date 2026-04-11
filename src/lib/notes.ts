import type { AppLanguage, Folder, Note, NoteContent, StoredBlock, Tag } from "../types";

const UNTITLED_TITLE: Record<AppLanguage, string> = {
  en: "Untitled note",
  ru: "Новая заметка"
};

export function getUntitledTitle(language: AppLanguage) {
  return UNTITLED_TITLE[language];
}

export function createStarterContent(language: AppLanguage): NoteContent {
  if (language === "ru") {
    return [
      {
        id: crypto.randomUUID(),
        type: "heading",
        props: {
          level: 2
        },
        content: [
          {
            type: "text",
            text: "Полевая заметка",
            styles: {}
          }
        ],
        children: []
      },
      {
        id: crypto.randomUUID(),
        type: "paragraph",
        props: {
          textColor: "default"
        },
        content: [
          {
            type: "text",
            text: "Используйте / для вставки таблиц, изображений, файлов, списков и других блоков.",
            styles: {}
          }
        ],
        children: []
      }
    ];
  }

  return [
    {
      id: crypto.randomUUID(),
      type: "heading",
      props: {
        level: 2
      },
      content: [
        {
          type: "text",
          text: "Field note",
          styles: {}
        }
      ],
      children: []
    },
    {
      id: crypto.randomUUID(),
      type: "paragraph",
      props: {
        textColor: "default"
      },
      content: [
        {
          type: "text",
          text: "Use / to insert tables, images, files, lists, and other blocks.",
          styles: {}
        }
      ],
      children: []
    }
  ];
}

const FILE_BLOCK_TYPES = new Set(["image", "file", "audio", "video"]);

function normalizeStoredBlock(block: StoredBlock): StoredBlock {
  const normalizedChildren = Array.isArray(block.children)
    ? block.children.map((child) => normalizeStoredBlock(child))
    : [];

  if (!FILE_BLOCK_TYPES.has(block.type ?? "")) {
    return {
      ...block,
      children: normalizedChildren
    };
  }

  const record = block as StoredBlock & {
    url?: unknown;
    name?: unknown;
  };
  const props = {
    ...(record.props ?? {})
  };

  if (typeof props.url !== "string" && typeof record.url === "string") {
    props.url = record.url;
  }

  if (typeof props.name !== "string" && typeof record.name === "string") {
    props.name = record.name;
  }

  const { url: _legacyUrl, name: _legacyName, ...rest } = record;

  return {
    ...rest,
    props,
    children: normalizedChildren
  };
}

export function normalizeNoteContent(blocks: NoteContent): NoteContent {
  return blocks.map((block) => normalizeStoredBlock(block));
}

function collectText(value: unknown, parts: string[]) {
  if (typeof value === "string") {
    parts.push(value);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectText(entry, parts));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;

  if (typeof record.text === "string") {
    parts.push(record.text);
  }

  Object.entries(record).forEach(([key, nestedValue]) => {
    if (key !== "text") {
      collectText(nestedValue, parts);
    }
  });
}

function walkBlocks(blocks: StoredBlock[], callback: (block: StoredBlock) => void) {
  blocks.forEach((block) => {
    callback(block);

    if (Array.isArray(block.children) && block.children.length > 0) {
      walkBlocks(block.children, callback);
    }
  });
}

export function extractPlainText(blocks: NoteContent) {
  const parts: string[] = [];

  walkBlocks(blocks, (block) => {
    collectText(block.content, parts);
  });

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

export function buildExcerpt(blocks: NoteContent, maxLength = 180) {
  const plainText = extractPlainText(blocks);

  if (!plainText) {
    return "";
  }

  if (plainText.length <= maxLength) {
    return plainText;
  }

  return `${plainText.slice(0, maxLength).trim()}...`;
}

export function countBlocks(blocks: NoteContent) {
  let total = 0;

  walkBlocks(blocks, () => {
    total += 1;
  });

  return total;
}

export function extractReferencedAssetIds(blocks: NoteContent) {
  const assetIds = new Set<string>();

  walkBlocks(blocks, (block) => {
    const url =
      typeof block.props?.url === "string"
        ? block.props.url
        : typeof (block as StoredBlock & { url?: unknown }).url === "string"
          ? (block as StoredBlock & { url: string }).url
          : null;

    if (url?.startsWith("asset://")) {
      assetIds.add(url.replace("asset://", ""));
    }
  });

  return [...assetIds];
}

export function buildFolderDepthMap(folders: Folder[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const depthMap = new Map<string, number>();

  const getDepth = (folderId: string): number => {
    if (depthMap.has(folderId)) {
      return depthMap.get(folderId)!;
    }

    const folder = byId.get(folderId);

    if (!folder || !folder.parentId) {
      depthMap.set(folderId, 0);
      return 0;
    }

    const depth = getDepth(folder.parentId) + 1;
    depthMap.set(folderId, depth);
    return depth;
  };

  folders.forEach((folder) => {
    getDepth(folder.id);
  });

  return depthMap;
}

export function flattenFolderOptions(folders: Folder[]) {
  const childrenByParent = new Map<string | null, Folder[]>();

  folders.forEach((folder) => {
    const bucket = childrenByParent.get(folder.parentId) ?? [];
    bucket.push(folder);
    childrenByParent.set(folder.parentId, bucket);
  });

  childrenByParent.forEach((bucket) => {
    bucket.sort((left, right) => left.name.localeCompare(right.name));
  });

  const result: Array<Folder & { depth: number }> = [];

  const visit = (parentId: string | null, depth: number) => {
    const bucket = childrenByParent.get(parentId) ?? [];

    bucket.forEach((folder) => {
      result.push({
        ...folder,
        depth
      });
      visit(folder.id, depth + 1);
    });
  };

  visit(null, 0);
  return result;
}

export function getDescendantFolderIds(folderId: string, folders: Folder[]) {
  const childrenByParent = new Map<string | null, string[]>();

  folders.forEach((folder) => {
    const bucket = childrenByParent.get(folder.parentId) ?? [];
    bucket.push(folder.id);
    childrenByParent.set(folder.parentId, bucket);
  });

  const visited = new Set<string>();
  const queue = [folderId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;

    if (visited.has(currentId)) {
      continue;
    }

    visited.add(currentId);
    (childrenByParent.get(currentId) ?? []).forEach((childId) => {
      queue.push(childId);
    });
  }

  return visited;
}

export function buildFolderPathMap(folders: Folder[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const pathMap = new Map<string, string>();

  const getPath = (folderId: string | null): string => {
    if (!folderId) {
      return "";
    }

    if (pathMap.has(folderId)) {
      return pathMap.get(folderId)!;
    }

    const folder = byId.get(folderId);

    if (!folder) {
      return "";
    }

    const parentPath = getPath(folder.parentId);
    const path = parentPath ? `${parentPath} / ${folder.name}` : folder.name;
    pathMap.set(folderId, path);
    return path;
  };

  folders.forEach((folder) => {
    getPath(folder.id);
  });

  return pathMap;
}

export function buildFolderCounts(notes: Note[], folders: Folder[]) {
  const counts = new Map<string, number>();

  folders.forEach((folder) => {
    const folderIds = getDescendantFolderIds(folder.id, folders);
    const count = notes.filter((note) => note.folderId && folderIds.has(note.folderId)).length;
    counts.set(folder.id, count);
  });

  return counts;
}

export function getFolderCascade(folderId: string, folders: Folder[], notes: Note[]) {
  const folderIds = getDescendantFolderIds(folderId, folders);
  const noteIds = notes
    .filter((note) => note.folderId && folderIds.has(note.folderId))
    .map((note) => note.id);

  return {
    folderIds: [...folderIds],
    noteIds
  };
}

export function buildTagCounts(notes: Note[], tags: Tag[]) {
  const counts = new Map<string, number>();

  tags.forEach((tag) => {
    counts.set(
      tag.id,
      notes.filter((note) => note.tagIds.includes(tag.id)).length
    );
  });

  return counts;
}

export function formatTimestamp(timestamp: number, language: AppLanguage) {
  return new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-US", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(timestamp);
}

export function matchSearch(note: Note, search: string, tagMap: Map<string, Tag>) {
  const query = search.trim().toLowerCase();

  if (!query) {
    return true;
  }

  const tagNames = note.tagIds
    .map((tagId) => tagMap.get(tagId)?.name.toLowerCase() ?? "")
    .join(" ");

  return [note.title, note.excerpt, note.plainText, tagNames]
    .join(" ")
    .toLowerCase()
    .includes(query);
}
