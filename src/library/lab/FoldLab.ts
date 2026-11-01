import { Box3, Group, Plane, Raycaster, Vector2, Vector3 } from 'three';
import type { PerspectiveCamera, Scene } from 'three';
import type { SheetDefinition } from '@/core/asset/sheetTypes';
import { guessFold, lineAcrossSheet } from '@/core/fold/foldGuide';
import type { FoldGuess } from '@/core/fold/foldGuide';
import { FoldBook } from '@/core/fold/FoldBook';
import type { FoldFailure, FoldPlan, Landing } from '@/core/fold/FoldBook';
import { lineNormal, sideOf, UNITS_PER_CELL } from '@/core/fold/lattice';
import type { LineKind, MirrorLine } from '@/core/fold/lattice';
import { foldRequest, RECIPES, toMirrorLine } from '@/core/fold/recipes';
import type { FoldStep, Recipe, RecipeStep, SpreadStep, TrimStep } from '@/core/fold/recipes';
import type { ReshapeFailure } from '@/core/fold/reshape';
import { SheetPiece } from '@/core/fold/SheetPiece';
import { countCrossings } from '@/core/fold/soft/crossings';
import type { Pin } from '@/core/fold/soft/SoftSheet';
import type { ScrapBurst } from '@/core/fx/ScrapBurst';
import type { Shake } from '@/core/fx/Shake';
import { SheetView } from '@/core/render/SheetView';
import { SwingFlap } from '@/core/render/SwingFlap';
import { FixedStep } from '@/core/sim/FixedStep';
import { FlapHint, FoldGhost, PIN_COLOURS, PinMarker } from './LabMarkers';

const MAX_PINS = 3;
/** How close the held point must be to its landing for a drop to crease. */
const SNAP_RADIUS = 1.5;
/** Fraction of the sheet's size around a grab that is not trusted as "staying put". */
const NEAR_GRAB = 0.42;
const FOLLOW_RATE = 16;
const MARKER_PICK_RADIUS = 0.42;
const SETTLE_STEPS = 30;
/** Pointer travel, in pixels, that turns a click into a drag. */
const DRAG_START = 6;
const DRAG_PLANE_HEIGHT = 0.05;
/** How high two hands lift a plane off the bench, in metres. */
const HOLD_UP_HEIGHT = 3.2;

export type LabTool = 'fold' | 'cut';

/** One sheet of paper on the bench, with its picture. */
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
  /** Extra height from the wheel. */
  lift: number;
  /** True once the hand has pulled paper somewhere, so dropping it may fold. */
  carried: boolean;
  /** True if this grip lifted a flap off its stack. */
  peeled: boolean;
  /** Grabbed from above, so pulling it should lift the top flap. */
  fromAbove: boolean;
}

/** What dropping a held point would do. */
interface Assessment {
  guess: FoldGuess;
  plan: FoldPlan;
  landing: Landing;
  reachable: boolean;
}

interface Snapshot {
  book: FoldBook;
  log: RecipeStep[];
  recipeNext: number;
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
  log: readonly RecipeStep[];
  hardened: boolean;
  cellMetres: number;
  floppiness: number;
  /** How far the paper rises off the ground, in metres. */
  height: number;
  /** The lowest point of paper actually drawn, in metres. */
  lowest: number;
  /** Faces lit up under the pointer, ready to lift. */
  hoverFaces: number;
  /** Faces lifted off their stack right now. */
  liftedFaces: number;
  /** Flaps fixed open. */
  fixedFlaps: number;
  /** The pin that would fold if dropped, and whether it would succeed. */
  held: { x: number; y: number; z: number; ready: boolean } | null;
  recipe: { recipe: Recipe; next: number } | null;
}

export class FoldLab {
  readonly group = new Group();
  private benches: Bench[] = [];
  private grips: Grip[] = [];
  private dragging: Grip | null = null;
  /** The last hand to pull paper. Its guide stays up until it is dropped. */
  private active: Grip | null = null;
  private press: { grip: Grip; x: number; y: number; moved: boolean; planted: boolean } | null = null;
  private cutFrom: { bench: Bench; flat: { x: number; z: number } } | null = null;
  private cutTo: { x: number; z: number } | null = null;

  private assessment: Assessment | null = null;
  private planKey = '';
  private cachedPlan: FoldPlan | null = null;
  private moving: ReadonlySet<number> | null = null;

  private readonly clock = new FixedStep();
  private readonly ghost: FoldGhost;
  private readonly hint: FlapHint;
  /** The flap lit up under the pointer. */
  private hover: { bench: Bench; face: number; size: number; revision: number } | null = null;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly dragPlane = new Plane(new Vector3(0, 1, 0), -DRAG_PLANE_HEIGHT);
  private readonly history: Snapshot[] = [];
  private log: RecipeStep[] = [];
  private hardened = false;
  /** True when the sheet starts turned over, for a recipe that wants its printed face outside. */
  private faceDown = false;
  private simulationMs = 0;
  private message = 'Click paper to pin it, or drag it to pull it over.';
  private recipe: { recipe: Recipe; next: number } | null = null;
  private autoplay = false;
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
    this.hint = new FlapHint(overlay);
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

  private removeBench(bench: Bench): void {
    for (const grip of this.grips.filter((g) => g.bench === bench)) this.dropGrip(grip);
    bench.flap.clear();
    bench.view.dispose();
    this.benches = this.benches.filter((b) => b !== bench);
  }

  private clearBenches(): void {
    this.clearHover();
    for (const bench of [...this.benches]) this.removeBench(bench);
    this.dragging = null;
    this.active = null;
    this.ghost.hide();
  }

  dispose(): void {
    this.clearBenches();
    this.ghost.group.removeFromParent();
    this.hint.dispose();
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

  /** The nearest paper under the pointer. Reaching under passes through flaps already lifted. */
  private pick(reachUnder = false): { bench: Bench; tri: number; b0: number; b1: number; b2: number; fromAbove: boolean } | null {
    const { origin, direction } = this.raycaster.ray;
    const hit = new Vector3();
    const a = new Vector3(), b = new Vector3(), c = new Vector3(), e1 = new Vector3(), e2 = new Vector3(), n = new Vector3();
    let best = Infinity;
    let result: ReturnType<FoldLab['pick']> = null;
    for (const bench of this.benches) {
      const { soft } = bench.piece;
      const { tris, triCount, triFlap } = soft.mesh;
      const x = soft.x;
      for (let t = 0; t < triCount; t++) {
        if (reachUnder && (triFlap[t] as number) >= 0) continue;
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
        result = { bench, tri: t, b0: 1 - v - w, b1: v, b2: w, fromAbove: facing < 0 };
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
    this.fadeHover();
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
      this.beginPress(held, event, false);
      return;
    }
    const hit = this.pick(event.ctrlKey);
    if (!hit) return;
    if (event.ctrlKey) hit.fromAbove = false;
    const grip = this.grab(hit, event.shiftKey);
    if (grip) this.beginPress(grip, event, true);
  };

  private beginPress(grip: Grip, event: PointerEvent, planted: boolean): void {
    this.dragging = grip;
    this.press = { grip, x: event.clientX, y: event.clientY, moved: false, planted };
    this.setOrbit(false);
  }

  private readonly onMove = (event: PointerEvent): void => {
    if (this.tool === 'cut' && this.cutFrom) {
      this.ray(event);
      const point = this.raycaster.ray.intersectPlane(this.dragPlane, new Vector3());
      if (point) this.cutTo = { x: point.x, z: point.z };
      return;
    }
    const grip = this.dragging;
    if (!grip || !this.press) {
      this.updateHover(event);
      return;
    }
    if (!this.press.moved) {
      if (Math.hypot(event.clientX - this.press.x, event.clientY - this.press.y) < DRAG_START) return;
      this.press.moved = true;
      this.startCarrying(grip);
    }
    this.ray(event);
    const point = this.raycaster.ray.intersectPlane(this.dragPlane, new Vector3());
    if (!point) return;
    grip.target.x = point.x;
    grip.target.z = point.z;
    // Paper is carried up and over: the further it travels, the higher the arc.
    const travelled = Math.hypot(point.x - grip.flat.x, point.z - grip.flat.z);
    grip.target.y = Math.max(0.25, Math.min(2.8, 0.25 + travelled * 0.34)) + grip.lift;
  };

  /** A click only pins the stack. Actually pulling is what lifts a flap away from it. */
  private startCarrying(grip: Grip): void {
    const { piece } = grip.bench;
    const lifts = !grip.carried && grip.seeds.length === 1 && !this.hardened && !piece.pulling;
    if (lifts && piece.unfix(grip.face)) {
      grip.peeled = true;
    } else if (lifts && piece.book.depth(grip.face) > 1 && piece.peel(grip.face, !grip.fromAbove)) {
      grip.peeled = true;
      this.regrip(grip.bench);
      for (const f of piece.lifted) (grip.near as Set<number>).add(f);
    }
    grip.carried = true;
    this.active = grip;
    this.assessment = null;
    this.planKey = '';
    this.moving = null;
  }

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.dragging) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const change = -event.deltaY * 0.0025;
    this.dragging.lift = Math.max(-1, Math.min(6, this.dragging.lift + change));
    this.dragging.target.y = Math.max(0.1, this.dragging.target.y + change);
  };

  private readonly onContext = (event: Event): void => {
    event.preventDefault();
    this.ray(event as PointerEvent);
    const grip = this.markerUnderPointer();
    if (grip) this.letGo(grip);
  };

  private readonly onUp = (): void => {
    if (this.tool === 'cut' && this.cutFrom) {
      this.finishCut();
      return;
    }
    const grip = this.dragging;
    const press = this.press;
    this.dragging = null;
    this.press = null;
    this.setOrbit(true);
    if (!grip || !press) return;

    // A click on a pin that was already there means "put it down".
    if (!press.moved && !press.planted) {
      this.drop(grip);
      return;
    }
    if (press.moved) this.setMessage('Holding. Click the pin to drop it and crease, or right click to let it fall.');
    else this.setMessage('Pinned.');
  };

  // ---- Showing what the pointer would take hold of ----

  private updateHover(event: PointerEvent): void {
    if (event.buttons !== 0 || event.target !== this.canvas || this.tool !== 'fold' || this.hardened || this.flapsBusy()) {
      this.fadeHover();
      return;
    }
    this.ray(event);
    const hit = this.markerUnderPointer() ? null : this.pick(event.ctrlKey);
    const fromAbove = (hit?.fromAbove ?? true) && !event.ctrlKey;
    const face = hit && !hit.bench.piece.pulling ? this.faceOn(hit.bench, hit.tri, fromAbove) : -1;
    if (!hit || face < 0) {
      this.fadeHover();
      return;
    }
    const { hover } = this;
    if (hover?.bench === hit.bench && hover.face === face) return;
    const flap = hit.bench.piece.flapToLift(face, !fromAbove);
    if (!flap) {
      this.fadeHover();
      return;
    }
    const { piece } = hit.bench;
    // Anything on this flap lights up with it, so moving across it stays calm.
    if (hover?.bench === hit.bench && hover.size === flap.size && flap.has(hover.face)) {
      hover.face = face;
      return;
    }
    this.hover = { bench: hit.bench, face, size: flap.size, revision: piece.revision };
    this.hint.show(piece.soft.mesh, flap);
    this.canvas.style.cursor = 'grab';
  }

  private fadeHover(): void {
    if (!this.hover) return;
    this.hover = null;
    this.hint.hide();
    this.canvas.style.cursor = '';
  }

  private clearHover(): void {
    this.hover = null;
    this.hint.clear();
    this.canvas.style.cursor = '';
  }

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
    if (this.grips.length >= MAX_PINS) this.letGo(this.grips[0] as Grip);

    const stack = piece.book.stackOf(face);
    const seeds = wholeStack ? [...stack] : [face];

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
    const grip: Grip = { slot, bench, pin, marker, face, flat, seeds, near, target: new Vector3(pin.x, pin.y, pin.z), lift: 0, carried: false, peeled: false, fromAbove: hit.fromAbove };
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
      if (grip.bench !== bench || !book.faces.includes(grip.face)) continue;
      // An anchor stays on the stack when a flap lifts off from under its hand.
      const anchored = !grip.peeled && bench.piece.lifted.has(grip.face);
      const face = anchored ? (book.stackOf(grip.face).find((f) => !bench.piece.lifted.has(f)) ?? grip.face) : grip.face;
      const tri = soft.mesh.faceTri[face] as number;
      const [b0, b1, b2] = this.barycentric(bench, tri, grip.flat);
      const held = grip.pin;
      soft.removePin(held);
      grip.pin = soft.addPin(tri, b0, b1, b2);
      grip.pin.x = held.x;
      grip.pin.y = held.y;
      grip.pin.z = held.z;
    }
  }

  private dropGrip(grip: Grip): void {
    grip.bench.piece.soft.removePin(grip.pin);
    grip.marker.dispose();
    this.grips = this.grips.filter((g) => g !== grip);
    if (this.dragging === grip) this.dragging = null;
    if (this.active === grip) {
      this.active = null;
      this.assessment = null;
      this.ghost.hide();
    }
  }

  /** Lets paper fall with no crease. */
  private letGo(grip: Grip): void {
    const { bench, peeled } = grip;
    this.dropGrip(grip);
    if (peeled && !this.grips.some((g) => g.bench === bench && g.peeled)) {
      bench.piece.settle();
      this.regrip(bench);
    }
    this.notify();
  }

  letGoAll(): void {
    for (const grip of [...this.grips]) this.letGo(grip);
  }

  /**
   * Puts a held point down. This is the one action that creases paper: pulling
   * and holding never fold anything, so a fold always means someone chose it.
   */
  drop(grip: Grip): void {
    const assessment = grip.carried && !this.hardened ? this.assess(grip) : null;
    if (assessment?.reachable) {
      this.commit(grip, assessment);
      return;
    }
    const failure = assessment?.plan.failure;
    if (failure === 'jammed' || failure === 'layers-cross') this.reportFailure(failure);
    this.letGo(grip);
  }

  /** Bends a lifted flap for good at the angle it is held, and lets the hand go. */
  fixFlap(): void {
    const grips = this.grips.filter((grip) => grip.peeled);
    const first = grips[0];
    if (!first) {
      this.setMessage('Pull a flap open first, then fix it there.');
      return;
    }
    first.bench.piece.fixFlaps();
    for (const grip of grips) {
      grip.peeled = false;
      this.dropGrip(grip);
    }
    const { x, y, z } = first.pin;
    this.scraps.burst(new Vector3(x, y, z), 10, [first.bench.piece.definition.top, first.bench.piece.definition.bottom], 0.5, 0.6);
    this.shake.add(0.1);
    this.setMessage('Fixed open. It stays where you left it.');
  }

  /** Drops the hand that last pulled paper. */
  dropHeld(): void {
    if (this.active && !this.flapsBusy()) this.drop(this.active);
  }

  private flapsBusy(): boolean {
    return this.benches.some((b) => b.flap.active);
  }

  // ---- Folding ----

  /** Works out what dropping a held point would do. */
  private assess(grip: Grip): Assessment | null {
    const { piece } = grip.bench;
    // The fold follows the hand, not the paper trailing behind it, so what you
    // aim at is what you get, however slow the frame was.
    const flatNow = piece.worldToFlat(grip.target, this.moving ?? grip.near);
    const guess = guessFold(piece, grip.flat, flatNow);
    if (!guess) return null;

    const landing = this.landingFor(flatNow.height);
    const key = `${grip.slot}:${guess.line.kind}:${guess.line.c}:${guess.side}:${landing.kind}`;
    if (key !== this.planKey || !this.cachedPlan) {
      this.planKey = key;
      this.cachedPlan = piece.book.plan({ line: guess.line, side: guess.side, seeds: grip.seeds, landing });
      this.moving = this.paperOnSide(piece, guess);
    }
    const plan = this.cachedPlan;
    return { guess, plan, landing, reachable: !plan.failure && guess.miss < SNAP_RADIUS };
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

  private updateGuide(dt: number): void {
    const grip = this.active;
    if (!grip || this.hardened) {
      this.showNextRecipeLine(dt);
      return;
    }
    this.assessment = this.assess(grip);
    const assessment = this.assessment;
    grip.marker.setReady(assessment?.reachable ?? false);
    if (!assessment) {
      this.ghost.hide();
      return;
    }
    const { piece } = grip.bench;
    const frame = piece.frameOf(this.moving ?? grip.near);
    const [from, to] = lineAcrossSheet(piece, assessment.guess.line);
    const toWorld = (p: { x: number; z: number }) => {
      const out = new Float64Array(3);
      frame(p.x, p.z, out);
      return new Vector3().fromArray(out);
    };
    this.ghost.show(toWorld(from), toWorld(to), toWorld(assessment.guess.target), assessment.reachable ? 'good' : 'bad', dt);
  }

  /** With a recipe open, the guide marks where the next fold goes. */
  private showNextRecipeLine(dt: number): void {
    const step = this.recipe?.recipe.steps[this.recipe.next];
    const bench = this.benches[0];
    if (!step || step.action !== 'fold' || !bench || this.flapsBusy()) {
      this.ghost.hide();
      return;
    }
    const { piece } = bench;
    const [from, to] = lineAcrossSheet(piece, toMirrorLine(piece.book, piece.definition.size, step));
    this.ghost.show(new Vector3(from.x, 0.08, from.z), new Vector3(to.x, 0.08, to.z), null, 'good', dt);
  }

  private commit(grip: Grip, { guess, plan, landing }: Assessment): void {
    const { bench, seeds } = grip;
    const { piece } = bench;
    this.dropGrip(grip);
    this.remember();
    const done = this.foldBench(bench, landing, guess.line, guess.side, seeds, false);
    if (done.failure) {
      this.history.pop();
      this.reportFailure(done.failure);
      return;
    }
    void plan;
    this.log = [...this.log, this.stepFor(piece, guess, seeds, landing)];
    this.setMessage(`Creased along a ${LINE_NAMES[guess.line.kind]} line. ${piece.book.tallest} layers at the thickest.`);
  }

  private stepFor(piece: SheetPiece, guess: FoldGuess, seeds: readonly number[], landing: Landing): FoldStep {
    const at = (guess.line.c * piece.definition.size) / (piece.book.cells * UNITS_PER_CELL);
    return { action: 'fold', label: 'By hand', kind: guess.line.kind, at, side: guess.side, grip: seeds.length === 1 ? 'top' : 'all', landing };
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
    for (const grip of this.grips.filter((g) => g.bench === bench)) grip.peeled = false;
    for (const grip of [...this.grips]) {
      if (grip.bench === bench && plan.moved.has(grip.face)) this.dropGrip(grip);
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
    this.history.push({ book: (this.benches[0] as Bench).piece.book.clone(), log: this.log, recipeNext: this.recipe?.next ?? 0 });
  }

  /** Lab only: the game itself has no undo. */
  stepBack(): void {
    const snapshot = this.history.pop();
    if (!snapshot) return;
    this.clearBenches();
    this.log = snapshot.log;
    if (this.recipe) this.recipe.next = snapshot.recipeNext;
    this.addBench(new SheetPiece(this.dressed(), snapshot.book));
    this.hardened = false;
    this.setMessage('Stepped back.');
  }

  /** The sheet as it lies on the bench, which may be turned over. */
  private dressed(): SheetDefinition {
    const { definition } = this;
    return this.faceDown ? { ...definition, top: definition.bottom, bottom: definition.top } : definition;
  }

  reset(definition = this.definition, faceDown = false): void {
    this.definition = definition;
    this.faceDown = faceDown;
    this.clearBenches();
    this.history.length = 0;
    this.log = [];
    this.recipe = null;
    this.autoplay = false;
    this.hardened = false;
    for (const bench of this.benches) bench.piece.harden(false);
    this.addBench(new SheetPiece(this.dressed()));
    this.setMessage(`A fresh sheet, ${definition.size / definition.cells} m between fold lines.`);
  }

  setCells(cells: number): void {
    this.reset({ ...this.definition, cells });
  }

  get cells(): number {
    return this.definition.cells;
  }

  /** Tuning only: the paper's feel is meant to be one fixed value. */
  setFloppiness(floppiness: number): void {
    this.definition = { ...this.definition, floppiness };
    for (const bench of this.benches) bench.piece.setFloppiness(floppiness);
    this.notify();
  }

  // ---- Recipes ----

  private recipeById(id: string): Recipe {
    const recipe = RECIPES.find((r) => r.id === id);
    if (!recipe) throw new Error(`Unknown recipe "${id}".`);
    return recipe;
  }

  /** Lays out a recipe, ready to step through. */
  openRecipe(id: string): void {
    const recipe = this.recipeById(id);
    this.reset(this.definition, recipe.faceDown);
    this.recipe = { recipe, next: 0 };
    this.setMessage(recipe.source);
  }

  /** Runs the next step, animated. */
  nextStep(): void {
    const step = this.recipe?.recipe.steps[this.recipe.next];
    const bench = this.benches[0];
    if (!this.recipe || !step || !bench || this.flapsBusy()) return;
    this.remember();
    this.recipe.next++;

    if (step.action === 'trim') {
      this.trim(bench, step);
    } else if (step.action === 'open') {
      const before = bench.piece.corners();
      const failure = bench.piece.open(step);
      if (failure) {
        this.history.pop();
        this.recipe.next--;
        this.autoplay = false;
        this.setMessage(`"${step.label}" could not be done: ${OPEN_FAILURE_TEXT[failure]}`);
        return;
      }
      for (const grip of this.grips.filter((g) => g.bench === bench)) this.dropGrip(grip);
      bench.flap.start(new Set(bench.piece.book.faces), before, null);
    } else if (step.action === 'spread') {
      const before = bench.piece.corners();
      for (const grip of this.grips.filter((g) => g.bench === bench)) this.dropGrip(grip);
      if (!this.spread(bench, step)) {
        this.history.pop();
        this.recipe.next--;
        this.autoplay = false;
        this.setMessage(`"${step.label}" could not be done.`);
        return;
      }
      bench.flap.start(new Set(bench.piece.book.faces), before, null);
    } else {
      const { piece } = bench;
      const request = foldRequest(piece.book, piece.definition.size, step);
      const plan = this.foldBench(bench, step.landing ?? { kind: 'over' }, request.line, request.side, request.seeds, true);
      if (plan.failure) {
        this.history.pop();
        this.recipe.next--;
        this.autoplay = false;
        this.setMessage(`"${step.label}" could not be done: ${FAILURE_TEXT[plan.failure]}`);
        return;
      }
    }
    this.log = [...this.log, step];
    const done = this.recipe.next >= this.recipe.recipe.steps.length;
    this.setMessage(done ? this.recipe.recipe.finish : step.label);
  }

  playAll(): void {
    this.autoplay = true;
  }

  /** Opens the wings, with two hands on the body holding it up. */
  private spread(bench: Bench, step: SpreadStep): boolean {
    if (!bench.piece.spread(step)) return false;
    this.takeBothEnds(bench);
    return true;
  }

  /** Two hands on the paper that is not lifted, as far apart along it as they can get. */
  private takeBothEnds(bench: Bench): Grip[] {
    const { piece } = bench;
    const { mesh } = piece.soft;
    const { lifted } = piece;
    let nose = -1, tail = -1, low = Infinity, high = -Infinity;
    for (const f of piece.book.faces) {
      if (lifted.has(f)) continue;
      const t = mesh.faceTri[f] as number;
      const z = mesh.flat[(mesh.tris[t * 3] as number) * 2 + 1] as number;
      if (z < low) {
        low = z;
        nose = t;
      }
      if (z > high) {
        high = z;
        tail = t;
      }
    }
    const hit = (tri: number) => ({ bench, tri, b0: 1 / 3, b1: 1 / 3, b2: 1 / 3, fromAbove: true });
    return [this.grab(hit(nose), true), this.grab(hit(tail), true)].filter((grip) => grip !== null);
  }

  /** Lifts the paper off the bench by both ends, so whatever is underneath can be reached. */
  holdUp(): void {
    const bench = this.benches[0];
    if (!bench || this.hardened) return;
    this.letGoAll();
    for (const grip of this.takeBothEnds(bench)) {
      grip.pin.y = HOLD_UP_HEIGHT;
      grip.target.y = HOLD_UP_HEIGHT;
    }
    this.setMessage('Held up. Hold Ctrl and pull the flap underneath.');
  }

  private trim(bench: Bench, step: TrimStep): void {
    const { piece } = bench;
    const scale = (piece.book.cells * UNITS_PER_CELL) / piece.definition.size;
    const pieces = piece.cut({ kind: step.kind, c: Math.round(step.at * scale) }, step.from * scale, step.to * scale);
    const largest = pieces.reduce((best, p) => (p.book.faces.length > best.book.faces.length ? p : best));
    this.removeBench(bench);
    this.addBench(largest);
    this.scraps.burst(new Vector3(0, 0.1, 0), 18, [piece.definition.top, piece.definition.bottom], 0.6, 3);
    this.shake.add(0.16);
  }

  /** Applies a recipe at once, for screenshots. */
  applyRecipe(id: string, steps = Infinity): (FoldFailure | null)[] {
    this.openRecipe(id);
    const results: (FoldFailure | null)[] = [];
    const recipe = this.recipe as unknown as { recipe: Recipe; next: number };
    for (const step of recipe.recipe.steps.slice(0, steps)) {
      const bench = this.benches[0] as Bench;
      recipe.next++;
      if (step.action === 'trim') {
        this.trim(bench, step);
        continue;
      }
      if (step.action === 'open') {
        const failure = bench.piece.open(step);
        if (failure) throw new Error(`${step.label}: ${failure}`);
        continue;
      }
      if (step.action === 'spread') {
        if (!this.spread(bench, step)) throw new Error(`${step.label}: no wings to open`);
        continue;
      }
      const { piece } = bench;
      results.push(piece.fold(foldRequest(piece.book, piece.definition.size, step)).failure);
      this.log = [...this.log, step];
    }
    return results;
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
    const { top, bottom } = bench.piece.definition;
    for (const grip of this.grips.filter((g) => g.bench === bench)) this.dropGrip(grip);
    const pieces = bench.piece.cut(cut.line, cut.from, cut.to);
    if (pieces.length > 1) {
      this.removeBench(bench);
      for (const piece of pieces) this.addBench(piece);
    }
    this.scraps.burst(new Vector3(0, 0.1, 0), 18, [top, bottom], 0.6, 2);
    this.shake.add(0.16);
    this.setMessage(pieces.length > 1 ? `Cut into ${pieces.length} pieces.` : 'Cut a slit.');
  }

  // ---- Hardening ----

  /** Finishes the paper: its present shape becomes one solid body. */
  setHardened(hardened: boolean): void {
    this.hardened = hardened;
    for (const bench of this.benches) bench.piece.harden(hardened);
    this.setMessage(hardened ? 'Hardened. It keeps this shape and no longer folds.' : 'Soft again.');
  }

  // ---- Frame ----

  update(dt: number): void {
    if (!this.frozen) {
      const start = performance.now();
      if (this.autoplay) {
        if (this.recipe && this.recipe.next < this.recipe.recipe.steps.length) {
          if (!this.flapsBusy()) this.nextStep();
        } else {
          this.autoplay = false;
        }
      }
      this.followHands(dt);
      this.clock.advance(dt, (step) => {
        for (const bench of this.benches) bench.piece.step(step);
      });
      this.simulationMs += (performance.now() - start - this.simulationMs) * 0.1;
      for (const bench of this.benches) if (bench.flap.update(dt)) this.landed(bench);
    }
    if (this.tool === 'cut' && this.cutFrom) this.showCutGuide(dt);
    else this.updateGuide(dt);
    for (const bench of this.benches) bench.view.update(bench.flap.hidden);
    const { hover } = this;
    if (hover && hover.bench.piece.revision !== hover.revision) this.clearHover();
    this.hint.update(dt, this.hover?.bench.piece.soft.x ?? null);
    for (const grip of this.grips) {
      grip.marker.group.position.set(grip.pin.heldX, grip.pin.heldY, grip.pin.heldZ);
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

  private height(): number {
    let top = 0;
    for (const bench of this.benches) {
      const { x } = bench.piece.soft;
      for (let i = 1; i < x.length; i += 3) top = Math.max(top, x[i] as number);
    }
    return top;
  }

  /** How many places paper is passing through itself right now. Slow: lab and tests only. */
  crossings(): number {
    return this.benches.reduce((sum, b) => sum + countCrossings(b.piece.soft.mesh, b.piece.soft.x), 0);
  }

  readout(): LabReadout {
    const first = this.benches[0];
    const { active, assessment } = this;
    return {
      pieces: this.benches.length,
      faces: this.benches.reduce((sum, b) => sum + b.piece.book.faces.length, 0),
      tallest: this.benches.reduce((most, b) => Math.max(most, b.piece.book.tallest), 0),
      folds: this.log.filter((s) => s.action === 'fold').length,
      pins: this.grips.length,
      simulationMs: this.simulationMs,
      triangles: this.benches.reduce((sum, b) => sum + b.view.triangles, 0),
      stretch: first ? first.piece.soft.stretch() : 0,
      message: this.message,
      log: this.log,
      hardened: this.hardened,
      cellMetres: this.definition.size / this.definition.cells,
      floppiness: this.definition.floppiness,
      height: this.height(),
      lowest: this.benches.reduce((low, b) => Math.min(low, b.view.lowest), Infinity),
      hoverFaces: this.hover?.size ?? 0,
      liftedFaces: this.benches.reduce((sum, b) => sum + b.piece.lifted.size, 0),
      fixedFlaps: this.benches.reduce((sum, b) => sum + b.piece.fixedFlaps, 0),
      held: active ? { x: active.pin.heldX, y: active.pin.heldY, z: active.pin.heldZ, ready: assessment?.reachable ?? false } : null,
      recipe: this.recipe,
    };
  }
}

const LINE_NAMES: Record<LineKind, string> = { x: 'straight', z: 'straight', sum: 'diagonal', diff: 'diagonal' };

const OPEN_FAILURE_TEXT: Record<ReshapeFailure, string> = {
  'cannot-lie-flat': 'those creases cannot lie flat.',
  'no-layer-order': 'no layer order works.',
};

const FAILURE_TEXT: Record<FoldFailure, string> = {
  'not-a-grid-line': 'That is not on the grid.',
  'nothing-moves': 'Nothing on that side to fold.',
  'nothing-stays': 'All the paper would move.',
  jammed: 'Jammed: another layer is pinning that paper down.',
  'layers-cross': 'Layers would have to pass through each other.',
};
