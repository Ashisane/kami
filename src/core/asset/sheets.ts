import type { StockId } from '../paper/stocks';

/**
 * The second kind of asset. A model has a fixed shape with clips; a sheet is
 * living paper whose shape comes from what players do to it. Sheets register
 * themselves the same way models do: `src/assets/<anywhere>/<name>.sheet.ts`.
 */
export interface SheetDefinition {
  /** `sheet.name`, stable forever. */
  id: string;
  name: string;
  description: string;
  /** Side length in metres. */
  size: number;
  /** Half-cells per side. The finest fold spacing is size / cells. */
  cells: number;
  top: StockId;
  bottom: StockId;
  edge: StockId;
  /** One layer's thickness in metres. */
  thickness: number;
  /** Kilograms per square metre of one layer. */
  density: number;
  /** How easily a single layer bends. Larger is floppier. */
  floppiness: number;
}

export const defineSheet = (definition: SheetDefinition): SheetDefinition => definition;

const modules = import.meta.glob<{ default: SheetDefinition }>('/src/assets/**/*.sheet.ts', { eager: true });

const sheets = new Map<string, SheetDefinition>();
for (const [path, module] of Object.entries(modules)) {
  const definition = module.default;
  if (!definition) throw new Error(`${path} has no default export.`);
  if (sheets.has(definition.id)) throw new Error(`Duplicate sheet id "${definition.id}" in ${path}.`);
  sheets.set(definition.id, definition);
}

export const listSheets = (): SheetDefinition[] => [...sheets.values()];

export function getSheet(id: string): SheetDefinition {
  const sheet = sheets.get(id);
  if (!sheet) throw new Error(`Unknown sheet "${id}".`);
  return sheet;
}

export const hasSheet = (id: string): boolean => sheets.has(id);
