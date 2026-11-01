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
const screen = (x, y, z) => page.evaluate(([a, b, c]) => window.kami.screenOf(a, b, c), [x, y, z]);

/** A real drag between two flat sheet points, in small steps, as a hand would. */
async function drag(from, to, { y = 0.03, steps = 28, shift = false, hold = 500, midShot, lift = 0 } = {}) {
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
  const [sx, sy] = await screen(x, 0.03, z);
  await page.mouse.click(sx, sy);
  await wait(150);
}

/** Clicks the marker of the held pin, which puts it down. */
async function dropByClick() {
  const { held } = await lab();
  const [sx, sy] = await screen(held.x, held.y + 0.5, held.z);
  await page.mouse.click(sx, sy);
}

async function buildRecipe(name, chip, folds) {
  await page.keyboard.press('r');
  await wait(300);
  await page.locator('.chip', { hasText: chip }).click();
  await wait(200);
  await page.locator('.btn', { hasText: 'Play all' }).click();
  await page.waitForFunction((n) => window.kami.lab().folds >= n, folds, { timeout: 25000 });
  await wait(1400);
  await shot(`${name}-folded`);
  const result = await lab();
  check(`${name}: every fold of the recipe works`, result.folds === folds, `${result.folds} folds, ${result.tallest} layers, ${result.message.slice(0, 40)}`);
  return result;
}

try {
  await page.goto(server.resolvedUrls?.local[0] ?? 'http://localhost:5198');
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', undefined, { timeout: 120000 });
  // The camera glides into place on load, and aiming the mouse mid-glide would miss.
  await wait(3000);
  check('opens on the sheet in the Fold Lab', (await lab())?.tallest === 1);
  await shot('start');

  // 1. Two players hold the far corners, a third pulls the near edge across.
  await pin(4.6, -4.6);
  await pin(4.6, 4.6);
  check('clicking plants two pins', (await lab()).pins === 2);
  await drag([-4.8, 0.3], [4.8, 0.3], { hold: 900, midShot: 'dragging' });
  await wait(700);
  let r = await lab();
  check('pulling and letting go does not fold', r.folds === 0 && r.pins === 3, `${r.folds} folds, ${r.pins} pins`);
  check('and the paper stays held up, ready', r.held?.ready === true, r.message);
  check('the sheet is not passing through itself', (await page.evaluate(() => window.kami.crossings())) === 0);
  await shot('held');
  await dropByClick();
  await wait(1200);
  r = await lab();
  console.log('  fold log:', JSON.stringify(r.log));
  check('clicking the pin drops it and creases on the centre', r.tallest === 2 && r.folds === 1 && r.log[0]?.at === 5, r.message);
  check('both anchors keep holding after the fold', r.pins === 2, `${r.pins} pins`);
  await shot('folded');
  await page.keyboard.press('Escape');
  await wait(500);

  // 2. Right click lets go with no crease.
  await drag([4.8, 3], [3.2, 2], { hold: 300, midShot: 'held-up' });
  await wait(300);
  await page.mouse.move(0, 0);
  const { held } = await lab();
  const [hx, hy] = await screen(held.x, held.y + 0.5, held.z);
  await page.mouse.click(hx, hy, { button: 'right' });
  await wait(500);
  r = await lab();
  check('right click lets go with no crease', r.folds === 1 && r.pins === 0, `${r.folds} folds, ${r.pins} pins`);

  // 3. Only the top flap, because the point was grabbed on the top layer.
  await pin(1, 4.6);
  await pin(1, -4.6);
  await drag([4.7, -3], [1.3, -3], { midShot: 'peel' });
  await wait(300);
  await page.keyboard.press('Space');
  await wait(1300);
  r = await lab();
  check('Space drops the pin, folding only the top flap', r.folds === 2 && r.tallest === 3, `${r.tallest} layers, ${r.message}`);
  await shot('flap');

  // 4. Shift grips every layer.
  await page.keyboard.press('z');
  await wait(400);
  r = await lab();
  check('step back undoes it in the lab', r.folds === 1 && r.tallest === 2, `${r.folds} folds`);
  await pin(4.6, 4.6);
  await pin(1, 4.6);
  await drag([2.4, -4.8], [2.4, 4.8], { shift: true });
  await wait(200);
  await page.keyboard.press('Space');
  await wait(1300);
  r = await lab();
  check('shift-grip folds through every layer', r.tallest === 4 && r.folds === 2, r.message);
  await shot('quarter');

  // 5. Cutting all the way across makes two pieces, and no leftover sheet.
  await page.keyboard.press('r');
  await wait(400);
  await page.locator('.segment', { hasText: 'Cut' }).click();
  const [cx, cy] = await screen(0, 0.05, -4.7);
  const [dx, dy] = await screen(0, 0.05, 5.6);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(dx, dy, { steps: 14 });
  await wait(100);
  await shot('cut-guide');
  await page.mouse.up();
  await wait(700);
  r = await lab();
  check('a cut across the sheet gives exactly two pieces', r.pieces === 2 && r.faces === 800, `${r.pieces} pieces, ${r.faces} faces, ${r.message}`);
  await shot('cut');
  await page.locator('.segment', { hasText: 'Fold' }).first().click();

  // 6. Harden keeps a shape, and hardened paper refuses to fold.
  await page.keyboard.press('r');
  await wait(400);
  await drag([-4.8, -4.8], [-3, -3], { hold: 600, lift: 1400 });
  await page.locator('.btn', { hasText: 'Harden' }).click();
  await wait(150);
  await page.keyboard.press('Escape');
  await wait(900);
  r = await lab();
  check('hardening keeps the shape after letting go', r.hardened && r.height > 1, `stands ${r.height.toFixed(1)} m tall`);
  await shot('hardened');
  await drag([-1, -4.8], [-1, 2], { hold: 300 });
  await page.keyboard.press('Space');
  await wait(500);
  r = await lab();
  check('hardened paper no longer folds', r.folds === 0);
  await page.keyboard.press('Escape');

  // 7. Real recipes, step by step, then open the plane's wing by hand.
  r = await buildRecipe('plane', 'Nakamura Plane', 9);
  const box = await page.evaluate(() => window.kami.crossings());
  check('the folded plane is not passing through itself', box === 0, `${box} crossings`);
  await pin(-2.5, 0.6);
  await pin(-2.5, 4.6);
  await drag([-1.25, 3], [-1.9, 3], { hold: 1100, lift: 700, midShot: 'plane-wing' });
  await wait(300);
  r = await lab();
  check('with the body pinned, a wing lifts by hand', r.height > 1 && r.height < 4, `reaches ${r.height.toFixed(1)} m`);
  await page.keyboard.press('Escape');
  await wait(1500);
  r = await lab();
  await shot('plane-wing-released');
  check('and the crease pulls it shut again when let go', r.height < 1.2, `${r.height.toFixed(2)} m`);

  await buildRecipe('boat', 'Paper Boat', 7);

  // 8. The finer grid, on the real machine.
  await page.keyboard.press('Escape');
  await page.locator('.segment', { hasText: '0.5 m cells' }).click();
  await wait(900);
  await pin(4.6, -4.6);
  await pin(4.6, 4.6);
  await drag([-4.8, 0.3], [4.8, 0.3], { hold: 900, midShot: 'fine-grid' });
  await page.keyboard.press('Space');
  await wait(1400);
  r = await lab();
  check('the 0.5 m grid folds too', r.faces === 3200 && r.folds === 1 && r.tallest === 2, `${r.faces} faces, ${r.message}`);
  console.log('fine grid:', r.simulationMs.toFixed(2), 'ms sim,', await page.locator('.status').textContent());
  await page.locator('.segment', { hasText: '1 m cells' }).click();
  await wait(1200);

  console.log('coarse grid:', (await lab()).simulationMs.toFixed(2), 'ms sim,', await page.locator('.status').textContent());
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
