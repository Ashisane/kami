/**
 * Paper stocks are the only colour source in the 3D world. Assets reference a
 * stock by id, never a hex value, so retuning a colour here retunes every model
 * that uses it. Values below were tuned in the library's Paper tab.
 */
export interface PaperStock {
  id: string;
  name: string;
  /** sRGB hex of the printed face. */
  color: string;
  /** Colour of the fibres, specks and pulled threads mixed into the sheet. */
  fibreColor: string;
  roughness: number;
  /** Metres covered by one repeat of the grain texture. Larger means bigger fibres. */
  grainScale: number;
  /** Strength of the fibre relief in the lighting. */
  grainStrength: number;
  /** Cloudy density variation in the sheet. */
  formation: number;
  /** Amount of dark specks. */
  fleck: number;
  /** Amount of long visible threads, the signature of washi. */
  threads: number;
  /** How much sunlight glows through from behind. */
  translucency: number;
}

type Tuning = Omit<PaperStock, 'id' | 'name' | 'color' | 'fibreColor'>;

const FINE: Tuning = {
  roughness: 0.84,
  grainScale: 0.85,
  grainStrength: 0.14,
  formation: 0.05,
  fleck: 0.03,
  threads: 0.1,
  translucency: 0.55,
};
const WASHI: Tuning = {
  roughness: 0.9,
  grainScale: 1.1,
  grainStrength: 0.18,
  formation: 0.07,
  fleck: 0.06,
  threads: 0.34,
  translucency: 0.9,
};
const CARD: Tuning = {
  roughness: 0.94,
  grainScale: 0.75,
  grainStrength: 0.24,
  formation: 0.09,
  fleck: 0.3,
  threads: 0.12,
  translucency: 0.12,
};

export const PAPER_STOCKS = [
  { id: 'washi', name: 'Washi', color: '#f4ecdb', fibreColor: '#c9b48c', ...WASHI },
  { id: 'kraft', name: 'Kraft', color: '#c1935f', fibreColor: '#4f3218', ...CARD },
  { id: 'vermilion', name: 'Vermilion', color: '#e4482f', fibreColor: '#8e1d10', ...FINE },
  { id: 'marigold', name: 'Marigold', color: '#f2ad2f', fibreColor: '#a96b0c', ...FINE },
  { id: 'sakura', name: 'Sakura', color: '#ee93a8', fibreColor: '#b34e68', ...FINE },
  { id: 'moss', name: 'Moss', color: '#74a748', fibreColor: '#3a6220', ...FINE },
  { id: 'teal', name: 'Teal', color: '#1f8c86', fibreColor: '#0b4c4a', ...FINE },
  { id: 'indigo', name: 'Indigo', color: '#2f4f9e', fibreColor: '#16285c', ...FINE },
  { id: 'sumi', name: 'Sumi', color: '#2a2622', fibreColor: '#0e0c0a', ...CARD },
] as const satisfies readonly PaperStock[];

export type StockId = (typeof PAPER_STOCKS)[number]['id'];

export const isStockId = (id: string): id is StockId => PAPER_STOCKS.some((s) => s.id === id);
