import { FoldBook } from './FoldBook';
import { UNITS_PER_CELL } from './lattice';

/** The shapes a crew can start from. */
export type PaperShape = 'square' | 'a4';

/** Width over length. A4's sides are 1 to the square root of 2, so it halves into its own shape. */
const ACROSS: Record<PaperShape, number> = { square: 1, a4: Math.SQRT1_2 };

/**
 * A fresh, unfolded sheet of a shape, cut down from the square lattice and kept
 * centred on it. Its width snaps to the nearest fold line on each side.
 */
export function blankBook(cells: number, shape: PaperShape): FoldBook {
  const book = FoldBook.sheet(cells);
  const span = book.span;
  const margin = Math.round((span * (1 - (ACROSS[shape] as number))) / 2 / UNITS_PER_CELL) * UNITS_PER_CELL;
  if (margin === 0) return book;
  const pieces = [...book.cutAlong({ kind: 'x', c: margin }, 0, span)];
  const middle = pieces.find((piece) => piece.faces.some((f) => (piece.at[f * 6] as number) > margin)) as FoldBook;
  const halves = middle.cutAlong({ kind: 'x', c: span - margin }, 0, span);
  return halves.find((piece) => piece.faces.some((f) => (piece.at[f * 6] as number) < span - margin)) as FoldBook;
}
