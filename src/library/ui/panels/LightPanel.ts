import { LIGHTING_PRESETS } from '@/core/render/lighting';
import type { LightingPreset } from '@/core/render/lighting';
import type { Quality } from '@/core/render/RenderPipeline';
import type { LibraryContext } from '../../context';
import type { Surface } from '@/core/render/CuttingMat';
import { colorField, copyButton, round, section, segmented, slider, toggle } from '../controls';
import { h } from '../dom';

const SURFACES = [
  { value: 'mat', label: 'Mat' },
  { value: 'card', label: 'Card' },
  { value: 'grey', label: 'Grey' },
] as const satisfies readonly { value: Surface; label: string }[];

const QUALITIES = [
  { value: 'fast', label: 'Fast', title: 'No contact shadows' },
  { value: 'balanced', label: 'Balanced', title: 'Half resolution contact shadows' },
  { value: 'high', label: 'High', title: 'Everything at full resolution' },
] as const satisfies readonly { value: Quality; label: string; title: string }[];

export function lightPanel(context: LibraryContext): HTMLElement {
  const { store } = context;
  const { lighting } = store.state;
  const edit = (patch: Partial<LightingPreset>) => store.set({ lighting: { ...store.state.lighting, ...patch } });

  return h(
    'div.panel',
    {},
    section(
      'Mood',
      h(
        'div.stock-chips',
        {},
        LIGHTING_PRESETS.map((preset) =>
          h(`button.chip${preset.id === lighting.id ? '.on' : ''}`, {
            type: 'button',
            onclick: () => store.set({ lighting: { ...preset }, tab: 'light' }),
          }, preset.name),
        ),
      ),
    ),
    section(
      'Sun',
      slider({ label: 'Around', min: 0, max: 360, step: 1, value: lighting.sunAzimuth, format: (v) => `${v}°`, onInput: (v) => edit({ sunAzimuth: v }) }),
      slider({ label: 'Height', min: 3, max: 89, step: 1, value: lighting.sunElevation, format: (v) => `${v}°`, onInput: (v) => edit({ sunElevation: v }) }),
      slider({ label: 'Strength', min: 0, max: 8, step: 0.05, value: lighting.sunIntensity, format: round(2), onInput: (v) => edit({ sunIntensity: v }) }),
      slider({ label: 'Shadow softness', min: 0, max: 12, step: 0.1, value: lighting.shadowSoftness, format: round(1), onInput: (v) => edit({ shadowSoftness: v }) }),
      colorField('Colour', lighting.sunColor, (v) => edit({ sunColor: v })),
    ),
    section(
      'Sky',
      slider({ label: 'Strength', min: 0, max: 4, step: 0.05, value: lighting.skyIntensity, format: round(2), onInput: (v) => edit({ skyIntensity: v }) }),
      slider({ label: 'Fill', min: 0, max: 2, step: 0.01, value: lighting.fillIntensity, format: round(2), onInput: (v) => edit({ fillIntensity: v }) }),
      colorField('Sky', lighting.skyColor, (v) => edit({ skyColor: v })),
      colorField('Bounce', lighting.groundColor, (v) => edit({ groundColor: v })),
    ),
    section(
      'Stage',
      segmented(SURFACES, store.state.surface, (value) => store.set({ surface: value })).element,
      toggle('Contact shadows', store.state.ambientOcclusion, (value) => store.set({ ambientOcclusion: value })),
    ),
    section(
      'Quality',
      segmented(QUALITIES, store.state.quality, (value) => store.set({ quality: value })).element,
    ),
    h('div.button-row', {}, copyButton('Copy values', () => JSON.stringify(store.state.lighting, null, 2))),
  );
}
