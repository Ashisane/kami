/**
 * Lighting is data, so moods can be retuned or added without touching the rig.
 * Three looks come straight from the art direction; Overcast is a neutral test
 * light for judging a model without any mood flattering it.
 *
 * Three.js divides diffuse light by pi, so an intensity near 3 is "full light"
 * on a white surface. Keep sky strength high: paper bounces light around, and
 * shade in a paper world should stay colourful, never go black.
 */
export interface LightingPreset {
  id: string;
  name: string;
  /** Degrees around the subject; 0 is the front, 90 is the subject's right. */
  sunAzimuth: number;
  /** Degrees above the horizon. */
  sunElevation: number;
  sunColor: string;
  sunIntensity: number;
  skyColor: string;
  groundColor: string;
  skyIntensity: number;
  /** Cool light from opposite the sun, so shadow sides keep their shape. */
  fillIntensity: number;
  /** Shadow blur radius. */
  shadowSoftness: number;
  background: string;
}

export const LIGHTING_PRESETS: readonly LightingPreset[] = [
  {
    id: 'noon',
    name: 'Paper noon',
    sunAzimuth: 304,
    sunElevation: 46,
    sunColor: '#fff0d8',
    sunIntensity: 2.3,
    skyColor: '#e6f0ff',
    groundColor: '#d8c6a2',
    skyIntensity: 2,
    fillIntensity: 0.4,
    shadowSoftness: 1.6,
    background: '#bcd6cb',
  },
  {
    id: 'golden',
    name: 'Golden hour',
    sunAzimuth: 118,
    sunElevation: 19,
    sunColor: '#ffb06a',
    sunIntensity: 3.6,
    skyColor: '#b9c0ee',
    groundColor: '#a6775a',
    skyIntensity: 1.5,
    fillIntensity: 0.35,
    shadowSoftness: 1.8,
    background: '#d9b08c',
  },
  {
    id: 'lantern',
    name: 'Lantern dusk',
    sunAzimuth: 196,
    sunElevation: 30,
    sunColor: '#ffb872',
    sunIntensity: 4.2,
    skyColor: '#8088c6',
    groundColor: '#4a3c52',
    skyIntensity: 1.2,
    fillIntensity: 0.2,
    shadowSoftness: 2,
    background: '#2c3155',
  },
  {
    id: 'overcast',
    name: 'Overcast test',
    sunAzimuth: 20,
    sunElevation: 72,
    sunColor: '#ffffff',
    sunIntensity: 0.8,
    skyColor: '#ffffff',
    groundColor: '#d6d6d6',
    skyIntensity: 2.7,
    fillIntensity: 0,
    shadowSoftness: 3,
    background: '#c9c9c6',
  },
];
