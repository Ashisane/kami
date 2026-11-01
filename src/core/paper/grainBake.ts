import {
  ClampToEdgeWrapping,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoBlending,
  Scene,
  ShaderMaterial,
  WebGLRenderTarget,
} from 'three';
import type { Texture, WebGLRenderer } from 'three';

/**
 * Bakes the shared paper grain once at startup. Fibres are real stamped curves,
 * not stretched noise, and everything wraps, so one pair of textures serves
 * every stock and no authored image files are needed.
 *
 * surface: RG = height gradient, B = height, A = unused
 * mottle:  R = formation clouds, G = flecks, B = long threads
 */
export interface PaperGrain {
  surface: Texture;
  mottle: Texture;
}

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const NOISE = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  vec3 hash3(vec2 p, float seed) {
    vec3 q = vec3(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)), dot(p, vec2(419.2, 371.9)));
    return fract(sin(q + seed * 17.13) * 43758.5453);
  }

  // Value noise that wraps every period cells.
  float wrapNoise(vec2 p, float period, float seed) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash3(mod(i, period), seed).x;
    float b = hash3(mod(i + vec2(1.0, 0.0), period), seed).x;
    float c = hash3(mod(i + vec2(0.0, 1.0), period), seed).x;
    float d = hash3(mod(i + vec2(1.0, 1.0), period), seed).x;
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 uv, float period, float seed) {
    float sum = 0.0, amp = 0.5;
    for (int i = 0; i < 5; i++) {
      sum += amp * wrapNoise(uv * period, period, seed + float(i));
      period *= 2.0;
      amp *= 0.5;
    }
    return sum;
  }

  // A layer of short curved fibres. Each cell stamps a few bent, tapered strands.
  float fibres(vec2 uv, float cells, float len, float width, float seed) {
    vec2 p = uv * cells;
    vec2 id = floor(p);
    float result = 0.0;
    for (int y = -2; y <= 2; y++) {
      for (int x = -2; x <= 2; x++) {
        vec2 cell = id + vec2(float(x), float(y));
        vec2 wrapped = mod(cell, cells);
        for (int n = 0; n < 2; n++) {
          vec3 r = hash3(wrapped + float(n) * 3.7, seed);
          vec3 s = hash3(wrapped + float(n) * 5.3, seed + 1.0);
          vec2 origin = cell + r.xy;
          float angle = r.z * 6.2831;
          float ca = cos(angle), sa = sin(angle);
          vec2 d = p - origin;
          vec2 q = vec2(ca * d.x + sa * d.y, -sa * d.x + ca * d.y);
          float along = clamp(q.x / len, -1.0, 1.0);
          float bend = (s.x - 0.5) * 0.7;
          q.y -= bend * (1.0 - along * along) * len;
          float dist = length(vec2(q.x - along * len, q.y));
          float taper = 1.0 - along * along;
          float strand = 1.0 - smoothstep(0.0, width * (0.4 + 0.6 * taper), dist);
          result = max(result, strand * (0.45 + 0.55 * s.y));
        }
      }
    }
    return result;
  }
`;

const HEIGHT_FRAG = /* glsl */ `
  ${NOISE}
  void main() {
    // Fibres slightly displaced by low noise so the sheet never looks stamped.
    vec2 warp = vec2(fbm(vUv, 6.0, 3.0), fbm(vUv, 6.0, 7.0)) - 0.5;
    vec2 uv = vUv + warp * 0.012;
    float coarse = fibres(uv, 26.0, 1.05, 0.16, 11.0);
    float mid = fibres(uv, 58.0, 1.1, 0.17, 23.0);
    float tooth = fbm(vUv, 170.0, 31.0);
    float cloud = fbm(vUv, 5.0, 41.0);
    float h = 0.34 + 0.34 * coarse + 0.2 * mid + 0.16 * (tooth - 0.5) + 0.16 * (cloud - 0.5);
    gl_FragColor = vec4(vec3(h), 1.0);
  }
`;

const SURFACE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uHeight;
  uniform float uTexel;
  void main() {
    float l = texture2D(uHeight, fract(vUv - vec2(uTexel, 0.0))).r;
    float r = texture2D(uHeight, fract(vUv + vec2(uTexel, 0.0))).r;
    float d = texture2D(uHeight, fract(vUv - vec2(0.0, uTexel))).r;
    float u = texture2D(uHeight, fract(vUv + vec2(0.0, uTexel))).r;
    float h = texture2D(uHeight, vUv).r;
    vec2 gradient = clamp(vec2(l - r, d - u) * 3.0, -1.0, 1.0);
    gl_FragColor = vec4(gradient * 0.5 + 0.5, h, 1.0);
  }
`;

const MOTTLE_FRAG = /* glsl */ `
  ${NOISE}
  void main() {
    float formation = fbm(vUv, 7.0, 53.0);

    // Sparse flecks: most cells stay empty.
    vec2 p = vUv * 64.0;
    vec2 id = floor(p);
    float fleck = 0.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 cell = id + vec2(float(x), float(y));
        vec3 r = hash3(mod(cell, 64.0), 61.0);
        if (r.z > 0.3) continue;
        vec2 d = (p - cell - r.xy) * vec2(1.0, 0.55 + r.x);
        fleck = max(fleck, 1.0 - smoothstep(0.03, 0.12, length(d)));
      }
    }

    float threads = fibres(vUv, 9.0, 1.3, 0.024, 71.0);
    gl_FragColor = vec4(formation, fleck, threads, 1.0);
  }
`;

export function bakePaperGrain(renderer: WebGLRenderer, size = 1024): PaperGrain {
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometry = new PlaneGeometry(2, 2);
  const material = new ShaderMaterial({ vertexShader: VERT, blending: NoBlending, depthTest: false, depthWrite: false });
  const quad = new Mesh(geometry, material);
  quad.frustumCulled = false;
  const scene = new Scene();
  scene.add(quad);

  const previousTarget = renderer.getRenderTarget();
  const draw = (target: WebGLRenderTarget, fragmentShader: string, uniforms: ShaderMaterial['uniforms'] = {}) => {
    material.fragmentShader = fragmentShader;
    material.uniforms = uniforms;
    material.needsUpdate = true;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
  };

  const height = new WebGLRenderTarget(size, size, {
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
    depthBuffer: false,
  });
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const final = () =>
    new WebGLRenderTarget(size, size, {
      wrapS: RepeatWrapping,
      wrapT: RepeatWrapping,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
      generateMipmaps: true,
      anisotropy,
      depthBuffer: false,
    });
  const surface = final();
  const mottle = final();

  draw(height, HEIGHT_FRAG);
  draw(surface, SURFACE_FRAG, { uHeight: { value: height.texture }, uTexel: { value: 1 / size } });
  draw(mottle, MOTTLE_FRAG);

  renderer.setRenderTarget(previousTarget);
  height.dispose();
  geometry.dispose();
  material.dispose();

  return { surface: surface.texture, mottle: mottle.texture };
}
