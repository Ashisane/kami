import { PaperMaterial } from './PaperMaterial';
import { PAPER_STOCKS } from './stocks';
import type { PaperStock, StockId } from './stocks';

/**
 * One shared material per stock, so a whole level folded from nine papers costs
 * nine materials and one shader program. Editing a stock updates every model
 * using it, immediately.
 */
const stocks = new Map<string, PaperStock>(PAPER_STOCKS.map((s) => [s.id, { ...s }]));
const materials = new Map<string, PaperMaterial>();

function stockOf(id: string): PaperStock {
  const stock = stocks.get(id);
  if (!stock) throw new Error(`Unknown paper stock "${id}". Add it to src/core/paper/stocks.ts.`);
  return stock;
}

export function paper(id: StockId, options: { smooth?: boolean } = {}): PaperMaterial {
  const key = `${id}:${options.smooth ? 'smooth' : 'flat'}`;
  let material = materials.get(key);
  if (!material) {
    material = new PaperMaterial(stockOf(id), options);
    materials.set(key, material);
  }
  return material;
}

export const getStock = (id: string): PaperStock => stockOf(id);

export function listStocks(): PaperStock[] {
  return [...stocks.values()];
}

export function editStock(id: string, patch: Partial<PaperStock>): void {
  const stock = Object.assign(stockOf(id), patch);
  for (const material of materials.values()) {
    if (material.stockId === id) material.applyStock(stock);
  }
}

export function resetStock(id: string): PaperStock {
  const original = PAPER_STOCKS.find((s) => s.id === id);
  if (!original) throw new Error(`Unknown paper stock "${id}".`);
  editStock(id, original);
  return stockOf(id);
}
