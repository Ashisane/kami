import type { Landing } from './FoldBook';
import { guessFold } from './foldGuide';
import type { FoldGuess } from './foldGuide';
import type { MirrorLine } from './lattice';
import { readFlat } from './SheetPiece';
import type { PiecePlan, SheetPiece } from './SheetPiece';

/**
 * What a hand pulling paper is lining up: the fold that putting it down would make.
 * Shared by every way of holding paper, the Fold Lab's mouse and a being's hands,
 * so folding feels the same whoever does it. No three.js.
 */

/** How close the held point must be to its landing for a drop to crease, in metres. */
export const SNAP_RADIUS = 1.5;
/** Metres a hand is raised before it counts as holding paper up, not bringing it to a fold. */
export const HOLDING_UP = 0.5;
/** A hand this far under the paper it holds folds it underneath. */
const UNDER = -0.2;

/** Maps flat sheet metres to the world, as the paper lay at some moment. */
export type Frame = (x: number, z: number, out: Float64Array) => void;

export interface FoldAim {
  /** Where the hand is over the flat paper, and how high above it. */
  aimedAt: { x: number; z: number; height: number };
  guess: FoldGuess;
  plan: PiecePlan;
  landing: Landing;
  /** True when putting the paper down here would crease it. */
  reachable: boolean;
}

/** Keeps the last plan, because planning a fold is too slow to redo every frame for the same line. */
export class PlanCache {
  private key = '';
  private plan: PiecePlan | null = null;

  get(key: string, make: () => PiecePlan): PiecePlan {
    if (key !== this.key || !this.plan) {
      this.key = key;
      this.plan = make();
    }
    return this.plan;
  }

  /** Forgets the plan: the paper changed under it, so the same line may now be different. */
  clear(): void {
    this.key = '';
    this.plan = null;
  }
}

/**
 * Reads a hand against the paper as it lay when the pull began, and works out the
 * fold it lines up. Paper being pulled bends and rolls, and a frame refitted to it
 * each moment misread the hand by metres.
 */
export function aimFold(piece: SheetPiece, lay: Frame, from: { x: number; z: number }, hand: { x: number; y: number; z: number }, seeds: readonly number[], cache: PlanCache, owner = ''): FoldAim | null {
  const aimedAt = readFlat(lay, hand);
  const guess = guessFold(piece, from, aimedAt);
  if (!guess) return null;
  const landing: Landing = aimedAt.height < UNDER ? { kind: 'under' } : { kind: 'over' };
  const key = `${owner}:${guess.line.kind}:${guess.line.c}:${guess.side}:${landing.kind}`;
  const plan = cache.get(key, () => piece.plan({ line: guess.line, side: guess.side, seeds, landing }));
  return { aimedAt, guess, plan, landing, reachable: !plan.failure && guess.miss < SNAP_RADIUS };
}

/**
 * What a hand should have lifted off the stacks for an aim: exactly what the fold
 * would move, turning on its line, while a fold is lined up; otherwise the flap it
 * took hold of. A hand raised high is holding paper up, as when opening a wing, and
 * lifting for a fold there would break the wing apart.
 */
export function liftFor(aim: FoldAim | null, raised: number, ownFlap: ReadonlySet<number>, under: boolean): { paper: ReadonlySet<number>; line: MirrorLine | null; under: boolean } | null {
  if (aim?.reachable && raised < HOLDING_UP) return { paper: aim.plan.moved, line: aim.guess.line, under: aim.landing.kind === 'under' };
  if (ownFlap.size > 0) return { paper: ownFlap, line: null, under };
  return null;
}

/** Lifts paper for a hand, unless exactly that is lifted already. True if the cloth was rebuilt. */
export function applyLift(piece: SheetPiece, lift: ReturnType<typeof liftFor>): boolean {
  if (!lift) return false;
  const { lifted } = piece;
  if (lifted.size === lift.paper.size && [...lift.paper].every((f) => lifted.has(f))) return false;
  piece.liftFor(lift.paper, lift.line, lift.under);
  return true;
}
