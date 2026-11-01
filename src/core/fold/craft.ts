import type { SoftMesh } from './soft/softMesh';

/**
 * A finished craft: stiff plates of paper turning on chosen creases. Folding is
 * loose and physical, and this is what comes after it. Nothing here is simulated,
 * so an angle gives the same shape on every machine, and a whole craft is a short
 * list of creases and angles.
 */
export interface Joint {
  /** The paper that turns. */
  faces: ReadonlySet<number>;
  /** The crease it turns on, as a line key. */
  hinge: string;
  /** A point on the crease, in flat metres. */
  point: [number, number];
  /** Along the crease. */
  along: [number, number];
  /** Across the crease, towards this paper as it lies shut. */
  across: [number, number];
  /** Which face of the stack it lies on: 1 for the top, -1 for the underside. */
  side: 1 | -1;
  /** Degrees open: 0 lies shut, 90 is square to the body, 180 lies flat out. */
  angle: number;
  /** The joint on the same crease, on the other face, or -1. */
  partner: number;
  /** True while a partner copies this joint's angle. */
  mirrored: boolean;
}

/** How the flat paper sits in the world: x, up off the paper, and z of the sheet. */
export interface Stance {
  origin: [number, number, number];
  x: [number, number, number];
  up: [number, number, number];
  z: [number, number, number];
  /** True when it stands on its keel, rather than lying where it was left. */
  upright: boolean;
}

/** Where a flat point sits with its joint at an angle, in the paper's own space: x, up, z. */
export function jointPoint(joint: Joint, fx: number, fz: number, degrees: number, out: Float64Array): void {
  const dx = fx - joint.point[0], dz = fz - joint.point[1];
  const along = dx * joint.along[0] + dz * joint.along[1];
  const reach = dx * joint.across[0] + dz * joint.across[1];
  const open = (degrees * Math.PI) / 180;
  const flat = reach * Math.cos(open);
  out[0] = joint.point[0] + joint.along[0] * along + joint.across[0] * flat;
  out[1] = joint.side * reach * Math.sin(open);
  out[2] = joint.point[1] + joint.along[1] * along + joint.across[1] * flat;
}

/** Takes a point from the paper's own space into the world. */
export function toWorld(stance: Stance, local: Float64Array, out: Float64Array, offset = 0): void {
  const px = local[0] as number, pu = local[1] as number, pz = local[2] as number;
  for (let axis = 0; axis < 3; axis++) {
    out[offset + axis] = stance.origin[axis] as number
      + px * (stance.x[axis] as number) + pu * (stance.up[axis] as number) + pz * (stance.z[axis] as number);
  }
}

/**
 * The stance that stands paper on its keel, with a joint's crease along the top of
 * the body, and the paper hanging down from it. The crease keeps its place and heading.
 */
export function standOn(lying: Stance, joint: Joint): Stance {
  const [ax, az] = joint.along, [bx, bz] = joint.across;
  const heading: [number, number, number] = [0, 1, 2].map((i) => ax * (lying.x[i] as number) + az * (lying.z[i] as number)) as [number, number, number];
  const down: [number, number, number] = [0, -1, 0];
  // A rotation keeps handedness, so the paper's up follows from how its axes turn.
  const hand = ax * bz - az * bx > 0 ? -1 : 1;
  const up: [number, number, number] = [
    hand * (heading[1] * down[2] - heading[2] * down[1]),
    hand * (heading[2] * down[0] - heading[0] * down[2]),
    hand * (heading[0] * down[1] - heading[1] * down[0]),
  ];
  const x: [number, number, number] = [0, 1, 2].map((i) => ax * (heading[i] as number) + bx * (down[i] as number)) as [number, number, number];
  const z: [number, number, number] = [0, 1, 2].map((i) => az * (heading[i] as number) + bz * (down[i] as number)) as [number, number, number];
  const [px, pz] = joint.point;
  const hinge = [0, 1, 2].map((i) => (lying.origin[i] as number) + px * (lying.x[i] as number) + pz * (lying.z[i] as number)) as [number, number, number];
  const origin = [0, 1, 2].map((i) => (hinge[i] as number) - px * (x[i] as number) - pz * (z[i] as number)) as [number, number, number];
  return { origin, x, up, z, upright: true };
}

/** Lays every point of the paper out for a set of angles, resting on the table. */
export function poseCraft(mesh: SoftMesh, joints: readonly Joint[], angles: readonly number[], stance: Stance, thickness: number, out: Float64Array): void {
  const owner = new Int32Array(mesh.vertexCount).fill(-1);
  joints.forEach((joint, i) => {
    for (const f of joint.faces) for (let k = 0; k < 3; k++) owner[mesh.cornerVertex[f * 3 + k] as number] = i;
  });
  const local = new Float64Array(3);
  let clearance = Infinity;
  for (let v = 0; v < mesh.vertexCount; v++) {
    const fx = mesh.flat[v * 2] as number, fz = mesh.flat[v * 2 + 1] as number;
    const j = owner[v] as number;
    if (j >= 0) jointPoint(joints[j] as Joint, fx, fz, angles[j] as number, local);
    else {
      local[0] = fx;
      local[1] = 0;
      local[2] = fz;
    }
    toWorld(stance, local, out, v * 3);
    clearance = Math.min(clearance, (out[v * 3 + 1] as number) - (mesh.vertexDepth[v] as number) * thickness);
  }
  for (let v = 0; v < mesh.vertexCount; v++) out[v * 3 + 1] = (out[v * 3 + 1] as number) - clearance;
}
