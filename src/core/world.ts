/**
 * World-scale constants. Everything in Kami is authored in metres, so a model
 * made in Blender at real size drops straight in.
 */
export const WORLD = {
  /** Height of a player character, used by the library's scale reference. */
  playerHeight: 1,
  /** Thickness of a standard sheet. Exaggerated from real paper so edges read on screen. */
  sheetThickness: 0.014,
} as const;
