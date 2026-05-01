import type { AppLanguage, Note, Project } from "../types";

const UNTITLED_LABEL: Record<AppLanguage, string> = {
  en: "Untitled",
  ru: "Без названия"
};

const EMPTY_PREVIEW_LABEL: Record<AppLanguage, string> = {
  en: "No content yet",
  ru: "Пока пусто"
};

const SYSTEM_LABEL: Record<AppLanguage, string> = {
  en: "System",
  ru: "Система"
};

const VAULT_LABEL: Record<AppLanguage, string> = {
  en: "Vault",
  ru: "Хранилище"
};

export function normalizeDisplayName(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function truncateDisplayText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trim()}…`;
}

function stripLeadingPreviewPrefix(source: string, prefix: string) {
  if (!prefix) {
    return source;
  }

  if (!source.toLowerCase().startsWith(prefix.toLowerCase())) {
    return source;
  }

  return source
    .slice(prefix.length)
    .replace(/^[\s\-–—:.,;!?]+/, "")
    .trim();
}

export function getUntitledLabel(language: AppLanguage) {
  return UNTITLED_LABEL[language];
}

export function getEmptyPreviewLabel(language: AppLanguage) {
  return EMPTY_PREVIEW_LABEL[language];
}

export function hasExplicitDisplayName(value: unknown) {
  return normalizeDisplayName(value).length > 0;
}

export function deriveDisplayTitleFromText(value: unknown, maxLength = 72) {
  const normalized = normalizeDisplayName(value);

  if (!normalized) {
    return "";
  }

  return truncateDisplayText(normalized, maxLength);
}

export function getDisplayNoteTitle(
  note: Pick<Note, "title" | "plainText" | "excerpt">,
  language: AppLanguage
) {
  const explicitTitle = normalizeDisplayName(note.title);

  if (explicitTitle) {
    return explicitTitle;
  }

  const derivedTitle = deriveDisplayTitleFromText(note.plainText || note.excerpt);

  return derivedTitle || getUntitledLabel(language);
}

export function getDisplayNotePreview(
  note: Pick<Note, "title" | "plainText" | "excerpt">,
  language: AppLanguage
) {
  const previewSource = normalizeDisplayName(note.excerpt || note.plainText);

  if (!previewSource) {
    return getEmptyPreviewLabel(language);
  }

  const explicitTitle = normalizeDisplayName(note.title);

  if (explicitTitle) {
    return previewSource;
  }

  const derivedTitle = deriveDisplayTitleFromText(previewSource);
  const remainder = stripLeadingPreviewPrefix(previewSource, derivedTitle);

  return remainder || getEmptyPreviewLabel(language);
}

export function getDisplayProjectName(
  project: Pick<Project, "name"> | null | undefined,
  language: AppLanguage,
  index?: number
) {
  const explicitName = normalizeDisplayName(project?.name);

  if (explicitName) {
    return explicitName;
  }

  if (typeof index === "number" && index >= 0) {
    return `${SYSTEM_LABEL[language]} ${index + 1}`;
  }

  return SYSTEM_LABEL[language];
}

export function getDisplayVaultName(
  vault: { name: string } | null | undefined,
  language: AppLanguage,
  index?: number
) {
  const explicitName = normalizeDisplayName(vault?.name);

  if (explicitName) {
    return explicitName;
  }

  if (typeof index === "number" && index >= 0) {
    return `${VAULT_LABEL[language]} ${index + 1}`;
  }

  return VAULT_LABEL[language];
}
