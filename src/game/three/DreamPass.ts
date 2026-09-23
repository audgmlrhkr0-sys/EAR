import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/** Pearl-and-tide palette the image is softly pulled toward. */
const PALETTE = ['#141a3a', '#2c3470', '#3f6fb0', '#6fc3d6', '#a9ecdf', '#b9a6e8', '#f2c6e0', '#fbf1f5'];

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uTime;
uniform float uWave;
uniform float uAberration;
uniform float uPaletteMix;
uniform float uFlash;
uniform vec3 uPal[8];

float bayer8(vec2 p) {
  float x = floor(mod(p.x, 8.0));
  float y = floor(mod(p.y, 8.0));
  float v = 0.0;
  v += mod(x, 2.0) * 32.0 + mod(y, 2.0) * 16.0;
  x = floor(x * 0.5); y = floor(y * 0.5);
  v += mod(x, 2.0) * 8.0 + mod(y, 2.0) * 4.0;
  x = floor(x * 0.5); y = floor(y * 0.5);
  v += mod(x, 2.0) * 2.0 + mod(y, 2.0) * 1.0;
  return v / 64.0;
}

vec3 nearestPal(vec3 c) {
  vec3 best = uPal[0];
  float bd = dot(c - best, c - best);
  for (int i = 1; i < 8; i++) {
    vec3 cand = uPal[i];
    float d = dot(c - cand, c - cand);
    if (d < bd) { bd = d; best = cand; }
  }
  return best;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 uv = vUv;
  // Everything wavers a little, as if seen through moving water.
  uv.x += sin(uv.y * 16.0 + uTime * 1.2) * 0.0016 * uWave;
  uv.y += sin(uv.x * 12.0 - uTime * 0.9) * 0.0013 * uWave;

  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  vec2 off = c * uAberration * (0.4 + r2 * 2.5);
  vec3 col;
  col.r = texture2D(tDiffuse, uv + off).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv - off).b;

  // Milky lift in the shadows — the haze that makes it feel remembered, not seen.
  col = col * vec3(0.94, 0.98, 1.06) + vec3(0.03, 0.035, 0.06);

  float th = bayer8(vUv * uResolution) - 0.5;
  vec3 q = nearestPal(col + th * 0.11);
  col = mix(col, q, uPaletteMix);

  col += (hash(vUv * uResolution + fract(uTime) * 91.0) - 0.5) * 0.035;

  float vig = smoothstep(0.9, 0.22, length(c * vec2(1.05, 1.0)));
  col *= mix(0.5, 1.0, vig);
  col += uFlash * vec3(0.95, 0.93, 1.0) * (1.0 - r2 * 1.5);

  gl_FragColor = vec4(col, 1.0);
}
`;

export class DreamPass extends ShaderPass {
  constructor(width: number, height: number) {
    super({
      uniforms: {
        tDiffuse: { value: null },
        uResolution: { value: new THREE.Vector2(width, height) },
        uTime: { value: 0 },
        uWave: { value: 1 },
        uAberration: { value: 0.006 },
        uPaletteMix: { value: 0.3 },
        uFlash: { value: 0 },
        uPal: {
          value: PALETTE.map((hex) => {
            const n = parseInt(hex.slice(1), 16);
            return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
          }),
        },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
    });
  }

  setResolution(width: number, height: number): void {
    (this.uniforms.uResolution!.value as THREE.Vector2).set(width, height);
  }

  setTime(t: number): void {
    this.uniforms.uTime!.value = t;
  }

  setFlash(v: number): void {
    this.uniforms.uFlash!.value = v;
  }

  setWave(v: number): void {
    this.uniforms.uWave!.value = v;
  }
}
