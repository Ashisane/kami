#!/usr/bin/env node
/**
 * Plays the in-world experiment like a person: real keys, a real mouse, nothing
 * frozen. Writes what it saw to .shots/play-*.png and fails if the world does not
 * do what a player would expect.
 *
 *   npm run check:play
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const out = resolve('.shots');
await mkdir(out, { recursive: true });
const server = await createServer({ server: { port: 5197, strictPort: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const problems = [];
page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
page.on('console', (m) => {
  if ((m.type() === 'error' || m.type() === 'warning') && !/GPU stall/.test(m.text())) problems.push(`console: ${m.text()}`);
});
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) problems.push(`failed: ${name}`);
};
const state = () => page.evaluate(() => window.kami.state());
const shot = (name) => page.screenshot({ path: resolve(out, `play-${name}.png`) });
const wait = (ms) => page.waitForTimeout(ms);
const look = (yaw, pitch = 0.42) => page.evaluate(([y, p]) => window.kami.look(y, p), [yaw, pitch]);
const tap = async (key) => {
  await page.keyboard.press(key);
  await wait(120);
};
/** Holds keys down until a condition on the world is met, or time runs out. */
async function holdUntil(keys, until, ms = 12000) {
  for (const key of keys) await page.keyboard.down(key);
  const end = Date.now() + ms;
  while (Date.now() < end && !until(await state())) await wait(50);
  for (const key of [...keys].reverse()) await page.keyboard.up(key);
}
/** Presses E, and as a player would, steps a little closer and tries again if the hands came up empty. */
async function grabWith(being, tries = 4) {
  for (let i = 0; i < tries; i++) {
    await tap('KeyE');
    await wait(350);
    const all = await state();
    const b = all.beings[being];
    if (process.env.TRACE) console.log('  grab', i, JSON.stringify({ x: b.x, z: b.z, held: b.held, events: all.events.slice(-4), span: all.paperSpan }));
    if (b.holding) return true;
    await page.keyboard.down('KeyW');
    await wait(140);
    await page.keyboard.up('KeyW');
  }
  return false;
}
const EAST = Math.PI / 2;
const WEST = -Math.PI / 2;

try {
  await page.goto(`${server.resolvedUrls?.local[0] ?? 'http://localhost:5197/'}play.html`);
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', undefined, { timeout: 120000 });
  await wait(1500);
  let s = await state();
  check('three beings stand round the sheet', s.beings.length === 3 && s.tallest === 1);
  await shot('start');

  const NORTH = 0;
  const SOUTH = Math.PI;
  /** Selects a being, points the camera, and walks it forward until a condition holds. */
  const steer = async (key, yaw) => {
    await tap(key);
    await look(yaw);
    await wait(250);
  };

  // 1. Nothing in reach: hands close on air.
  await steer('Digit3', NORTH);
  await tap('KeyE');
  await wait(300);
  check('E with no paper in reach takes hold of nothing', !(await state()).beings[2].holding);

  // 2. Teal takes the east edge and holds it still.
  await steer('Digit2', WEST);
  await holdUntil(['KeyW'], (w) => w.beings[1].x < 5.45);
  await tap('KeyE');
  await wait(400);
  check('Teal takes hold of the east edge', (await state()).beings[1].holding);

  // 3. Marigold goes round to the south-west corner, takes it, carries it along beside
  // the sheet, and creases it. Dragging an edge sideways while Teal holds the far one
  // pulls the paper taut, and her grip would slip.
  await steer('Digit1', SOUTH);
  await holdUntil(['KeyW'], (w) => w.beings[0].z < -5.35);
  await look(EAST);
  await holdUntil(['KeyW'], (w) => w.beings[0].x > -5.42);
  await wait(300);
  await shot('reach-ring');
  await tap('KeyE');
  await wait(600);
  s = await state();
  check('E takes hold of the paper in reach', s.beings[0].holding, `held at ${s.beings[0].held.x.toFixed(2)}, ${s.beings[0].held.y.toFixed(2)}`);
  await shot('holding');
  await holdUntil(['KeyW'], (w) => w.beings[0].ready && w.beings[0].x > 2.5, 20000);
  await wait(400);
  s = await state();
  check('carried over, the fold lines up', s.beings[0].ready, `Marigold at ${s.beings[0].x.toFixed(2)}, ${s.beings[0].z.toFixed(2)}`);
  await shot('fold-lined-up');
  await tap('KeyF');
  await wait(1200);
  s = await state();
  check('F creases it, and the hands let go', s.tallest === 2 && !s.beings[0].holding, `${s.tallest} layers`);
  await shot('folded');

  // 4. Marigold walks back along the flap that landed, turns to face it, takes it, and
  // carries it back across its crease. The folded sheet lies a little skewed from run to
  // run, so if her hands come up empty, she steps in towards it.
  await look(WEST);
  await holdUntil(['KeyW'], (w) => w.beings[0].x < 1.4, 4000);
  await look(NORTH);
  await grabWith(0);
  s = await state();
  check('the flap can be taken hold of, and opened out', s.beings[0].holding && s.beings[0].opening !== null, JSON.stringify({ x: s.beings[0].x, holding: s.beings[0].holding, from: s.beings[0].from, opening: s.beings[0].opening }));
  await look(WEST);
  await holdUntil(['KeyW'], (w) => w.beings[0].unfolding && w.beings[0].x < -1, 20000);
  await wait(300);
  s = await state();
  check('carried back across its crease, it is ready to open', s.beings[0].unfolding);
  await shot('unfold-lined-up');
  await tap('KeyF');
  await wait(1200);
  s = await state();
  check('F opens it back out', s.tallest === 1, `${s.tallest} layers`);
  await shot('unfolded');

  // 5. R lays out a fresh sheet. Teal and Sakura take the east and south edges and hold
  // still, and Marigold takes the west edge, then runs off.
  await tap('KeyR');
  await wait(1200);
  s = await state();
  check('R lays out a fresh sheet, the crew back at the start', s.tallest === 1 && s.beings.every((b) => !b.holding));
  await steer('Digit2', WEST);
  await holdUntil(['KeyW'], (w) => w.beings[1].x < 5.45);
  await grabWith(1);
  await steer('Digit3', NORTH);
  await holdUntil(['KeyW'], (w) => w.beings[2].z > -5.45);
  await grabWith(2);
  await steer('Digit1', EAST);
  await holdUntil(['KeyW'], (w) => w.beings[0].x > -5.45);
  await grabWith(0);
  s = await state();
  check('all three hold the paper', s.beings.every((b) => b.holding), s.beings.map((b) => `${b.holding ? 'holds' : 'empty'} at ${b.x.toFixed(1)},${b.z.toFixed(1)}`).join(' | '));
  await wait(1500);
  // The moment the paper goes taut, the cloth takes a few frames to lift its middle off
  // the floor and pull straight, and stretches a little more while it does. What counts
  // is how stretched it stays while she strains against it.
  let strainedFor = 0, peakStretch = 0, heldStretch = 0, furthest = 0;
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyS');
  for (let i = 0; i < 60 && (await state()).beings[0].holding; i++) {
    const w = await state();
    if (w.beings[0].action === 'strain') strainedFor++;
    peakStretch = Math.max(peakStretch, w.stretch);
    if (strainedFor > 4) heldStretch = Math.max(heldStretch, w.stretch);
    if (process.env.TRACE) console.log('  run', i, 'x', w.beings[0].x.toFixed(2), 'stretch', (w.stretch * 100).toFixed(1), w.beings[0].action, 'tension', w.beings[0].tension.toFixed(2), 'holders', w.beings.map((b) => (b.holding ? b.held.x.toFixed(1) + ',' + b.held.z.toFixed(1) : '-')).join(' '));
    furthest = Math.min(furthest, w.beings[0].x);
    if (i === 12) await shot('straining');
    await wait(60);
  }
  await page.keyboard.up('KeyS');
  await page.keyboard.up('ShiftLeft');
  s = await state();
  check('running off, Marigold is held back and strains', strainedFor > 0, `got to x ${furthest.toFixed(2)}`);
  check('and the grip slips rather than the paper tearing', !s.beings[0].holding && heldStretch < 0.02 && peakStretch < 0.05, `${(heldStretch * 100).toFixed(1)}% while straining, ${(peakStretch * 100).toFixed(1)}% at the snap`);
  await wait(300);
  await shot('slipped');

  // 6. The other two lift the sheet between them.
  for (const key of ['Digit2', 'Digit3']) {
    await tap(key);
    for (let i = 0; i < 14; i++) {
      await page.mouse.move(720, 450);
      await page.mouse.wheel(0, -100);
      await wait(40);
    }
  }
  await wait(1500);
  s = await state();
  check('raising their hands lifts the paper between them', s.paperTop > 1.1, `paper reaches ${s.paperTop.toFixed(2)} m`);
  await shot('lifted');

  // 7. Marigold walks into the hanging paper, which gives way round her.
  await steer('Digit1', EAST);
  await holdUntil(['KeyW'], () => false, 2500);
  await shot('walked-into-paper');
  check('walking into hanging paper does not break anything', (await state()).beings[0].x > -6);

  // 8. Both let go, and the paper comes down.
  for (const key of ['Digit2', 'Digit3']) {
    await tap(key);
    await tap('KeyE');
  }
  await wait(3000);
  s = await state();
  check('let go, nobody holds the paper any more', s.beings.every((b) => !b.holding));
  await shot('dropped');

  // 9. Alone on a fresh sheet: Marigold walks on, jumps, then takes the south-west
  // corner and carries it across the sheet herself, and presses it down.
  await tap('KeyR');
  await wait(1200);
  const SW = (-3 * Math.PI) / 4;
  const NE = Math.PI / 4;
  const laid = (await state()).paperSpan;
  await steer('Digit1', EAST);
  await holdUntil(['KeyW'], (w) => w.beings[0].x > -3.5);
  s = await state();
  const shift = Math.max(...['minX', 'maxX', 'minZ', 'maxZ'].map((k) => Math.abs(s.paperSpan[k] - laid[k])));
  check('walking onto the sheet does not shove it', shift < 0.005 && s.beings[0].standing, `edges moved ${(shift * 100).toFixed(2)} cm`);
  await page.keyboard.press('Space');
  await wait(140);
  s = await state();
  check('Space jumps', s.beings[0].y > 0.15, `${s.beings[0].y.toFixed(2)} m up`);
  await shot('jump');
  await wait(900);
  s = await state();
  check('and the being lands, standing on the paper again', s.beings[0].y === 0 && s.beings[0].standing && s.events.some((e) => e === '0:land'));
  await look(SOUTH);
  await holdUntil(['KeyW'], (w) => w.beings[0].z < -3.8);
  await look(WEST);
  await holdUntil(['KeyW'], (w) => w.beings[0].x < -4.4);
  await look(SW);
  await grabWith(0);
  s = await state();
  check('alone, she takes hold of the corner', s.beings[0].holding, `held at ${s.beings[0].held.x.toFixed(2)}, ${s.beings[0].held.z.toFixed(2)}, standing at ${s.beings[0].x.toFixed(2)}, ${s.beings[0].z.toFixed(2)}${s.beings[0].standing ? " on paper" : " off it"}`);
  await shot('solo-holding');
  await look(NE);
  await holdUntil(['KeyW'], (w) => {
    if (process.env.TRACE) console.log('  carry', w.beings[0].x.toFixed(2), w.beings[0].z.toFixed(2), w.beings[0].standing ? 'on' : 'off', w.beings[0].action, 'far', ((w.paperSpan.maxX - laid.maxX) * 100).toFixed(1), ((w.paperSpan.maxZ - laid.maxZ) * 100).toFixed(1), 'stretch', (w.stretch * 100).toFixed(1));
    return w.beings[0].ready && w.beings[0].x > -2.2;
  }, 15000);
  await wait(300);
  s = await state();
  const farMoved = Math.hypot(s.paperSpan.maxX - laid.maxX, s.paperSpan.maxZ - laid.maxZ);
  check('carrying it across, the corner comes over and the rest stays put', s.beings[0].ready && farMoved < 0.1, `far edges moved ${(farMoved * 100).toFixed(1)} cm`);
  await shot('solo-lined-up');
  await tap('KeyF');
  await wait(1200);
  s = await state();
  check('F creases it: folded by one being alone', s.tallest === 2, `${s.tallest} layers`);
  await shot('solo-folded');
  console.log('frame time', s.frameMs.toFixed(1), 'ms');
} catch (error) {
  problems.push(String(error));
  await shot('failure').catch(() => {});
} finally {
  problems.push(...(await page.evaluate(() => window.kami?.errors ?? []).catch(() => [])));
  await browser.close();
  await server.close();
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of [...new Set(problems)]) console.error(`  ${p}`);
  process.exit(1);
}
console.log('ok');
