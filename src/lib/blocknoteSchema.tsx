import { BlockNoteSchema, defaultStyleSpecs } from "@blocknote/core";
import { createReactStyleSpec } from "@blocknote/react";

export type EditorStoredFontId =
  | "onest"
  | "ibmPlexSans"
  | "golosText"
  | "ibmPlexSerif"
  | "ibmPlexMono"
  | "unbounded";
export type EditorFontChoiceId = "default" | EditorStoredFontId;

type EditorFontChoice = {
  id: EditorFontChoiceId;
  labelKey: string;
  preview: string;
  stack?: string;
};

export const EDITOR_FONT_CHOICES: readonly EditorFontChoice[] = [
  {
    id: "default",
    labelKey: "note.fontDefault",
    preview: "Aa"
  },
  {
    id: "onest",
    labelKey: "note.fontOnest",
    preview: "On",
    stack: '"Onest Variable", "IBM Plex Sans", system-ui, sans-serif'
  },
  {
    id: "ibmPlexSans",
    labelKey: "note.fontIbmPlexSans",
    preview: "Px",
    stack: '"IBM Plex Sans", "Onest Variable", system-ui, sans-serif'
  },
  {
    id: "golosText",
    labelKey: "note.fontGolosText",
    preview: "Go",
    stack: '"Golos Text Variable", "IBM Plex Sans", "Onest Variable", sans-serif'
  },
  {
    id: "ibmPlexSerif",
    labelKey: "note.fontIbmPlexSerif",
    preview: "Ss",
    stack: '"IBM Plex Serif", Georgia, serif'
  },
  {
    id: "ibmPlexMono",
    labelKey: "note.fontIbmPlexMono",
    preview: "{ }",
    stack: '"IBM Plex Mono", ui-monospace, monospace'
  },
  {
    id: "unbounded",
    labelKey: "note.fontUnbounded",
    preview: "UB",
    stack: '"Unbounded Variable", "Onest Variable", "IBM Plex Sans", sans-serif'
  }
] as const;

export function isEditorStoredFontId(value: unknown): value is EditorStoredFontId {
  return EDITOR_FONT_CHOICES.some(
    (choice) => choice.id !== "default" && choice.id === value
  );
}

export function resolveEditorFontFamily(
  value: string | null | undefined
) {
  if (!value || !isEditorStoredFontId(value)) {
    return undefined;
  }

  return EDITOR_FONT_CHOICES.find((choice) => choice.id === value)?.stack;
}

const FontStyleSpec = createReactStyleSpec(
  {
    type: "font",
    propSchema: "string"
  },
  {
    render: (props) => {
      const fontFamily = resolveEditorFontFamily(props.value);

      return (
        <span
          ref={props.contentRef}
          style={fontFamily ? { fontFamily } : undefined}
        />
      );
    }
  }
);

export const editorBlockNoteSchema = BlockNoteSchema.create({
  styleSpecs: {
    ...defaultStyleSpecs,
    font: FontStyleSpec
  }
});
