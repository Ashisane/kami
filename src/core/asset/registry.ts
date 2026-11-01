import type { AssetCategory, AssetDefinition } from './types';

/**
 * Assets register themselves: create `src/assets/<anything>.asset.ts` with a
 * default export and it appears here. There is no list to keep in sync.
 */
const modules = import.meta.glob<{ default: AssetDefinition }>('/src/assets/**/*.asset.ts', { eager: true });

const assets = new Map<string, AssetDefinition>();
for (const [path, module] of Object.entries(modules)) {
  const definition = module.default;
  if (!definition) throw new Error(`${path} has no default export.`);
  const existing = assets.get(definition.id);
  if (existing) throw new Error(`Duplicate asset id "${definition.id}" in ${path}.`);
  assets.set(definition.id, definition);
}

export function listAssets(category?: AssetCategory): AssetDefinition[] {
  const all = [...assets.values()];
  return (category ? all.filter((a) => a.category === category) : all).sort((a, b) => a.name.localeCompare(b.name));
}

export function getAsset(id: string): AssetDefinition {
  const asset = assets.get(id);
  if (!asset) throw new Error(`Unknown asset "${id}".`);
  return asset;
}

export const hasAsset = (id: string): boolean => assets.has(id);
