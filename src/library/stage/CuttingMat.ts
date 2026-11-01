import { CanvasTexture, Mesh, MeshLambertMaterial, PlaneGeometry, RepeatWrapping, SRGBColorSpace } from 'three';

export type Surface = 'mat' | 'card' | 'grey';

const SURFACES: Record<Surface, { base: string; minor: string; major: string; text: string }> = {
  mat: { base: '#2f6e62', minor: 'rgba(205,240,222,0.08)', major: 'rgba(218,246,230,0.26)', text: 'rgba(218,246,230,0.42)' },
  card: { base: '#efe6d3', minor: 'rgba(70,55,35,0.11)', major: 'rgba(70,55,35,0.34)', text: 'rgba(70,55,35,0.55)' },
  grey: { base: '#8c8c88', minor: 'rgba(255,255,255,0)', major: 'rgba(255,255,255,0.14)', text: 'rgba(255,255,255,0)' },
};

const TILE_METRES = 4;
const TILES = 14;

/** The desk everything is judged on. Major lines are one metre, minor lines ten centimetres. */
function drawTile(surface: Surface): HTMLCanvasElement {
  const { base, minor, major, text } = SURFACES[surface];
  const size = 2048;
  const perMetre = size / TILE_METRES;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  const steps = TILE_METRES * 10;
  ctx.strokeStyle = minor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < steps; i++) {
    const p = (i / steps) * size + 0.5;
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
  }
  ctx.stroke();

  ctx.strokeStyle = major;
  ctx.lineWidth = 5;
  ctx.beginPath();
  for (let i = 0; i < TILE_METRES; i++) {
    const p = i * perMetre + 0.5;
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
  }
  ctx.stroke();

  ctx.fillStyle = text;
  ctx.font = '46px "Kiwi Maru", serif';
  ctx.textBaseline = 'top';
  for (let i = 0; i < TILE_METRES; i++) {
    ctx.fillText(`${i} m`, i * perMetre + 14, 14);
  }
  return canvas;
}

export class CuttingMat {
  readonly mesh: Mesh<PlaneGeometry, MeshLambertMaterial>;
  private readonly textures = new Map<Surface, CanvasTexture>();

  constructor(private readonly anisotropy: number) {
    const size = TILE_METRES * TILES;
    // Lambert: a desk with any sheen turns into a mirror under a low sun.
    this.mesh = new Mesh(new PlaneGeometry(size, size), new MeshLambertMaterial());
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.receiveShadow = true;
    this.set('mat');
  }

  set(surface: Surface): void {
    let texture = this.textures.get(surface);
    if (!texture) {
      texture = new CanvasTexture(drawTile(surface));
      texture.colorSpace = SRGBColorSpace;
      texture.wrapS = texture.wrapT = RepeatWrapping;
      texture.repeat.set(TILES, TILES);
      texture.anisotropy = this.anisotropy;
      this.textures.set(surface, texture);
    }
    this.mesh.material.map = texture;
    this.mesh.material.needsUpdate = true;
  }
}
