import { Box3, Group, Plane, Raycaster, Vector2, Vector3 } from 'three';
import type { PerspectiveCamera, Scene } from 'three';
import type { SheetDefinition } from '@/core/asset/sheetTypes';
import { guessFold, lineAcrossSheet } from '@/core/fold/foldGuide';
import type { FoldGuess } from '@/core/fold/foldGuide';
import { FoldBook } from '@/core/fold/FoldBook';
import type { FoldFailure, FoldPlan, Landing } from '@/core/fold/FoldBook';
import { lineNormal, sideOf, UNITS_PER_CELL } from '@/core/fold/lattice';
import type { LineKind, MirrorLine } from '@/core/fold/lattice';
import { applyStep, gripFaces, RECIPES, toMirrorLine } from '@/core/fold/recipes';
import type { FoldStep } from '@/core/fold/recipes';
import { SheetPiece } from '@/core/fold/SheetPiece';
import type { Pin } from '@/core/fold/soft/SoftSheet';
import type { ScrapBurst } from '@/core/fx/ScrapBurst';
import type { Shake } from '@/core/fx/Shake';
import { SheetView } from '@/core/render/SheetView';
import { SwingFlap } from '@/core/render/SwingFlap';
import { FixedStep } from '@/core/sim/FixedStep';
import { FoldGhost, PIN_COLOURS, PinMarker } from './LabMarkers';

const MAX_PINS = 3;
/** How close the held point must get to its landing for a release to crease. */
const SNAP_RADIUS = 1.5;
/** Lifting a held point this far by wheel means "hold it up", not "fold it". */
const HOLD_LIFT = 0.6;
/** Fraction of the sheet's size around a grab that is not trusted as "staying put". */
const NEAR_GRAB = 0.42;
const FOLLOW_RATE = 16;
const MARKER_PICK_RADIUS = 0.42;
const SETTLE_STEPS = 30;

export type LabTool = 'fold' | 'cut';

/** One sheet of the paper on the bench, with its picture. */
interface Bench {
  piece: SheetPiece;
  view: SheetView;
  flap: SwingFlap;
}

/** A hand on the paper. */
interface Grip {
  slot: number;
  bench: Bench;
  pin: Pin;
  marker: PinMarker;
  face: number;
  /** Where the point sits on the flat sheet. */
  flat: { x: number; z: number };
  seeds: number[];
  near: ReadonlySet<number>;
  /** Where the hand is trying to be. */
  target: Vector3;
}

interface Snapshot {
  book: FoldBook;
  log: FoldStep[];
}

export interface LabReadout {
  pieces: number;
  faces: number;
  tallest: number;
  folds: number;
  pins: number;
  simulationMs: number;
  triangles: number;
  stretch: number;
  message: string;
  log: readonly FoldStep[];
  rigidity: number;
  cellMetres: number;
}

export class FoldLab {
  readonly group = new Group();
  private benches: Bench[] = [];
  private grips: Grip[] = [];
  private dragging: Grip | null = null;
  private liftExtra = 0;
  private cutFrom: { bench: Bench; flat: { x: number; z: number } } | null = null;
  private cutTo: { x: number; z: number } | null = null;

  private guess: FoldGuess | null = null;
  private plan: FoldPlan | null = null;
  private planKey = '';
  private moving: ReadonlySet<number> | null = null;

  private readonly clock = new FixedStep();
  private readonly ghost: FoldGhost;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly dragPlane = new Plane();
  private readonly history: Snapshot[] = [];
  private log: FoldStep[] = [];
  private rigidity = 0;
  private simulationMs = 0;
  private message = 'Drag any point of the paper.';
  private queue: FoldStep[] = [];
  private listeners = new Set<() => void>();
  tool: LabTool = 'fold';
  /** Runs nothing by itself, for repeatable screenshots. */
  frozen = false;

  constructor(
    private definition: SheetDefinition,
    scene: Scene,
    private readonly overlay: Scene,
    private readonly camera: PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
    private readonly scraps: ScrapBurst,
    private readonly shake: Shake,
    private readonly setOrbit: (enabled: boolean) => void,
  ) {
    scene.add(this.group);
    this.ghost = new FoldGhost(overlay);
    this.addBench(new SheetPiece(definition));
    canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false, capture: true });
    canvas.addEventListener('contextmenu', this.onContext);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private addBench(piece: SheetPiece): Bench {
    const view = new SheetView(piece);
    this.group.add(view.group);
    const bench = { piece, view, flap: new SwingFlap(piece, this.group) };
    this.benches.push(bench);
    return bench;
  }

  private clearBenches(): void {
    for (const grip of this.grips) grip.marker.dispose();
    this.grips = [];
    this.dragging = null;
    for (const bench of this.benches) {
      bench.flap.clear();
      bench.view.dispose();
    }
    this.benches = [];
  }

  dispose(): void {
    this.clearBenches();
    this.ghost.group.removeFromParent();
    this.group.removeFromParent();
    this.canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    this.canvas.removeEventListener('wheel', this.onWheel, { capture: true });
    this.canvas.removeEventListener('contextmenu', this.onContext);
    this.setOrbit(true);
  }

  bounds(): Box3 {
    const half = this.definition.size / 2;
    return new Box3(new Vector3(-half, 0, -half), new Vector3(half, 0.6, half));
  }

  private setMessage(message: string): void {
    this.message = message;
    this.notify();
  }

  // ---- Input ----

  private ray(event: PointerEvent | WheelEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  /** The nearest paper under the pointer. */
  private pick(): { bench: Bench; tri: number; b0: number; b1: number; b2: number; fromAbove: boolean; point: Vector3 } | null {
    const { origin, direction } = this.raycaster.ray;
    const hit = new Vector3();
    const a = new Vector3(), b = new Vector3(), c = new Vector3(), e1 = new Vector3(), e2 = new Vector3(), n = new Vector3();
    let best = Infinity;
    let result: ReturnType<FoldLab['pick']> = null;
    for (const bench of this.benches) {
      const { soft } = bench.piece;
      const { tris, triCount } = soft.mesh;
      const x = soft.x;
      for (let t = 0; t < triCount; t++) {
        a.fromArray(x, (tris[t * 3] as number) * 3);
        b.fromArray(x, (tris[t * 3 + 1] as number) * 3);
        c.fromArray(x, (tris[t * 3 + 2] as number) * 3);
        e1.subVectors(b, a);
        e2.subVectors(c, a);
        n.crossVectors(e1, e2);
        const facing = direction.dot(n);
        if (Math.abs(facing) < 1e-9) continue;
        hit.subVectors(origin, a);
        const distance = -hit.dot(n) / facing;
        if (distance <= 0 || distance >= best) continue;
        hit.copy(origin).addScaledVector(direction, distance).sub(a);
        const d00 = e1.dot(e1), d01 = e1.dot(e2), d11 = e2.dot(e2), d20 = hit.dot(e1), d21 = hit.dot(e2);
        const det = d00 * d11 - d01 * d01;
        const v = (d11 * d20 - d01 * d21) / det, w = (d00 * d21 - d01 * d20) / det;
        if (v < 0 || w < 0 || v + w > 1) continue;
        best = distance;
        result = { bench, tri: t, b0: 1 - v - w, b1: v, b2: w, fromAbove: facing < 0, point: new Vector3().copy(origin).addScaledVector(direction, distance) };
      }
    }
    return result;
  }

  private markerUnderPointer(): Grip | null {
    const point = new Vector3();
    for (const grip of this.grips) {
      point.set(grip.pin.x, grip.pin.y + 0.5, grip.pin.z);
      if (this.raycaster.ray.distanceToPoint(point) < MARKER_PICK_RADIUS) return grip;
    }
    return null;
  }

  private readonly onDown = (event: PointerEvent): void => {
    if (event.button !== 0 || this.flapsBusy()) return;
    this.ray(event);
    if (this.tool === 'cut') {
      const hit = this.pick();
      if (!hit) return;
      this.cutFrom = { bench: hit.bench, flat: this.flatPoint(hit.bench, hit.tri, hit.b0, hit.b1, hit.b2) };
      this.cutTo = null;
      this.setOrbit(false);
      event.stopPropagation();
      return;
    }

    const held = this.markerUnderPointer();
    if (held) {
      this.beginDrag(held);
      return;
    }
    const hit = this.pick();
    if (!hit) return;
    const grip = this.grab(hit, event.shiftKey);
    if (grip) this.beginDrag(grip);
  };

  private beginDrag(grip: Grip): void {
    this.dragging = grip;
    this.liftExtra = 0;
    this.setOrbit(false);
    this.dragPlane.set(new Vector3(0, 1, 0), -grip.pin.y);
    this.guess = null;
    this.plan = null;
    this.planKey = '';
    this.moving = null;
  }

  private readonly onMove = (event: PointerEvent): void => {
    if (this.tool === 'cut' && this.cutFrom) {
      this.ray(event);
      const point = this.raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -0.05), new Vector3());
      if (point) this.cutTo = { x: point.x, z: point.z };
      return;
    }
    const grip = this.dragging;
    if (!grip) return;
    this.ray(event);
    const point = this.raycaster.ray.intersectPlane(this.dragPlane, new Vector3());
    if (!point) return;
    grip.target.x = point.x;
    grip.target.z = point.z;
    // Paper is carried up and over: the further it travels, the higher the arc.
    const travelled = Math.hypot(point.x - grip.flat.x, point.z - grip.flat.z);
    grip.target.y = Math.max(0.25, Math.min(2.8, 0.25 + travelled * 0.34)) + this.liftExtra;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.dragging) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.liftExtra = Math.max(-1, Math.min(6, this.liftExtra - event.deltaY * 0.0025));
    this.dragging.target.y += -event.deltaY * 0.0025;
  };

  private readonly onContext = (event: Event): void => {
    event.preventDefault();
    this.ray(event as PointerEvent);
    const grip = this.markerUnderPointer();
    if (grip) this.release(grip);
  };

  private readonly onUp = (): void => {
    if (this.tool === 'cut' && this.cutFrom) {
      this.finishCut();
      return;
    }
    const grip = this.dragging;
    if (!grip) return;
    this.dragging = null;
    this.setOrbit(true);
    this.ghost.hide();
    const { guess, plan } = this;
    this.guess = null;
    this.plan = null;

    if (this.liftExtra < HOLD_LIFT && guess && plan && !plan.failure && guess.miss < SNAP_RADIUS) {
      this.commit(grip, guess);
      return;
    }
    if (this.liftExtra < HOLD_LIFT && (plan?.failure === 'jammed' || plan?.failure === 'layers-cross')) {
      this.shake.add(0.3);
      this.setMessage('Jammed: another layer is pinning that paper down.');
    }
    // Nothing creased, so the hand stays where it is, holding the paper.
    grip.bench.piece.settle();
    this.regrip(grip.bench);
    this.notify();
  };

  // ---- Holding paper ----

  private flatPoint(bench: Bench, tri: number, b0: number, b1: number, b2: number): { x: number; z: number } {
    const { tris, flat } = bench.piece.soft.mesh;
    const a = tris[tri * 3] as number, b = tris[tri * 3 + 1] as number, c = tris[tri * 3 + 2] as number;
    return {
      x: b0 * (flat[a * 2] as number) + b1 * (flat[b * 2] as number) + b2 * (flat[c * 2] as number),
      z: b0 * (flat[a * 2 + 1] as number) + b1 * (flat[b * 2 + 1] as number) + b2 * (flat[c * 2 + 1] as number),
    };
  }

  private faceOn(bench: Bench, tri: number, fromAbove: boolean): number {
    const { book, soft } = bench.piece;
    let best = -1;
    let bestLayer = fromAbove ? -1 : Infinity;
    for (const f of book.faces) {
      if (soft.mesh.faceTri[f] !== tri) continue;
      const layer = book.layer[f] as number;
      if (fromAbove ? layer > bestLayer : layer < bestLayer) {
        best = f;
        bestLayer = layer;
      }
    }
    return best;
  }

  private grab(hit: NonNullable<ReturnType<FoldLab['pick']>>, wholeStack: boolean): Grip | null {
    const { bench, tri, b0, b1, b2 } = hit;
    const { piece } = bench;
    const face = this.faceOn(bench, tri, hit.fromAbove);
    if (face < 0) return null;
    const flat = this.flatPoint(bench, tri, b0, b1, b2);
    if (this.grips.length >= MAX_PINS) this.release(this.grips[0] as Grip);

    const stack = piece.book.stackOf(face);
    const seeds = wholeStack ? [...stack] : [face];
    if (!wholeStack && stack.length > 1 && hit.fromAbove && piece.peel(face)) this.regrip(bench);

    const mesh = piece.soft.mesh;
    const liveTri = mesh.faceTri[face] as number;
    const [w0, w1, w2] = this.barycentric(bench, liveTri, flat);
    const pin = piece.soft.addPin(liveTri, w0, w1, w2);
    const slot = [0, 1, 2].find((s) => !this.grips.some((g) => g.slot === s)) ?? 0;
    const marker = new PinMarker(PIN_COLOURS[slot] as string);
    this.overlay.add(marker.group);

    // The paper being lifted is the one thing that cannot say where the sheet is.
    const near = new Set<number>(piece.lifted);
    const reach = this.definition.size * NEAR_GRAB;
    for (const f of piece.book.faces) {
      const i = f * 6;
      const cx = piece.toMetres(((piece.book.at[i] as number) + (piece.book.at[i + 2] as number) + (piece.book.at[i + 4] as number)) / 3);
      const cz = piece.toMetres(((piece.book.at[i + 1] as number) + (piece.book.at[i + 3] as number) + (piece.book.at[i + 5] as number)) / 3);
      if (Math.hypot(cx - flat.x, cz - flat.z) < reach) near.add(f);
    }
    const grip: Grip = { slot, bench, pin, marker, face, flat, seeds, near, target: new Vector3(pin.x, pin.y, pin.z) };
    this.grips.push(grip);
    this.notify();
    return grip;
  }

  private barycentric(bench: Bench, tri: number, point: { x: number; z: number }): [number, number, number] {
    const { tris, flat } = bench.piece.soft.mesh;
    const a = (tris[tri * 3] as number) * 2, b = (tris[tri * 3 + 1] as number) * 2, c = (tris[tri * 3 + 2] as number) * 2;
    const ax = flat[a] as number, az = flat[a + 1] as number;
    const v0x = (flat[b] as number) - ax, v0z = (flat[b + 1] as number) - az;
    const v1x = (flat[c] as number) - ax, v1z = (flat[c + 1] as number) - az;
    const px = point.x - ax, pz = point.z - az;
    const det = v0x * v1z - v1x * v0z || 1;
    const u = Math.min(1, Math.max(0, (px * v1z - v1x * pz) / det));
    const v = Math.min(1 - u, Math.max(0, (v0x * pz - px * v0z) / det));
    return [1 - u - v, u, v];
  }

  /** The cloth was rebuilt, so every hand takes a fresh hold at the same flat point. */
  private regrip(bench: Bench): void {
    const { soft, book } = bench.piece;
    for (const grip of this.grips) {
      if (grip.bench !== bench) continue;
      if (!book.faces.includes(grip.face)) continue;
      const tri = soft.mesh.faceTri[grip.face] as number;
      const [b0, b1, b2] = this.barycentric(bench, tri, grip.flat);
      const held = grip.pin;
      grip.pin = soft.addPin(tri, b0, b1, b2);
      grip.pin.x = held.x;
      grip.pin.y = held.y;
      grip.pin.z = held.z;
    }
  }

  private release(grip: Grip): void {
    grip.bench.piece.soft.removePin(grip.pin);
    grip.marker.dispose();
    this.grips = this.grips.filter((g) => g !== grip);
    if (this.dragging === grip) this.dragging = null;
    this.notify();
  }

  releaseAll(): void {
    for (const grip of [...this.grips]) this.release(grip);
  }

  private flapsBusy(): boolean {
    return this.benches.some((b) => b.flap.active);
  }

  // ---- Folding ----

  /** Works out what the current drag would do, and shows it. */
  private updateGuess(dt: number): void {
    const grip = this.dragging;
    if (!grip) return;
    if (this.liftExtra >= HOLD_LIFT) {
      this.guess = null;
      this.ghost.hide();
      return;
    }
    const { piece } = grip.bench;
    const still = this.moving ?? grip.near;
    const flatNow = piece.worldToFlat(grip.pin, still);
    this.guess = guessFold(piece, grip.flat, flatNow);
    const guess = this.guess;
    if (!guess) {
      this.ghost.hide();
      return;
    }

    const landing = this.landingFor(flatNow.height);
    const key = `${guess.line.kind}:${guess.line.c}:${guess.side}:${landing.kind}`;
    if (key !== this.planKey) {
      this.planKey = key;
      this.plan = piece.book.plan({ line: guess.line, side: guess.side, seeds: grip.seeds, landing });
      this.moving = this.paperOnSide(piece, guess);
    }
    const frame = piece.frameOf(this.moving ?? still);
    const [from, to] = lineAcrossSheet(piece, guess.line);
    const toWorld = (p: { x: number; z: number }) => {
      const out = new Float64Array(3);
      frame(p.x, p.z, out);
      return new Vector3().fromArray(out);
    };
    const reachable = !this.plan?.failure && guess.miss < SNAP_RADIUS;
    this.ghost.show(toWorld(from), toWorld(to), toWorld(guess.target), reachable ? 'good' : 'bad', dt);
  }

  /** All paper past the fold line. It is in motion, so it cannot locate the sheet. */
  private paperOnSide(piece: SheetPiece, guess: FoldGuess): Set<number> {
    const { at, faces } = piece.book;
    const moving = new Set(piece.lifted);
    for (const f of faces) {
      const i = f * 6;
      const x = ((at[i] as number) + (at[i + 2] as number) + (at[i + 4] as number)) / 3;
      const z = ((at[i + 1] as number) + (at[i + 3] as number) + (at[i + 5] as number)) / 3;
      if (sideOf(guess.line, x, z) * guess.side > 0) moving.add(f);
    }
    return moving;
  }

  private landingFor(height: number): Landing {
    return height < -0.2 ? { kind: 'under' } : { kind: 'over' };
  }

  private commit(grip: Grip, guess: FoldGuess): void {
    const { bench, seeds } = grip;
    const { piece } = bench;
    this.release(grip);
    this.remember();
    const step = this.stepFor(piece, guess, seeds);
    const plan = this.foldBench(bench, step.landing ?? { kind: 'over' }, guess.line, guess.side, seeds, false);
    if (plan.failure) {
      this.history.pop();
      this.reportFailure(plan.failure);
      return;
    }
    this.log = [...this.log, step];
    this.setMessage(`Folded along a ${LINE_NAMES[guess.line.kind]} line. ${piece.book.tallest} layers at the thickest.`);
  }

  private stepFor(piece: SheetPiece, guess: FoldGuess, seeds: readonly number[]): FoldStep {
    const metres = (guess.line.c * piece.definition.size) / (piece.book.cells * UNITS_PER_CELL);
    return { kind: guess.line.kind, at: metres, side: guess.side, grip: seeds.length === 1 ? 'top' : 'all', landing: this.planLanding() };
  }

  private planLanding(): Landing {
    return this.plan?.request.landing ?? { kind: 'over' };
  }

  private foldBench(bench: Bench, landing: Landing, line: MirrorLine, side: number, seeds: readonly number[], swing: boolean): FoldPlan {
    const { piece } = bench;
    const before = piece.corners();
    const frame = piece.frameOf(new Set());
    const axis = swing ? this.axisFor(piece, line, frame, side, landing) : null;
    const plan = piece.fold({ line, side, seeds, landing }, swing);
    if (plan.failure) return plan;
    bench.flap.start(plan.moved, before, axis);
    bench.view.update(bench.flap.hidden);
    for (const grip of [...this.grips]) {
      if (grip.bench === bench && plan.moved.has(grip.face)) this.release(grip);
    }
    this.regrip(bench);
    return plan;
  }

  private axisFor(piece: SheetPiece, line: MirrorLine, frame: ReturnType<SheetPiece['frameOf']>, side: number, landing: Landing) {
    const [from, to] = lineAcrossSheet(piece, line);
    const a = new Float64Array(3), b = new Float64Array(3);
    frame(from.x, from.z, a);
    frame(to.x, to.z, b);
    const origin = new Vector3().fromArray(a);
    const direction = new Vector3().fromArray(b).sub(origin).normalize();
    // Turn the way that lifts the moved side, or drops it for a fold underneath.
    const [nx, nz] = lineNormal(line.kind);
    const outward = new Vector3(nx * side, 0, nz * side);
    const lift = direction.clone().cross(outward).y;
    const angle = (landing.kind === 'under' ? -1 : 1) * (lift > 0 ? Math.PI : -Math.PI);
    return { origin, direction, angle };
  }

  private reportFailure(failure: FoldFailure): void {
    this.shake.add(0.3);
    this.setMessage(FAILURE_TEXT[failure]);
  }

  private landed(bench: Bench): void {
    // The crease presses flat: a thud along the line, and scraps kicked out.
    const { piece } = bench;
    const { x } = piece.soft;
    const centre = new Vector3();
    for (let i = 0; i < x.length; i += 3) centre.add(new Vector3(x[i] as number, 0, x[i + 2] as number));
    centre.divideScalar(x.length / 3);
    this.scraps.burst(centre, 26, [piece.definition.top, piece.definition.bottom], 1.1, piece.definition.size * 0.4);
    this.shake.add(0.26);
    this.notify();
  }

  private remember(): void {
    this.history.push({ book: (this.benches[0] as Bench).piece.book.clone(), log: this.log });
  }

  /** Lab only: the game itself has no undo. */
  stepBack(): void {
    const snapshot = this.history.pop();
    if (!snapshot) return;
    this.clearBenches();
    this.log = snapshot.log;
    this.addBench(new SheetPiece(this.definition, snapshot.book));
    this.rigidity = 0;
    this.setMessage('Stepped back.');
  }

  reset(definition = this.definition): void {
    this.definition = definition;
    this.clearBenches();
    this.history.length = 0;
    this.log = [];
    this.queue = [];
    this.rigidity = 0;
    this.addBench(new SheetPiece(definition));
    this.setMessage('A fresh sheet.');
  }

  setCells(cells: number): void {
    this.reset({ ...this.definition, cells });
  }

  get cells(): number {
    return this.definition.cells;
  }

  playRecipe(id: string): void {
    const recipe = RECIPES.find((r) => r.id === id);
    if (!recipe) throw new Error(`Unknown recipe "${id}".`);
    this.reset();
    this.queue = [...recipe.steps];
  }

  /** Applies a recipe at once, for tests and screenshots. */
  applyRecipe(id: string): (FoldFailure | null)[] {
    const recipe = RECIPES.find((r) => r.id === id);
    if (!recipe) throw new Error(`Unknown recipe "${id}".`);
    this.reset();
    const piece = (this.benches[0] as Bench).piece;
    const results = recipe.steps.map((step) => applyStep(piece, step).failure);
    this.log = recipe.steps;
    return results;
  }

  private nextQueued(): void {
    const step = this.queue[0];
    const bench = this.benches[0];
    if (!step || !bench || this.flapsBusy()) return;
    this.queue.shift();
    this.remember();
    const plan = this.foldBench(bench, step.landing ?? { kind: 'over' }, toMirrorLine(bench.piece, step), step.side, gripFaces(bench.piece, step), true);
    if (plan.failure) {
      this.queue = [];
      this.history.pop();
      this.reportFailure(plan.failure);
      return;
    }
    this.log = [...this.log, step];
    this.notify();
  }

  // ---- Cutting ----

  /** The grid line nearest the drawn stroke, and the stretch of it to cut. */
  private cutLine(): { line: MirrorLine; from: number; to: number } | null {
    const { cutFrom, cutTo } = this;
    if (!cutFrom || !cutTo) return null;
    const dx = cutTo.x - cutFrom.flat.x, dz = cutTo.z - cutFrom.flat.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.4) return null;
    const { piece } = cutFrom.bench;

    let kind: LineKind = 'x';
    let best = Infinity;
    for (const candidate of ['x', 'z', 'sum', 'diff'] as const) {
      const [nx, nz] = lineNormal(candidate);
      const across = Math.abs(dx * nx + dz * nz) / length;
      if (across < best) {
        best = across;
        kind = candidate;
      }
    }
    const ux = piece.toUnits(cutFrom.flat.x), uz = piece.toUnits(cutFrom.flat.z);
    const vx = piece.toUnits(cutTo.x), vz = piece.toUnits(cutTo.z);
    const raw = kind === 'x' ? ux : kind === 'z' ? uz : kind === 'sum' ? ux + uz : ux - uz;
    const spacing = kind === 'x' || kind === 'z' ? UNITS_PER_CELL : UNITS_PER_CELL * 2;
    const line: MirrorLine = { kind, c: Math.round(raw / spacing) * spacing };
    const start = kind === 'x' ? uz : ux, end = kind === 'x' ? vz : vx;
    return { line, from: Math.round(Math.min(start, end) / UNITS_PER_CELL) * UNITS_PER_CELL, to: Math.round(Math.max(start, end) / UNITS_PER_CELL) * UNITS_PER_CELL };
  }

  private showCutGuide(dt: number): void {
    const cut = this.cutLine();
    if (!cut || !this.cutFrom) {
      this.ghost.hide();
      return;
    }
    const { piece } = this.cutFrom.bench;
    const { kind, c } = cut.line;
    const point = (along: number) => {
      const x = kind === 'x' ? c : along;
      const z = kind === 'x' ? along : kind === 'z' ? c : kind === 'sum' ? c - along : along - c;
      return new Vector3(piece.toMetres(x), 0.06, piece.toMetres(z));
    };
    this.ghost.show(point(cut.from), point(cut.to), null, 'cut', dt);
  }

  private finishCut(): void {
    const cut = this.cutLine();
    const source = this.cutFrom;
    this.cutFrom = null;
    this.cutTo = null;
    this.ghost.hide();
    this.setOrbit(true);
    if (!cut || !source) return;
    const { bench } = source;
    const pieces = bench.piece.cut(cut.line, cut.from, cut.to);
    for (const piece of pieces) {
      if (piece !== bench.piece) this.addBench(piece);
    }
    for (const grip of [...this.grips]) if (grip.bench === bench) this.release(grip);
    this.scraps.burst(new Vector3(0, 0.1, 0), 18, [bench.piece.definition.top, bench.piece.definition.bottom], 0.6, 2);
    this.shake.add(0.16);
    this.setMessage(pieces.length > 1 ? `Cut into ${pieces.length} pieces.` : 'Cut a slit.');
  }

  // ---- Hardening ----

  setRigidity(rigidity: number): void {
    this.rigidity = rigidity;
    for (const bench of this.benches) bench.piece.harden(rigidity);
    this.notify();
  }

  // ---- Frame ----

  update(dt: number): void {
    if (!this.frozen) {
      const start = performance.now();
      this.nextQueued();
      this.followHands(dt);
      this.clock.advance(dt, (step) => {
        for (const bench of this.benches) bench.piece.step(step);
      });
      this.simulationMs += (performance.now() - start - this.simulationMs) * 0.1;
      for (const bench of this.benches) if (bench.flap.update(dt)) this.landed(bench);
    }
    if (this.tool === 'cut' && this.cutFrom) this.showCutGuide(dt);
    else this.updateGuess(dt);
    for (const bench of this.benches) bench.view.update(bench.flap.hidden);
    for (const grip of this.grips) {
      grip.marker.group.position.set(grip.pin.x, grip.pin.y, grip.pin.z);
      grip.marker.update(dt, this.camera);
    }
  }

  private followHands(dt: number): void {
    const grip = this.dragging;
    if (!grip) return;
    // Heavier paper lags behind the hand, so a thick stack feels heavy.
    const layers = grip.bench.piece.book.depth(grip.face);
    const k = 1 - Math.exp((-FOLLOW_RATE / Math.sqrt(layers)) * dt);
    grip.pin.x += (grip.target.x - grip.pin.x) * k;
    grip.pin.y += (grip.target.y - grip.pin.y) * k;
    grip.pin.z += (grip.target.z - grip.pin.z) * k;
  }

  /** Runs the simulation forward with no drawing, for screenshots. */
  settle(steps = SETTLE_STEPS): void {
    for (let i = 0; i < steps; i++) for (const bench of this.benches) bench.piece.step(this.clock.step);
    for (const bench of this.benches) bench.view.update();
  }

  /** Lifts a point for screenshots: hold paper at a flat spot and raise it. */
  holdAt(x: number, z: number, height: number): void {
    const bench = this.benches[0];
    if (!bench) return;
    const { soft } = bench.piece;
    let best = 0, distance = Infinity;
    for (let t = 0; t < soft.mesh.triCount; t++) {
      const v = (soft.mesh.tris[t * 3] as number) * 2;
      const d = Math.hypot((soft.mesh.flat[v] as number) - x, (soft.mesh.flat[v + 1] as number) - z);
      if (d < distance) {
        distance = d;
        best = t;
      }
    }
    const pin = soft.addPin(best, 1, 0, 0);
    pin.y = height;
    pin.x = x;
    pin.z = z;
  }

  readout(): LabReadout {
    const first = this.benches[0];
    return {
      pieces: this.benches.length,
      faces: this.benches.reduce((sum, b) => sum + b.piece.book.faces.length, 0),
      tallest: this.benches.reduce((most, b) => Math.max(most, b.piece.book.tallest), 0),
      folds: this.log.length,
      pins: this.grips.length,
      simulationMs: this.simulationMs,
      triangles: this.benches.reduce((sum, b) => sum + b.view.triangles, 0),
      stretch: first ? first.piece.soft.stretch() : 0,
      message: this.message,
      log: this.log,
      rigidity: this.rigidity,
      cellMetres: this.definition.size / this.definition.cells,
    };
  }
}

const LINE_NAMES: Record<LineKind, string> = { x: 'straight', z: 'straight', sum: 'diagonal', diff: 'diagonal' };

const FAILURE_TEXT: Record<FoldFailure, string> = {
  'not-a-grid-line': 'That is not on the grid.',
  'nothing-moves': 'Nothing on that side to fold.',
  'nothing-stays': 'All the paper would move.',
  jammed: 'Jammed: another layer is pinning that paper down.',
  'layers-cross': 'Layers would have to pass through each other.',
};
