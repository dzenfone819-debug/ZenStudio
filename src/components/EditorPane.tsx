import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { BlockNoteView } from "@blocknote/mantine";
import { en, ru } from "@blocknote/core/locales";
import { useCreateBlockNote } from "@blocknote/react";
import { useTranslation } from "react-i18next";

import "./EditorPane.css";
import FolderPicker from "./FolderPicker";
import TagInputField from "./TagInputField";
import { COLOR_PALETTE, DEFAULT_NOTE_COLOR } from "../lib/palette";
import {
  flattenFolderOptions,
  formatTimestamp,
  normalizeNoteContent
} from "../lib/notes";
import type { AppLanguage, Folder, Note, NoteContent, SaveState, Tag } from "../types";

type MarkdownStatus = "copied" | "exported" | "imported" | "error" | null;
type PendingMarkdownImport = {
  fileName: string;
  markdown: string;
};

interface EditorPaneProps {
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
  onContentChange: (content: NoteContent, state: SaveState) => void;
  onUploadFile: (file: File) => Promise<string>;
  onResolveFileUrl: (url: string) => Promise<string>;
  immersive?: boolean;
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
  onTagIdsChange,
  onCreateTag,
  onDelete,
  onRestore,
  onTogglePin,
  onContentChange,
  onUploadFile,
  onResolveFileUrl,
  immersive = false
}: EditorPaneProps) {
  const { t } = useTranslation();
  const [titleDraft, setTitleDraft] = useState(note.title);
  const [markdownStatus, setMarkdownStatus] = useState<MarkdownStatus>(null);
  const [pendingMarkdownImport, setPendingMarkdownImport] =
    useState<PendingMarkdownImport | null>(null);
  const titleTimeoutRef = useRef<number | null>(null);
  const contentTimeoutRef = useRef<number | null>(null);
  const markdownStatusTimeoutRef = useRef<number | null>(null);
  const markdownFileInputRef = useRef<HTMLInputElement | null>(null);
  const latestTitleDraftRef = useRef(titleDraft);
  const latestStoredTitleRef = useRef(note.title);
  const latestEditorRef = useRef<ReturnType<typeof useCreateBlockNote> | null>(null);
  const latestOnContentChangeRef = useRef(onContentChange);
  const latestOnTitleChangeRef = useRef(onTitleChange);
  const folderOptions = useMemo(
    () => flattenFolderOptions(folders.filter((folder) => folder.projectId === note.projectId)),
    [folders, note.projectId]
  );
  const currentFolder = useMemo(
    () => folderOptions.find((folder) => folder.id === note.folderId) ?? null,
    [folderOptions, note.folderId]
  );
  const normalizedContent = useMemo(() => normalizeNoteContent(note.content), [note.content]);

  useEffect(() => {
    setTitleDraft(note.title);
  }, [note.id, note.title]);

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

  const showMarkdownStatus = (status: Exclude<MarkdownStatus, null>) => {
    setMarkdownStatus(status);

    if (markdownStatusTimeoutRef.current) {
      window.clearTimeout(markdownStatusTimeoutRef.current);
    }

    markdownStatusTimeoutRef.current = window.setTimeout(() => {
      setMarkdownStatus(null);
      markdownStatusTimeoutRef.current = null;
    }, 2400);
  };

  const getMarkdown = () => editor.blocksToMarkdownLossy(editor.document as any);

  const getMarkdownFilename = () => {
    const safeTitle = (titleDraft.trim() || note.title || t("note.untitled"))
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);

    return `${safeTitle || "note"}.md`;
  };

  const handleCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(getMarkdown());
      showMarkdownStatus("copied");
    } catch {
      showMarkdownStatus("error");
    }
  };

  const handleExportMarkdown = () => {
    try {
      const blob = new Blob([getMarkdown()], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = getMarkdownFilename();
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showMarkdownStatus("exported");
    } catch {
      showMarkdownStatus("error");
    }
  };

  const applyMarkdownImport = async (markdown: string) => {
    try {
      const blocks = await Promise.resolve(editor.tryParseMarkdownToBlocks(markdown));

      editor.replaceBlocks(editor.document as any, blocks as any);
      onContentChange(blocks as unknown as NoteContent, "saved");
      setPendingMarkdownImport(null);
      showMarkdownStatus("imported");
    } catch {
      showMarkdownStatus("error");
    }
  };

  const handleImportMarkdownFile = async (file: File | null | undefined) => {
    if (!file) {
      return;
    }

    try {
      const markdown = await file.text();

      if (getMarkdown().trim().length > 0) {
        setPendingMarkdownImport({ fileName: file.name, markdown });
        return;
      }

      await applyMarkdownImport(markdown);
    } catch {
      showMarkdownStatus("error");
    } finally {
      if (markdownFileInputRef.current) {
        markdownFileInputRef.current.value = "";
      }
    }
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

      if (markdownStatusTimeoutRef.current) {
        window.clearTimeout(markdownStatusTimeoutRef.current);
      }

      if (latestTitleDraftRef.current !== latestStoredTitleRef.current) {
        latestOnTitleChangeRef.current(
          latestTitleDraftRef.current.trim() || t("note.untitled")
        );
      }
    };
  }, [t]);

  return (
    <section
      className={`editor-pane ${immersive ? "is-immersive" : ""}`}
      style={{ "--note-accent": note.color || DEFAULT_NOTE_COLOR } as CSSProperties}
    >
      <div className="editor-pane-toolbar">
        <div className="editor-pane-toolbar-main">
          <div className="editor-pane-title-stack">
            <input
              value={titleDraft}
              onChange={(event) => handleTitleChange(event.target.value)}
              className="note-title-input editor-pane-title-field"
              placeholder={t("note.titlePlaceholder")}
            />

            <div className="editor-pane-toolbar-meta">
              <span className={`editor-pane-chip editor-pane-save-pill is-${saveState}`}>
                {t(`saveState.${saveState}`)}
              </span>
              <span className="editor-pane-chip">
                {currentFolder?.name ?? t("orbit.uncategorized")}
              </span>
              {note.tagIds.length > 0 ? (
                <span className="editor-pane-chip">
                  {note.tagIds.length} {t("note.tags").toLowerCase()}
                </span>
              ) : null}
              {note.pinned || note.favorite ? (
                <span className="editor-pane-chip is-warm">{t("note.pinnedActive")}</span>
              ) : null}
              <span className="editor-pane-contextmeta">
                {t("note.updated")}: {formatTimestamp(note.updatedAt, language)}
              </span>
            </div>
          </div>

          <div className="editor-pane-markdown-actions" aria-label={t("note.markdownActions")}>
            <button type="button" className="editor-pane-ghost-action" onClick={handleCopyMarkdown}>
              {t("note.copyMarkdown")}
            </button>
            <button type="button" className="editor-pane-ghost-action" onClick={handleExportMarkdown}>
              {t("note.exportMarkdown")}
            </button>
            <button
              type="button"
              className="editor-pane-ghost-action"
              onClick={() => markdownFileInputRef.current?.click()}
            >
              {t("note.importMarkdown")}
            </button>
            <input
              ref={markdownFileInputRef}
              className="editor-pane-hidden-input"
              type="file"
              accept=".md,.markdown,text/markdown,text/plain"
              onChange={(event) => void handleImportMarkdownFile(event.target.files?.[0])}
            />
            {markdownStatus ? (
              <span className={`editor-pane-markdown-status is-${markdownStatus}`}>
                {t(`note.markdownStatus.${markdownStatus}`)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {pendingMarkdownImport ? (
        <div className="editor-pane-import-confirm" role="alertdialog" aria-modal="false">
          <div className="editor-pane-import-confirm-copy">
            <p className="editor-pane-import-confirm-kicker">
              {t("note.importMarkdown")}
            </p>
            <h3>{t("note.importMarkdownTitle")}</h3>
            <p>
              {t("note.importMarkdownMessage", {
                fileName: pendingMarkdownImport.fileName
              })}
            </p>
          </div>
          <div className="editor-pane-import-confirm-actions">
            <button
              type="button"
              className="editor-pane-ghost-action"
              onClick={() => setPendingMarkdownImport(null)}
            >
              {t("dialog.cancel")}
            </button>
            <button
              type="button"
              className="editor-pane-ghost-action is-danger"
              onClick={() => void applyMarkdownImport(pendingMarkdownImport.markdown)}
            >
              {t("note.replaceWithMarkdown")}
            </button>
          </div>
        </div>
      ) : null}

      <div className="editor-pane-shell">
        <div className="editor-stage-column">
          <div className="editor-stage-frame">
            <div className="editor-stage-shell">
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

        <aside className="editor-sidepanel">
          <section className="editor-pane-detail-card">
            <div className="editor-pane-detail-field">
              <span className="editor-pane-detail-label">{t("note.folder")}</span>
              <FolderPicker
                options={folderOptions}
                value={note.folderId}
                emptyLabel={t("orbit.uncategorized")}
                ariaLabel={t("note.folder")}
                onChange={onFolderChange}
              />
            </div>

            <div className="editor-pane-detail-field">
              <span className="editor-pane-detail-label">{t("note.tags")}</span>
              <TagInputField
                tags={tags}
                selectedTagIds={note.tagIds}
                language={language}
                onChangeTagIds={onTagIdsChange}
                onCreateTag={onCreateTag}
              />
            </div>

            <div className="editor-pane-detail-field">
              <span className="editor-pane-detail-label">{t("note.color")}</span>
              <div className="color-swatch-grid compact editor-pane-color-grid">
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
              <label className="orbital-custom-color-picker editor-pane-custom-color-picker">
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

          <section className="editor-pane-detail-card editor-pane-detail-card-actions">
            <div className="editor-pane-action-grid">
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
