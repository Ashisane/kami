import { Mesh, MeshBasicMaterial, PerspectiveCamera, RingGeometry, Scene, Vector3 } from 'three';
import type { WebGLRenderer } from 'three';
import type { SheetDefinition } from '@/core/asset/sheetTypes';
import { lineAcrossSheet } from '@/core/fold/foldGuide';
import { nearestPaper, worldOf } from '@/core/fold/paperPoints';
import { ScrapBurst } from '@/core/fx/ScrapBurst';
import { Shake } from '@/core/fx/Shake';
import { bakePaperGrain } from '@/core/paper/grainBake';
import { setPaperGrain } from '@/core/paper/PaperMaterial';
import { getStock } from '@/core/paper/paperLibrary';
import type { StockId } from '@/core/paper/stocks';
import { CuttingMat } from '@/core/render/CuttingMat';
import { FoldGhost, GOOD, Tether } from '@/core/render/guides';
import { LIGHTING_PRESETS } from '@/core/render/lighting';
import { LightRig } from '@/core/render/LightRig';
import { createRenderer, RenderPipeline } from '@/core/render/RenderPipeline';
import { SheetView } from '@/core/render/SheetView';
import { FixedStep } from '@/core/sim/FixedStep';
import { Controls } from '../input/Controls';
import { GameSim, STEP } from '../sim/GameSim';
import type { SimEvent } from '../sim/GameSim';
import { RULES } from '../sim/rules';
import { BeingView } from './BeingView';
import { FollowCamera } from './FollowCamera';
import { Hud } from './Hud';

/** The crew: each one's paper, and where it starts, round the sheet. */
const CREW: readonly { stock: StockId; x: number; z: number; facing: number }[] = [
  { stock: 'marigold', x: -6, z: -1.5, facing: Math.PI / 2 },
  { stock: 'teal', x: 6, z: -1.5, facing: -Math.PI / 2 },
  { stock: 'sakura', x: 0, z: -6.2, facing: 0 },
];
const MAX_FRAME = 1 / 20;
/** How hard each kind of moment shakes the screen, and how many scraps it throws. */
const JUICE: Partial<Record<SimEvent['kind'], { shake: number; scraps: number; power: number }>> = {
  grab: { shake: 0.04, scraps: 4, power: 0.35 },
  press: { shake: 0.32, scraps: 26, power: 1.1 },
  unfold: { shake: 0.22, scraps: 16, power: 0.8 },
  slip: { shake: 0.26, scraps: 14, power: 0.9 },
  refuse: { shake: 0.12, scraps: 0, power: 0 },
  jump: { shake: 0, scraps: 3, power: 0.25 },
  land: { shake: 0.07, scraps: 5, power: 0.35 },
};

/**
 * The experiment: three beings and a sheet of paper on a desk, seen from behind
 * whichever being is selected. The sim decides everything; this only draws it.
 */
export class PlayWorld {
  readonly renderer: WebGLRenderer;
  readonly camera = new PerspectiveCamera(50, 1, 0.05, 80);
  sim: GameSim;
  readonly controls: Controls;
  private readonly scene = new Scene();
  private readonly overlay = new Scene();
  private readonly pipeline: RenderPipeline;
  private readonly clock = new FixedStep(STEP);
  private readonly follow = new FollowCamera(this.camera);
  private readonly shake = new Shake();
  private readonly scraps = new ScrapBurst();
  private readonly ghost = new FoldGhost(this.overlay);
  private readonly tether = new Tether(this.overlay);
  private readonly reach: Mesh;
  private sheets: SheetView[] = [];
  private beings: BeingView[] = [];
  readonly hud: Hud;
  private gliding = false;
  private width = 1;
  private height = 1;
  private last = 0;
  frameMs = 16;
  /** The latest events, newest last, for checks to read. */
  readonly recent: SimEvent[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    host: HTMLElement,
    private readonly definition: SheetDefinition,
  ) {
    this.renderer = createRenderer(canvas);
    const grain = bakePaperGrain(this.renderer);
    setPaperGrain(grain.surface, grain.mottle);
    const lights = new LightRig(this.scene);
    lights.apply(LIGHTING_PRESETS[0] as (typeof LIGHTING_PRESETS)[number]);
    lights.focusOn(new Vector3(0, 0, 0), 9);
    lights.fitFog(9);
    const mat = new CuttingMat(this.renderer.capabilities.getMaxAnisotropy());
    this.scene.add(mat.mesh, this.scraps.mesh);
    this.pipeline = new RenderPipeline(this.renderer, this.scene, this.camera, this.overlay);

    this.sim = new GameSim(definition, CREW);
    this.showPaper();
    // A ring on the paper where E would take hold.
    this.reach = new Mesh(new RingGeometry(0.1, 0.14, 24), new MeshBasicMaterial({ color: GOOD, transparent: true, opacity: 0.9, depthTest: false }));
    this.reach.rotation.x = -Math.PI / 2;
    this.overlay.add(this.reach);

    this.controls = new Controls(canvas, CREW.length);
    this.controls.onSelect(() => (this.gliding = true));
    this.controls.onReset(() => this.reset());
    this.hud = new Hud(CREW.map(({ stock }) => ({ name: getStock(stock).name, colour: getStock(stock).color })));
    host.append(this.hud.element);
    const first = CREW[0] as (typeof CREW)[number];
    this.controls.yaw = first.facing;
    this.follow.snap(first.x, first.z);

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  /** A fresh sheet, and the crew back where they started. */
  reset(): void {
    this.sim = new GameSim(this.definition, CREW);
    this.showPaper();
    this.gliding = true;
    this.shake.add(0.2);
    this.scraps.burst(new Vector3(0, 0.1, 0), 30, CREW.map((c) => c.stock), 1, 4);
  }

  private showPaper(): void {
    for (const view of this.sheets) view.dispose();
    this.sheets = this.sim.pieces.map((piece) => {
      const view = new SheetView(piece);
      this.scene.add(view.group);
      return view;
    });
  }

  /** Loads the beings' models. The world runs once they are in. */
  async load(): Promise<void> {
    this.beings = await Promise.all(CREW.map(({ stock }) => BeingView.create(stock)));
    for (const view of this.beings) this.scene.add(view.instance.root);
  }

  start(): void {
    this.renderer.setAnimationLoop((now) => this.tick(now));
  }

  private tick(now: number): void {
    const raw = this.last ? (now - this.last) / 1000 : STEP;
    this.last = now;
    this.frameMs += (raw * 1000 - this.frameMs) * 0.08;
    this.advance(Math.min(raw, MAX_FRAME));
  }

  /** Runs the world by real time, then draws it. */
  advance(dt: number): void {
    this.clock.advance(dt, () => this.sim.step(this.controls.intents()));
    for (const event of this.sim.events.splice(0)) this.react(event);
    this.draw(dt);
  }

  private react(event: SimEvent): void {
    this.recent.push(event);
    if (this.recent.length > 40) this.recent.shift();
    this.hud.tell(event);
    if (event.kind === 'land') this.beings[event.being]?.land();
    const juice = JUICE[event.kind];
    if (!juice) return;
    // Only what the selected being does, or what lands near it, shakes the screen.
    const near = event.being === this.controls.selected ? 1 : 0.35;
    this.shake.add(juice.shake * near);
    const stock = CREW[event.being]?.stock ?? 'washi';
    if (juice.scraps > 0) this.scraps.burst(new Vector3(event.x, Math.max(0.05, event.y), event.z), juice.scraps, [stock, 'washi'], juice.power, 0.4);
  }

  private draw(dt: number): void {
    const { sim, controls } = this;
    sim.beings.forEach((being, i) => this.beings[i]?.update(being, sim.action(being), dt));
    for (const view of this.sheets) view.update();
    this.scraps.update(dt);

    const being = sim.beings[controls.selected];
    if (being) {
      this.follow.update(dt, being.x, being.z, controls.yaw, controls.pitch, this.gliding);
      if (this.gliding && this.follow.lag(being.x, being.z) < 0.05) this.gliding = false;
      this.showGuides(dt);
    }
    this.hud.update(sim, controls.selected, dt);
    this.shake.apply(this.camera, dt, this.width, this.height);
    this.pipeline.render(dt);
  }

  /** The fold the selected being is lining up, its strain, and where E would take hold. */
  private showGuides(dt: number): void {
    const being = this.sim.beings[this.controls.selected];
    if (!being) return;
    const grip = being.grip;
    this.reach.visible = false;
    if (!grip) {
      this.ghost.hide();
      this.tether.hide();
      const at = { x: being.x + Math.sin(being.facing) * RULES.grabAhead, y: RULES.grabHeight, z: being.z + Math.cos(being.facing) * RULES.grabAhead };
      for (const piece of this.sim.pieces) {
        const near = nearestPaper(piece, at, RULES.grabReach);
        if (!near) continue;
        const point = { x: 0, y: 0, z: 0 };
        worldOf(piece, near, point);
        this.reach.position.set(point.x, point.y + 0.02, point.z);
        this.reach.visible = true;
        break;
      }
      return;
    }
    const lay = grip.lay;
    const line = grip.unfolding ? grip.opening?.line : grip.aim?.guess.line;
    if (lay && line) {
      const toWorld = (p: { x: number; z: number }) => {
        const out = new Float64Array(3);
        lay(p.x, p.z, out);
        return new Vector3(out[0], (out[1] as number) + 0.02, out[2]);
      };
      const [from, to] = lineAcrossSheet(grip.piece, line);
      const ready = grip.unfolding || (grip.aim?.reachable ?? false);
      const landing = !grip.unfolding && grip.aim ? toWorld(grip.aim.guess.target) : null;
      this.ghost.show(toWorld(from), toWorld(to), landing, ready ? 'good' : 'bad', dt);
    } else {
      this.ghost.hide();
    }
    const strain = being.pushing ? Math.max(0.25, being.strain.tension) : 0;
    this.tether.show(new Vector3(grip.pin.heldX, grip.pin.heldY, grip.pin.heldZ), new Vector3(being.hand.x, being.hand.y, being.hand.z), strain);
  }

  private resize(): void {
    this.width = this.canvas.clientWidth || 1;
    this.height = this.canvas.clientHeight || 1;
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.pipeline.setSize(this.width, this.height);
  }

  /** Where a world point appears on screen, so a check can aim the real mouse. */
  screenOf(x: number, y: number, z: number): [number, number] {
    const point = new Vector3(x, y, z).project(this.camera);
    return [((point.x + 1) / 2) * this.width, ((1 - point.y) / 2) * this.height];
  }
}
