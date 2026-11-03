import { describe, expect, it } from 'vitest';
import { getSheet } from '@/core/asset/sheets';
import { worldOf } from '@/core/fold/paperPoints';
import { GameSim, IDLE } from '@/game/sim/GameSim';
import type { Being, Intent } from '@/game/sim/GameSim';
import { RULES } from '@/game/sim/rules';

/**
 * Every case the experiment has to handle, played headless with the real sim.
 * The sheet is 10 m, centred on the origin; beings are 1 m.
 */
const EAST = Math.PI / 2;
const WEST = -Math.PI / 2;
const sheet = getSheet('sheet.standard');

const make = (...starts: { x: number; z: number; facing: number }[]) => new GameSim(sheet, starts);
const walk = (x: number, z: number, run = false): Intent => ({ ...IDLE, move: { x, z }, run });
const grab: Intent = { ...IDLE, grab: true };
const press: Intent = { ...IDLE, press: true };
const raise = (by: number): Intent => ({ ...IDLE, raise: by });

/** Runs some steps, each being doing what its intent function says. */
function play(sim: GameSim, steps: number, ...intents: ((step: number) => Intent)[]): void {
  for (let i = 0; i < steps; i++) sim.step(intents.map((f) => f(i)));
}
const still = () => IDLE;
const once = (intent: Intent) => (step: number) => (step === 0 ? intent : IDLE);
const kinds = (sim: GameSim) => sim.events.map((e) => e.kind);
const top = (sim: GameSim) => Math.max(...sim.pieces.flatMap((p) => Array.from(p.soft.x).filter((_, i) => i % 3 === 1)));
const heldPoint = (being: Being) => {
  const out = { x: 0, y: 0, z: 0 };
  if (being.grip) worldOf(being.grip.piece, being.grip.pin, out);
  return out;
};

describe('a being and the paper', () => {
  it('closes its hands on nothing when no paper is in reach', () => {
    const sim = make({ x: -8, z: 0, facing: EAST });
    play(sim, 5, once(grab));
    expect(sim.beings[0]?.grip).toBeNull();
    expect(kinds(sim)).toContain('whiff');
  });

  it('takes hold of flat paper and lifts it to its hands', () => {
    const sim = make({ x: -5.4, z: 0, facing: EAST });
    play(sim, 90, once(grab));
    const being = sim.beings[0] as Being;
    expect(being.grip).not.toBeNull();
    expect(heldPoint(being).y).toBeGreaterThan(0.3);
  });

  it('lets two beings hold the same paper', () => {
    const sim = make({ x: -5.4, z: 0, facing: EAST }, { x: -5.4, z: 0.6, facing: EAST });
    play(sim, 30, once(grab), once(grab));
    expect(sim.beings.every((b) => b.grip)).toBe(true);
  });

  it('drags paper along when walking away holding it', () => {
    const sim = make({ x: -5.4, z: 0, facing: EAST });
    play(sim, 20, once(grab));
    const start = heldPoint(sim.beings[0] as Being).x;
    play(sim, 120, () => walk(-1, 0));
    expect(start - heldPoint(sim.beings[0] as Being).x).toBeGreaterThan(1);
  });

  it('holds back a being running off while two others hold the far edge, then its grip slips without tearing', () => {
    const sim = make({ x: -5.4, z: 0, facing: EAST }, { x: 5.4, z: -2, facing: WEST }, { x: 5.4, z: 2, facing: WEST });
    play(sim, 20, once(grab), once(grab), once(grab));
    expect(sim.beings.every((b) => b.grip)).toBe(true);
    let furthest = 0, strained = false, worstStretch = 0;
    for (let i = 0; i < 150 && sim.beings[0]?.grip; i++) {
      sim.step([walk(-1, 0, true), IDLE, IDLE]);
      const runner = sim.beings[0] as Being;
      furthest = Math.min(furthest, runner.x);
      strained ||= sim.action(runner) === 'strain';
      worstStretch = Math.max(worstStretch, sim.pieces[0]?.soft.stretch() ?? 0);
    }
    console.log('runner got to x', furthest.toFixed(2), 'stretch at worst', (worstStretch * 100).toFixed(1), '%');
    expect(strained).toBe(true);
    expect(sim.beings[0]?.grip).toBeNull();
    expect(kinds(sim)).toContain('slip');
    expect(furthest).toBeGreaterThan(-6.6);
    expect(worstStretch).toBeLessThan(0.03);
    // The other two still hold their edge.
    expect(sim.beings[1]?.grip && sim.beings[2]?.grip).toBeTruthy();
  });

  it('lets two beings pull apart until one grip gives, and nothing tears', () => {
    const sim = make({ x: -5.4, z: 0, facing: EAST }, { x: 5.4, z: 0, facing: WEST });
    play(sim, 20, once(grab), once(grab));
    let worstStretch = 0;
    for (let i = 0; i < 180 && sim.beings.every((b) => b.grip); i++) {
      sim.step([walk(-1, 0, true), walk(1, 0, true)]);
      worstStretch = Math.max(worstStretch, sim.pieces[0]?.soft.stretch() ?? 0);
    }
    expect(sim.beings.some((b) => !b.grip)).toBe(true);
    expect(worstStretch).toBeLessThan(0.03);
  });

  it('lifts the sheet between two beings, and lets it float down flat when let go', () => {
    const sim = make({ x: -5.4, z: 0, facing: EAST }, { x: 5.4, z: 0, facing: WEST });
    play(sim, 20, once(grab), once(grab));
    play(sim, 120, (step) => (step < 30 ? raise(0.04) : IDLE), (step) => (step < 30 ? raise(0.04) : IDLE));
    expect(top(sim)).toBeGreaterThan(1.1);
    const mean = () => {
      const x = sim.pieces[0]?.soft.x ?? new Float64Array();
      let sum = 0;
      for (let i = 1; i < x.length; i += 3) sum += x[i] as number;
      return sum / (x.length / 3);
    };
    const held = mean();
    play(sim, 300, once(grab), once(grab));
    expect(sim.beings.every((b) => !b.grip)).toBe(true);
    // It comes down. Stiff paper can leave a ridge standing where it was held up, like card.
    expect(mean()).toBeLessThan(held * 0.6);
    expect(top(sim)).toBeLessThan(1.1);
  });

  /**
   * The crew folds the sheet in half: one holds the far edge still, the other takes
   * the near corner and carries it along beside the sheet, then presses it down.
   * Alone, a being drags the whole sheet along, and folds it over its own head.
   */
  const foldInHalf = () => {
    const sim = make({ x: -5.35, z: -5.35, facing: Math.PI / 4 }, { x: 5.4, z: 0, facing: WEST });
    play(sim, 20, once(grab), once(grab));
    play(sim, 900, () => ((sim.beings[0] as Being).x < 4.6 ? walk(1, 0) : IDLE), still);
    return sim;
  };

  it('folds the sheet in half when a corner is carried over and pressed down', () => {
    const sim = foldInHalf();
    expect(sim.beings[0]?.grip?.aim?.reachable).toBe(true);
    play(sim, 60, once(press), still);
    expect(kinds(sim)).toContain('press');
    expect(sim.pieces[0]?.book.tallest).toBe(2);
    expect(sim.beings[0]?.grip).toBeNull();
  });

  it('refuses a fold while someone stands on the paper that would move', () => {
    // A strip along the west edge is folded over, and someone stands on it 2 m along.
    const sim = make({ x: -5.4, z: 0, facing: EAST }, { x: -4.6, z: 2, facing: EAST });
    play(sim, 20, once(grab), still);
    expect(sim.beings[1]?.foothold).not.toBeNull();
    play(sim, 200, () => ((sim.beings[0] as Being).x < -3.3 ? walk(1, 0) : IDLE), still);
    expect(sim.beings[0]?.grip?.aim?.reachable).toBe(true);
    play(sim, 10, once(press), still);
    const refusal = sim.events.find((e) => e.kind === 'refuse');
    expect(refusal?.reason).toContain('standing');
    expect(sim.pieces[0]?.book.tallest).toBe(1);
  });

  it('opens a fold back out when its flap is pulled back across the crease and pressed', () => {
    const sim = foldInHalf();
    play(sim, 60, once(press), still);
    expect(sim.pieces[0]?.book.tallest).toBe(2);
    // Take the corner of the flap that just landed, and carry it back the way it came.
    play(sim, 20, once(grab), still);
    expect(sim.beings[0]?.grip?.opening).not.toBeNull();
    play(sim, 900, () => ((sim.beings[0] as Being).x > -4.6 ? walk(-1, 0) : IDLE), still);
    expect(sim.beings[0]?.grip?.unfolding).toBe(true);
    play(sim, 60, once(press), still);
    expect(kinds(sim)).toContain('unfold');
    expect(sim.pieces[0]?.book.tallest).toBe(1);
  });

  it('holds paper down underfoot, until it is dragged out from under and the being wobbles', () => {
    const sim = make({ x: -5.4, z: 0, facing: EAST }, { x: -3, z: 0.8, facing: EAST });
    play(sim, 20, once(grab), still);
    expect(sim.beings[1]?.foothold).not.toBeNull();
    play(sim, 240, () => walk(-1, 0, true), still);
    expect(kinds(sim)).toContain('wobble');
  });

  it('never lets hanging paper pass through a being walking into it', () => {
    const sim = make({ x: -5.4, z: -5.4, facing: EAST }, { x: 5.4, z: -5.4, facing: WEST }, { x: 0, z: -8, facing: 0 });
    play(sim, 20, once(grab), once(grab), still);
    play(sim, 60, (i) => (i < 30 ? raise(0.04) : IDLE), (i) => (i < 30 ? raise(0.04) : IDLE), still);
    let deepest = 0;
    for (let i = 0; i < 180; i++) {
      sim.step([IDLE, IDLE, walk(0, 1)]);
      const walker = sim.beings[2] as Being;
      const { x } = sim.pieces[0]?.soft as { x: Float64Array };
      for (let j = 0; j < x.length; j += 3) {
        const y = x[j + 1] as number;
        if (y < RULES.bodyBottom || y > RULES.bodyTop) continue;
        deepest = Math.max(deepest, RULES.bodyRadius - Math.hypot((x[j] as number) - walker.x, (x[j + 2] as number) - walker.z));
      }
    }
    expect(deepest).toBeLessThan(0.03);
  });

  it('keeps holding still when it is not the one being steered', () => {
    const sim = make({ x: -5.4, z: 0, facing: EAST });
    play(sim, 30, once(grab));
    const being = sim.beings[0] as Being;
    const before = { x: being.x, z: being.z };
    play(sim, 120, still);
    expect(being.grip).not.toBeNull();
    expect(Math.hypot(being.x - before.x, being.z - before.z)).toBeLessThan(0.05);
  });
});
