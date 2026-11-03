import type { SheetDefinition } from '@/core/asset/sheetTypes';
import { aimFold, applyLift, liftFor, PlanCache } from '@/core/fold/foldIntent';
import type { FoldAim, Frame } from '@/core/fold/foldIntent';
import type { MirrorLine } from '@/core/fold/lattice';
import { flatOf, nearestPaper, outerFace, paperUnder, weightsIn, worldOf } from '@/core/fold/paperPoints';
import { flatSide, SheetPiece } from '@/core/fold/SheetPiece';
import { StrainClock } from '@/core/fold/soft/SoftSheet';
import type { Body, Pin } from '@/core/fold/soft/SoftSheet';
import { RULES } from './rules';

/**
 * The world of the experiment: beings and paper, stepped at a fixed rate from
 * nothing but each being's intent. No three.js and no clock of its own, so the
 * same inputs give the same world, which is what multiplayer will need.
 */

/** What one being is told to do for one step. Edge actions are true on the step they happen. */
export interface Intent {
  /** Where to walk, in world x and z, length up to 1. */
  move: { x: number; z: number };
  run: boolean;
  /** Take hold of paper, or let go if holding. */
  grab: boolean;
  /** Slap the held paper down: crease it, or open it back out. */
  press: boolean;
  /** Metres to raise the hands, or lower them if negative. */
  raise: number;
}

export const IDLE: Intent = { move: { x: 0, z: 0 }, run: false, grab: false, press: false, raise: 0 };

/** A hand on paper. */
export interface Grip {
  piece: SheetPiece;
  pin: Pin;
  /** The face taken hold of, and where on the flat sheet. */
  face: number;
  flat: { x: number; z: number };
  /** Grabbed from underneath. */
  under: boolean;
  /** True once the hand has moved the paper. */
  carried: boolean;
  /** The paper as it lay when carrying began, to read the hand against. */
  lay: Frame | null;
  /** What the hand lifted off the stack when it began carrying. */
  flap: ReadonlySet<number>;
  /** The fold the hand is lining up right now, if any. */
  aim: FoldAim | null;
  /** The flap this hand could open back out, and the crease it turns on. */
  opening: { faces: ReadonlySet<number>; line: MirrorLine } | null;
  /** True while the hand has pulled that flap back across its crease. */
  unfolding: boolean;
  plans: PlanCache;
}

/** Feet planted on paper, holding it down. */
interface Foothold {
  piece: SheetPiece;
  pin: Pin;
  /** Where on the ground the feet were planted. */
  x: number;
  z: number;
}

export type Action = 'idle' | 'walk' | 'run' | 'reach' | 'hold' | 'strain' | 'press' | 'stumble';

export interface Being {
  readonly id: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Radians around y; 0 faces +z. */
  facing: number;
  handHeight: number;
  /** Where the hands are trying to be this step. */
  hand: { x: number; y: number; z: number };
  grip: Grip | null;
  foothold: Foothold | null;
  readonly body: Body;
  readonly strain: StrainClock;
  /** How far the paper held this being back this step. */
  heldBack: number;
  /** Seconds since the paper last held this being back, counting down: taut paper stays taut between steps. */
  taut: number;
  pushing: boolean;
  /** How far it walked this step, in x and z. */
  stepX: number;
  stepZ: number;
  /** Seconds left of a one-off action. */
  reaching: number;
  pressing: number;
  stumbling: number;
}

export type SimEventKind = 'grab' | 'whiff' | 'release' | 'slip' | 'press' | 'unfold' | 'refuse' | 'wobble';

/** Something worth showing: what happened, to whom, where, and why if refused. */
export interface SimEvent {
  kind: SimEventKind;
  being: number;
  x: number;
  y: number;
  z: number;
  reason?: string;
}

export const REFUSALS: Record<string, string> = {
  'not-a-grid-line': 'There is no fold line there.',
  'nothing-moves': 'Nothing on that side to fold.',
  'nothing-stays': 'All the paper would move.',
  'layers-cross': 'Layers would have to pass through each other.',
  held: 'That paper is held down.',
  covered: 'Something is lying on that flap.',
  standing: 'Someone is standing on that paper.',
  'not-lined-up': 'Bring the paper over a fold line first.',
};

export const STEP = 1 / 60;

export class GameSim {
  readonly beings: Being[] = [];
  readonly pieces: SheetPiece[] = [];
  /** Things that happened since the view last read them. */
  readonly events: SimEvent[] = [];
  private readonly bodies: Body[] = [];
  private readonly point = { x: 0, y: 0, z: 0 };

  constructor(definition: SheetDefinition, starts: readonly { x: number; z: number; facing: number }[]) {
    this.pieces.push(new SheetPiece(definition, undefined, {}, undefined, [], this.bodies));
    starts.forEach((start, id) => {
      const body: Body = { x: start.x, z: start.z, bottom: RULES.bodyBottom, top: RULES.bodyTop, radius: RULES.bodyRadius };
      this.bodies.push(body);
      this.beings.push({
        id,
        x: start.x,
        z: start.z,
        vx: 0,
        vz: 0,
        facing: start.facing,
        handHeight: RULES.handRest,
        hand: { x: start.x, y: RULES.handRest, z: start.z },
        grip: null,
        foothold: null,
        body,
        strain: new StrainClock(),
        heldBack: 0,
        taut: 0,
        pushing: false,
        stepX: 0,
        stepZ: 0,
        reaching: 0,
        pressing: 0,
        stumbling: 0,
      });
    });
  }

  /** Advances the world one fixed step. Intents line up with beings; missing ones idle. */
  step(intents: readonly Intent[]): void {
    const dt = STEP;
    this.beings.forEach((being, i) => this.act(being, intents[i] ?? IDLE, dt));
    this.separate();
    for (const being of this.beings) {
      being.body.x = being.x;
      being.body.z = being.z;
      this.plantFeet(being);
      this.aimHands(being);
    }
    for (const piece of this.pieces) piece.step(dt);
    this.beings.forEach((being, i) => this.feelPaper(being, intents[i] ?? IDLE, dt));
  }

  /** Which way a being would move for an intent, and the one-off actions it asks for. */
  private act(being: Being, intent: Intent, dt: number): void {
    being.reaching = Math.max(0, being.reaching - dt);
    being.pressing = Math.max(0, being.pressing - dt);
    being.stumbling = Math.max(0, being.stumbling - dt);

    // Stumbling, a being is carried by its fall and takes no orders.
    const steering = being.stumbling === 0;
    const length = Math.min(1, Math.hypot(intent.move.x, intent.move.z));
    const thick = being.grip ? Math.sqrt(being.grip.piece.book.depth(being.grip.face)) : 1;
    const pace = (intent.run ? RULES.runSpeed : RULES.walkSpeed) * (being.grip ? RULES.carryingPace / thick : 1);
    const wantX = steering && length > 0 ? (intent.move.x / Math.hypot(intent.move.x, intent.move.z)) * length * pace : 0;
    const wantZ = steering && length > 0 ? (intent.move.z / Math.hypot(intent.move.x, intent.move.z)) * length * pace : 0;
    const k = 1 - Math.exp(-RULES.acceleration * dt);
    being.vx += (wantX - being.vx) * k;
    being.vz += (wantZ - being.vz) * k;
    being.stepX = being.vx * dt;
    being.stepZ = being.vz * dt;
    being.x += being.stepX;
    being.z += being.stepZ;

    // Holding paper, a being faces it; otherwise it faces where it is going.
    let face: number | null = null;
    if (being.grip) face = Math.atan2(being.grip.pin.heldX - being.x, being.grip.pin.heldZ - being.z);
    else if (Math.hypot(being.vx, being.vz) > 0.2) face = Math.atan2(being.vx, being.vz);
    if (face !== null) {
      const turn = Math.atan2(Math.sin(face - being.facing), Math.cos(face - being.facing));
      being.facing += Math.max(-RULES.turnRate * dt, Math.min(RULES.turnRate * dt, turn));
    }

    being.handHeight = Math.max(RULES.handLowest, Math.min(RULES.handHighest, being.handHeight + intent.raise));
    if (!steering) return;
    if (intent.grab) {
      if (being.grip) this.letGo(being);
      else this.grab(being);
    }
    if (intent.press && being.grip) this.press(being);
  }

  /** Beings cannot stand inside each other. */
  private separate(): void {
    const gap = RULES.bodyRadius * 2;
    for (let i = 0; i < this.beings.length; i++) {
      for (let j = i + 1; j < this.beings.length; j++) {
        const a = this.beings[i] as Being, b = this.beings[j] as Being;
        const dx = b.x - a.x, dz = b.z - a.z;
        const distance = Math.hypot(dx, dz);
        if (distance >= gap || distance === 0) continue;
        const push = (gap - distance) / 2 / distance;
        a.x -= dx * push;
        a.z -= dz * push;
        b.x += dx * push;
        b.z += dz * push;
      }
    }
  }

  // ---- Hands ----

  /** Closes the hands on the nearest paper in reach, or on nothing. */
  private grab(being: Being): void {
    const at = {
      x: being.x + Math.sin(being.facing) * RULES.grabAhead,
      y: RULES.grabHeight,
      z: being.z + Math.cos(being.facing) * RULES.grabAhead,
    };
    being.reaching = RULES.reachSeconds;
    let found: { piece: SheetPiece; tri: number; b0: number; b1: number; b2: number; distance: number } | null = null;
    for (const piece of this.pieces) {
      const near = nearestPaper(piece, at, RULES.grabReach);
      if (near && (!found || near.distance < found.distance)) found = { piece, ...near };
    }
    if (!found) {
      this.emit('whiff', being, at);
      return;
    }
    const { piece } = found;
    worldOf(piece, found, this.point);
    // Reaching down onto paper takes the top layer; reaching up under it, the bottom one.
    const under = this.point.y > being.handHeight + 0.2;
    const face = outerFace(piece, found.tri, !under);
    const pin = piece.soft.addPin(found.tri, found.b0, found.b1, found.b2);
    being.grip = {
      piece,
      pin,
      face,
      flat: flatOf(piece, found),
      under,
      carried: false,
      lay: null,
      flap: new Set(),
      aim: null,
      opening: piece.openingAt(face, under),
      unfolding: false,
      plans: new PlanCache(),
    };
    being.handHeight = RULES.handRest;
    this.emit('grab', being, this.point);
  }

  /** Opens the hands. Paper lifted for this hand drops back into its stack if no one else lifted any. */
  private letGo(being: Being, quietly = false): void {
    const grip = being.grip;
    if (!grip) return;
    being.grip = null;
    being.strain.reset();
    grip.piece.soft.removePin(grip.pin);
    if (!quietly) this.emit('release', being, { x: grip.pin.heldX, y: grip.pin.heldY, z: grip.pin.heldZ });
    const others = this.beings.some((b) => b.grip?.piece === grip.piece && b.grip.carried);
    if (!others && grip.piece.pulling) {
      grip.piece.settle();
      this.regrip(grip.piece);
    }
  }

  /** Where every hand on paper is trying to be, and what it is lining up. */
  private aimHands(being: Being): void {
    const reach = being.grip ? RULES.arm : RULES.grabAhead;
    being.hand.x = being.x + Math.sin(being.facing) * reach;
    being.hand.y = being.handHeight;
    being.hand.z = being.z + Math.cos(being.facing) * reach;
    const grip = being.grip;
    if (!grip) return;
    const { piece, pin } = grip;
    pin.x = being.hand.x;
    pin.y = being.hand.y;
    pin.z = being.hand.z;

    if (!grip.carried) {
      worldOf(piece, pin, this.point);
      if (Math.hypot(pin.x - this.point.x, pin.y - this.point.y, pin.z - this.point.z) < RULES.carryStart) return;
      // The hand starts carrying: a flap on a stack comes up off it, as in the Lab.
      grip.carried = true;
      if (piece.book.depth(grip.face) > 1 && !piece.pulling && piece.peel(grip.face, grip.under)) this.regrip(piece);
      grip.lay = piece.frameNow(piece.lifted);
      grip.flap = new Set(piece.lifted);
    }
    const lay = grip.lay as Frame;
    grip.aim = aimFold(piece, lay, grip.flat, being.hand, [grip.face], grip.plans, String(being.id));
    // Pulled back across the crease of the flap it holds, the hand is opening that flap out.
    const { opening } = grip;
    grip.unfolding = false;
    if (opening && grip.aim) {
      const now = flatSide(piece, opening.line, grip.aim.aimedAt.x, grip.aim.aimedAt.z);
      const was = flatSide(piece, opening.line, grip.flat.x, grip.flat.z);
      grip.unfolding = Math.sign(now) !== Math.sign(was) && now !== 0;
    }
    // Held by its edge, a flap turns freely on its crease, as it opens; once another fold
    // is lined up, exactly what that fold moves lifts instead.
    const folding = !grip.unfolding && grip.aim?.reachable;
    const lift = opening && !folding ? { paper: opening.faces, line: opening.line, under: grip.under } : liftFor(grip.aim, being.handHeight - RULES.handRest, grip.flap, grip.under);
    if (applyLift(piece, lift)) this.regrip(piece);
  }

  /** Puts the held paper down hard: creases it on the lined-up fold, or opens a flap out. */
  private press(being: Being): void {
    const grip = being.grip as Grip;
    const { piece } = grip;
    being.pressing = RULES.pressSeconds;
    const at = { x: grip.pin.heldX, y: 0, z: grip.pin.heldZ };
    if (grip.unfolding && grip.opening) {
      if (this.standingOn(piece, grip.opening.faces, being)) {
        this.emit('refuse', being, at, REFUSALS['standing']);
        return;
      }
      const opened = grip.opening.faces;
      const plan = piece.unfold(grip.face, grip.under, true);
      if (!plan || plan.failure) {
        this.emit('refuse', being, at, REFUSALS[plan?.failure ?? 'covered']);
        return;
      }
      this.afterChange(piece, opened);
      this.emit('unfold', being, at);
      return;
    }
    const aim = grip.aim;
    if (!aim || !aim.reachable) {
      this.emit('refuse', being, at, REFUSALS[aim?.plan.failure ?? 'not-lined-up']);
      return;
    }
    if (this.standingOn(piece, aim.plan.moved, being)) {
      this.emit('refuse', being, at, REFUSALS['standing']);
      return;
    }
    const plan = piece.fold({ line: aim.guess.line, side: aim.guess.side, seeds: [grip.face], landing: aim.landing });
    if (plan.failure) {
      this.emit('refuse', being, at, REFUSALS[plan.failure]);
      return;
    }
    this.afterChange(piece, plan.moved);
    this.emit('press', being, at);
  }

  /** True if any being but this one has its feet on paper among these faces. */
  private standingOn(piece: SheetPiece, faces: ReadonlySet<number>, except: Being): boolean {
    return this.beings.some((b) => {
      if (b === except || b.foothold?.piece !== piece) return false;
      const tri = b.foothold.pin.tri;
      return piece.book.faces.some((f) => piece.soft.mesh.faceTri[f] === tri && faces.has(f));
    });
  }

  /** Paper moved by a fold: hands on it open, feet replant, and every other hold takes hold again. */
  private afterChange(piece: SheetPiece, moved: ReadonlySet<number>): void {
    for (const being of this.beings) {
      if (being.grip?.piece === piece && moved.has(being.grip.face)) {
        being.grip = null;
        being.strain.reset();
      }
      if (being.foothold?.piece === piece) being.foothold = null;
    }
    this.regrip(piece);
  }

  /** The cloth was rebuilt, so every hand takes a fresh hold at the same flat point. */
  private regrip(piece: SheetPiece): void {
    const { soft, book } = piece;
    for (const being of this.beings) {
      const grip = being.grip;
      if (grip?.piece === piece) {
        if (!book.faces.includes(grip.face)) {
          being.grip = null;
          continue;
        }
        // A hand on paper that just lifted off from under it stays with the paper it held.
        const tri = soft.mesh.faceTri[grip.face] as number;
        const [b0, b1, b2] = weightsIn(piece, tri, grip.flat);
        const old = grip.pin;
        grip.pin = soft.addPin(tri, b0, b1, b2);
        Object.assign(grip.pin, { x: old.x, y: old.y, z: old.z, heldX: old.heldX, heldY: old.heldY, heldZ: old.heldZ });
      }
      if (being.foothold?.piece === piece) being.foothold = null;
    }
  }

  // ---- Feet ----

  /** Feet on paper lying on the ground hold it down, planted afresh as the being walks. */
  private plantFeet(being: Being): void {
    const hold = being.foothold;
    if (hold && Math.hypot(being.x - hold.x, being.z - hold.z) < RULES.footStep) return;
    if (hold) hold.piece.soft.removePin(hold.pin);
    being.foothold = null;
    if (being.stumbling > 0) return;
    for (const piece of this.pieces) {
      const under = paperUnder(piece, being.x, being.z);
      if (!under || under.y > RULES.footReach) continue;
      const pin = piece.soft.addPin(under.tri, under.b0, under.b1, under.b2);
      // Feet press down; they do not stop other hands reaching, and paper can slide from under them.
      pin.strength = RULES.footStrength;
      pin.anchoring = false;
      being.foothold = { piece, pin, x: being.x, z: being.z };
      return;
    }
  }

  // ---- After the paper has moved ----

  /** Hands held back by taut paper hold their being back too, and slip if it keeps pulling. */
  private feelPaper(being: Being, intent: Intent, dt: number): void {
    being.heldBack = 0;
    being.pushing = false;
    being.taut = Math.max(0, being.taut - dt);
    const grip = being.grip;
    if (grip) {
      // Taut paper stops a being going further, but never drags one along: it undoes
      // only the part of this step's walk that took the hands past where paper allows.
      const walked = Math.hypot(being.stepX, being.stepZ);
      if (walked > 0) {
        const ux = being.stepX / walked, uz = being.stepZ / walked;
        const past = (being.hand.x - grip.pin.heldX) * ux + (being.hand.z - grip.pin.heldZ) * uz;
        const back = Math.min(walked, past);
        if (back > RULES.heldBack) {
          being.x -= ux * back;
          being.z -= uz * back;
          // Like a wall: what was carrying it away is gone, so it does not jerk the paper again next step.
          const outward = Math.max(0, being.vx * ux + being.vz * uz);
          being.vx -= ux * outward;
          being.vz -= uz * outward;
          being.heldBack = back;
          being.taut = RULES.tautMemory;
        }
      }
      // Still pulling away from the paper it holds, while the paper is taut.
      const ax = being.x - grip.pin.heldX, az = being.z - grip.pin.heldZ;
      const away = Math.hypot(ax, az) || 1;
      being.pushing = being.taut > 0 && (intent.move.x * ax + intent.move.z * az) / away > 0.3;
      if (being.strain.update(being.pushing ? Infinity : 0, dt)) {
        // Paper never tears: the grip gives, and the being pitches forward.
        const away = Math.hypot(intent.move.x, intent.move.z) || 1;
        this.letGo(being, true);
        this.emit('slip', being, being.hand);
        being.stumbling = RULES.stumbleSeconds;
        being.vx = (intent.move.x / away) * RULES.stumbleSpeed;
        being.vz = (intent.move.z / away) * RULES.stumbleSpeed;
      }
    }
    const hold = being.foothold;
    if (hold) {
      worldOf(hold.piece, hold.pin, this.point);
      if (Math.hypot(this.point.x - hold.pin.heldX, this.point.z - hold.pin.heldZ) > RULES.footSlide) {
        // The paper is dragged out from under the feet: they lose it and wobble.
        hold.piece.soft.removePin(hold.pin);
        being.foothold = null;
        being.stumbling = Math.max(being.stumbling, RULES.wobbleSeconds);
        this.emit('wobble', being, this.point);
      }
    }
  }

  /** What a being is doing, for its body to show. */
  action(being: Being): Action {
    if (being.stumbling > 0) return 'stumble';
    if (being.pressing > 0) return 'press';
    if (being.grip && being.pushing) return 'strain';
    if (being.reaching > 0) return 'reach';
    if (being.grip) return 'hold';
    const speed = Math.hypot(being.vx, being.vz);
    return speed > RULES.walkSpeed * 1.2 ? 'run' : speed > 0.25 ? 'walk' : 'idle';
  }

  private emit(kind: SimEventKind, being: Being, at: { x: number; y: number; z: number }, reason?: string): void {
    this.events.push({ kind, being: being.id, x: at.x, y: at.y, z: at.z, ...(reason ? { reason } : {}) });
  }
}
