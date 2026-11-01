import { Color, DoubleSide, MeshStandardMaterial } from 'three';
import type { Texture, WebGLProgramParametersWithUniforms } from 'three';
import type { PaperStock } from './stocks';

/**
 * The one material of the 3D world: a MeshStandardMaterial with procedural
 * grain patched in, so it inherits lights, shadows, fog and skinning.
 *
 * Grain is projected from the rest-pose position, so it needs no UVs and stays
 * glued to the paper while it folds, whether by hinge, skin or morph. Flat
 * facets project along their own plane, so grain never stretches on a slope.
 *
 * Shared by every instance, so these uniforms are swapped by reference.
 */
const grain: { surface: { value: Texture | null }; mottle: { value: Texture | null } } = {
  surface: { value: null },
  mottle: { value: null },
};

export function setPaperGrain(surface: Texture, mottle: Texture): void {
  grain.surface.value = surface;
  grain.mottle.value = mottle;
}

const VERTEX_COMMON = /* glsl */ `
  varying vec3 vPaperPos;
  #ifndef FLAT_SHADED
    varying vec3 vPaperNormal;
  #endif
`;

const VERTEX_BEGIN = /* glsl */ `
  vPaperPos = position;
  #ifndef FLAT_SHADED
    vPaperNormal = normal;
  #endif
`;

const FRAGMENT_COMMON = /* glsl */ `
  uniform sampler2D uPaperSurface;
  uniform sampler2D uPaperMottle;
  uniform float uGrainScale;
  uniform float uGrainStrength;
  uniform float uFormation;
  uniform float uFleck;
  uniform float uThreads;
  uniform float uTranslucency;
  uniform vec3 uFibreColor;
  uniform mat3 normalMatrix;
  varying vec3 vPaperPos;
  #ifndef FLAT_SHADED
    varying vec3 vPaperNormal;
  #endif
`;

// Runs at <color_fragment>. Leaves paperSurface, paperMottle and paperGradient
// in scope for the normal step that follows.
const FRAGMENT_COLOR = /* glsl */ `
  vec3 paperP = vPaperPos / uGrainScale;
  vec4 paperSurface;
  vec4 paperMottle;
  vec3 paperGradient;

  #ifdef FLAT_SHADED
    vec3 paperN = normalize(cross(dFdx(vPaperPos), dFdy(vPaperPos)) + vec3(1e-9));
    vec3 paperUp = abs(paperN.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    vec3 paperT = normalize(cross(paperUp, paperN));
    vec3 paperB = cross(paperN, paperT);
    vec2 paperUv = vec2(dot(paperP, paperT), dot(paperP, paperB));
    paperSurface = texture2D(uPaperSurface, paperUv);
    paperMottle = texture2D(uPaperMottle, paperUv);
    vec2 paperG = paperSurface.xy * 2.0 - 1.0;
    paperGradient = paperT * paperG.x + paperB * paperG.y;
  #else
    vec3 paperW = pow(abs(normalize(vPaperNormal)), vec3(4.0));
    paperW /= paperW.x + paperW.y + paperW.z;
    vec4 sx = texture2D(uPaperSurface, paperP.zy);
    vec4 sy = texture2D(uPaperSurface, paperP.xz);
    vec4 sz = texture2D(uPaperSurface, paperP.xy);
    paperSurface = sx * paperW.x + sy * paperW.y + sz * paperW.z;
    paperMottle = texture2D(uPaperMottle, paperP.zy) * paperW.x
                + texture2D(uPaperMottle, paperP.xz) * paperW.y
                + texture2D(uPaperMottle, paperP.xy) * paperW.z;
    vec2 gx = sx.xy * 2.0 - 1.0, gy = sy.xy * 2.0 - 1.0, gz = sz.xy * 2.0 - 1.0;
    paperGradient = vec3(0.0, gx.y, gx.x) * paperW.x
                  + vec3(gy.x, 0.0, gy.y) * paperW.y
                  + vec3(gz.x, gz.y, 0.0) * paperW.z;
  #endif

  diffuseColor.rgb *= 1.0 + (paperMottle.r - 0.5) * uFormation * 2.0;
  diffuseColor.rgb *= 0.9 + 0.2 * smoothstep(0.2, 0.62, paperSurface.b);
  diffuseColor.rgb = mix(diffuseColor.rgb, uFibreColor, clamp(paperMottle.g * uFleck, 0.0, 1.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, uFibreColor, clamp(paperMottle.b * uThreads, 0.0, 1.0));
`;

const FRAGMENT_ROUGHNESS = /* glsl */ `
  roughnessFactor = clamp(roughnessFactor + (0.5 - paperSurface.b) * 0.16, 0.0, 1.0);
`;

const FRAGMENT_NORMAL = /* glsl */ `
  normal = normalize(normal + (normalMatrix * paperGradient) * uGrainStrength);
`;

// Sun hitting the far side of a sheet glows through it. Deliberately ignores
// shadows: thin paper with a lit back is the cue that sells the material.
const FRAGMENT_TRANSLUCENT = /* glsl */ `
  #if NUM_DIR_LIGHTS > 0
    float paperBack = saturate(dot(-normal, directionalLights[0].direction));
    reflectedLight.directDiffuse += material.diffuseColor * directionalLights[0].color
      * paperBack * uTranslucency * RECIPROCAL_PI;
  #endif
`;

function patch(shader: WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${VERTEX_COMMON}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_BEGIN}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${FRAGMENT_COMMON}`)
    .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_COLOR}`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAGMENT_ROUGHNESS}`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAGMENT_NORMAL}`)
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${FRAGMENT_TRANSLUCENT}`);
}

export class PaperMaterial extends MeshStandardMaterial {
  readonly stockId: string;

  private readonly paperUniforms = {
    uPaperSurface: grain.surface,
    uPaperMottle: grain.mottle,
    uGrainScale: { value: 1 },
    uGrainStrength: { value: 0 },
    uFormation: { value: 0 },
    uFleck: { value: 0 },
    uThreads: { value: 0 },
    uTranslucency: { value: 0 },
    uFibreColor: { value: new Color() },
  };

  constructor(stock: PaperStock, options: { smooth?: boolean } = {}) {
    super({ metalness: 0, flatShading: !options.smooth, side: DoubleSide });
    this.stockId = stock.id;
    // The name doubles as the glTF material convention: see docs/ASSET_PIPELINE.md.
    this.name = `paper:${stock.id}`;
    this.applyStock(stock);
    this.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.paperUniforms);
      patch(shader);
    };
    this.customProgramCacheKey = () => 'kami-paper-1';
  }

  applyStock(stock: PaperStock): void {
    const u = this.paperUniforms;
    this.color.set(stock.color);
    this.roughness = stock.roughness;
    u.uFibreColor.value.set(stock.fibreColor);
    u.uGrainScale.value = stock.grainScale;
    u.uGrainStrength.value = stock.grainStrength;
    u.uFormation.value = stock.formation;
    u.uFleck.value = stock.fleck;
    u.uThreads.value = stock.threads;
    u.uTranslucency.value = stock.translucency;
  }
}
