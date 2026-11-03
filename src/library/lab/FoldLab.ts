import { Box3, Group, Plane, Raycaster, Vector2, Vector3 } from 'three';
import type { PerspectiveCamera, Scene } from 'three';
import { Spring } from '@/core/anim/spring';
import type { SheetDefinition } from '@/core/asset/sheetTypes';
import { lineAcrossSheet } from '@/core/fold/foldGuide';
import { aimFold, applyLift, liftFor, PlanCache, SNAP_RADIUS } from '@/core/fold/foldIntent';
import type { FoldGuess } from '@/core/fold/foldGuide';
import { FoldBook } from '@/core/fold/FoldBook';
import type { Landing } from '@/core/fold/FoldBook';
import { lineNormal, UNITS_PER_CELL } from '@/core/fold/lattice';
import type { LineKind, MirrorLine } from '@/core/fold/lattice';
import type { Joint } from '@/core/fold/craft';
import { blankBook } from '@/core/fold/paper';
import type { PaperShape } from '@/core/fold/paper';
import { foldRequest, RECIPES, toMirrorLine } from '@/core/fold/recipes';
import type { CompleteStep, FoldStep, Recipe, RecipeStep, TrimStep } from '@/core/fold/recipes';
import type { ReshapeFailure } from '@/core/fold/reshape';
import { readFlat, SheetPiece } from '@/core/fold/SheetPiece';
import type { FoldRefusal, PiecePlan } from '@/core/fold/SheetPiece';
import { countCrossings } from '@/core/fold/soft/crossings';
import type { Pin } from '@/core/fold/soft/SoftSheet';
import type { ScrapBurst } from '@/core/fx/ScrapBurst';
import type { Shake } from '@/core/fx/Shake';
import { SheetView } from '@/core/render/SheetView';
import { SwingFlap } from '@/core/render/SwingFlap';
import { FixedStep } from '@/core/sim/FixedStep';
import { AngleTag, FlapHint, FoldGhost, HeldMarks, LockBrush, PIN_COLOURS, PinMarker, Tether } from './LabMarkers';

const MAX_PINS = 3;
const FOLLOW_RATE = 16;
const MARKER_PICK_RADIUS = 0.42;
const SETTLE_STEPS = 30;
/** Pointer travel, in pixels, that turns a click into a drag. */
const DRAG_START = 6;
const DRAG_PLANE_HEIGHT = 0.05;
/** Degrees a joint snaps to. Shift turns it freely. */
const ANGLE_SNAP = 15;
/** The shortest lever a drag is measured on, in metres, so grabbing by the hinge still works. */
const SHORTEST_LEVER = 1;
/** Radius of the brush that paints locks, in metres. */
const BRUSH_RADIUS = 0.9;
/** Seconds between rebuilds of the cloth while locks are painted: each one rebuilds it. */
const PAINT_INTERVAL = 0.06;
/** Metres past its reach at which a hand shows full strain. */
const FULL_STRAIN = 1.5;
/** Seconds that paper just freed glows. */
const FREED_GLOW = 0.45;

export type LabTool = 'fold' | 'cut' | 'lock';

/** One sheet of paper on the bench, with its picture. */
interface Bench {
  piece: SheetPiece;
  view: SheetView;
  flap: SwingFlap;
  /** The angle each joint is showing, which springs towards the one that was set. */
  shown: Spring[];
  /** Paper a fold just locked, marked once the fold lands, and the point its ink spreads from. */
  pressed: { faces: ReadonlySet<number>; from: { x: number; z: number } } | null;
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
  /**
   * The paper as it lay when the hand started pulling. The hand is read against this:
   * paper being pulled bends and rolls, and a frame refitted to it each moment
   * misread the hand by metres and lined up the wrong fold.
   */
  lay: ((x: number, z: number, out: Float64Array) => void) | null;
  /** What this hand first lifted, to go back to when no fold is lined up. */
  flap: ReadonlySet<number>;
}

/** A press of the lock tool on the paper. */
interface LockStroke {
  bench: Bench;
  face: number;
  /** Where it was pressed, on the flat sheet and in the world. */
  flat: { x: number; z: number };
  at: Vector3;
  /** True if this press locks paper, false if it frees it. */
  locking: boolean;
  under: boolean;
  /** With Shift, every layer under the brush, not only the paper first pressed. */
  every: boolean;
  /** The flat paper first pressed. The brush paints only this, so a layer can be locked under another. */
  panel: ReadonlySet<number>;
  x: number;
  y: number;
  moved: boolean;
  /** Where the brush last painted, on the flat sheet, and the face there. */
  last: { x: number; z: number; face: number } | null;
  /** Faces painted since the cloth was last rebuilt. */
  pending: Set<number>;
}

/** What dropping a held point would do. */
interface Assessment {
  guess: FoldGuess;
  plan: PiecePlan;
  landing: Landing;
  reachable: boolean;
}

interface Snapshot {
  book: FoldBook;
  held: number[];
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
  completed: boolean;
  /** The joints of a finished craft. */
  joints: { faces: number; angle: number; partner: number; mirrored: boolean }[];
  /** The joint being turned right now, or -1. */
  turning: number;
  cellMetres: number;
  /** The shape a fresh sheet starts as. */
  paper: PaperShape;
  floppiness: number;
  /** How far the paper rises off the ground, in metres. */
  height: number;
  /** How far paper that no hand has lifted rises off the ground: the layers left lying. */
  resting: number;
  /** The lowest point of paper actually drawn, in metres. */
  lowest: number;
  /** Faces lit up under the pointer, ready to lift. */
  hoverFaces: number;
  /** Faces lifted off their stack right now. */
  liftedFaces: number;
  /** Faces locked in place right now. */
  lockedFaces: number;
  /** True when a made fold locks down with the paper it lands on. */
  lockFolds: boolean;
  /** The pin that would fold if dropped, and whether it would succeed. */
  held: { x: number; y: number; z: number; ready: boolean; from: { x: number; z: number }; to: { x: number; z: number } | null; strain: number } | null;
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
  /** Where the hand is aiming on the flat paper, so a check can see what the guide was given. */
  private aimedAt: { x: number; z: number } | null = null;
  private readonly plans = new PlanCache();

  private readonly clock = new FixedStep();
  private readonly ghost: FoldGhost;
  private readonly hint: FlapHint;
  private readonly tag: AngleTag;
  private readonly marks = new HeldMarks();
  private readonly brush: LockBrush;
  private readonly tether: Tether;
  private stroke: LockStroke | null = null;
  private paintClock = 0;
  /** Where the pointer last was, for keys that act on the paper under it. */
  private pointerAt: { x: number; y: number } | null = null;
  /** Paper just freed glows for a moment: on which sheet, and for how much longer. */
  private freed: { bench: Bench; left: number } | null = null;
  /** Locked paper in the way of the fold a hand has lined up. It is inked, and L frees it. */
  private blocking: { bench: Bench; faces: Set<number> } | null = null;
  /** When true, a made fold is locked to the paper it lands on, as if creased and held down. */
  private lockFolds = true;
  /** The flap lit up under the pointer. */
  private hover: { bench: Bench; face: number; size: number; revision: number } | null = null;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly dragPlane = new Plane(new Vector3(0, 1, 0), -DRAG_PLANE_HEIGHT);
  private readonly history: Snapshot[] = [];
  private log: RecipeStep[] = [];
  private completed = false;
  /** A hand turning a joint of a finished craft. */
  private posing: { bench: Bench; joint: number; flat: { x: number; z: number }; raw: number; x: number; y: number } | null = null;
  /** True when the sheet starts turned over, for a recipe that wants its printed face outside. */
  private faceDown = false;
  /** The shape fresh sheets start as. Recipes always start square: they cut their own. */
  private paper: PaperShape = 'square';
  private square = false;
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
    this.tag = new AngleTag(canvas.parentElement as HTMLElement);
    this.brush = new LockBrush(overlay, BRUSH_RADIUS);
    this.tether = new Tether(overlay);
    this.addBench(this.blank());
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
    const view = new SheetView(piece, this.marks);
    this.group.add(view.group);
    const bench: Bench = { piece, view, flap: new SwingFlap(piece, this.group), shown: [], pressed: null };
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
    this.blocking = null;
    this.freed = null;
    this.ghost.hide();
  }

  dispose(): void {
    this.clearBenches();
    this.ghost.group.removeFromParent();
    this.hint.dispose();
    this.tag.dispose();
    this.marks.dispose();
    this.brush.dispose();
    this.tether.dispose();
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
    this.rayAt(event.clientX, event.clientY);
  }

  private rayAt(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
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
    if (this.completed) {
      this.startTurning(event);
      return;
    }
    if (this.tool === 'cut') {
      const hit = this.pick();
      if (!hit) return;
      this.cutFrom = { bench: hit.bench, flat: this.flatPoint(hit.bench, hit.tri, hit.b0, hit.b1, hit.b2) };
      this.cutTo = null;
      this.setOrbit(false);
      event.stopPropagation();
      return;
    }
    if (this.tool === 'lock') {
      this.startStroke(event);
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
    // Keys act on the paper under the pointer, and not through the panels over the canvas.
    this.pointerAt = event.target === this.canvas ? { x: event.clientX, y: event.clientY } : null;
    if (this.posing) {
      this.turnJoint(event);
      return;
    }
    if (this.tool === 'cut' && this.cutFrom) {
      this.ray(event);
      const point = this.raycaster.ray.intersectPlane(this.dragPlane, new Vector3());
      if (point) this.cutTo = { x: point.x, z: point.z };
      return;
    }
    if (this.stroke) {
      this.continueStroke(event);
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
    if (!grip.carried && grip.seeds.length === 1 && !piece.pulling && piece.book.depth(grip.face) > 1 && piece.peel(grip.face, !grip.fromAbove)) {
      grip.peeled = true;
      this.regrip(grip.bench);
    }
    grip.lay = piece.frameNow(piece.lifted);
    grip.flap = grip.peeled ? piece.lifted : new Set();
    grip.carried = true;
    this.active = grip;
    this.assessment = null;
    this.plans.clear();
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
    if (this.posing) {
      this.stopTurning();
      return;
    }
    if (this.tool === 'cut' && this.cutFrom) {
      this.finishCut();
      return;
    }
    if (this.stroke) {
      this.endStroke();
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
    if (press.moved) this.setMessage(this.blocking ? BLOCKED_TEXT : 'Holding. Click the pin to drop it and crease, or right click to let it fall.');
    else this.setMessage('Pinned.');
  };

  // ---- Showing what the pointer would take hold of ----

  private updateHover(event: PointerEvent): void {
    if (event.buttons !== 0 || event.target !== this.canvas || this.flapsBusy() || (this.tool === 'cut' && !this.completed)) {
      this.fadeHover();
      this.brush.hide();
      return;
    }
    this.ray(event);
    if (this.completed) {
      this.hoverJoint();
      return;
    }
    if (this.tool === 'lock') {
      this.hoverLock(event);
      return;
    }
    const hit = this.markerUnderPointer() ? null : this.pick(event.ctrlKey);
    const fromAbove = (hit?.fromAbove ?? true) && !event.ctrlKey;
    const face = hit && !hit.bench.piece.pulling ? this.faceOn(hit.bench, hit.tri, fromAbove) : -1;
    if (!hit || face < 0) {
      this.fadeHover();
      return;
    }
    // Locked paper cannot be taken hold of. It lights up in ink instead: what L would free.
    if (hit.bench.piece.held.has(face)) {
      this.canvas.style.cursor = 'not-allowed';
      if (this.hover?.bench === hit.bench && this.hover.face === face) return;
      const { piece } = hit.bench;
      const region = this.lockRegion(piece, face, !fromAbove, false);
      this.hover = { bench: hit.bench, face, size: region.size, revision: piece.revision };
      this.hint.show(piece.soft.mesh, region, 'lock');
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

  /** On a finished craft, only what turns lights up: a joint, and the partner that mirrors it. */
  private hoverJoint(): void {
    const hit = this.pick();
    const joint = hit ? (hit.bench.piece.soft.mesh.triFlap[hit.tri] as number) : -1;
    if (!hit || joint < 0) {
      this.fadeHover();
      return;
    }
    if (this.hover?.bench === hit.bench && this.hover.face === joint) return;
    const { piece } = hit.bench;
    const { joints } = piece;
    const target = joints[joint];
    if (!target) return;
    const partner = target.mirrored ? joints[target.partner] : undefined;
    const faces = new Set([...target.faces, ...(partner?.faces ?? [])]);
    this.hover = { bench: hit.bench, face: joint, size: faces.size, revision: piece.revision };
    this.hint.show(piece.soft.mesh, faces);
    this.canvas.style.cursor = 'grab';
  }

  private fadeHover(): void {
    this.canvas.style.cursor = '';
    if (!this.hover) return;
    this.hover = null;
    this.hint.hide();
  }

  private clearHover(): void {
    this.hover = null;
    this.hint.clear();
    this.canvas.style.cursor = '';
  }

  // ---- Turning the joints of a finished craft ----

  private startTurning(event: PointerEvent): void {
    const hit = this.pick();
    const joint = hit ? (hit.bench.piece.soft.mesh.triFlap[hit.tri] as number) : -1;
    if (!hit || joint < 0) return;
    const grabbed = this.flatPoint(hit.bench, hit.tri, hit.b0, hit.b1, hit.b2);
    const { angle: raw, point, across } = hit.bench.piece.joints[joint] as Joint;
    const lever = (grabbed.x - point[0]) * across[0] + (grabbed.z - point[1]) * across[1];
    const extra = Math.max(0, SHORTEST_LEVER - lever);
    const flat = { x: grabbed.x + across[0] * extra, z: grabbed.z + across[1] * extra };
    this.posing = { bench: hit.bench, joint, flat, raw, x: event.clientX, y: event.clientY };
    this.canvas.style.cursor = 'grabbing';
    this.setOrbit(false);
    event.stopPropagation();
  }

  /** Where a joint's grabbed point would be on screen at an angle. */
  private screenAt(degrees: number): Vector2 {
    const { bench, joint, flat } = this.posing as NonNullable<FoldLab['posing']>;
    const out = new Float64Array(3);
    bench.piece.jointWorld(joint, flat.x, flat.z, degrees, out);
    const point = new Vector3().fromArray(out).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return new Vector2(((point.x + 1) / 2) * rect.width, ((1 - point.y) / 2) * rect.height);
  }

  /** The paper follows the hand: whatever way the point would move on screen is the way to pull. */
  private turnJoint(event: PointerEvent): void {
    const posing = this.posing as NonNullable<FoldLab['posing']>;
    const { bench, joint } = posing;
    const { piece } = bench;
    const dx = event.clientX - posing.x, dy = event.clientY - posing.y;
    posing.x = event.clientX;
    posing.y = event.clientY;
    const step = posing.raw < 170 ? 5 : -5;
    const tangent = this.screenAt(posing.raw + step).sub(this.screenAt(posing.raw)).divideScalar(step);
    const reach = tangent.lengthSq();
    if (reach > 1e-3) posing.raw = Math.max(0, Math.min(180, posing.raw + (dx * tangent.x + dy * tangent.y) / reach));

    const angle = event.shiftKey ? Math.round(posing.raw) : Math.round(posing.raw / ANGLE_SNAP) * ANGLE_SNAP;
    const host = (this.canvas.parentElement as HTMLElement).getBoundingClientRect();
    this.tag.show(event.clientX - host.left, event.clientY - host.top, angle);
    if (angle === piece.joints[joint]?.angle) return;
    piece.setAngle(joint, angle);
    this.syncShown(bench);
    this.shake.add(0.03);
    this.notify();
  }

  private stopTurning(): void {
    const posing = this.posing as NonNullable<FoldLab['posing']>;
    const angle = posing.bench.piece.joints[posing.joint]?.angle ?? 0;
    this.posing = null;
    this.tag.hide();
    this.canvas.style.cursor = '';
    this.setOrbit(true);
    this.setMessage(`Set at ${angle} degrees.`);
  }

  private syncShown(bench: Bench): void {
    bench.piece.joints.forEach((joint, i) => {
      const spring = bench.shown[i];
      if (spring) spring.target = joint.angle;
    });
  }

  /** Marks the paper complete: its outermost flaps become hinges, and folding ends. */
  complete(): void {
    if (this.completed || this.flapsBusy()) return;
    this.letGoAll();
    this.clearHover();
    this.completed = true;
    let count = 0;
    for (const bench of this.benches) {
      const before = bench.piece.corners();
      count += bench.piece.complete().length;
      bench.shown = bench.piece.joints.map(() => new Spring(0, 5, 0.5));
      bench.flap.start(new Set(bench.piece.book.faces), before, null);
    }
    this.setMessage(count > 0 ? 'Complete. Drag a flap to set its angle.' : 'Complete. Nothing here can turn: no outer flap is free.');
  }

  /** Back to loose paper, to fold further. The angles are dropped. */
  backToFolding(): void {
    if (!this.completed || this.flapsBusy()) return;
    this.clearHover();
    this.completed = false;
    for (const bench of this.benches) {
      const before = bench.piece.corners();
      bench.piece.reopen();
      bench.shown = [];
      bench.flap.start(new Set(bench.piece.book.faces), before, null);
    }
    this.setMessage('Back to folding.');
  }

  /** Lets a pair of joints move apart, or brings them back together. */
  setMirrored(joint: number, mirrored: boolean): void {
    const bench = this.benches[0];
    if (!bench) return;
    bench.piece.setMirrored(joint, mirrored);
    this.syncShown(bench);
    this.notify();
  }

  /** Sets an angle directly, for screenshots. */
  setAngle(joint: number, degrees: number): void {
    const bench = this.benches[0];
    if (!bench) return;
    bench.piece.setAngle(joint, degrees);
    bench.piece.joints.forEach((j, i) => bench.shown[i]?.snap(j.angle));
    bench.piece.pose();
  }

  private showJoints(bench: Bench, dt: number): void {
    if (bench.shown.every((spring) => spring.settled)) return;
    bench.piece.pose(bench.shown.map((spring) => Math.max(0, Math.min(180, spring.update(dt)))));
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
    if (piece.held.has(face)) {
      this.shake.add(0.05);
      this.setMessage('Locked. Press L over it, or use the Lock tool, to free it.');
      return null;
    }
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

    const grip: Grip = { slot, bench, pin, marker, face, flat, seeds, target: new Vector3(pin.x, pin.y, pin.z), lift: 0, carried: false, peeled: false, fromAbove: hit.fromAbove, lay: null, flap: new Set() };
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
      this.showBlocking(grip.bench, null);
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
    const assessment = grip.carried ? this.assess(grip) : null;
    if (assessment?.reachable) {
      this.commit(grip, assessment);
      return;
    }
    const failure = assessment?.plan.failure;
    if (failure === 'layers-cross' || failure === 'held') this.reportFailure(failure);
    this.letGo(grip);
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
    const aim = aimFold(piece, grip.lay ?? piece.frameOf(piece.lifted), grip.flat, grip.target, grip.seeds, this.plans, String(grip.slot));
    this.aimedAt = aim ? { x: aim.aimedAt.x, z: aim.aimedAt.z } : readFlat(grip.lay ?? piece.frameOf(piece.lifted), grip.target);
    if (!aim) return null;
    const { guess, plan, landing, reachable } = aim;
    this.showBlocking(grip.bench, plan.failure === 'held' && guess.miss < SNAP_RADIUS ? plan.moved : null);
    if (grip.carried && !this.completed && applyLift(piece, liftFor(aim, grip.lift, grip.flap, !grip.fromAbove))) {
      grip.peeled = true;
      this.regrip(grip.bench);
    }
    return { guess, plan, landing, reachable };
  }

  /** Lights up the locked paper a lined-up fold would have to move, or clears it. */
  private showBlocking(bench: Bench, moved: ReadonlySet<number> | null): void {
    const faces = moved ? new Set([...moved].filter((f) => bench.piece.held.has(f))) : null;
    const same = this.blocking && faces && this.blocking.bench === bench && this.blocking.faces.size === faces.size;
    if (same || (!this.blocking && !faces)) return;
    this.blocking = faces ? { bench, faces } : null;
    if (faces) {
      this.hover = null;
      this.hint.show(bench.piece.soft.mesh, faces, 'lock');
      this.setMessage(BLOCKED_TEXT);
    } else if (!this.hover && !this.freed) {
      this.hint.hide();
    }
  }


  private updateGuide(dt: number): void {
    const grip = this.active;
    if (!grip) {
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
    const frame = grip.lay ?? piece.frameOf(piece.lifted);
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
    const done = this.foldBench(bench, landing, guess.line, guess.side, seeds, false, piece.restPoint(grip.face, grip.flat.x, grip.flat.z));
    if (done.failure) {
      this.history.pop();
      this.reportFailure(done.failure);
      return;
    }
    void plan;
    this.log = [...this.log, this.stepFor(piece, guess, seeds, landing)];
    const locked = this.lockFolds ? ' and locked down' : '';
    this.setMessage(`Creased along a ${LINE_NAMES[guess.line.kind]} line${locked}. ${piece.book.tallest} layers at the thickest.`);
  }

  private stepFor(piece: SheetPiece, guess: FoldGuess, seeds: readonly number[], landing: Landing): FoldStep {
    const at = (guess.line.c * piece.definition.size) / (piece.book.cells * UNITS_PER_CELL);
    return { action: 'fold', label: 'By hand', kind: guess.line.kind, at, side: guess.side, grip: seeds.length === 1 ? 'top' : 'all', landing };
  }

  private foldBench(bench: Bench, landing: Landing, line: MirrorLine, side: number, seeds: readonly number[], swing: boolean, from: { x: number; z: number }): PiecePlan {
    const { piece } = bench;
    const before = piece.corners();
    const frame = piece.frameOf(new Set());
    const axis = swing ? this.axisFor(piece, line, frame, side, landing) : null;
    const was = new Set(piece.held);
    const plan = piece.fold({ line, side, seeds, landing }, swing, this.lockFolds);
    if (plan.failure) return plan;
    // Paper the fold locked is inked once it lands, spreading out from where it was held.
    const pressed = new Set([...piece.held].filter((f) => !was.has(f)));
    if (pressed.size > 0) {
      this.marks.hide(pressed);
      bench.pressed = { faces: pressed, from };
    }
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

  private reportFailure(failure: FoldRefusal): void {
    this.shake.add(0.3);
    this.setMessage(FAILURE_TEXT[failure]);
  }

  private landed(bench: Bench): void {
    if (bench.pressed) {
      this.marks.press(bench.pressed.faces, bench.pressed.from);
      bench.pressed = null;
    }
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
    const { piece } = this.benches[0] as Bench;
    this.history.push({ book: piece.book.clone(), held: [...piece.held], log: this.log, recipeNext: this.recipe?.next ?? 0 });
  }

  /** Lab only: the game itself has no undo. */
  stepBack(): void {
    if (this.completed && !this.recipe) {
      this.backToFolding();
      return;
    }
    const snapshot = this.history.pop();
    if (!snapshot) return;
    this.clearBenches();
    this.log = snapshot.log;
    if (this.recipe) this.recipe.next = snapshot.recipeNext;
    this.addBench(new SheetPiece(this.dressed(), snapshot.book, {}, undefined, snapshot.held));
    this.completed = false;
    this.setMessage('Stepped back.');
  }

  /** The sheet as it lies on the bench, which may be turned over. */
  private dressed(): SheetDefinition {
    const { definition } = this;
    return this.faceDown ? { ...definition, top: definition.bottom, bottom: definition.top } : definition;
  }

  /** A fresh sheet, of the chosen shape. */
  private blank(): SheetPiece {
    const definition = this.dressed();
    return new SheetPiece(definition, blankBook(definition.cells, this.square ? 'square' : this.paper));
  }

  reset(definition = this.definition, faceDown = false, square = false): void {
    this.definition = definition;
    this.faceDown = faceDown;
    this.square = square;
    this.clearBenches();
    this.history.length = 0;
    this.log = [];
    this.recipe = null;
    this.autoplay = false;
    this.completed = false;
    this.addBench(this.blank());
    this.setMessage(`A fresh sheet, ${definition.size / definition.cells} m between fold lines.`);
  }

  setCells(cells: number): void {
    this.reset({ ...this.definition, cells });
  }

  get cells(): number {
    return this.definition.cells;
  }

  /** Chooses the shape fresh sheets start as, and lays one out. */
  setPaper(paper: PaperShape): void {
    this.paper = paper;
    this.reset();
    this.setMessage(paper === 'a4' ? 'A fresh A4 sheet: 7 by 10 m.' : 'A fresh square sheet: 10 by 10 m.');
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
    this.reset(this.definition, recipe.faceDown, true);
    this.recipe = { recipe, next: 0 };
    this.setMessage(recipe.source);
  }

  /** Runs the next step, animated. */
  nextStep(): void {
    const step = this.recipe?.recipe.steps[this.recipe.next];
    const bench = this.benches[0];
    if (!this.recipe || !step || !bench || this.flapsBusy() || this.completed) return;
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
    } else if (step.action === 'complete') {
      this.complete();
      this.openJoint(bench, step);
      this.syncShown(bench);
    } else {
      const { piece } = bench;
      const request = foldRequest(piece.book, piece.definition.size, step);
      const landing = step.landing ?? { kind: 'over' };
      // Following the steps, a crew frees whatever the next fold has to move.
      const moving = piece.book.plan({ line: request.line, side: request.side, seeds: request.seeds, landing });
      if (!moving.failure) piece.lock(moving.moved, false);
      const plan = this.foldBench(bench, landing, request.line, request.side, request.seeds, true, restMiddle(piece, moving.moved));
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

  private openJoint(bench: Bench, step: CompleteStep): void {
    const { piece } = bench;
    const joint = piece.jointNear(step.at[0], step.at[1]);
    if (joint < 0) throw new Error(`${step.label}: nothing turns there`);
    piece.setAngle(joint, step.angle);
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
  applyRecipe(id: string, steps = Infinity): (FoldRefusal | null)[] {
    this.openRecipe(id);
    const results: (FoldRefusal | null)[] = [];
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
      if (step.action === 'complete') {
        this.complete();
        bench.flap.clear();
        this.openJoint(bench, step);
        bench.piece.joints.forEach((joint, i) => bench.shown[i]?.snap(joint.angle));
        bench.piece.pose();
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
    for (const bench of this.benches) this.showJoints(bench, dt);
    this.tag.update(dt);
    this.marks.update(dt);
    this.paint(dt);
    this.brush.update(dt);
    this.showStrain();
    if (this.freed) {
      this.freed.left -= dt;
      if (this.freed.left <= 0 || this.hover) {
        if (!this.hover) this.hint.hide();
        this.freed = null;
      }
    }
    for (const bench of this.benches) bench.view.update(bench.flap.hidden);
    const { hover } = this;
    if (hover && hover.bench.piece.revision !== hover.revision) this.clearHover();
    this.hint.update(dt, (this.hover ?? this.freed ?? this.blocking)?.bench.piece.soft.x ?? null);
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

  // ---- Locking paper ----

  /** Whether a made fold locks down with the paper it lands on. */
  setLockFolds(locked: boolean): void {
    this.lockFolds = locked;
    this.setMessage(locked ? 'New folds lock down where they land.' : 'New folds stay loose.');
  }

  /** Locks every sheet where it lies, or frees them all. */
  lockAll(locked: boolean): void {
    if (this.completed || this.flapsBusy()) return;
    let count = 0;
    for (const bench of this.benches) count += this.setLock(bench, bench.piece.book.faces, locked, { x: 0, z: 0 }, null);
    if (count > 0) this.setMessage(locked ? 'Locked everything. Free what you want to fold.' : 'Everything is free.');
  }

  /**
   * Locks or frees the flap under the pointer: the L key. With Shift, every layer there.
   * While a lined-up fold is blocked by locked paper, it frees that paper instead.
   */
  toggleLockUnderPointer(every: boolean): void {
    if (this.completed || this.flapsBusy() || this.stroke) return;
    if (this.blocking) {
      const { bench, faces } = this.blocking;
      this.blocking = null;
      if (this.setLock(bench, faces, false, { x: 0, z: 0 }, null) > 0) this.setMessage('Freed what was in the way. Drop the pin to fold.');
      return;
    }
    if (!this.pointerAt) return;
    this.rayAt(this.pointerAt.x, this.pointerAt.y);
    const hit = this.markerUnderPointer() ? null : this.pick();
    if (!hit) return;
    const face = this.faceOn(hit.bench, hit.tri, hit.fromAbove);
    if (face < 0) return;
    const { piece } = hit.bench;
    const locking = !piece.held.has(face);
    const flat = this.flatPoint(hit.bench, hit.tri, hit.b0, hit.b1, hit.b2);
    const region = this.lockRegion(piece, face, !hit.fromAbove, every);
    if (this.setLock(hit.bench, region, locking, piece.restPoint(face, flat.x, flat.z), this.hitPoint(hit)) > 0) {
      this.setMessage(locking ? LOCKED_TEXT : FREED_TEXT);
    }
  }

  /** What a click or L locks or frees: the flap at a face, or with Shift every layer there. */
  private lockRegion(piece: SheetPiece, face: number, under: boolean, every: boolean): Set<number> {
    if (!every) return piece.flapOf(face, under);
    const region = new Set<number>();
    for (const f of piece.book.stackOf(face)) for (const g of piece.flapOf(f, under)) region.add(g);
    return region;
  }

  /**
   * Locks paper or frees it. Locking inks it from the point pressed, with a small
   * thud; freeing makes it glow for a moment, so it is clear what came loose.
   */
  private setLock(bench: Bench, faces: Iterable<number>, locking: boolean, from: { x: number; z: number }, at: Vector3 | null): number {
    const { piece } = bench;
    const changed = piece.lock(faces, locking);
    if (changed.size === 0) return 0;
    this.plans.clear();
    if (locking) {
      this.marks.press(changed, from);
      // A hand on paper that is now held has nothing left to pull.
      for (const grip of this.grips.filter((g) => g.bench === bench && piece.held.has(g.face))) this.dropGrip(grip);
      this.shake.add(0.05);
      if (at) this.scraps.burst(at, 6, [piece.definition.top, piece.definition.bottom], 0.35, 0.5);
    }
    this.regrip(bench);
    if (!locking) {
      this.clearHover();
      this.hint.show(piece.soft.mesh, changed, 'lift');
      this.freed = { bench, left: FREED_GLOW };
    }
    this.notify();
    return changed.size;
  }

  /** With the lock tool, what a click would lock or free lights up, and the brush follows the pointer. */
  private hoverLock(event: PointerEvent): void {
    const hit = this.pick(event.ctrlKey);
    const under = event.ctrlKey || !(hit?.fromAbove ?? true);
    const face = hit ? this.faceOn(hit.bench, hit.tri, !under) : -1;
    if (!hit || face < 0) {
      this.fadeHover();
      this.brush.hide();
      return;
    }
    const { piece } = hit.bench;
    const locking = !piece.held.has(face);
    this.brush.show(this.hitPoint(hit), locking);
    this.canvas.style.cursor = 'crosshair';
    const { hover } = this;
    if (hover?.bench === hit.bench && hover.face === face) return;
    const region = this.lockRegion(piece, face, under, event.shiftKey);
    this.hover = { bench: hit.bench, face, size: region.size, revision: piece.revision };
    this.hint.show(piece.soft.mesh, region, locking ? 'lock' : 'lift');
  }

  /** The lock tool pressed on paper. Locking or freeing is decided by what was pressed. */
  private startStroke(event: PointerEvent): void {
    const hit = this.pick(event.ctrlKey);
    const under = event.ctrlKey || !(hit?.fromAbove ?? true);
    const face = hit ? this.faceOn(hit.bench, hit.tri, !under) : -1;
    if (!hit || face < 0) return;
    const { piece } = hit.bench;
    const flat = this.flatPoint(hit.bench, hit.tri, hit.b0, hit.b1, hit.b2);
    this.stroke = {
      bench: hit.bench,
      face,
      flat,
      at: this.hitPoint(hit),
      locking: !piece.held.has(face),
      under,
      every: event.shiftKey,
      panel: piece.flatRegion(face),
      x: event.clientX,
      y: event.clientY,
      moved: false,
      // A stroke paints from where it was pressed, however quick the first move.
      last: { x: flat.x, z: flat.z, face },
      pending: new Set(),
    };
    this.paintClock = 0;
    this.brush.press();
    this.setOrbit(false);
    event.stopPropagation();
  }

  /** Dragging paints: everything under the brush on the paper first pressed. */
  private continueStroke(event: PointerEvent): void {
    const stroke = this.stroke as LockStroke;
    if (!stroke.moved) {
      if (Math.hypot(event.clientX - stroke.x, event.clientY - stroke.y) < DRAG_START) return;
      stroke.moved = true;
      this.fadeHover();
    }
    this.ray(event);
    const hit = this.pick(stroke.under);
    if (!hit || hit.bench !== stroke.bench) return;
    const { piece } = stroke.bench;
    const point = this.flatPoint(hit.bench, hit.tri, hit.b0, hit.b1, hit.b2);
    this.brush.show(this.hitPoint(hit), stroke.locking);
    this.canvas.style.cursor = 'crosshair';
    // Paint in between pointer events too, so a quick stroke leaves no gaps.
    const from = stroke.last ?? point;
    const steps = Math.max(1, Math.ceil(Math.hypot(point.x - from.x, point.z - from.z) / (BRUSH_RADIUS / 2)));
    for (let i = 1; i <= steps; i++) {
      const x = from.x + ((point.x - from.x) * i) / steps, z = from.z + ((point.z - from.z) * i) / steps;
      for (const f of piece.facesWithin(x, z, BRUSH_RADIUS)) if (stroke.every || stroke.panel.has(f)) stroke.pending.add(f);
    }
    stroke.last = { x: point.x, z: point.z, face: this.faceOn(hit.bench, hit.tri, !stroke.under) };
  }

  /** Painted locks land a few times a second, not on every pointer event. */
  private paint(dt: number): void {
    const { stroke } = this;
    if (!stroke || stroke.pending.size === 0) return;
    this.paintClock -= dt;
    if (this.paintClock > 0) return;
    this.paintClock = PAINT_INTERVAL;
    this.flushPaint(stroke);
  }

  private flushPaint(stroke: LockStroke): void {
    const { piece } = stroke.bench;
    const last = stroke.last;
    const from = last && last.face >= 0 ? piece.restPoint(last.face, last.x, last.z) : piece.restPoint(stroke.face, stroke.flat.x, stroke.flat.z);
    if (this.setLock(stroke.bench, stroke.pending, stroke.locking, from, null) > 0) this.brush.press();
    stroke.pending.clear();
  }

  /** A click locks or frees the whole flap; a drag has already painted. */
  private endStroke(): void {
    const stroke = this.stroke as LockStroke;
    this.stroke = null;
    this.setOrbit(true);
    const { bench, face, under, every, locking } = stroke;
    const { piece } = bench;
    if (stroke.moved) {
      if (stroke.pending.size > 0) this.flushPaint(stroke);
      this.setMessage(locking ? 'Painted a lock: that paper stays put now.' : 'Painted it free: that paper can move now.');
      return;
    }
    const region = this.lockRegion(piece, face, under, every);
    if (this.setLock(bench, region, locking, piece.restPoint(face, stroke.flat.x, stroke.flat.z), stroke.at) > 0) {
      this.setMessage(locking ? LOCKED_TEXT : FREED_TEXT);
    }
  }

  /** Where a picked point of paper is in the world. */
  private hitPoint(hit: NonNullable<ReturnType<FoldLab['pick']>>): Vector3 {
    const { x, mesh } = hit.bench.piece.soft;
    const point = new Vector3();
    const weights = [hit.b0, hit.b1, hit.b2];
    for (let k = 0; k < 3; k++) {
      const v = (mesh.tris[hit.tri * 3 + k] as number) * 3;
      const w = weights[k] as number;
      point.x += (x[v] as number) * w;
      point.y += (x[v + 1] as number) * w;
      point.z += (x[v + 2] as number) * w;
    }
    return point;
  }

  /** A hand that paper is holding back strains: the pin shivers, and a line runs to where it aims. */
  private showStrain(): void {
    for (const grip of this.grips) grip.marker.setStrain(grip === this.dragging ? Math.min(1, grip.pin.strain / FULL_STRAIN) : 0);
    const grip = this.dragging;
    if (!grip || grip.pin.strain < 0.08) {
      this.tether.hide();
      return;
    }
    const { pin } = grip;
    this.tether.show(new Vector3(pin.heldX, pin.heldY + 0.62, pin.heldZ), new Vector3(pin.x, pin.y + 0.62, pin.z), Math.max(0.2, Math.min(1, pin.strain / FULL_STRAIN)));
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

  /** The highest point of paper, or of paper lying in its stacks when `resting`. */
  private height(resting = false): number {
    let top = 0;
    for (const bench of this.benches) {
      const { x, mesh } = bench.piece.soft;
      for (let t = 0; t < mesh.triCount; t++) {
        if (resting && (mesh.triFlap[t] as number) >= 0) continue;
        for (let k = 0; k < 3; k++) top = Math.max(top, x[(mesh.tris[t * 3 + k] as number) * 3 + 1] as number);
      }
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
      completed: this.completed,
      joints: (first?.piece.joints ?? []).map((joint) => ({ faces: joint.faces.size, angle: joint.angle, partner: joint.partner, mirrored: joint.mirrored })),
      turning: this.posing?.joint ?? -1,
      cellMetres: this.definition.size / this.definition.cells,
      paper: this.paper,
      floppiness: this.definition.floppiness,
      height: this.height(),
      resting: this.height(true),
      lowest: this.benches.reduce((low, b) => Math.min(low, b.view.lowest), Infinity),
      hoverFaces: this.hover?.size ?? 0,
      liftedFaces: this.benches.reduce((sum, b) => sum + b.piece.lifted.size, 0),
      lockedFaces: this.benches.reduce((sum, b) => sum + b.piece.held.size, 0),
      lockFolds: this.lockFolds,
      held: active ? { x: active.pin.heldX, y: active.pin.heldY, z: active.pin.heldZ, ready: assessment?.reachable ?? false, from: active.flat, to: this.aimedAt, strain: active.pin.strain } : null,
      recipe: this.recipe,
    };
  }
}

const LINE_NAMES: Record<LineKind, string> = { x: 'straight', z: 'straight', sum: 'diagonal', diff: 'diagonal' };

const OPEN_FAILURE_TEXT: Record<ReshapeFailure, string> = {
  'cannot-lie-flat': 'those creases cannot lie flat.',
  'no-layer-order': 'no layer order works.',
};

const FAILURE_TEXT: Record<FoldRefusal, string> = {
  'not-a-grid-line': 'That is not on the grid.',
  'nothing-moves': 'Nothing on that side to fold.',
  'nothing-stays': 'All the paper would move.',
  'layers-cross': 'Layers would have to pass through each other.',
  held: 'Locked paper would have to move. Free it first: L over it, or the Lock tool.',
};

const BLOCKED_TEXT = 'Locked paper is in the way of this fold. Press L to free it.';
const LOCKED_TEXT = 'Locked: it stays put, whatever is pulled around it.';
const FREED_TEXT = 'Free: it can be lifted and folded now.';

/** The middle of some paper on the unfolded sheet, for marks to spread out from. */
function restMiddle(piece: SheetPiece, faces: Iterable<number>): { x: number; z: number } {
  const { rest, span } = piece.book;
  let x = 0, z = 0, count = 0;
  for (const f of faces) {
    for (let k = 0; k < 3; k++) {
      x += rest[f * 6 + k * 2] as number;
      z += rest[f * 6 + k * 2 + 1] as number;
      count++;
    }
  }
  if (count === 0) return { x: 0, z: 0 };
  return { x: (x / count - span / 2) * piece.unit, z: (z / count - span / 2) * piece.unit };
}
