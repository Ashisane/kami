import { extractRotation, rotateInto } from './rotation';
import type { Quat } from './rotation';
import type { SoftMesh } from './softMesh';

/**
 * Floppy paper. An XPBD particle solver in typed arrays with no three.js, so it
 * can run headless in tests, move to a worker, or run on a server.
 */
export interface SoftSettings {
  substeps: number;
  gravity: number;
  /** One layer's thickness in metres. */
  thickness: number;
  /** How easily one layer bends. Larger is floppier. */
  floppiness: number;
  /** Air resistance on the face of the sheet. */
  airDrag: number;
  /** Fraction of ground sliding removed each substep. */
  friction: number;
}

export const DEFAULT_SOFT: SoftSettings = {
  substeps: 12,
  gravity: 9.8,
  thickness: 0.0034,
  floppiness: 0.25,
  airDrag: 1.4,
  friction: 0.8,
};

/** A point on the paper held in place: by a player, or by a test pin. */
export interface Pin {
  tri: number;
  /** Barycentric weights across the triangle's corners. */
  b0: number;
  b1: number;
  b2: number;
  /** Where the hand wants to be. */
  x: number;
  y: number;
  z: number;
  /** Where the hand actually is. It chases the target, at a speed paper can follow. */
  heldX: number;
  heldY: number;
  heldZ: number;
  /** Where the held point sat on the unfolded sheet, once for each layer held: x z pairs, in metres. */
  rest: Float64Array;
  /** How far the held point can get from each point of locked paper, in metres. */
  reach: Float64Array;
  /** How far it can get from each other pin's held point, in metres. */
  span: Map<Pin, number>;
  /** How far past the paper's reach the hand is trying to go, in metres. */
  strain: number;
  /** How hard it holds: the share of the way to the hand paper is pulled each substep. */
  strength: number;
  /** True if other hands can carry paper only as far as it reaches from this one. Feet pressing down do not. */
  anchoring: boolean;
}

/**
 * Something standing in the paper's way, such as a being: an upright capsule that
 * hardened paper cannot pass through. Soft paper passes through bodies: a sheet that
 * shoved at everyone walking on it, and wrapped round anyone carrying it, fought
 * every move a player made.
 */
export interface Body {
  x: number;
  z: number;
  /** Heights of the capsule's spine, bottom and top, in metres. */
  bottom: number;
  top: number;
  radius: number;
}

const BEND_COMPLIANCE = 0.02;
/** A made crease holds far harder than flat paper, so a fold stays shut. */
const CREASE_COMPLIANCE = 0.0015;
/** How much more easily paper bends along a crease that was opened out again. */
const OPENED_CREASE_EASE = 6;
/**
 * The sharpest an uncreased edge can bend. This gives paper a minimum bend
 * radius: it rolls where cloth would crumple, which is what stops it folding
 * into itself. Only a committed fold makes a sharp crease.
 */
const BEND_LIMIT = 0.85;
/** Fastest a hand can drag paper, in metres per second. Faster and layers tunnel. */
const HAND_SPEED = 7;
/** How far paper gives before it stops a hand: a share of the span, and a little more. */
const REACH_GIVE = 0.01;
const REACH_SLACK = 0.005;
/** Substeps between contact searches. */
const CONTACT_INTERVAL = 6;
/**
 * How fast a stack stiffens with its layers. Folded layers slide over each other,
 * so a stack bends more like a pile of sheets (a power of 1) than a solid beam (3),
 * and creases stiffen it a little beyond a pile. Measured, not guessed: see `sag`.
 */
const STACK_STIFFENING = 2;
const PIN_STRENGTH = 0.7;
const DAMPING = 0.998;
/** Space kept between loose sheets. Real paper is too thin for a solver to hold apart. */
export const CONTACT_GAP = 0.03;
/** Fastest a point may move per substep, as a share of the gap, so layers cannot pass through. */
const MAX_TRAVEL = 0.45;

const CONTACT_SAMPLES = [1 / 3, 1 / 3, 1 / 3, 0.5, 0.5, 0, 0, 0.5, 0.5, 0.5, 0, 0.5, 0.9, 0.05, 0.05, 0.05, 0.9, 0.05, 0.05, 0.05, 0.9];
const SAMPLE_COUNT = CONTACT_SAMPLES.length / 3;
const CONTACT_REACH = 0.2;
const INSIDE_MARGIN = 0.03;
/** Contact searches a remembered side outlives once the paper has moved apart. */
const SIDE_MEMORY = 6;

/** The shortest span of paper between two held points, over the layers each one holds. */
function restGap(a: Float64Array, b: Float64Array): number {
  let shortest = Infinity;
  for (let i = 0; i < a.length; i += 2) {
    for (let j = 0; j < b.length; j += 2) shortest = Math.min(shortest, Math.hypot((a[i] as number) - (b[j] as number), (a[i + 1] as number) - (b[j + 1] as number)));
  }
  return shortest;
}

/** Moves a point to just outside a body, if it is inside. True if it moved. */
function outOf(body: Body, reach: number, point: { x: number; y: number; z: number }): boolean {
  if (point.y < body.bottom - reach || point.y > body.top + reach) return false;
  const dx = point.x - body.x, dz = point.z - body.z;
  if (dx * dx + dz * dz > reach * reach) return false;
  const cy = Math.max(body.bottom, Math.min(body.top, point.y));
  const dy = point.y - cy;
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (distance >= reach) return false;
  if (distance < 1e-6) {
    point.x = body.x + reach;
    return true;
  }
  const s = reach / distance;
  point.x = body.x + dx * s;
  point.y = cy + dy * s;
  point.z = body.z + dz * s;
  return true;
}

/** Seconds a hand can be held at full strain before its grip slips. */
export const SLIP_SECONDS = 0.8;
/** Metres past its reach a hand must aim for the strain to count as full. */
export const FULL_STRAIN = 0.6;

/**
 * Times how long a hand has been pulling past what paper allows. Paper never tears:
 * held at full strain long enough, the grip slips and lets go instead.
 */
export class StrainClock {
  private seconds = 0;

  /** Advances by a frame. True once the grip should slip. */
  update(strain: number, dt: number): boolean {
    this.seconds = strain >= FULL_STRAIN ? this.seconds + dt : Math.max(0, this.seconds - dt * 2);
    return this.seconds >= SLIP_SECONDS;
  }

  /** How close the grip is to slipping, from 0 to 1. */
  get tension(): number {
    return Math.min(1, this.seconds / SLIP_SECONDS);
  }

  reset(): void {
    this.seconds = 0;
  }
}

export class SoftSheet {
  readonly x: Float64Array;
  readonly v: Float64Array;
  readonly w: Float64Array;
  readonly pins: Pin[] = [];
  readonly settings: SoftSettings;

  private readonly p: Float64Array;
  private readonly hingeRest: Float64Array;
  private readonly hingeCompliance: Float64Array;
  private readonly hingePrevious: Float64Array;
  private readonly groundHeight: Float64Array;

  // Sides remembered per contact, so a layer that goes too far is pushed back the right way.
  private readonly sides = new Map<number, number>();
  private contactFrame = 0;
  private contactTri = new Int32Array(1 << 12);
  private contactSample = new Int32Array(1 << 12);
  private contactOther = new Int32Array(1 << 12);
  private contactSide = new Int8Array(1 << 12);
  private contactCount = 0;
  private readonly grid = new Map<number, number[]>();
  private readonly centre: Float64Array;

  private readonly contactCell: number;
  private readonly reachPoint = { x: 0, y: 0, z: 0 };
  private readonly bodyPoint = { x: 0, y: 0, z: 0 };

  /** Points of locked paper, which bound how far any hand can carry the paper it holds. */
  private readonly anchors: Int32Array;
  /** Where each anchor's layers sat on the unfolded sheet: x z pairs, from `anchorStart`. */
  private readonly anchorRest: Float64Array;
  private readonly anchorStart: Int32Array;

  private solid: Float64Array | null = null;
  private readonly orientation: Quat = [0, 0, 0, 1];
  private readonly covariance = new Float64Array(9);

  constructor(
    readonly mesh: SoftMesh,
    settings: Partial<SoftSettings> = {},
    initial?: Float64Array,
    /** Bodies that push hardened paper aside. Move them freely; they are read every substep. */
    readonly bodies: Body[] = [],
  ) {
    this.settings = { ...DEFAULT_SOFT, ...settings };
    const n = mesh.vertexCount;
    this.x = new Float64Array(n * 3);
    this.p = new Float64Array(n * 3);
    this.v = new Float64Array(n * 3);
    this.w = mesh.inverseMass.slice();
    this.groundHeight = new Float64Array(n);
    this.centre = new Float64Array(mesh.triCount * 3);

    const { thickness } = this.settings;
    for (let i = 0; i < n; i++) {
      this.groundHeight[i] = (mesh.vertexDepth[i] as number) * thickness;
      if (!initial) {
        this.x[i * 3] = mesh.flat[i * 2] as number;
        this.x[i * 3 + 1] = this.groundHeight[i] as number;
        this.x[i * 3 + 2] = mesh.flat[i * 2 + 1] as number;
      }
    }
    if (initial) this.x.set(initial);

    this.contactCell = Math.max(...mesh.edgeLength) * 1.1;

    // Locked paper does not move. Each of its points is reached through every layer meeting there.
    const anchorOf = new Int32Array(n).fill(-1);
    const anchors: number[] = [];
    for (let i = 0; i < n; i++) {
      if (this.w[i] !== 0) continue;
      anchorOf[i] = anchors.length;
      anchors.push(i);
    }
    this.anchors = Int32Array.from(anchors);
    this.anchorStart = new Int32Array(anchors.length + 1);
    const { cornerVertex, cornerRest } = mesh;
    for (let c = 0; c < cornerVertex.length; c++) {
      const a = anchorOf[cornerVertex[c] as number] ?? -1;
      if (a >= 0) this.anchorStart[a + 1] = (this.anchorStart[a + 1] as number) + 1;
    }
    for (let a = 0; a < anchors.length; a++) this.anchorStart[a + 1] = (this.anchorStart[a + 1] as number) + (this.anchorStart[a] as number);
    this.anchorRest = new Float64Array((this.anchorStart[anchors.length] as number) * 2);
    const filled = this.anchorStart.slice(0, anchors.length);
    for (let c = 0; c < cornerVertex.length; c++) {
      const a = anchorOf[cornerVertex[c] as number] ?? -1;
      if (a < 0) continue;
      const slot = filled[a] as number;
      filled[a] = slot + 1;
      this.anchorRest[slot * 2] = cornerRest[c * 2] as number;
      this.anchorRest[slot * 2 + 1] = cornerRest[c * 2 + 1] as number;
    }

    const hinges = mesh.hinges.length / 4;
    this.hingeRest = new Float64Array(hinges);
    this.hingeCompliance = new Float64Array(hinges);
    this.hingePrevious = new Float64Array(hinges);
    this.applyStiffness();
    for (let h = 0; h < hinges; h++) {
      const angle = this.hingeAngle(h);
      this.hingePrevious[h] = angle;
      if (mesh.hingeFolded[h]) this.hingeRest[h] = angle < 0 ? -Math.PI : Math.PI;
    }
  }

  /** Sets how easily paper bends. Creases hold the same however floppy the sheet is. */
  setFloppiness(floppiness: number): void {
    this.settings.floppiness = floppiness;
    this.applyStiffness();
  }

  private applyStiffness(): void {
    const { floppiness } = this.settings;
    const { hingeFolded, hingeLayers, hingeCreased } = this.mesh;
    for (let h = 0; h < this.hingeCompliance.length; h++) {
      const layers = hingeLayers[h] as number;
      // A crease is a line of weakness: thicker paper resists it only a little.
      const flat = (BEND_COMPLIANCE * floppiness) / layers ** STACK_STIFFENING;
      this.hingeCompliance[h] = hingeFolded[h] ? CREASE_COMPLIANCE / layers : hingeCreased[h] ? flat * OPENED_CREASE_EASE : flat;
    }
  }

  private hingeAngle(h: number): number {
    const { hinges } = this.mesh;
    const x = this.x;
    const a = (hinges[h * 4] as number) * 3, b = (hinges[h * 4 + 1] as number) * 3;
    const c = (hinges[h * 4 + 2] as number) * 3, d = (hinges[h * 4 + 3] as number) * 3;
    const ex = (x[b] as number) - (x[a] as number), ey = (x[b + 1] as number) - (x[a + 1] as number), ez = (x[b + 2] as number) - (x[a + 2] as number);
    const cx = (x[c] as number) - (x[a] as number), cy = (x[c + 1] as number) - (x[a + 1] as number), cz = (x[c + 2] as number) - (x[a + 2] as number);
    const dx = (x[d] as number) - (x[a] as number), dy = (x[d + 1] as number) - (x[a + 1] as number), dz = (x[d + 2] as number) - (x[a + 2] as number);
    const n1x = ey * cz - ez * cy, n1y = ez * cx - ex * cz, n1z = ex * cy - ey * cx;
    const n2x = dy * ez - dz * ey, n2y = dz * ex - dx * ez, n2z = dx * ey - dy * ex;
    const length = Math.sqrt(ex * ex + ey * ey + ez * ez) || 1;
    const sx = n1y * n2z - n1z * n2y, sy = n1z * n2x - n1x * n2z, sz = n1x * n2y - n1y * n2x;
    return Math.atan2((sx * ex + sy * ey + sz * ez) / length, n1x * n2x + n1y * n2y + n1z * n2z);
  }

  /** Current fold angle across a hinge, in radians. */
  angleAt(h: number): number {
    return this.hingePrevious[h] as number;
  }

  addPin(tri: number, b0: number, b1: number, b2: number): Pin {
    const rest = this.restAt(tri, b0, b1, b2);
    const { anchors, anchorRest, anchorStart } = this;
    const reach = new Float64Array(anchors.length);
    for (let a = 0; a < anchors.length; a++) {
      let shortest = Infinity;
      for (let j = anchorStart[a] as number; j < (anchorStart[a + 1] as number); j++) {
        const ax = anchorRest[j * 2] as number, az = anchorRest[j * 2 + 1] as number;
        for (let p = 0; p < rest.length; p += 2) shortest = Math.min(shortest, Math.hypot((rest[p] as number) - ax, (rest[p + 1] as number) - az));
      }
      reach[a] = shortest;
    }
    const pin: Pin = { tri, b0, b1, b2, x: 0, y: 0, z: 0, heldX: 0, heldY: 0, heldZ: 0, rest, reach, span: new Map(), strain: 0, strength: PIN_STRENGTH, anchoring: true };
    for (const other of this.pins) {
      const gap = restGap(rest, other.rest);
      pin.span.set(other, gap);
      other.span.set(pin, gap);
    }
    this.pinPoint(pin, pin);
    pin.heldX = pin.x;
    pin.heldY = pin.y;
    pin.heldZ = pin.z;
    this.pins.push(pin);
    return pin;
  }

  /** Where a point of a triangle sat on the unfolded sheet, once for each of its layers. */
  private restAt(tri: number, b0: number, b1: number, b2: number): Float64Array {
    const { faceTri, cornerVertex, cornerRest, tris } = this.mesh;
    const out: number[] = [];
    for (let f = 0; f < faceTri.length; f++) {
      if (faceTri[f] !== tri) continue;
      let x = 0, z = 0;
      for (let k = 0; k < 3; k++) {
        const v = tris[tri * 3 + k] as number;
        const weight = k === 0 ? b0 : k === 1 ? b1 : b2;
        for (let c = 0; c < 3; c++) {
          if (cornerVertex[f * 3 + c] !== v) continue;
          x += weight * (cornerRest[(f * 3 + c) * 2] as number);
          z += weight * (cornerRest[(f * 3 + c) * 2 + 1] as number);
        }
      }
      out.push(x, z);
    }
    return Float64Array.from(out);
  }

  removePin(pin: Pin): void {
    const i = this.pins.indexOf(pin);
    if (i >= 0) this.pins.splice(i, 1);
    for (const other of this.pins) other.span.delete(pin);
  }

  /** Where a pinned point of the paper actually is right now. */
  pinPoint(pin: Pin, out: { x: number; y: number; z: number }): void {
    const { tris } = this.mesh;
    const a = (tris[pin.tri * 3] as number) * 3, b = (tris[pin.tri * 3 + 1] as number) * 3, c = (tris[pin.tri * 3 + 2] as number) * 3;
    const x = this.x;
    out.x = pin.b0 * (x[a] as number) + pin.b1 * (x[b] as number) + pin.b2 * (x[c] as number);
    out.y = pin.b0 * (x[a + 1] as number) + pin.b1 * (x[b + 1] as number) + pin.b2 * (x[c + 1] as number);
    out.z = pin.b0 * (x[a + 2] as number) + pin.b1 * (x[b + 2] as number) + pin.b2 * (x[c + 2] as number);
  }

  step(dt: number): void {
    const { substeps } = this.settings;
    const h = dt / substeps;
    this.applyAir(dt);
    const rigid = this.solid !== null;
    for (let s = 0; s < substeps; s++) {
      if (!rigid && s % CONTACT_INTERVAL === 0) this.findContacts();
      this.integrate(h);
      this.moveHands(h);
      this.solvePins();
      if (rigid) {
        // Only hardened paper is solid enough for a body to shove.
        this.solveBodies();
        this.solveGround();
        this.solveSolid();
      } else {
        this.solveHinges(h);
        this.solveContacts();
        // Twice, because a hanging sheet puts all its weight through a few edges.
        this.solveDistances();
        this.solveDistances();
        this.solveGround();
      }
      this.updateVelocity(h);
    }
  }

  /** The sheet's face catches the air, so it falls slowly and billows. */
  private applyAir(dt: number): void {
    const { tris, triCount } = this.mesh;
    const { airDrag } = this.settings;
    const x = this.x, v = this.v, w = this.w;
    for (let t = 0; t < triCount; t++) {
      const ia = tris[t * 3] as number, ib = tris[t * 3 + 1] as number, ic = tris[t * 3 + 2] as number;
      const a = ia * 3, b = ib * 3, c = ic * 3;
      const ux = (x[b] as number) - (x[a] as number), uy = (x[b + 1] as number) - (x[a + 1] as number), uz = (x[b + 2] as number) - (x[a + 2] as number);
      const px = (x[c] as number) - (x[a] as number), py = (x[c + 1] as number) - (x[a + 1] as number), pz = (x[c + 2] as number) - (x[a + 2] as number);
      const nx = uy * pz - uz * py, ny = uz * px - ux * pz, nz = ux * py - uy * px;
      const area = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (area < 1e-9) continue;
      const vx = ((v[a] as number) + (v[b] as number) + (v[c] as number)) / 3;
      const vy = ((v[a + 1] as number) + (v[b + 1] as number) + (v[c + 1] as number)) / 3;
      const vz = ((v[a + 2] as number) + (v[b + 2] as number) + (v[c + 2] as number)) / 3;
      const push = -airDrag * dt * ((vx * nx + vy * ny + vz * nz) / area);
      const fx = nx * push, fy = ny * push, fz = nz * push;
      for (const [i, j] of [[ia, a], [ib, b], [ic, c]] as const) {
        const m = w[i] as number;
        v[j] = (v[j] as number) + fx * m;
        v[j + 1] = (v[j + 1] as number) + fy * m;
        v[j + 2] = (v[j + 2] as number) + fz * m;
      }
    }
  }

  private integrate(h: number): void {
    const { x, v, p, w } = this;
    const limit = (MAX_TRAVEL * CONTACT_GAP) / h;
    const fall = this.settings.gravity * h;
    for (let i = 0; i < w.length; i++) {
      const j = i * 3;
      p[j] = x[j] as number;
      p[j + 1] = x[j + 1] as number;
      p[j + 2] = x[j + 2] as number;
      if (w[i] === 0) continue;
      v[j + 1] = (v[j + 1] as number) - fall;
      const vx = v[j] as number, vy = v[j + 1] as number, vz = v[j + 2] as number;
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const scale = speed > limit ? limit / speed : 1;
      v[j] = vx * scale;
      v[j + 1] = vy * scale;
      v[j + 2] = vz * scale;
      x[j] = (x[j] as number) + vx * scale * h;
      x[j + 1] = (x[j + 1] as number) + vy * scale * h;
      x[j + 2] = (x[j + 2] as number) + vz * scale * h;
    }
  }

  private moveHands(h: number): void {
    const reach = HAND_SPEED * h;
    const point = this.reachPoint;
    for (const pin of this.pins) {
      const dx = pin.x - pin.heldX, dy = pin.y - pin.heldY, dz = pin.z - pin.heldZ;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance === 0) continue;
      const k = distance > reach ? reach / distance : 1;
      point.x = pin.heldX + dx * k;
      point.y = pin.heldY + dy * k;
      point.z = pin.heldZ + dz * k;
      this.keepInReach(pin, point);
      pin.heldX = point.x;
      pin.heldY = point.y;
      pin.heldZ = point.z;
      // How far past its reach the hand is aiming, for whoever draws it straining.
      point.x = pin.x;
      point.y = pin.y;
      point.z = pin.z;
      this.keepInReach(pin, point);
      pin.strain = Math.hypot(pin.x - point.x, pin.y - point.y, pin.z - point.z);
    }
  }

  /**
   * Paper does not stretch, so a hand can carry it only as far as it reaches from
   * whatever else holds it: locked paper, or another hand. Pulling further, the paper
   * stops the hand instead of tearing. Reach is measured on the unfolded sheet, layer
   * by layer, which is as far as paper can ever span.
   */
  private keepInReach(pin: Pin, point: { x: number; y: number; z: number }): void {
    const { x, anchors } = this;
    const { reach } = pin;
    const ball = (cx: number, cy: number, cz: number, radius: number) => {
      const dx = point.x - cx, dy = point.y - cy, dz = point.z - cz;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (distance <= radius) return;
      const s = radius / distance;
      point.x = cx + dx * s;
      point.y = cy + dy * s;
      point.z = cz + dz * s;
    };
    for (let i = 0; i < anchors.length; i++) {
      const v = (anchors[i] as number) * 3;
      ball(x[v] as number, x[v + 1] as number, x[v + 2] as number, (reach[i] as number) * (1 + REACH_GIVE) + REACH_SLACK);
    }
    for (const [other, gap] of pin.span) if (other.anchoring) ball(other.heldX, other.heldY, other.heldZ, gap * (1 + REACH_GIVE) + REACH_SLACK);
  }

  private solvePins(): void {
    const { tris } = this.mesh;
    const { x, w } = this;
    for (const pin of this.pins) {
      const ia = tris[pin.tri * 3] as number, ib = tris[pin.tri * 3 + 1] as number, ic = tris[pin.tri * 3 + 2] as number;
      const a = ia * 3, b = ib * 3, c = ic * 3;
      const px = pin.b0 * (x[a] as number) + pin.b1 * (x[b] as number) + pin.b2 * (x[c] as number);
      const py = pin.b0 * (x[a + 1] as number) + pin.b1 * (x[b + 1] as number) + pin.b2 * (x[c + 1] as number);
      const pz = pin.b0 * (x[a + 2] as number) + pin.b1 * (x[b + 2] as number) + pin.b2 * (x[c + 2] as number);
      const wa = (w[ia] as number) * pin.b0, wb = (w[ib] as number) * pin.b1, wc = (w[ic] as number) * pin.b2;
      const total = wa * pin.b0 + wb * pin.b1 + wc * pin.b2;
      if (total === 0) continue;
      const s = pin.strength / total;
      const dx = (pin.heldX - px) * s, dy = (pin.heldY - py) * s, dz = (pin.heldZ - pz) * s;
      x[a] = (x[a] as number) + dx * wa; x[a + 1] = (x[a + 1] as number) + dy * wa; x[a + 2] = (x[a + 2] as number) + dz * wa;
      x[b] = (x[b] as number) + dx * wb; x[b + 1] = (x[b + 1] as number) + dy * wb; x[b + 2] = (x[b + 2] as number) + dz * wb;
      x[c] = (x[c] as number) + dx * wc; x[c + 1] = (x[c + 1] as number) + dy * wc; x[c + 2] = (x[c + 2] as number) + dz * wc;
    }
  }

  /**
   * Shoves hardened paper out of every body, as one piece: the deepest any point or
   * edge middle is inside a body is how far the whole solid moves, sideways, so it
   * clears the body without bending. Edge middles count because an edge can be
   * longer than a body is wide.
   */
  private solveBodies(): void {
    const { x, w } = this;
    const { edges } = this.mesh;
    const reach = (body: Body) => body.radius + CONTACT_GAP;
    const point = this.bodyPoint;
    for (const body of this.bodies) {
      let pushX = 0, pushZ = 0, deepest = 0;
      const feel = (px: number, py: number, pz: number) => {
        point.x = px;
        point.y = py;
        point.z = pz;
        if (!outOf(body, reach(body), point)) return;
        const dx = point.x - px, dz = point.z - pz;
        const depth = dx * dx + dz * dz;
        if (depth <= deepest) return;
        deepest = depth;
        pushX = dx;
        pushZ = dz;
      };
      for (let e = 0; e < edges.length; e += 2) {
        const a = (edges[e] as number) * 3, b = (edges[e + 1] as number) * 3;
        feel(((x[a] as number) + (x[b] as number)) / 2, ((x[a + 1] as number) + (x[b + 1] as number)) / 2, ((x[a + 2] as number) + (x[b + 2] as number)) / 2);
      }
      for (let j = 0; j < x.length; j += 3) feel(x[j] as number, x[j + 1] as number, x[j + 2] as number);
      if (deepest === 0) continue;
      for (let i = 0; i < w.length; i++) {
        if (w[i] === 0) continue;
        x[i * 3] = (x[i * 3] as number) + pushX;
        x[i * 3 + 2] = (x[i * 3 + 2] as number) + pushZ;
      }
    }
  }

  private solveDistances(): void {
    const { edges, edgeLength } = this.mesh;
    const { x, w } = this;
    for (let e = 0; e < edgeLength.length; e++) {
      const ia = edges[e * 2] as number, ib = edges[e * 2 + 1] as number;
      const wa = w[ia] as number, wb = w[ib] as number, total = wa + wb;
      if (total === 0) continue;
      const a = ia * 3, b = ib * 3;
      const dx = (x[a] as number) - (x[b] as number), dy = (x[a + 1] as number) - (x[b + 1] as number), dz = (x[a + 2] as number) - (x[b + 2] as number);
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d === 0) continue;
      const s = (d - (edgeLength[e] as number)) / d / total;
      const sa = s * wa, sb = s * wb;
      x[a] = (x[a] as number) - dx * sa; x[a + 1] = (x[a + 1] as number) - dy * sa; x[a + 2] = (x[a + 2] as number) - dz * sa;
      x[b] = (x[b] as number) + dx * sb; x[b + 1] = (x[b + 1] as number) + dy * sb; x[b + 2] = (x[b + 2] as number) + dz * sb;
    }
  }

  private solveHinges(h: number): void {
    const { hinges } = this.mesh;
    const { x, w } = this;
    const { hingeFolded, hingeLoose, hingeCreased } = this.mesh;
    const count = hinges.length / 4;
    const inverseStep = 1 / (h * h);
    for (let n = 0; n < count; n++) {
      // Paper being folded turns freely on the line, like a hinge. Springing back
      // towards flat there was far stronger than paper's weight, so a fold held near
      // its landing flipped the paper on the other side of the line up to meet it.
      if (hingeLoose[n]) continue;
      const ia = hinges[n * 4] as number, ib = hinges[n * 4 + 1] as number, ic = hinges[n * 4 + 2] as number, id = hinges[n * 4 + 3] as number;
      const a = ia * 3, b = ib * 3, c = ic * 3, d = id * 3;
      const ex = (x[b] as number) - (x[a] as number), ey = (x[b + 1] as number) - (x[a + 1] as number), ez = (x[b + 2] as number) - (x[a + 2] as number);
      const cx = (x[c] as number) - (x[a] as number), cy = (x[c + 1] as number) - (x[a + 1] as number), cz = (x[c + 2] as number) - (x[a + 2] as number);
      const dx = (x[d] as number) - (x[a] as number), dy = (x[d + 1] as number) - (x[a + 1] as number), dz = (x[d + 2] as number) - (x[a + 2] as number);
      const n1x = ey * cz - ez * cy, n1y = ez * cx - ex * cz, n1z = ex * cy - ey * cx;
      const n2x = dy * ez - dz * ey, n2y = dz * ex - dx * ez, n2z = dx * ey - dy * ex;
      const n1s = n1x * n1x + n1y * n1y + n1z * n1z, n2s = n2x * n2x + n2y * n2y + n2z * n2z;
      if (n1s < 1e-12 || n2s < 1e-12) continue;
      const lengthSquared = ex * ex + ey * ey + ez * ez, length = Math.sqrt(lengthSquared);
      const sx = n1y * n2z - n1z * n2y, sy = n1z * n2x - n1x * n2z, sz = n1x * n2y - n1y * n2x;
      let angle = Math.atan2((sx * ex + sy * ey + sz * ez) / length, n1x * n2x + n1y * n2y + n1z * n2z);
      const previous = this.hingePrevious[n] as number;
      // Unwrap past a half turn. A sum, not a loop, so bad numbers cannot hang the solver.
      angle -= Math.round((angle - previous) / (Math.PI * 2)) * Math.PI * 2;
      this.hingePrevious[n] = angle;

      const k1 = -length / n1s, k2 = -length / n2s;
      const gcx = n1x * k1, gcy = n1y * k1, gcz = n1z * k1;
      const gdx = n2x * k2, gdy = n2y * k2, gdz = n2z * k2;
      const s1 = (cx * ex + cy * ey + cz * ez) / lengthSquared, s2 = (dx * ex + dy * ey + dz * ez) / lengthSquared;
      const gax = -(1 - s1) * gcx - (1 - s2) * gdx, gay = -(1 - s1) * gcy - (1 - s2) * gdy, gaz = -(1 - s1) * gcz - (1 - s2) * gdz;
      const gbx = -s1 * gcx - s2 * gdx, gby = -s1 * gcy - s2 * gdy, gbz = -s1 * gcz - s2 * gdz;
      const wa = w[ia] as number, wb = w[ib] as number, wc = w[ic] as number, wd = w[id] as number;
      const weight = wa * (gax * gax + gay * gay + gaz * gaz) + wb * (gbx * gbx + gby * gby + gbz * gbz)
        + wc * (gcx * gcx + gcy * gcy + gcz * gcz) + wd * (gdx * gdx + gdy * gdy + gdz * gdz);
      // All four points held: nothing here can move, and a stop dead would divide by nothing.
      if (weight === 0) continue;
      // Past the bend limit the edge stops dead, instead of springing softly.
      const bend = angle - (this.hingeRest[n] as number);
      // An opened crease folds sharp again easily, so it has no minimum radius.
      const overLimit = !hingeFolded[n] && !hingeCreased[n] && Math.abs(bend) > BEND_LIMIT;
      const error = overLimit ? bend - Math.sign(bend) * BEND_LIMIT : bend;
      const softness = overLimit ? 0 : (this.hingeCompliance[n] as number) * inverseStep;
      const lambda = -error / (weight + softness);
      x[a] = (x[a] as number) + wa * gax * lambda; x[a + 1] = (x[a + 1] as number) + wa * gay * lambda; x[a + 2] = (x[a + 2] as number) + wa * gaz * lambda;
      x[b] = (x[b] as number) + wb * gbx * lambda; x[b + 1] = (x[b + 1] as number) + wb * gby * lambda; x[b + 2] = (x[b + 2] as number) + wb * gbz * lambda;
      x[c] = (x[c] as number) + wc * gcx * lambda; x[c + 1] = (x[c + 1] as number) + wc * gcy * lambda; x[c + 2] = (x[c + 2] as number) + wc * gcz * lambda;
      x[d] = (x[d] as number) + wd * gdx * lambda; x[d + 1] = (x[d + 1] as number) + wd * gdy * lambda; x[d + 2] = (x[d + 2] as number) + wd * gdz * lambda;
    }
  }

  private findContacts(): void {
    const { tris, triCount } = this.mesh;
    const { x, centre, grid } = this;
    // Sized from the triangles, so a finer grid is not comparing everything to everything.
    const cell = this.contactCell;
    const key = (i: number, j: number, k: number) => (i + 512) * 1048576 + (j + 512) * 1024 + (k + 512);
    grid.clear();
    this.contactCount = 0;
    this.contactFrame++;
    for (let t = 0; t < triCount; t++) {
      const a = (tris[t * 3] as number) * 3, b = (tris[t * 3 + 1] as number) * 3, c = (tris[t * 3 + 2] as number) * 3;
      const cx = ((x[a] as number) + (x[b] as number) + (x[c] as number)) / 3;
      const cy = ((x[a + 1] as number) + (x[b + 1] as number) + (x[c + 1] as number)) / 3;
      const cz = ((x[a + 2] as number) + (x[b + 2] as number) + (x[c + 2] as number)) / 3;
      centre[t * 3] = cx;
      centre[t * 3 + 1] = cy;
      centre[t * 3 + 2] = cz;
      const k = key(Math.floor(cx / cell), Math.floor(cy / cell), Math.floor(cz / cell));
      const list = grid.get(k);
      if (list) list.push(t);
      else grid.set(k, [t]);
    }
    const reach = (cell * cell) / 0.9;
    for (let t = 0; t < triCount; t++) {
      const cx = centre[t * 3] as number, cy = centre[t * 3 + 1] as number, cz = centre[t * 3 + 2] as number;
      const ix = Math.floor(cx / cell), iy = Math.floor(cy / cell), iz = Math.floor(cz / cell);
      const t0 = tris[t * 3] as number, t1 = tris[t * 3 + 1] as number, t2 = tris[t * 3 + 2] as number;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const list = grid.get(key(ix + dx, iy + dy, iz + dz));
            if (!list) continue;
            for (let n = 0; n < list.length; n++) {
              const o = list[n] as number;
              if (o === t) continue;
              const qx = cx - (centre[o * 3] as number), qy = cy - (centre[o * 3 + 1] as number), qz = cz - (centre[o * 3 + 2] as number);
              if (qx * qx + qy * qy + qz * qz > reach) continue;
              const o0 = tris[o * 3] as number, o1 = tris[o * 3 + 1] as number, o2 = tris[o * 3 + 2] as number;
              if (t0 === o0 || t0 === o1 || t0 === o2 || t1 === o0 || t1 === o1 || t1 === o2 || t2 === o0 || t2 === o1 || t2 === o2) continue;
              this.narrowPhase(t, o);
            }
          }
        }
      }
    }
  }

  private narrowPhase(t: number, o: number): void {
    const { tris, triCount } = this.mesh;
    const { x } = this;
    const a = (tris[o * 3] as number) * 3, b = (tris[o * 3 + 1] as number) * 3, c = (tris[o * 3 + 2] as number) * 3;
    const abx = (x[b] as number) - (x[a] as number), aby = (x[b + 1] as number) - (x[a + 1] as number), abz = (x[b + 2] as number) - (x[a + 2] as number);
    const acx = (x[c] as number) - (x[a] as number), acy = (x[c + 1] as number) - (x[a + 1] as number), acz = (x[c + 2] as number) - (x[a + 2] as number);
    let nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (length < 1e-9) return;
    nx /= length; ny /= length; nz /= length;
    const p0 = (tris[t * 3] as number) * 3, p1 = (tris[t * 3 + 1] as number) * 3, p2 = (tris[t * 3 + 2] as number) * 3;

    // All three corners well clear on one side means nothing here can be touching.
    const h0 = ((x[p0] as number) - (x[a] as number)) * nx + ((x[p0 + 1] as number) - (x[a + 1] as number)) * ny + ((x[p0 + 2] as number) - (x[a + 2] as number)) * nz;
    const h1 = ((x[p1] as number) - (x[a] as number)) * nx + ((x[p1 + 1] as number) - (x[a + 1] as number)) * ny + ((x[p1 + 2] as number) - (x[a + 2] as number)) * nz;
    const h2 = ((x[p2] as number) - (x[a] as number)) * nx + ((x[p2 + 1] as number) - (x[a + 1] as number)) * ny + ((x[p2 + 2] as number) - (x[a + 2] as number)) * nz;
    if ((h0 > CONTACT_REACH && h1 > CONTACT_REACH && h2 > CONTACT_REACH) || (h0 < -CONTACT_REACH && h1 < -CONTACT_REACH && h2 < -CONTACT_REACH)) return;

    const d00 = abx * abx + aby * aby + abz * abz, d01 = abx * acx + aby * acy + abz * acz, d11 = acx * acx + acy * acy + acz * acz;
    const det = d00 * d11 - d01 * d01;

    for (let s = 0; s < SAMPLE_COUNT; s++) {
      const b0 = CONTACT_SAMPLES[s * 3] as number, b1 = CONTACT_SAMPLES[s * 3 + 1] as number, b2 = CONTACT_SAMPLES[s * 3 + 2] as number;
      const px = b0 * (x[p0] as number) + b1 * (x[p1] as number) + b2 * (x[p2] as number) - (x[a] as number);
      const py = b0 * (x[p0 + 1] as number) + b1 * (x[p1 + 1] as number) + b2 * (x[p2 + 1] as number) - (x[a + 1] as number);
      const pz = b0 * (x[p0 + 2] as number) + b1 * (x[p1 + 2] as number) + b2 * (x[p2 + 2] as number) - (x[a + 2] as number);
      const d20 = px * abx + py * aby + pz * abz, d21 = px * acx + py * acy + pz * acz;
      const u = (d11 * d20 - d01 * d21) / det, v = (d00 * d21 - d01 * d20) / det;
      const memory = (t * SAMPLE_COUNT + s) * triCount + o;
      if (u < -INSIDE_MARGIN || v < -INSIDE_MARGIN || u + v > 1 + INSIDE_MARGIN) continue;
      const distance = px * nx + py * ny + pz * nz;
      // A side is remembered as a signed age, and forgotten once it goes stale.
      const stored = this.sides.get(memory);
      const fresh = stored !== undefined && this.contactFrame - Math.abs(stored) <= SIDE_MEMORY;
      if (!fresh && Math.abs(distance) > CONTACT_REACH) continue;
      const side = fresh ? Math.sign(stored) : distance >= 0 ? 1 : -1;
      this.sides.set(memory, side * this.contactFrame);
      this.pushContact(t, s, o, side);
    }
  }

  private pushContact(t: number, s: number, o: number, side: number): void {
    if (this.contactCount === this.contactTri.length) {
      const size = this.contactCount * 2;
      const grow = <T extends Int32Array | Int8Array>(old: T, next: T): T => {
        next.set(old);
        return next;
      };
      this.contactTri = grow(this.contactTri, new Int32Array(size));
      this.contactSample = grow(this.contactSample, new Int32Array(size));
      this.contactOther = grow(this.contactOther, new Int32Array(size));
      this.contactSide = grow(this.contactSide, new Int8Array(size));
    }
    const n = this.contactCount++;
    this.contactTri[n] = t;
    this.contactSample[n] = s;
    this.contactOther[n] = o;
    this.contactSide[n] = side;
  }

  private solveContacts(): void {
    const { tris, triLayers } = this.mesh;
    const { x, w } = this;
    const { thickness } = this.settings;
    for (let n = 0; n < this.contactCount; n++) {
      const t = this.contactTri[n] as number, o = this.contactOther[n] as number, s = this.contactSample[n] as number, side = this.contactSide[n] as number;
      const ia = tris[o * 3] as number, ib = tris[o * 3 + 1] as number, ic = tris[o * 3 + 2] as number;
      const a = ia * 3, b = ib * 3, c = ic * 3;
      const abx = (x[b] as number) - (x[a] as number), aby = (x[b + 1] as number) - (x[a + 1] as number), abz = (x[b + 2] as number) - (x[a + 2] as number);
      const acx = (x[c] as number) - (x[a] as number), acy = (x[c + 1] as number) - (x[a + 1] as number), acz = (x[c + 2] as number) - (x[a + 2] as number);
      let nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
      const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (length < 1e-9) continue;
      nx /= length; ny /= length; nz /= length;
      const i0 = tris[t * 3] as number, i1 = tris[t * 3 + 1] as number, i2 = tris[t * 3 + 2] as number;
      const p0 = i0 * 3, p1 = i1 * 3, p2 = i2 * 3;
      const b0 = CONTACT_SAMPLES[s * 3] as number, b1 = CONTACT_SAMPLES[s * 3 + 1] as number, b2 = CONTACT_SAMPLES[s * 3 + 2] as number;
      const px = b0 * (x[p0] as number) + b1 * (x[p1] as number) + b2 * (x[p2] as number) - (x[a] as number);
      const py = b0 * (x[p0 + 1] as number) + b1 * (x[p1 + 1] as number) + b2 * (x[p2 + 1] as number) - (x[a + 1] as number);
      const pz = b0 * (x[p0 + 2] as number) + b1 * (x[p1 + 2] as number) + b2 * (x[p2 + 2] as number) - (x[a + 2] as number);
      const gap = CONTACT_GAP + (thickness * ((triLayers[t] as number) + (triLayers[o] as number))) / 2;
      const violation = side * (px * nx + py * ny + pz * nz) - gap;
      if (violation >= 0) continue;
      const d00 = abx * abx + aby * aby + abz * abz, d01 = abx * acx + aby * acy + abz * acz, d11 = acx * acx + acy * acy + acz * acz;
      const det = d00 * d11 - d01 * d01;
      const d20 = px * abx + py * aby + pz * abz, d21 = px * acx + py * acy + pz * acz;
      const u = (d11 * d20 - d01 * d21) / det, v = (d00 * d21 - d01 * d20) / det, l = 1 - u - v;
      const w0 = b0 * (w[i0] as number), w1 = b1 * (w[i1] as number), w2 = b2 * (w[i2] as number);
      const wa = l * (w[ia] as number), wb = u * (w[ib] as number), wc = v * (w[ic] as number);
      const total = b0 * w0 + b1 * w1 + b2 * w2 + l * wa + u * wb + v * wc;
      if (total === 0) continue;
      const push = (-violation / total) * side;
      const fx = nx * push, fy = ny * push, fz = nz * push;
      x[p0] = (x[p0] as number) + fx * w0; x[p0 + 1] = (x[p0 + 1] as number) + fy * w0; x[p0 + 2] = (x[p0 + 2] as number) + fz * w0;
      x[p1] = (x[p1] as number) + fx * w1; x[p1 + 1] = (x[p1 + 1] as number) + fy * w1; x[p1 + 2] = (x[p1 + 2] as number) + fz * w1;
      x[p2] = (x[p2] as number) + fx * w2; x[p2 + 1] = (x[p2 + 1] as number) + fy * w2; x[p2 + 2] = (x[p2 + 2] as number) + fz * w2;
      x[a] = (x[a] as number) - fx * wa; x[a + 1] = (x[a + 1] as number) - fy * wa; x[a + 2] = (x[a + 2] as number) - fz * wa;
      x[b] = (x[b] as number) - fx * wb; x[b + 1] = (x[b + 1] as number) - fy * wb; x[b + 2] = (x[b + 2] as number) - fz * wb;
      x[c] = (x[c] as number) - fx * wc; x[c + 1] = (x[c + 1] as number) - fy * wc; x[c + 2] = (x[c + 2] as number) - fz * wc;
    }
  }

  private solveGround(): void {
    const { x, p, groundHeight } = this;
    const { friction } = this.settings;
    for (let i = 0; i < groundHeight.length; i++) {
      const j = i * 3;
      const ground = groundHeight[i] as number;
      if ((x[j + 1] as number) >= ground) continue;
      x[j + 1] = ground;
      // Starting below the ground must not read as a launch: a fold thickens the
      // paper, and pushing it out of the floor would otherwise fire it upward.
      if ((p[j + 1] as number) < ground) p[j + 1] = ground;
      x[j] = (x[j] as number) - ((x[j] as number) - (p[j] as number)) * friction;
      x[j + 2] = (x[j + 2] as number) - ((x[j + 2] as number) - (p[j + 2] as number)) * friction;
    }
  }

  private updateVelocity(h: number): void {
    const { x, p, v } = this;
    const scale = DAMPING / h;
    for (let i = 0; i < x.length; i++) v[i] = ((x[i] as number) - (p[i] as number)) * scale;
  }

  /** Freezes the shape the paper holds right now into one solid body, or lets it go soft again. */
  harden(solid: boolean): void {
    this.solid = null;
    if (solid) this.captureSolid();
  }

  get hardened(): boolean {
    return this.solid !== null;
  }

  private centreOfMass(): [number, number, number] {
    const { x, w } = this;
    let cx = 0, cy = 0, cz = 0, total = 0;
    for (let i = 0; i < w.length; i++) {
      const m = 1 / ((w[i] as number) || 1e-6);
      cx += (x[i * 3] as number) * m;
      cy += (x[i * 3 + 1] as number) * m;
      cz += (x[i * 3 + 2] as number) * m;
      total += m;
    }
    return [cx / total, cy / total, cz / total];
  }

  private captureSolid(): void {
    const [cx, cy, cz] = this.centreOfMass();
    const shape = this.x.slice();
    for (let i = 0; i < shape.length; i += 3) {
      shape[i] = (shape[i] as number) - cx;
      shape[i + 1] = (shape[i + 1] as number) - cy;
      shape[i + 2] = (shape[i + 2] as number) - cz;
    }
    this.solid = shape;
    this.orientation[0] = this.orientation[1] = this.orientation[2] = 0;
    this.orientation[3] = 1;
  }

  /** Snaps every point back to the frozen shape, in the best-fitting position. */
  private solveSolid(): void {
    const shape = this.solid;
    if (!shape) return;
    const { x, w, covariance: m } = this;
    const [cx, cy, cz] = this.centreOfMass();
    m.fill(0);
    for (let i = 0; i < w.length; i++) {
      const j = i * 3;
      const weight = 1 / ((w[i] as number) || 1e-6);
      const px = ((x[j] as number) - cx) * weight, py = ((x[j + 1] as number) - cy) * weight, pz = ((x[j + 2] as number) - cz) * weight;
      const qx = shape[j] as number, qy = shape[j + 1] as number, qz = shape[j + 2] as number;
      m[0] = (m[0] as number) + px * qx; m[1] = (m[1] as number) + py * qx; m[2] = (m[2] as number) + pz * qx;
      m[3] = (m[3] as number) + px * qy; m[4] = (m[4] as number) + py * qy; m[5] = (m[5] as number) + pz * qy;
      m[6] = (m[6] as number) + px * qz; m[7] = (m[7] as number) + py * qz; m[8] = (m[8] as number) + pz * qz;
    }
    extractRotation(m, this.orientation);
    for (let i = 0; i < w.length; i++) {
      const j = i * 3;
      rotateInto(this.orientation, shape[j] as number, shape[j + 1] as number, shape[j + 2] as number, x, j, cx, cy, cz);
    }
  }

  get contacts(): number {
    return this.contactCount;
  }

  /** The worst edge stretch right now, as a fraction. */
  stretch(): number {
    const { edges, edgeLength } = this.mesh;
    const x = this.x;
    let worst = 0;
    for (let e = 0; e < edgeLength.length; e++) {
      const a = (edges[e * 2] as number) * 3, b = (edges[e * 2 + 1] as number) * 3;
      const d = Math.hypot((x[a] as number) - (x[b] as number), (x[a + 1] as number) - (x[b + 1] as number), (x[a + 2] as number) - (x[b + 2] as number));
      worst = Math.max(worst, Math.abs(d - (edgeLength[e] as number)) / (edgeLength[e] as number));
    }
    return worst;
  }
}
