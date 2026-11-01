import { RECIPES } from '@/core/fold/recipes';
import type { LibraryContext } from '../../context';
import type { FoldLab } from '../../lab/FoldLab';
import { button, emptyNote, round, section, segmented, slider } from '../controls';
import { h, replace } from '../dom';

const GRIDS = [
  { value: '20', label: '1 m cells', title: '800 triangles, folds every 0.5 m' },
  { value: '40', label: '0.5 m cells', title: '3,200 triangles, folds every 0.25 m' },
] as const;

const TOOLS = [
  { value: 'fold', label: 'Fold', title: 'Pull paper and drop the pin to fold' },
  { value: 'cut', label: 'Cut', title: 'Draw along a line to cut every layer (X)' },
] as const;

const stat = (label: string, value: string | number) => h('div.stat', {}, h('dt', {}, label), h('dd', {}, value));

function readoutPanel(lab: FoldLab, body: HTMLElement): void {
  const r = lab.readout();
  replace(
    body,
    h('p.lab-message', {}, r.message),
    h(
      'dl.stats',
      {},
      stat('Folds', r.folds),
      stat('Thickest', `${r.tallest} layer${r.tallest === 1 ? '' : 's'}`),
      stat('Pieces', r.pieces),
      stat('Pins', `${r.pins} of 3`),
    ),
    h('p.panel-note', {}, `${r.simulationMs.toFixed(1)} ms sim · ${r.triangles.toLocaleString()} tris · ${(r.stretch * 100).toFixed(1)}% stretch`),
  );
}

/** The open recipe, as a list you can step through. */
function recipePanel(lab: FoldLab, body: HTMLElement): void {
  const open = lab.readout().recipe;
  if (!open) {
    replace(body);
    return;
  }
  const { recipe, next } = open;
  const finished = next >= recipe.steps.length;
  replace(
    body,
    h('p.panel-note', {}, recipe.source),
    h(
      'ol.recipe-steps',
      {},
      recipe.steps.map((step, i) => h(`li${i < next ? '.done' : i === next ? '.current' : ''}`, {}, step.label)),
    ),
    finished
      ? h('p.panel-note', {}, recipe.finish)
      : h('div.button-row', {}, button('Next fold', () => lab.nextStep(), { primary: true, title: 'N' }), button('Play all', () => lab.playAll())),
  );
}

export function foldPanel({ stage }: LibraryContext): HTMLElement {
  const { lab } = stage;
  if (!lab) return emptyNote('No sheet here', 'Choose a sheet from Living paper to open the Fold Lab.');

  const body = h('div');
  const steps = h('div.recipe');
  const harden = h('button.btn', { type: 'button', onclick: () => lab.setHardened(!lab.readout().hardened) }, 'Harden');
  const refresh = () => {
    readoutPanel(lab, body);
    recipePanel(lab, steps);
    const { hardened } = lab.readout();
    harden.textContent = hardened ? 'Soften again' : 'Harden';
    harden.classList.toggle('btn-primary', hardened);
  };
  refresh();
  const unsubscribe = lab.subscribe(() => {
    if (body.isConnected) refresh();
    else unsubscribe();
  });

  return h(
    'div.panel',
    {},
    h('header.panel-head', {}, h('h2.panel-title', {}, 'Fold Lab')),
    body,
    section(
      'Tool',
      segmented(TOOLS, lab.tool, (value) => (lab.tool = value)).element,
      h(
        'ul.rows.lab-hints',
        {},
        h('li', {}, h('strong', {}, 'Drag'), h('span', {}, 'pull paper over; it stays held')),
        h('li', {}, h('strong', {}, 'Click the pin, or Space'), h('span', {}, 'drop it, and it creases on the guide')),
        h('li', {}, h('strong', {}, 'Hover'), h('span', {}, 'lights up the flap you would lift')),
        h('li', {}, h('strong', {}, 'Click paper'), h('span', {}, 'pin it in place')),
        h('li', {}, h('strong', {}, 'Right click a pin'), h('span', {}, 'let go with no crease')),
        h('li', {}, h('strong', {}, 'Wheel'), h('span', {}, 'raise or lower while dragging')),
        h('li', {}, h('strong', {}, 'Shift'), h('span', {}, 'grip every layer at that point')),
        h('li', {}, h('strong', {}, 'Ctrl'), h('span', {}, 'reach the underside, for the flap below')),
        h('li', {}, h('strong', {}, 'B'), h('span', {}, 'bend a lifted flap: it stays at that angle')),
      ),
    ),
    section(
      'Recipes',
      h('div.stock-chips', {}, RECIPES.map((recipe) => h('button.chip', { type: 'button', onclick: () => lab.openRecipe(recipe.id) }, recipe.name))),
      steps,
    ),
    section(
      'Finish',
      h('div.button-row', {}, button('Hold it up', () => lab.holdUp(), { title: 'U' }), harden),
      h('p.panel-note', {}, 'Freezes the shape the paper holds right now into one solid piece. Hardened paper no longer folds.'),
    ),
    section(
      'Bench',
      segmented(GRIDS, String(lab.cells) as '20' | '40', (value) => lab.setCells(Number(value))).element,
      slider({ label: 'Floppiness, for tuning', min: 0.05, max: 1, step: 0.05, value: lab.readout().floppiness, format: round(2), onInput: (value) => lab.setFloppiness(value) }),
      h('div.button-row', {}, button('Step back', () => lab.stepBack(), { title: 'Z' }), button('Fresh sheet', () => lab.reset(), { title: 'R' })),
    ),
  );
}
