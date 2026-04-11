import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BlockNoteView } from "@blocknote/mantine";
import { en, ru } from "@blocknote/core/locales";
import { useCreateBlockNote } from "@blocknote/react";
import { useTranslation } from "react-i18next";

import { COLOR_PALETTE, DEFAULT_NOTE_COLOR } from "../lib/palette";
import {
  buildFolderPathMap,
  countBlocks,
  flattenFolderOptions,
  formatTimestamp,
  normalizeNoteContent
} from "../lib/notes";
import type { AppLanguage, Folder, Note, NoteContent, SaveState, Tag } from "../types";

interface EditorPaneProps {
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
  onContentChange: (content: NoteContent, state: SaveState) => void;
  onUploadFile: (file: File) => Promise<string>;
  onResolveFileUrl: (url: string) => Promise<string>;
}

export default function EditorPane({
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
  onUploadFile,
  onResolveFileUrl
}: EditorPaneProps) {
  const { t } = useTranslation();
  const [titleDraft, setTitleDraft] = useState(note.title);
  const [activeSurface, setActiveSurface] = useState<"write" | "info">("write");
  const titleTimeoutRef = useRef<number | null>(null);
  const contentTimeoutRef = useRef<number | null>(null);
  const latestTitleDraftRef = useRef(titleDraft);
  const latestStoredTitleRef = useRef(note.title);
  const latestEditorRef = useRef<ReturnType<typeof useCreateBlockNote> | null>(null);
  const latestOnContentChangeRef = useRef(onContentChange);
  const latestOnTitleChangeRef = useRef(onTitleChange);
  const folderOptions = useMemo(
    () => flattenFolderOptions(folders.filter((folder) => folder.projectId === note.projectId)),
    [folders, note.projectId]
  );
  const folderPathMap = useMemo(
    () => buildFolderPathMap(folders.filter((folder) => folder.projectId === note.projectId)),
    [folders, note.projectId]
  );
  const selectedTags = tags.filter((tag) => note.tagIds.includes(tag.id));
  const normalizedContent = useMemo(() => normalizeNoteContent(note.content), [note.content]);
  const attachmentCount = normalizedContent.filter((block) =>
    ["image", "file", "audio", "video"].includes(block.type ?? "")
  ).length;
  const selectedFolderLabel =
    folderOptions.find((folder) => folder.id === note.folderId)?.name ?? t("orbit.uncategorized");
  const selectedFolderPath = note.folderId
    ? folderPathMap.get(note.folderId) ?? selectedFolderLabel
    : t("orbit.uncategorized");
  const visibleHeaderTags = selectedTags.slice(0, 4);
  const hiddenHeaderTagsCount = Math.max(0, selectedTags.length - visibleHeaderTags.length);

  useEffect(() => {
    setTitleDraft(note.title);
  }, [note.id, note.title]);

  useEffect(() => {
    setActiveSurface("write");
  }, [note.id]);

  const editorDictionary = language === "ru" ? ru : en;

  const editor = useCreateBlockNote(
    {
      initialContent: normalizedContent as any,
      animations: true,
      dictionary: {
        ...editorDictionary,
        placeholders: {
          ...editorDictionary.placeholders,
          emptyDocument: t("note.editorPlaceholder"),
          default: t("note.editorPlaceholder")
        }
      },
      tables: {
        splitCells: true,
        cellBackgroundColor: true,
        cellTextColor: true,
        headers: true
      },
      tabBehavior: "prefer-indent",
      uploadFile: onUploadFile,
      resolveFileUrl: onResolveFileUrl,
      domAttributes: {
        editor: {
          class: "zen-editor-surface"
        }
      }
    },
    [note.id, language]
  );

  useEffect(() => {
    latestTitleDraftRef.current = titleDraft;
  }, [titleDraft]);

  useEffect(() => {
    latestStoredTitleRef.current = note.title;
  }, [note.title]);

  useEffect(() => {
    latestEditorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    latestOnContentChangeRef.current = onContentChange;
  }, [onContentChange]);

  useEffect(() => {
    latestOnTitleChangeRef.current = onTitleChange;
  }, [onTitleChange]);

  const handleEditorChange = () => {
    if (contentTimeoutRef.current) {
      window.clearTimeout(contentTimeoutRef.current);
    }

    onContentChange(editor.document as unknown as NoteContent, "saving");

    contentTimeoutRef.current = window.setTimeout(() => {
      onContentChange(editor.document as unknown as NoteContent, "saved");
    }, 280);
  };

  const handleTitleChange = (value: string) => {
    setTitleDraft(value);

    if (titleTimeoutRef.current) {
      window.clearTimeout(titleTimeoutRef.current);
    }

    titleTimeoutRef.current = window.setTimeout(() => {
      onTitleChange(value.trim() || t("note.untitled"));
    }, 220);
  };

  useEffect(() => {
    return () => {
      if (titleTimeoutRef.current) {
        window.clearTimeout(titleTimeoutRef.current);
      }

      if (contentTimeoutRef.current) {
        window.clearTimeout(contentTimeoutRef.current);
        if (latestEditorRef.current) {
          latestOnContentChangeRef.current(
            latestEditorRef.current.document as unknown as NoteContent,
            "saved"
          );
        }
      }

      if (latestTitleDraftRef.current !== latestStoredTitleRef.current) {
        latestOnTitleChangeRef.current(
          latestTitleDraftRef.current.trim() || t("note.untitled")
        );
      }
    };
  }, [t]);

  return (
    <section className="panel editor-panel editor-composer">
      <div
        className="editor-surface-switcher editor-surface-switcher-quiet"
        role="tablist"
        aria-label={t("note.surfaceLabel")}
      >
        <button
          type="button"
          className={`editor-surface-tab ${activeSurface === "write" ? "is-active" : ""}`}
          onClick={() => setActiveSurface("write")}
        >
          {t("note.writeTab")}
        </button>
        <button
          type="button"
          className={`editor-surface-tab ${activeSurface === "info" ? "is-active" : ""}`}
          onClick={() => setActiveSurface("info")}
        >
          {t("note.infoTab")}
        </button>
      </div>

      <div className="editor-composer-shell">
        <div className={`editor-primary-stage ${activeSurface === "info" ? "is-hidden-mobile" : ""}`}>
          <header className="editor-focus-head">
            <div className="editor-session-line">
              <span className={`editor-save-pill is-${saveState}`}>{t(`saveState.${saveState}`)}</span>
              {note.favorite ? <span className="editor-inline-state">{t("note.favoriteActive")}</span> : null}
              {note.pinned ? <span className="editor-inline-state">{t("note.pin")}</span> : null}
              {note.archived ? <span className="editor-inline-state">{t("note.archive")}</span> : null}
            </div>

            <input
              value={titleDraft}
              onChange={(event) => handleTitleChange(event.target.value)}
              className="note-title-input editor-title-field"
              placeholder={t("note.titlePlaceholder")}
            />

            <div className="editor-context-row">
              <span className="editor-context-chip">{selectedFolderPath}</span>
              <span className="editor-context-caption">
                {t("note.updated")}: {formatTimestamp(note.updatedAt, language)}
              </span>
            </div>

            {selectedTags.length > 0 ? (
              <div className="editor-tag-preview-strip">
                {visibleHeaderTags.map((tag) => (
                  <span className="tiny-tag editor-tag-preview" key={tag.id}>
                    {tag.name}
                  </span>
                ))}
                {hiddenHeaderTagsCount > 0 ? (
                  <span className="tiny-tag editor-tag-preview">+{hiddenHeaderTagsCount}</span>
                ) : null}
              </div>
            ) : null}
          </header>

          <div className="editor-writing-stage">
            <div className="editor-shell editor-writing-shell">
              <BlockNoteView
                editor={editor}
                theme="dark"
                onChange={handleEditorChange}
                formattingToolbar
                linkToolbar
                slashMenu
                sideMenu
                filePanel
                tableHandles
                emojiPicker
                comments={false}
              />
            </div>
          </div>
        </div>

        <aside className={`editor-secondary-rail ${activeSurface === "write" ? "is-hidden-mobile" : ""}`}>
          <section className="editor-detail-card editor-detail-card-organize">
            <p className="editor-section-title">{t("note.organize")}</p>

            <label className="editor-detail-field">
              <span className="editor-detail-label">{t("note.folder")}</span>
              <select
                value={note.folderId ?? ""}
                onChange={(event) => onFolderChange(event.target.value || null)}
                className="meta-select editor-detail-select"
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

            <div className="editor-detail-field">
              <span className="editor-detail-label">{t("note.color")}</span>
              <div className="color-swatch-grid compact editor-color-grid">
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
              <label className="orbital-custom-color-picker editor-custom-color-picker">
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

            <div className="editor-detail-field">
              <span className="editor-detail-label">{t("note.tags")}</span>
              <div className="editor-tag-selector">
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
          </section>

          <section className="editor-detail-card editor-detail-card-actions">
            <p className="editor-section-title">{t("note.actions")}</p>

            <div className="editor-quiet-actions">
              <button
                type="button"
                className={`micro-action editor-quiet-action ${note.favorite ? "is-active" : ""}`}
                onClick={onToggleFavorite}
              >
                {note.favorite ? t("note.unfavorite") : t("note.favorite")}
              </button>
              <button
                type="button"
                className={`micro-action editor-quiet-action ${note.pinned ? "is-active" : ""}`}
                onClick={onTogglePin}
              >
                {note.pinned ? t("note.unpin") : t("note.pin")}
              </button>
              <button
                type="button"
                className={`micro-action editor-quiet-action ${note.archived ? "is-active" : ""}`}
                onClick={onToggleArchive}
              >
                {note.archived ? t("note.unarchive") : t("note.archive")}
              </button>
              {note.trashedAt ? (
                <button type="button" className="micro-action editor-quiet-action" onClick={onRestore}>
                  {t("note.restore")}
                </button>
              ) : null}
              <button
                type="button"
                className="micro-action danger editor-quiet-action"
                onClick={onDelete}
              >
                {note.trashedAt ? t("note.deletePermanently") : t("note.moveToTrash")}
              </button>
            </div>
          </section>

          <section className="editor-detail-card editor-detail-card-secondary">
            <p className="editor-section-title">{t("note.details")}</p>

            <div className="editor-detail-list">
              <div className="editor-detail-row">
                <span>{t("note.saveStatus")}</span>
                <strong>{t(`saveState.${saveState}`)}</strong>
              </div>
              <div className="editor-detail-row">
                <span>{t("note.updated")}</span>
                <strong>{formatTimestamp(note.updatedAt, language)}</strong>
              </div>
              <div className="editor-detail-row">
                <span>{t("note.blocks")}</span>
                <strong>{countBlocks(normalizedContent)}</strong>
              </div>
              <div className="editor-detail-row">
                <span>{t("note.attachments")}</span>
                <strong>{attachmentCount}</strong>
              </div>
              <div className="editor-detail-row">
                <span>{t("note.tags")}</span>
                <strong>{selectedTags.length}</strong>
              </div>
              <div className="editor-detail-row">
                <span>{t("note.storage")}</span>
                <strong>{t("note.localOnlyShort")}</strong>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}
