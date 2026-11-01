import type { FoldBook, FoldPlan, Landing } from './FoldBook';
import { UNITS_PER_CELL } from './lattice';
import type { LineKind, MirrorLine } from './lattice';
import { reshape } from './reshape';
import type { ReshapeFailure } from './reshape';

/**
 * Folds written down, so a design can be replayed exactly. This is also what a
 * network message will be: a whole piece of origami fits in a few dozen bytes.
 *
 * Every position is in metres from the sheet's first corner, as the paper lies
 * at that moment.
 */
export interface FoldStep {
  action: 'fold';
  label: string;
  kind: LineKind;
  /** Where the line sits. */
  at: number;
  /** Which side moves: +1 or -1. */
  side: number;
  /** `all` grips every layer, `top` and `bottom` grip only that outer layer. */
  grip: 'all' | 'top' | 'bottom';
  /** Grips one spot on that outer layer, rather than everything on the moving side. */
  hold?: [number, number];
  /** How many layers to pinch at that spot, counted in from the outside. */
  depth?: number;
  /** Grips every layer that started on this part of the flat sheet, like one half of a plane. */
  from?: { axis: 'x' | 'z'; min?: number; max?: number };
  landing?: Landing;
}

/** Cuts a strip off. A recipe keeps the largest piece. */
export interface TrimStep {
  action: 'trim';
  label: string;
  kind: 'x' | 'z';
  at: number;
  from: number;
  to: number;
}

/**
 * Opens a pocket and flattens it a new way: creases open and form all at once.
 * Lines are in metres on the flat sheet, not as the paper lies now.
 */
export interface OpenStep {
  action: 'open';
  label: string;
  changes: { kind: LineKind; at: number; crease: boolean }[];
  /** Folds this has to leave possible, which picks the right layer order. */
  ready?: FoldStep[];
}

/**
 * Opens wings out and stands the paper up on its keel, for the moment a crew holds
 * it up to harden. Shape only: the Book keeps the folds it has.
 */
export interface SpreadStep {
  action: 'spread';
  label: string;
  /** The straight crease both wings turn on, in metres as the paper lies. */
  hinge: { kind: 'x' | 'z'; at: number };
  /** A point on each wing, in metres as the paper lies, on the top or the underside. */
  wings: { at: [number, number]; under: boolean }[];
  /** Degrees each wing opens from its body. 90 is square to it. */
  angle: number;
  /** Where the hinge is held, in metres off the ground. */
  height: number;
}

export type RecipeStep = FoldStep | TrimStep | OpenStep | SpreadStep;

export interface Recipe {
  id: string;
  name: string;
  /** Where the fold sequence comes from. */
  source: string;
  /** What is left for players to do by hand. */
  finish: string;
  /** Starts with the sheet turned over, so the printed face ends up outside. */
  faceDown?: boolean;
  steps: RecipeStep[];
}

const unitsPerMetre = (book: FoldBook, size: number) => (book.cells * UNITS_PER_CELL) / size;

export function toMirrorLine(book: FoldBook, size: number, { kind, at }: Pick<FoldStep, 'kind' | 'at'>): MirrorLine {
  return { kind, c: Math.round(at * unitsPerMetre(book, size)) };
}

/** The faces a step's grip holds on the side that is moving. */
export function gripFaces(book: FoldBook, size: number, step: FoldStep): number[] {
  if (step.from) {
    const { axis, min = -Infinity, max = Infinity } = step.from;
    const scale = unitsPerMetre(book, size);
    const offset = axis === 'x' ? 0 : 1;
    return book.faces.filter((f) => {
      const i = f * 6 + offset;
      const value = ((book.rest[i] as number) + (book.rest[i + 2] as number) + (book.rest[i + 4] as number)) / 3 / scale;
      return value >= min && value <= max;
    });
  }
  if (step.grip === 'all') return book.faces;
  const outer = (f: number) => {
    const stack = book.stackOf(f);
    return (step.grip === 'top' ? stack[stack.length - 1] : stack[0]) === f;
  };
  const line = toMirrorLine(book, size, step);
  if (step.hold) {
    const scale = unitsPerMetre(book, size);
    const [x, z] = [step.hold[0] * scale, step.hold[1] * scale];
    let best = -1;
    let bestDistance = Infinity;
    for (const f of book.faces) {
      if (!outer(f)) continue;
      const i = f * 6;
      const cx = ((book.at[i] as number) + (book.at[i + 2] as number) + (book.at[i + 4] as number)) / 3;
      const cz = ((book.at[i + 1] as number) + (book.at[i + 3] as number) + (book.at[i + 5] as number)) / 3;
      const distance = Math.hypot(cx - x, cz - z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = f;
      }
    }
    if (best < 0) return [];
    const stack = book.stackOf(best);
    const depth = step.depth ?? 1;
    return step.grip === 'top' ? stack.slice(stack.length - depth) : stack.slice(0, depth);
  }
  return book.faces.filter((f) => outer(f) && book.plan({ line, side: step.side, seeds: [f] }).moved.size > 0);
}

export function foldRequest(book: FoldBook, size: number, step: FoldStep) {
  return { line: toMirrorLine(book, size, step), side: step.side, seeds: gripFaces(book, size, step), landing: step.landing };
}

/** Runs a fold on the Book alone, for tests and previews. */
export function applyFold(book: FoldBook, size: number, step: FoldStep): FoldPlan {
  return book.fold(foldRequest(book, size, step));
}

/** Runs an opening on the Book alone. */
export function applyOpen(book: FoldBook, size: number, step: OpenStep): ReshapeFailure | null {
  const scale = unitsPerMetre(book, size);
  const changes = step.changes.map(({ kind, at, crease }) => ({ kind, c: Math.round(at * scale), crease }));
  return reshape(book, changes, (candidate) => {
    for (const next of step.ready ?? []) {
      if (applyFold(candidate, size, next).failure) return false;
    }
    return true;
  });
}

/** Runs a whole recipe on the Book alone, and reports the first step that failed. */
export function runRecipe(recipe: Recipe, start: FoldBook, size: number): { book: FoldBook; failure: string | null } {
  let book = start;
  for (const step of recipe.steps) {
    if (step.action === 'trim') {
      const scale = unitsPerMetre(book, size);
      const pieces = book.cutAlong({ kind: step.kind, c: Math.round(step.at * scale) }, step.from * scale, step.to * scale);
      book = pieces.reduce((largest, piece) => (piece.faces.length > largest.faces.length ? piece : largest));
      continue;
    }
    if (step.action === 'open') {
      const failed = applyOpen(book, size, step);
      if (failed) return { book, failure: `${step.label}: ${failed}` };
      continue;
    }
    if (step.action === 'spread') continue;
    const plan = applyFold(book, size, step);
    if (plan.failure) return { book, failure: `${step.label}: ${plan.failure}` };
  }
  return { book, failure: null };
}

const fold = (label: string, kind: LineKind, at: number, side: number, grip: FoldStep['grip'], extra: Partial<FoldStep> = {}): FoldStep => ({
  action: 'fold', label, kind, at, side, grip, ...extra,
});

const open = (label: string, changes: OpenStep['changes'], ready?: FoldStep[]): OpenStep => ({ action: 'open', label, changes, ready });

const boatFront = fold('Fold the front bottom point up', 'diff', -5, -1, 'top', { hold: [0.6, 8.4], depth: 4 });
const boatBack = fold('Fold the back bottom point up', 'diff', -5, -1, 'bottom', { hold: [0.6, 8.4], depth: 4, landing: { kind: 'under' } });

/** Real planes and boats start from a page, taller than it is wide. */
const trim = (width: number): TrimStep => ({ action: 'trim', label: `Cut the sheet down to ${width} by 10 m`, kind: 'x', at: width, from: 0, to: 10 });

/** Every plane starts the same way: the Nakamura lock, folded in half. */
const planeBody: RecipeStep[] = [
  trim(6),
  fold('Top left corner to the centre line', 'sum', 3, -1, 'top'),
  fold('Top right corner to the centre line', 'diff', 3, 1, 'top'),
  fold('Fold the triangle down', 'z', 4, -1, 'all'),
  fold('New left corner to the centre line', 'sum', 7, -1, 'all'),
  fold('New right corner to the centre line', 'diff', -1, 1, 'all'),
  fold('Fold the tip up over them: the Nakamura lock', 'z', 7, 1, 'top', { hold: [3, 7.6] }),
  fold('Fold in half behind, with the flaps outside', 'x', 3, 1, 'all', { landing: { kind: 'under' } }),
];

/** `crease` sets the keel: it is the distance from there to the fold down the middle. */
const planeWings = (crease: number): RecipeStep[] => [
  fold('Fold the top wing down', 'x', crease, -1, 'all', { from: { axis: 'x', max: 3 } }),
  fold('Fold the other wing down', 'x', crease, -1, 'all', { from: { axis: 'x', min: 3 }, landing: { kind: 'under' } }),
];

const spreadWings = (crease: number, angle: number, at: [number, number]): SpreadStep => ({
  action: 'spread',
  label: 'Open the wings and hold it up',
  hinge: { kind: 'x', at: crease },
  wings: [{ at, under: false }, { at, under: true }],
  angle,
  height: 2.4,
});

export const RECIPES: readonly Recipe[] = [
  {
    id: 'book',
    name: 'Fold in half twice',
    source: 'Basic test',
    finish: 'Nothing left to do.',
    steps: [
      fold('Fold in half', 'x', 5, 1, 'all'),
      fold('Fold in half again', 'z', 5, 1, 'all'),
    ],
  },
  {
    id: 'letter',
    name: 'Letter fold',
    source: 'Basic test: one flap ends up between two layers',
    finish: 'Nothing left to do.',
    steps: [
      fold('Fold the right third over', 'x', 7, 1, 'top'),
      fold('Fold the left third over it', 'x', 3, -1, 'top'),
    ],
  },
  {
    id: 'blintz',
    name: 'Four corners',
    source: 'Traditional blintz fold',
    finish: 'Nothing left to do.',
    steps: [
      fold('Corner to the centre', 'sum', 5, -1, 'top'),
      fold('Corner to the centre', 'sum', 15, 1, 'top'),
      fold('Corner to the centre', 'diff', 5, 1, 'top'),
      fold('Corner to the centre', 'diff', -5, -1, 'top'),
    ],
  },
  {
    id: 'plane',
    name: 'Nakamura plane',
    source: 'Nakamura Lock, after the Southwest Adopt-A-Pilot sheet',
    finish: 'Two hands hold it up, wings open. Press Harden to keep it.',
    faceDown: true,
    steps: [...planeBody, ...planeWings(2), spreadWings(2, 118, [3, 8])],
  },
  {
    id: 'dart',
    name: 'Dart',
    source: 'The Nakamura plane with its tail cut off, so each wing comes to a point',
    finish: 'Two hands hold it up, wings open. Press Harden to keep it.',
    faceDown: true,
    steps: [
      ...planeBody,
      { action: 'trim', label: 'Cut the tail off, through every layer', kind: 'z', at: 7, from: 0, to: 6 },
      ...planeWings(2.5),
      spreadWings(2.5, 118, [3.5, 6.5]),
    ],
  },
  {
    id: 'boat',
    name: 'Paper boat',
    source: 'Traditional paper boat, after the Nottinghamshire Mayflower sheet',
    finish: 'A flat diamond, step 9 on the sheet. Pull its side tips apart by hand to open the boat.',
    steps: [
      trim(8),
      fold('Fold the top half down', 'z', 5, -1, 'all'),
      fold('Left corner to the middle, leaving a brim', 'sum', 9, -1, 'all'),
      fold('Right corner to the middle, leaving a brim', 'diff', -1, 1, 'all'),
      fold('Fold the front brim up', 'z', 9, 1, 'top'),
      fold('Fold the back brim up', 'z', 9, 1, 'bottom', { landing: { kind: 'under' } }),
      open('Open the hat and flatten it into a square', [{ kind: 'diff', at: -1, crease: false }, { kind: 'x', at: 4, crease: true }], [boatFront, boatBack]),
      boatFront,
      boatBack,
      open('Open the triangle and flatten it into a square', [{ kind: 'diff', at: -1, crease: true }, { kind: 'z', at: 5, crease: false }]),
    ],
  },
];
