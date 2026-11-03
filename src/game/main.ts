import '@fontsource/potta-one/index.css';
import '@fontsource/kiwi-maru/400.css';
import '@fontsource/kiwi-maru/500.css';
import '../library/styles/tokens.css';
import './play.css';
import { getSheet } from '@/core/asset/sheets';
import { worldOf } from '@/core/fold/paperPoints';
import type { Intent } from './sim/GameSim';
import { PlayWorld } from './view/PlayWorld';

/**
 * The in-world experiment: three beings and the standard sheet. Open
 * localhost:5173/play.html. 1, 2 and 3 choose who the keys steer.
 */
async function boot(): Promise<void> {
  // The desk texture draws text, so the font has to be ready first.
  await document.fonts.load('46px "Kiwi Maru"');
  const host = document.getElementById('play') as HTMLElement;
  const canvas = document.createElement('canvas');
  canvas.className = 'play-canvas';
  host.append(canvas);
  const world = new PlayWorld(canvas, host, getSheet('sheet.standard'));
  await world.load();
  installDebugApi(world);
  world.start();
  document.documentElement.dataset['ready'] = 'true';
}

/** What `tools/playcheck.mjs` reads and drives, so a check can see what a player sees. */
function installDebugApi(world: PlayWorld): void {
  const api = {
    errors: [] as string[],
    /** Every being and the paper, as plain numbers. */
    state() {
      const { sim } = world;
      const piece = sim.pieces[0];
      const ys = piece ? Array.from(piece.soft.x).filter((_, i) => i % 3 === 1) : [];
      return {
        selected: world.controls.selected,
        beings: sim.beings.map((being) => {
          const held = { x: 0, y: 0, z: 0 };
          if (being.grip) worldOf(being.grip.piece, being.grip.pin, held);
          return {
            x: being.x,
            z: being.z,
            facing: being.facing,
            action: sim.action(being),
            holding: !!being.grip,
            held,
            ready: being.grip?.aim?.reachable ?? false,
            unfolding: being.grip?.unfolding ?? false,
            standing: !!being.foothold,
            tension: being.strain.tension,
            opening: being.grip?.opening ? { kind: being.grip.opening.line.kind, c: being.grip.opening.line.c, faces: being.grip.opening.faces.size } : null,
            from: being.grip?.flat ?? null,
            aimedAt: being.grip?.aim?.aimedAt ?? null,
          };
        }),
        tallest: piece?.book.tallest ?? 0,
        stretch: piece?.soft.stretch() ?? 0,
        paperTop: Math.max(0, ...ys),
        paperSpan: piece ? spanOf(piece.soft.x) : null,
        frameMs: world.frameMs,
        events: world.recent.map((e) => `${e.being}:${e.kind}${e.reason ? ' ' + e.reason : ''}`),
      };
    },
    screenOf: (x: number, y: number, z: number) => world.screenOf(x, y, z),
    /** Points the camera, as the mouse would. */
    look(yaw: number, pitch: number) {
      world.controls.yaw = yaw;
      world.controls.pitch = pitch;
    },
    /** Steps the world by hand for a few frames with set intents, for exact checks. */
    drive(steps: number, intents: Intent[]) {
      for (let i = 0; i < steps; i++) world.sim.step(intents);
    },
  };
  (window as unknown as { kami: typeof api }).kami = api;
  window.addEventListener('error', (event) => api.errors.push(event.message));
  window.addEventListener('unhandledrejection', (event) => api.errors.push(String(event.reason)));
}

/** The ground the paper covers, from its points: the least and most x and z. */
function spanOf(x: Float64Array): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const span = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i < x.length; i += 3) {
    span.minX = Math.min(span.minX, x[i] as number);
    span.maxX = Math.max(span.maxX, x[i] as number);
    span.minZ = Math.min(span.minZ, x[i + 2] as number);
    span.maxZ = Math.max(span.maxZ, x[i + 2] as number);
  }
  return span;
}

void boot();
