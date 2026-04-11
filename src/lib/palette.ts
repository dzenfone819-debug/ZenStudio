export const COLOR_PALETTE = [
  { id: "rose", hex: "#ff678c", labelKey: "palette.rose" },
  { id: "amber", hex: "#ffa45c", labelKey: "palette.amber" },
  { id: "aqua", hex: "#73f7ff", labelKey: "palette.aqua" },
  { id: "mint", hex: "#66f0a4", labelKey: "palette.mint" },
  { id: "violet", hex: "#d189ff", labelKey: "palette.violet" },
  { id: "gold", hex: "#ffe08a", labelKey: "palette.gold" },
  { id: "crimson", hex: "#ff5f6d", labelKey: "palette.crimson" },
  { id: "cobalt", hex: "#5d8bff", labelKey: "palette.cobalt" },
  { id: "lime", hex: "#b9ff66", labelKey: "palette.lime" },
  { id: "pearl", hex: "#f4efff", labelKey: "palette.pearl" }
] as const;

export const DEFAULT_PROJECT_COLOR = COLOR_PALETTE[5].hex;
export const DEFAULT_FOLDER_COLOR = COLOR_PALETTE[0].hex;
export const DEFAULT_NOTE_COLOR = COLOR_PALETTE[2].hex;
