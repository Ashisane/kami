#!/usr/bin/env node
/**
 * Lets Claude (and you) see what was actually built. Boots the library, drives
 * it through `window.kami`, and writes PNGs to .shots/.
 *
 *   npm run capture -- --suite smoke
 *   npm run capture -- --asset calibration.fold_test --clip fold --time 0.6 --camera side
 *   npm run capture -- --stock kraft --lighting golden --bare
 *   npm run capture -- --turnaround calibration.fold_test
 *
 * Any page error or failed contract makes the process exit non-zero.
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const { values: args } = parseArgs({
  options: {
    suite: { type: 'string' },
    asset: { type: 'string' },
    stock: { type: 'string' },
    sheet: { type: 'string' },
    recipe: { type: 'string' },
    cells: { type: 'string' },
    settle: { type: 'string' },
    hold: { type: 'string' },
    steps: { type: 'string' },
    harden: { type: 'boolean' },
    clip: { type: 'string' },
    time: { type: 'string' },
    camera: { type: 'string' },
    aim: { type: 'string' },
    zoom: { type: 'string' },
    view: { type: 'string' },
    lighting: { type: 'string' },
    tab: { type: 'string' },
    colliders: { type: 'boolean' },
    sockets: { type: 'boolean' },
    scale: { type: 'boolean' },
    bare: { type: 'boolean' },
    turnaround: { type: 'string' },
    name: { type: 'string' },
    size: { type: 'string', default: '1440x900' },
  },
});

const [width, height] = (args.size ?? '1440x900').split('x').map(Number);
const out = resolve('.shots');
await mkdir(out, { recursive: true });

const ANGLES = ['hero', 'front', 'side', 'back', 'top'];

const request = {
  asset: args.asset,
  stock: args.stock,
  sheet: args.sheet,
  recipe: args.recipe,
  cells: args.cells === undefined ? undefined : Number(args.cells),
  settle: args.settle === undefined ? undefined : Number(args.settle),
  hold: args.hold?.split(',').map(Number),
  steps: args.steps === undefined ? undefined : Number(args.steps),
  harden: args.harden,
  clip: args.clip,
  time: args.time === undefined ? undefined : Number(args.time),
  camera: args.camera,
  aim: args.aim?.split(',').map(Number),
  zoom: args.zoom === undefined ? undefined : Number(args.zoom),
  view: args.view,
  lighting: args.lighting,
  tab: args.tab,
  colliders: args.colliders,
  sockets: args.sockets,
  scale: args.scale,
};

/** @type {{ name: string, bare?: boolean, request: object }[]} */
let shots;
if (args.suite === 'smoke') {
  const asset = 'calibration.fold_test';
  const sheet = 'sheet.standard';
  shots = [
    { name: 'fold-lab', request: { sheet, tab: 'fold', settle: 20 } },
    { name: 'sheet-held', bare: true, request: { sheet, hold: [-5, -5, 5], settle: 120 } },
    { name: 'sheet-book', bare: true, request: { sheet, recipe: 'book', settle: 40 } },
    { name: 'sheet-plane', bare: true, request: { sheet, recipe: 'plane', harden: true, aim: [335, 20, 0, 2.4, 1], zoom: 2.4 } },
    { name: 'sheet-dart', bare: true, request: { sheet, recipe: 'dart', harden: true, aim: [318, 26, 0, 2.4, 0], zoom: 2.6 } },
    { name: 'library', request: { asset, clip: 'fold', time: 1.5, tab: 'asset' } },
    { name: 'motion-mid-fold', request: { asset, clip: 'fold', time: 0.62, tab: 'motion' } },
    { name: 'collide', request: { asset, clip: 'fold', time: 0.8, tab: 'collide', colliders: true, sockets: true } },
    { name: 'paper-bench', bare: true, request: { stock: 'vermilion', tab: 'paper', colliders: false, sockets: false } },
    { name: 'light-golden', request: { stock: 'kraft', tab: 'light', lighting: 'golden' } },
    { name: 'light-lantern', bare: true, request: { stock: 'washi', tab: 'light', lighting: 'lantern' } },
  ];
} else if (args.turnaround) {
  shots = ANGLES.map((camera) => ({
    name: `${args.turnaround}-${camera}`,
    bare: true,
    request: { ...request, asset: args.turnaround, camera },
  }));
} else {
  shots = [{ name: args.name ?? args.recipe ?? args.asset ?? args.stock ?? 'shot', bare: args.bare, request }];
}

const server = await createServer({ server: { port: 5199, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls?.local[0];

const browser = await chromium.launch({
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width, height } });

const problems = [];
page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error' || message.type() === 'warning') {
    const text = message.text();
    if (!/GPU stall due to ReadPixels/.test(text)) problems.push(`console ${message.type()}: ${text}`);
  }
});

try {
  await page.goto(url ?? 'http://localhost:5199');
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true', undefined, { timeout: 120000 });
  await page.waitForTimeout(800);
  console.log(`  gpu: ${await page.evaluate(() => window.kami.gpu())}`);

  for (const { name, bare, request: shot } of shots) {
    await page.evaluate((r) => window.kami.capture(r), shot);
    await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });
    await page.evaluate((hide) => document.body.classList.toggle('bare', hide), Boolean(bare));
    await page.waitForTimeout(120);
    const path = resolve(out, `${name}.png`);
    await page.screenshot({ path });
    console.log(`  ${path}`);
  }

  if (args.suite === 'smoke') {
    console.log('  frame cost:', await page.evaluate(() => window.kami.benchmark()));
    const assets = await page.evaluate(() => window.kami.assets());
    for (const id of assets) {
      const report = await page.evaluate((a) => window.kami.roundTrip(a), id);
      const errors = report.issues.filter((i) => i.severity === 'error');
      console.log(`  glb round trip ${id}: ${report.bytes} bytes, clips [${report.clips}], ${errors.length} errors`);
      for (const issue of report.issues) console.log(`    ${issue.severity}: ${issue.message}`);
      if (errors.length) problems.push(`${id} failed the glb round trip`);
    }
  }

  problems.push(...(await page.evaluate(() => window.kami?.errors ?? [])));
} catch (error) {
  problems.push(String(error));
  await page.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {});
} finally {
  await browser.close();
  await server.close();
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of [...new Set(problems)]) console.error(`  ${problem}`);
  process.exit(1);
}
console.log('ok');
