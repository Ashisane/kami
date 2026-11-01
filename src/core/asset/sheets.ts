import type { SheetDefinition } from './sheetTypes';

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
