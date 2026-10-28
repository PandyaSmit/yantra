// Palette names shared by projects and labels. Colours live in tokens.css; data stores names, never hex.
export const PALETTE = ['slate', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'violet', 'pink'] as const;
export type PaletteName = (typeof PALETTE)[number];
