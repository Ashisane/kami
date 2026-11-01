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
  { value: 'fold', label: 'Fold', title: 'Drag paper to fold it' },
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

export function foldPanel({ stage }: LibraryContext): HTMLElement {
  const { lab } = stage;
  if (!lab) return emptyNote('No sheet here', 'Choose a sheet from Living paper to open the Fold Lab.');

  const body = h('div');
  const rigidity = slider({ label: 'Rigidity', min: 0, max: 1, step: 0.05, value: lab.readout().rigidity, format: round(2), onInput: (value) => lab.setRigidity(value) });
  const rigidityInput = rigidity.querySelector('input') as HTMLInputElement;
  const refresh = () => {
    readoutPanel(lab, body);
    // A fresh sheet is soft again, so the slider has to follow it back down.
    const value = lab.readout().rigidity;
    if (Number(rigidityInput.value) !== value) {
      rigidityInput.value = String(value);
      rigidityInput.dispatchEvent(new Event('sync'));
    }
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
        h('li', {}, h('strong', {}, 'Drag'), h('span', {}, 'pull paper over, let go to crease it')),
        h('li', {}, h('strong', {}, 'Click'), h('span', {}, 'pin the paper in place')),
        h('li', {}, h('strong', {}, 'Wheel up while dragging'), h('span', {}, 'lift it, and it stays held when you let go')),
        h('li', {}, h('strong', {}, 'Shift'), h('span', {}, 'grip every layer at that point')),
        h('li', {}, h('strong', {}, 'Right click'), h('span', {}, 'remove a pin')),
      ),
    ),
    section(
      'Harden',
      rigidity,
      h('p.panel-note', {}, 'Freezes the shape the paper holds right now, and it stops folding. 1 is one solid body.'),
    ),
    section('Recipes', h('div.stock-chips', {}, RECIPES.map((recipe) => h('button.chip', { type: 'button', onclick: () => lab.playRecipe(recipe.id) }, recipe.name)))),
    section(
      'Bench',
      segmented(GRIDS, String(lab.cells) as '20' | '40', (value) => lab.setCells(Number(value))).element,
      h('div.button-row', {}, button('Step back', () => lab.stepBack(), { title: 'Z' }), button('Fresh sheet', () => lab.reset(), { title: 'R' })),
    ),
  );
}
