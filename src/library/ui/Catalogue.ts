import { listAssets } from '@/core/asset/registry';
import { ASSET_CATEGORIES } from '@/core/asset/types';
import { listSheets } from '@/core/asset/sheets';
import type { AssetCategory, AssetDefinition } from '@/core/asset/types';
import { listStocks } from '@/core/paper/paperLibrary';
import type { StockId } from '@/core/paper/stocks';
import type { LibraryContext } from '../context';
import { h, replace } from './dom';

const CATEGORY_LABELS: Record<AssetCategory, string> = {
  character: 'Characters',
  craft: 'Crafts',
  tool: 'Tools',
  prop: 'Props',
  terrain: 'Terrain',
  calibration: 'Calibration',
};

const STATUS_LABELS: Record<AssetDefinition['status'], string> = {
  calibration: 'test',
  blockout: 'blockout',
  draft: 'draft',
  final: 'final',
};

export function createCatalogue({ store }: LibraryContext, status: HTMLElement): HTMLElement {
  const list = h('div.catalogue-list');
  const search = h('input.search', { type: 'search', placeholder: 'Find an asset…', 'aria-label': 'Find an asset' });
  const swatches = h('div.swatches');

  const renderAssets = () => {
    const query = search.value.trim().toLowerCase();
    const { selection } = store.state;
    replace(
      list,
      h(
        'section.shelf',
        {},
        h('h3.shelf-title', {}, h('span', {}, 'Living paper'), h('span.shelf-count', {}, listSheets().length)),
        listSheets()
          .filter((s) => !query || s.name.toLowerCase().includes(query))
          .map((sheet) =>
            h(
              `button.asset-row${selection.kind === 'sheet' && selection.id === sheet.id ? '.on' : ''}`,
              { type: 'button', title: sheet.description, onclick: () => store.set({ selection: { kind: 'sheet', id: sheet.id }, tab: 'fold' }) },
              h('span.asset-name', {}, sheet.name),
              h('span.asset-status', {}, `${sheet.size} m`),
            ),
          ),
      ),
      ASSET_CATEGORIES.map((category) => {
        const assets = listAssets(category).filter(
          (a) => !query || a.name.toLowerCase().includes(query) || a.id.includes(query),
        );
        return h(
          'section.shelf',
          {},
          h('h3.shelf-title', {}, h('span', {}, CATEGORY_LABELS[category]), h('span.shelf-count', {}, assets.length)),
          assets.map((asset) =>
            h(
              `button.asset-row${selection.kind === 'asset' && selection.id === asset.id ? '.on' : ''}`,
              {
                type: 'button',
                title: asset.description,
                onclick: () =>
                  store.set({
                    selection: { kind: 'asset', id: asset.id },
                    tab: store.state.tab === 'paper' || store.state.tab === 'fold' ? 'asset' : store.state.tab,
                  }),
              },
              h('span.asset-name', {}, asset.name),
              h('span.asset-status', {}, STATUS_LABELS[asset.status]),
            ),
          ),
        );
      }),
    );
  };

  const renderSwatches = () => {
    const { selection } = store.state;
    replace(
      swatches,
      listStocks().map((stock) =>
        h(`button.swatch${selection.kind === 'stock' && selection.id === stock.id ? '.on' : ''}`, {
          type: 'button',
          title: stock.name,
          'aria-label': `${stock.name} paper`,
          style: { '--swatch': stock.color },
          onclick: () => store.set({ selection: { kind: 'stock', id: stock.id as StockId }, tab: 'paper' }),
        }),
      ),
    );
  };

  search.addEventListener('input', renderAssets);
  store.subscribe((_, changed) => {
    if (changed.has('selection')) {
      renderAssets();
      renderSwatches();
    }
  });
  renderAssets();
  renderSwatches();

  return h(
    'aside.card.rail',
    {},
    h(
      'header.brand',
      {},
      h('span.hanko', { 'aria-hidden': 'true' }, '紙'),
      h('div', {}, h('h1.wordmark', {}, 'KAMI'), h('p.brand-sub', {}, 'Asset Library')),
    ),
    search,
    list,
    h('section.shelf.stocks', {}, h('h3.shelf-title', {}, h('span', {}, 'Paper stocks')), swatches),
    status,
  );
}
