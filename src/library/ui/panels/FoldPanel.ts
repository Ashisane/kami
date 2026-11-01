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

/** What a finished craft can do: one row for each joint, or for each mirrored pair. */
function craftPanel(lab: FoldLab, body: HTMLElement): void {
  const { completed, joints } = lab.readout();
  if (!completed) {
    replace(body, h('p.panel-note', {}, 'When the folding is done, mark it complete. Its outermost flaps become hinges, and you drag each one to the angle it should stay at.'));
    return;
  }
  if (joints.length === 0) {
    replace(body, h('p.panel-note', {}, 'Nothing here can turn: no outer flap is free.'));
    return;
  }
  const rows = joints.flatMap((joint, i) => {
    if (joint.mirrored && joint.partner >= 0 && joint.partner < i) return [];
    const name = joint.partner < 0 ? `Flap ${i + 1}` : joint.mirrored ? 'Pair' : `Side ${i + 1}`;
    const mirror = joint.partner < 0 ? [] : [button(joint.mirrored ? 'Mirrored' : 'Separate', () => lab.setMirrored(i, !joint.mirrored), { title: 'Copy the angle across the crease' })];
    return [h('li', {}, h('strong', {}, name), h('span', {}, `${joint.angle}°`), ...mirror)];
  });
  replace(body, h('ul.rows.lab-hints', {}, rows));
}

/** The open recipe, as a list you can step through. */
function recipePanel(lab: FoldLab, body: HTMLElement): void {
  const open = lab.readout().recipe;
  if (!open) {
    replace(body);
    return;
  }
  const { recipe, next } = open;
  const { completed } = lab.readout();
  const finished = next >= recipe.steps.length;
  replace(
    body,
    h('p.panel-note', {}, recipe.source),
    h(
      'ol.recipe-steps',
      {},
      recipe.steps.map((step, i) => h(`li${i < next ? '.done' : i === next ? '.current' : ''}`, {}, step.label)),
    ),
    finished ? h('p.panel-note', {}, recipe.finish) : completed ? h('div') : h('div.button-row', {}, button('Next fold', () => lab.nextStep(), { primary: true, title: 'N' }), button('Play all', () => lab.playAll())),
  );
}

export function foldPanel({ stage }: LibraryContext): HTMLElement {
  const { lab } = stage;
  if (!lab) return emptyNote('No sheet here', 'Choose a sheet from Living paper to open the Fold Lab.');

  const body = h('div');
  const steps = h('div.recipe');
  const craft = h('div');
  const finish = h('button.btn', { type: 'button', title: 'Enter', onclick: () => (lab.readout().completed ? lab.backToFolding() : lab.complete()) }, 'Complete');
  const refresh = () => {
    readoutPanel(lab, body);
    recipePanel(lab, steps);
    craftPanel(lab, craft);
    finish.textContent = lab.readout().completed ? 'Back to folding' : 'Complete';
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
      ),
    ),
    section(
      'Recipes',
      h('div.stock-chips', {}, RECIPES.map((recipe) => h('button.chip', { type: 'button', onclick: () => lab.openRecipe(recipe.id) }, recipe.name))),
      steps,
    ),
    section(
      'Finish',
      h('div.button-row', {}, finish),
      craft,
    ),
    section(
      'Bench',
      segmented(GRIDS, String(lab.cells) as '20' | '40', (value) => lab.setCells(Number(value))).element,
      slider({ label: 'Floppiness, for tuning', min: 0.05, max: 1, step: 0.05, value: lab.readout().floppiness, format: round(2), onInput: (value) => lab.setFloppiness(value) }),
      h('div.button-row', {}, button('Step back', () => lab.stepBack(), { title: 'Z' }), button('Fresh sheet', () => lab.reset(), { title: 'R' })),
    ),
  );
}
