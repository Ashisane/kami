import { editStock, getStock, listStocks, resetStock } from '@/core/paper/paperLibrary';
import type { PaperStock, StockId } from '@/core/paper/stocks';
import { isStockId } from '@/core/paper/stocks';
import type { LibraryContext } from '../../context';
import { button, colorField, copyButton, round, section, slider } from '../controls';
import { h, replace } from '../dom';

type NumericKey = {
  [K in keyof PaperStock]: PaperStock[K] extends number ? K : never;
}[keyof PaperStock];

const SURFACE: readonly { key: NumericKey; label: string; min: number; max: number; step: number }[] = [
  { key: 'grainScale', label: 'Fibre size', min: 0.2, max: 4, step: 0.05 },
  { key: 'grainStrength', label: 'Relief', min: 0, max: 1.2, step: 0.01 },
  { key: 'roughness', label: 'Roughness', min: 0.3, max: 1, step: 0.01 },
];
const CHARACTER: readonly { key: NumericKey; label: string; min: number; max: number; step: number }[] = [
  { key: 'formation', label: 'Cloudiness', min: 0, max: 0.4, step: 0.005 },
  { key: 'fleck', label: 'Flecks', min: 0, max: 1, step: 0.01 },
  { key: 'threads', label: 'Long threads', min: 0, max: 1, step: 0.01 },
  { key: 'translucency', label: 'Light through', min: 0, max: 1.5, step: 0.01 },
];

function stockFromSelection({ store }: LibraryContext, fallback: StockId): StockId {
  const { selection } = store.state;
  return selection.kind === 'stock' ? selection.id : fallback;
}

export function paperPanel(context: LibraryContext): HTMLElement {
  const root = h('div.panel');
  let active = stockFromSelection(context, 'washi');

  const render = () => {
    const stock = getStock(active);
    const sliders = (rows: typeof SURFACE) =>
      rows.map(({ key, label, min, max, step }) =>
        slider({ label, min, max, step, value: stock[key], format: round(2), onInput: (value) => editStock(active, { [key]: value }) }),
      );

    replace(
      root,
      h(
        'div.stock-chips',
        {},
        listStocks().map((s) =>
          h(`button.chip${s.id === active ? '.on' : ''}`, {
            type: 'button',
            onclick: () => {
              if (!isStockId(s.id)) return;
              active = s.id;
              if (context.store.state.selection.kind === 'stock') context.store.set({ selection: { kind: 'stock', id: s.id } });
              render();
            },
          }, s.name),
        ),
      ),
      section(
        'Colour',
        colorField('Printed face', stock.color, (value) => editStock(active, { color: value })),
        colorField('Fibres & flecks', stock.fibreColor, (value) => editStock(active, { fibreColor: value })),
      ),
      section('Surface', ...sliders(SURFACE)),
      section('Character', ...sliders(CHARACTER)),
      h(
        'div.button-row',
        {},
        button('Reset', () => { resetStock(active); render(); }),
        copyButton('Copy values', () => JSON.stringify(getStock(active), null, 2)),
      ),
      h('p.panel-note', {}, 'Edits apply live to every model using this stock. Copy the values to keep them.'),
    );
  };

  render();
  return root;
}
