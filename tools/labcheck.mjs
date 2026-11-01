#!/usr/bin/env node
/**
 * Plays the Fold Lab like a person: a real mouse grabbing real paper, nothing
 * frozen. Writes what it saw to .shots/lab-*.png and fails if the paper does not
 * do what a player would expect.
 *
 *   npm run check:lab
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const out = resolve('.shots');
await mkdir(out, { recursive: true });

const server = await createServer({ server: { port: 5198, strictPort: false }, logLevel: 'error' });
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
const lab = () => page.evaluate(() => window.kami.lab());
const shot = (name) => page.screenshot({ path: resolve(out, `lab-${name}.png`) });
const wait = (ms) => page.waitForTimeout(ms);

/** A real drag between two flat sheet points, in small steps, as a hand would. */
async function drag(from, to, { y = 0.03, steps = 28, shift = false, hold = 500, midShot, lift = 0 } = {}) {
  const screen = (x, h, z) => page.evaluate(([a, b, c]) => window.kami.screenOf(a, b, c), [x, h, z]);
  const [sx, sy] = await screen(from[0], y, from[1]);
  const [ex, ey] = await screen(to[0], y, to[1]);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(sx + ((ex - sx) * i) / steps, sy + ((ey - sy) * i) / steps);
    await wait(16);
  }
  if (lift) await page.mouse.wheel(0, -lift);
  await wait(hold);
  if (midShot) await shot(midShot);
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}

/** A click with no drag: a player planting their feet on the paper. */
async function pin(x, z) {
  const [sx, sy] = await page.evaluate(([a, c]) => window.kami.screenOf(a, 0.03, c), [x, z]);
  await page.mouse.click(sx, sy);
  await wait(150);
  const after = await lab();
  console.log(`  pin at ${x}, ${z} -> screen ${Math.round(sx)}, ${Math.round(sy)}, pins now ${after.pins}, folds ${after.folds}`);
}

let r0;
try {
  await page.goto(server.resolvedUrls?.local[0] ?? 'http://localhost:5198');
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', undefined, { timeout: 120000 });
  // The camera glides into place on load, and aiming the mouse mid-glide would miss.
  await wait(3000);
  check('opens on the sheet in the Fold Lab', (await lab())?.tallest === 1);
  await shot('start');

  // 0. With nobody holding it, pulling just slides the whole sheet along.
  await drag([-4.6, 0.3], [-1, 0.3], { hold: 300 });
  await wait(1200);
  r0 = await lab();
  await page.keyboard.press('r');
  await wait(300);

  // 1. Two players hold the far corners, a third pulls the near edge across.
  await pin(4.6, -4.6);
  await pin(4.6, 4.6);
  check('clicking plants two pins', (await lab()).pins === 2);
  await drag([-4.8, 0.3], [4.8, 0.3], { hold: 900, midShot: 'dragging' });
  await wait(250);
  await shot('landing');
  await wait(1000);
  let r = await lab();
  console.log('  fold log:', JSON.stringify(r.log));
  check('dragging an edge across folds the sheet in half', r.tallest === 2 && r.folds === 1 && r.log[0]?.at === 5, `${JSON.stringify(r.log)} ${r.message}`);
  check('both anchors keep holding after the fold', r.pins === 2, `${r.pins} pins`);
  await page.keyboard.press('Escape');
  await wait(500);
  await shot('folded');

  // 2. Lifted paper stays held, with no crease.
  await drag([4.8, 3], [3.2, 2], { hold: 300, lift: 800, midShot: 'held-up' });
  await wait(500);
  r = await lab();
  check('a lifted drag creases nothing', r.folds === 1, `${r.folds} folds`);
  check('and the pin stays, holding the paper', r.pins === 1, `${r.pins} pins`);
  await page.keyboard.press('Escape');
  await wait(600);

  // 3. Only the top flap, because the point was grabbed on the top layer.
  await pin(1, 4.6);
  await pin(1, -4.6);
  await drag([4.7, -3], [1.3, -3], { midShot: 'peel' });
  await wait(1300);
  r = await lab();
  console.log('  fold log:', JSON.stringify(r.log));
  check('pulling the top flap folds only that flap', r.folds === 2 && r.tallest === 3, `${r.tallest} layers, ${r.message}`);
  await shot('flap');

  // 4. Shift grips every layer.
  await page.keyboard.press('z');
  await wait(400);
  await pin(4.6, 4.6);
  await pin(1, 4.6);
  r = await lab();
  check('step back undoes it in the lab', r.folds === 1 && r.tallest === 2, `${r.folds} folds`);
  await drag([2.4, -4.8], [2.4, 4.8], { shift: true });
  await wait(1300);
  r = await lab();
  check('shift-grip folds through every layer', r.tallest === 4 && r.folds === 2, r.message);
  await shot('quarter');

  // 5. Hold the stack up and harden it.
  await page.keyboard.press('r');
  await wait(400);
  await page.locator('.segment', { hasText: 'Cut' }).click();
  const [cx, cy] = await page.evaluate(() => window.kami.screenOf(0, 0.05, -4.5));
  const [dx, dy] = await page.evaluate(() => window.kami.screenOf(0, 0.05, 5));
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(dx, dy, { steps: 14 });
  await wait(100);
  await shot('cut-guide');
  await page.mouse.up();
  await wait(700);
  r = await lab();
  check('a cut down the middle gives two pieces, or one slit', r.pieces >= 1, r.message);
  await shot('cut');
  await page.keyboard.press('r');
  await wait(400);
  await page.locator('.segment', { hasText: 'Fold' }).click();
  await drag([-4.8, -4.8], [-4.2, -4.2], { hold: 200, lift: 1800 });
  await wait(900);
  await page.locator('.inspector .slider').first().fill('1');
  await page.keyboard.press('Escape');
  await wait(900);
  r = await lab();
  check('hardening freezes the sheet', r.rigidity === 1);
  await shot('hardened');

  // 6. The real goal: open a folded dart and a boat into 3D, and harden them.
  const build = async (name, recipe, folds, grab, to, lift) => {
    await page.keyboard.press('r');
    await wait(300);
    await page.locator('.inspector .slider').first().fill('0');
    await page.locator('.chip', { hasText: recipe }).click();
    await page.waitForFunction((n) => window.kami.lab().folds >= n, folds, { timeout: 15000 });
    await wait(1400);
    await drag(grab, to, { hold: 900, lift, midShot: `${name}-opening` });
    await wait(900);
    await page.locator('.inspector .slider').first().fill('1');
    await wait(120);
    await page.keyboard.press('Escape');
    await wait(1200);
    await shot(`${name}-solid`);
    const result = await lab();
    check(`${name} opens into 3D and hardens`, result.rigidity === 1 && result.folds >= 3 && result.height > 1.2, `${result.folds} folds, stands ${result.height.toFixed(1)} m tall`);
  };
  await build('dart', 'Paper Dart', 3, [-4.7, 2], [-3.4, 2], 1600);
  await build('boat', 'Paper Boat', 5, [-4.6, 0], [-3.4, 0], 1600);

  // 7. Hardened paper refuses to fold.
  const foldsBefore = (await lab()).folds;
  await drag([-4.7, -2], [-1, -2], { hold: 400 });
  await wait(500);
  check('hardened paper no longer folds', (await lab()).folds === foldsBefore);

  // 8. The finer grid, on the real machine.
  await page.keyboard.press('Escape');
  await page.locator('.segment', { hasText: '0.5 m cells' }).click();
  await wait(900);
  await pin(4.6, -4.6);
  await pin(4.6, 4.6);
  await drag([-4.8, 0.3], [4.8, 0.3], { hold: 900, midShot: 'fine-grid' });
  await wait(1400);
  r = await lab();
  check('the 0.5 m grid folds too', r.faces === 3200 && r.folds === 1 && r.tallest === 2, `${r.faces} faces, ${r.message}`);
  console.log('fine grid:', r.simulationMs.toFixed(2), 'ms sim,', await page.locator('.status').textContent());

  console.log('readout:', JSON.stringify({ ms: r.simulationMs.toFixed(2), tris: r.triangles }));
  console.log('status:', await page.locator('.status').textContent());
  problems.push(...(await page.evaluate(() => window.kami.errors)));
} catch (error) {
  problems.push(String(error));
  await shot('failure').catch(() => {});
} finally {
  await browser.close();
  await server.close();
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of [...new Set(problems)]) console.error(`  ${p}`);
  process.exit(1);
}
console.log('ok');
