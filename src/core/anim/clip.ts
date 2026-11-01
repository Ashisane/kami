import { AnimationClip, Euler, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three';
import type { KeyframeTrack } from 'three';
import { linear } from './easing';
import type { Ease } from './easing';

/**
 * Procedural clips are baked into plain AnimationClips, so game code plays a
 * procedural clip and a Blender clip through the same call and cannot tell
 * them apart. Curves are sampled, which is what lets wind-up, overshoot and
 * spring easing survive the bake.
 */

const BAKE_FPS = 60;

export interface Key<T> {
  /** Seconds from the start of the clip. */
  at: number;
  value: T;
  /** Curve used to arrive at this key. */
  ease?: Ease;
}

type Axis = 'x' | 'y' | 'z';

function sample<T>(
  keys: readonly Key<T>[],
  duration: number,
  mix: (a: T, b: T, k: number, out: number[]) => void,
): { times: number[]; values: number[] } {
  const ordered = [...keys].sort((a, b) => a.at - b.at);
  const first = ordered[0];
  if (!first) throw new Error('A track needs at least one key.');

  const times: number[] = [];
  const values: number[] = [];
  const frames = Math.max(1, Math.ceil(duration * BAKE_FPS));

  for (let f = 0; f <= frames; f++) {
    const t = (f / frames) * duration;
    times.push(t);
    let from = first;
    let to = first;
    for (const key of ordered) {
      if (key.at <= t) from = key;
      if (key.at >= t) {
        to = key;
        break;
      }
      to = key;
    }
    const span = to.at - from.at;
    const raw = span > 0 ? (t - from.at) / span : 1;
    mix(from.value, to.value, (to.ease ?? linear)(raw), values);
  }
  return { times, values };
}

/** Rotation around one axis, in degrees: how every paper hinge is animated. */
export function hinge(node: string, axis: Axis, duration: number, keys: readonly Key<number>[]): KeyframeTrack {
  const euler = new Euler();
  const q = new Quaternion();
  const { times, values } = sample(keys, duration, (a, b, k, out) => {
    const radians = ((a + (b - a) * k) * Math.PI) / 180;
    euler.set(axis === 'x' ? radians : 0, axis === 'y' ? radians : 0, axis === 'z' ? radians : 0);
    q.setFromEuler(euler);
    out.push(q.x, q.y, q.z, q.w);
  });
  return new QuaternionKeyframeTrack(`${node}.quaternion`, times, values);
}

type Vec3 = readonly [number, number, number];

function vectorTrack(property: string, node: string, duration: number, keys: readonly Key<Vec3>[]): KeyframeTrack {
  const v = new Vector3();
  const w = new Vector3();
  const { times, values } = sample(keys, duration, (a, b, k, out) => {
    v.fromArray(a).lerp(w.fromArray(b), k);
    out.push(v.x, v.y, v.z);
  });
  return new VectorKeyframeTrack(`${node}.${property}`, times, values);
}

export const move = (node: string, duration: number, keys: readonly Key<Vec3>[]): KeyframeTrack =>
  vectorTrack('position', node, duration, keys);

/** Scale over time. This is where squash and stretch lives. */
export const scale = (node: string, duration: number, keys: readonly Key<Vec3>[]): KeyframeTrack =>
  vectorTrack('scale', node, duration, keys);

export function clip(name: string, duration: number, tracks: KeyframeTrack[]): AnimationClip {
  return new AnimationClip(name, duration, tracks);
}
