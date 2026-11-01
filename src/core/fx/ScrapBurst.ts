import { BufferGeometry, Color, DynamicDrawUsage, Euler, Float32BufferAttribute, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { getStock } from '../paper/paperLibrary';
import { PaperMaterial } from '../paper/PaperMaterial';
import type { StockId } from '../paper/stocks';

interface Scrap {
  alive: boolean;
  position: Vector3;
  velocity: Vector3;
  euler: Euler;
  spin: Vector3;
  size: number;
  phase: number;
  /** Seconds since landing, or -1 while airborne. */
  rest: number;
}

const CAPACITY = 160;
const GRAVITY = 5.2;
const AIR_DRAG = 3;
const REST_TIME = 0.7;

/** An uneven little quad: reads as torn paper, not as a confetti rectangle. */
function scrapGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  const p = [-0.5, 0, -0.42, 0.46, 0, -0.5, 0.56, 0, 0.3, -0.34, 0, 0.5];
  geometry.setAttribute('position', new Float32BufferAttribute(p, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  geometry.setIndex([0, 2, 1, 0, 3, 2]);
  return geometry;
}

/** Paper scraps that flutter down and settle. One draw call however many fly. */
export class ScrapBurst {
  readonly mesh: InstancedMesh;
  private readonly scraps: Scrap[];
  private readonly matrix = new Matrix4();
  private readonly quaternion = new Quaternion();
  private readonly scale = new Vector3();
  private readonly color = new Color();
  private next = 0;
  private time = 0;

  constructor(private readonly groundY = 0.012) {
    const material = new PaperMaterial({ ...getStock('washi'), color: '#ffffff', fibreColor: '#e6e0d2' });
    this.mesh = new InstancedMesh(scrapGeometry(), material, CAPACITY);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.count = 0;
    this.scraps = Array.from({ length: CAPACITY }, () => ({
      alive: false,
      position: new Vector3(),
      velocity: new Vector3(),
      euler: new Euler(),
      spin: new Vector3(),
      size: 0,
      phase: 0,
      rest: -1,
    }));
    this.mesh.setColorAt(0, this.color.set('#ffffff'));
  }

  burst(origin: Vector3, count: number, stocks: readonly StockId[], power = 1, spread = 0.5): void {
    for (let i = 0; i < count; i++) {
      const scrap = this.scraps[this.next] as Scrap;
      const index = this.next;
      this.next = (this.next + 1) % CAPACITY;

      const angle = Math.random() * Math.PI * 2;
      const out = (1 + Math.random() * 2.4) * power;
      scrap.alive = true;
      scrap.rest = -1;
      scrap.position.set(
        origin.x + Math.cos(angle) * spread * Math.random(),
        origin.y + 0.03,
        origin.z + Math.sin(angle) * spread * Math.random(),
      );
      scrap.velocity.set(Math.cos(angle) * out, (2.2 + Math.random() * 3) * power, Math.sin(angle) * out);
      scrap.euler.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      scrap.spin.set(Math.random() * 16 - 8, Math.random() * 8 - 4, Math.random() * 16 - 8);
      scrap.size = 0.035 + Math.random() * 0.06;
      scrap.phase = Math.random() * 6;

      const stock = stocks[i % stocks.length] as StockId;
      this.mesh.setColorAt(index, this.color.set(getStock(stock).color));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear(): void {
    for (const scrap of this.scraps) scrap.alive = false;
    this.mesh.count = 0;
  }

  update(dt: number): void {
    this.time += dt;
    let highest = 0;

    this.scraps.forEach((scrap, i) => {
      let size = 0;
      if (scrap.alive) {
        if (scrap.rest < 0) this.fly(scrap, dt);
        else scrap.rest += dt;
        const fade = scrap.rest < 0 ? 1 : 1 - scrap.rest / REST_TIME;
        if (fade <= 0) scrap.alive = false;
        else size = scrap.size * Math.min(1, fade * 3);
      }
      this.quaternion.setFromEuler(scrap.euler);
      this.scale.setScalar(size);
      this.matrix.compose(scrap.position, this.quaternion, this.scale);
      this.mesh.setMatrixAt(i, this.matrix);
      if (scrap.alive) highest = i + 1;
    });

    this.mesh.count = highest;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private fly(scrap: Scrap, dt: number): void {
    const drag = Math.exp(-AIR_DRAG * dt);
    scrap.velocity.x *= drag;
    scrap.velocity.z *= drag;
    // Air resistance on a flat sheet: fast up, slow down.
    scrap.velocity.y = scrap.velocity.y > 0 ? scrap.velocity.y * drag : Math.max(scrap.velocity.y, -1.5);
    scrap.velocity.y -= GRAVITY * dt;

    // Side-to-side flutter once it starts falling.
    if (scrap.velocity.y < 0) {
      scrap.velocity.x += Math.sin(this.time * 7 + scrap.phase) * 3.2 * dt;
      scrap.velocity.z += Math.cos(this.time * 5 + scrap.phase) * 3.2 * dt;
    }

    scrap.position.addScaledVector(scrap.velocity, dt);
    scrap.euler.x += scrap.spin.x * dt;
    scrap.euler.y += scrap.spin.y * dt;
    scrap.euler.z += scrap.spin.z * dt;

    if (scrap.position.y <= this.groundY) {
      scrap.position.y = this.groundY;
      scrap.euler.x = 0;
      scrap.euler.z = 0;
      scrap.rest = 0;
    }
  }
}
