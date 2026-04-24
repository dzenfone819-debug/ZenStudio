import {
  BasicTextStyleButton,
  BlockTypeSelect,
  ColorStyleButton,
  CreateLinkButton,
  FileCaptionButton,
  FileDeleteButton,
  FileDownloadButton,
  FilePreviewButton,
  FileRenameButton,
  FileReplaceButton,
  FormattingToolbar,
  NestBlockButton,
  TableCellMergeButton,
  TextAlignButton,
  UnnestBlockButton,
  useBlockNoteEditor,
  useComponentsContext,
  useEditorState
} from "@blocknote/react";
import { useTranslation } from "react-i18next";

import "./EditorFormattingToolbar.css";
import {
  EDITOR_FONT_CHOICES,
  editorBlockNoteSchema,
  isEditorStoredFontId,
  resolveEditorFontFamily
} from "../lib/blocknoteSchema";

function FontStyleSelect() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor(editorBlockNoteSchema);
  const { t } = useTranslation();

  const activeFont = useEditorState({
    editor,
    selector: ({ editor }) => {
      if (!editor.isEditable) {
        return undefined;
      }

      const selectedBlocks =
        editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block];

      if (!selectedBlocks.some((block) => block.content !== undefined)) {
        return undefined;
      }

      const currentFont = editor.getActiveStyles().font;

      return typeof currentFont === "string" && isEditorStoredFontId(currentFont)
        ? currentFont
        : "default";
    }
  });

  if (!activeFont) {
    return null;
  }

  return (
    <Components.FormattingToolbar.Select
      className="bn-select editor-font-select"
      items={EDITOR_FONT_CHOICES.map((choice) => ({
        text: t(choice.labelKey),
        icon: (
          <span
            className="editor-font-option-preview"
            data-font-choice={choice.id}
            style={choice.stack ? { fontFamily: choice.stack } : undefined}
          >
            {choice.preview}
          </span>
        ),
        isSelected: activeFont === choice.id,
        onClick: () => {
          editor.focus();

          if (choice.id === "default") {
            editor.removeStyles({ font: "" } as any);
          } else {
            editor.addStyles({ font: choice.id } as any);
          }

          setTimeout(() => {
            editor.focus();
          });
        }
      }))}
    />
  );
}

export default function EditorFormattingToolbar() {
  return (
    <div className="editor-formatting-toolbar-shell">
      <FormattingToolbar>
        <BlockTypeSelect />
        <FontStyleSelect />
        <TableCellMergeButton />
        <FileCaptionButton />
        <FileReplaceButton />
        <FileRenameButton />
        <FileDeleteButton />
        <FileDownloadButton />
        <FilePreviewButton />
        <BasicTextStyleButton basicTextStyle="bold" />
        <BasicTextStyleButton basicTextStyle="italic" />
        <BasicTextStyleButton basicTextStyle="underline" />
        <BasicTextStyleButton basicTextStyle="strike" />
        <TextAlignButton textAlignment="left" />
        <TextAlignButton textAlignment="center" />
        <TextAlignButton textAlignment="right" />
        <ColorStyleButton />
        <CreateLinkButton />
        <NestBlockButton />
        <UnnestBlockButton />
      </FormattingToolbar>
    </div>
  );
}
