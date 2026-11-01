import type { Landing } from './FoldBook';
import { UNITS_PER_CELL } from './lattice';
import type { LineKind, MirrorLine } from './lattice';
import type { SheetPiece } from './SheetPiece';

/**
 * A fold written down, so a design can be replayed exactly. This is also what a
 * network message will be: a whole piece of origami fits in a few dozen bytes.
 */
export interface FoldStep {
  kind: LineKind;
  /** Where the line sits, in metres from the sheet's corner. */
  at: number;
  /** Which side moves: +1 or -1. */
  side: number;
  /** `all` grips every layer, `top` and `bottom` grip only that outer layer. */
  grip: 'all' | 'top' | 'bottom';
  landing?: Landing;
}

export interface Recipe {
  id: string;
  name: string;
  steps: FoldStep[];
}

export function toMirrorLine(piece: SheetPiece, { kind, at }: Pick<FoldStep, 'kind' | 'at'>): MirrorLine {
  const unitsPerMetre = (piece.book.cells * UNITS_PER_CELL) / piece.definition.size;
  return { kind, c: Math.round(at * unitsPerMetre) };
}

/** The faces a step's grip holds on the side that is moving. */
export function gripFaces(piece: SheetPiece, step: FoldStep): number[] {
  const { book } = piece;
  if (step.grip === 'all') return book.faces;
  const line = toMirrorLine(piece, step);
  const outer = book.faces.filter((f) => {
    const stack = book.stackOf(f);
    return (step.grip === 'top' ? stack[stack.length - 1] : stack[0]) === f;
  });
  return outer.filter((f) => book.plan({ line, side: step.side, seeds: [f] }).moved.size > 0);
}

export function applyStep(piece: SheetPiece, step: FoldStep, swing = false) {
  return piece.fold({ line: toMirrorLine(piece, step), side: step.side, seeds: gripFaces(piece, step), landing: step.landing }, swing);
}

const half = 5;

export const RECIPES: readonly Recipe[] = [
  {
    id: 'book',
    name: 'Fold in half twice',
    steps: [
      { kind: 'x', at: half, side: 1, grip: 'all' },
      { kind: 'z', at: half, side: 1, grip: 'all' },
    ],
  },
  {
    id: 'letter',
    name: 'Letter fold',
    steps: [
      { kind: 'x', at: 7, side: 1, grip: 'top' },
      { kind: 'x', at: 3, side: -1, grip: 'top' },
    ],
  },
  {
    id: 'blintz',
    name: 'Four corners',
    steps: [
      { kind: 'sum', at: 5, side: -1, grip: 'top' },
      { kind: 'sum', at: 15, side: 1, grip: 'top' },
      { kind: 'diff', at: 5, side: 1, grip: 'top' },
      { kind: 'diff', at: -5, side: -1, grip: 'top' },
    ],
  },
  {
    id: 'plane',
    name: 'Paper dart',
    steps: [
      { kind: 'sum', at: 5, side: -1, grip: 'top' },
      { kind: 'diff', at: 5, side: 1, grip: 'top' },
      { kind: 'x', at: half, side: 1, grip: 'all' },
    ],
  },
  {
    id: 'boat',
    name: 'Paper boat',
    steps: [
      { kind: 'sum', at: 5, side: -1, grip: 'top' },
      { kind: 'sum', at: 15, side: 1, grip: 'top' },
      { kind: 'diff', at: 5, side: 1, grip: 'top' },
      { kind: 'diff', at: -5, side: -1, grip: 'top' },
      { kind: 'x', at: half, side: 1, grip: 'all' },
    ],
  },
];
