import { flatSide, mirroredPoint } from './SheetPiece';
import type { SheetPiece } from './SheetPiece';
import { isMirror, lineNormal, UNITS_PER_CELL } from './lattice';
import type { LineKind, MirrorLine } from './lattice';

/**
 * Turns a dragged point into a fold. Moving a point of paper from A to B creases
 * it along the line halfway between them, so the guide finds that line and snaps
 * it to the nearest grid line. Hands stay rough; the paper lands exact.
 */
export interface FoldGuess {
  line: MirrorLine;
  /** The side of the line the grabbed point started on. */
  side: number;
  /** Where the grabbed point lands, in flat metres. */
  target: { x: number; z: number };
  /** How far the point is from landing, in metres. */
  miss: number;
}

const KINDS: readonly LineKind[] = ['x', 'z', 'sum', 'diff'];
/** The smallest drag that counts as trying to fold. */
const MIN_DRAG = 0.5;
/**
 * How close to the paper's middle a fold locks onto it, in steps between lines. Under
 * one step, so the line beside the middle can still be chosen: at 0.7 m, a plane's
 * wing crease 0.5 m off its middle could never be folded.
 */
const HALVING_PULL = 0.8;

export function guessFold(piece: SheetPiece, from: { x: number; z: number }, to: { x: number; z: number }): FoldGuess | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const drag = Math.hypot(dx, dz);
  if (drag < MIN_DRAG) return null;

  // Of the four line directions, the fold's is the one most facing along the drag.
  let kind: LineKind = 'x';
  let best = -1;
  for (const candidate of KINDS) {
    const [nx, nz] = lineNormal(candidate);
    const facing = Math.abs(dx * nx + dz * nz) / drag;
    if (facing > best) {
      best = facing;
      kind = candidate;
    }
  }

  const middleX = piece.toUnits((from.x + to.x) / 2);
  const middleZ = piece.toUnits((from.z + to.z) / 2);
  const raw = kind === 'x' ? middleX : kind === 'z' ? middleZ : kind === 'sum' ? middleX + middleZ : middleX - middleZ;
  // Axis lines repeat every half-cell, diagonals every other one.
  const step = kind === 'x' || kind === 'z' ? UNITS_PER_CELL : UNITS_PER_CELL * 2;
  // Halving the paper is what people are nearly always aiming for, so it is sticky.
  const centre = paperCentre(piece, kind);
  const aim = Math.abs(raw - centre) < HALVING_PULL * step ? centre : raw;
  const line: MirrorLine = { kind, c: Math.round(aim / step) * step };
  if (!isMirror(line)) return null;

  const side = flatSide(piece, line, from.x, from.z);
  if (side === 0) return null;
  const target = mirroredPoint(piece, line, from.x, from.z);
  return { line, side: Math.sign(side), target, miss: Math.hypot(to.x - target.x, to.z - target.z) };
}

/** The middle of the paper as it lies now, measured across a line direction. */
function paperCentre(piece: SheetPiece, kind: LineKind): number {
  const { at, faces } = piece.book;
  let low = Infinity;
  let high = -Infinity;
  for (const f of faces) {
    for (let k = 0; k < 3; k++) {
      const x = at[f * 6 + k * 2] as number;
      const z = at[f * 6 + k * 2 + 1] as number;
      const value = kind === 'x' ? x : kind === 'z' ? z : kind === 'sum' ? x + z : x - z;
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
  }
  return (low + high) / 2;
}

/** The two ends of a line where it crosses the sheet, in flat metres. */
export function lineAcrossSheet(piece: SheetPiece, line: MirrorLine): [{ x: number; z: number }, { x: number; z: number }] {
  const span = piece.book.span;
  const metres = (a: number, b: number) => ({ x: piece.toMetres(a), z: piece.toMetres(b) });
  switch (line.kind) {
    case 'x':
      return [metres(line.c, 0), metres(line.c, span)];
    case 'z':
      return [metres(0, line.c), metres(span, line.c)];
    case 'sum': {
      const low = Math.max(0, line.c - span);
      const high = Math.min(span, line.c);
      return [metres(low, line.c - low), metres(high, line.c - high)];
    }
    case 'diff': {
      const low = Math.max(0, line.c);
      const high = Math.min(span, span + line.c);
      return [metres(low, low - line.c), metres(high, high - line.c)];
    }
  }
}
