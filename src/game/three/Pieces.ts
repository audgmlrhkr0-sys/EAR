import * as THREE from 'three';
import { PIECE_COUNT } from '../puzzle';
import { PHRASES } from '../song';
import { pieceSpot } from './Ocean';

const PIECE_WIDTH = 7;
const FLY_TIME = 1.3;

/** A small seeded PRNG so each lump is asymmetric but stable across sessions. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An unidentified mass — a noise-displaced, slightly flattened lump. Nothing about it should read as "puzzle piece". */
function lumpGeometry(seed: number, radius: number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(radius, 3);
  const pos = geo.attributes['position']!;
  const rnd = mulberry(seed);
  const f1 = 1.6 + rnd() * 1.6;
  const f2 = 2.4 + rnd() * 2.2;
  const f3 = 1.9 + rnd() * 1.7;
  const p1 = rnd() * 20;
  const p2 = rnd() * 20;
  const p3 = rnd() * 20;
  const squash = 0.72 + rnd() * 0.18;
  for (let k = 0; k < pos.count; k++) {
    const x = pos.getX(k);
    const y = pos.getY(k);
    const z = pos.getZ(k);
    const len = Math.hypot(x, y, z) || 1;
    const nx = x / len;
    const ny = y / len;
    const nz = z / len;
    const n =
      Math.sin(nx * f1 + p1) * Math.cos(ny * f2 + p2) * 0.6 +
      Math.sin(nz * f3 + p3) * Math.cos(nx * f2 - p1) * 0.4;
    const s = 1 + n * 0.4;
    pos.setXYZ(k, x * s, y * s * squash, z * s);
  }
  geo.computeVertexNormals();
  return geo;
}

type Item = {
  root: THREE.Group;
  mesh: THREE.Mesh;
  halo: THREE.Sprite;
  haloMat: THREE.SpriteMaterial;
  beamMat: THREE.ShaderMaterial;
  light: THREE.PointLight;
  base: THREE.Vector3;
  phase: number;
  collected: boolean;
  flyStart: number;
  flyFrom: THREE.Vector3;
};

function glowTexture(): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function easeInOut(k: number): number {
  return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
}

/** The six glowing pieces, each with a light pillar so they can be found from far off. */
export class PuzzlePieces {
  readonly group = new THREE.Group();
  private items: Item[] = [];

  constructor() {
    const glow = glowTexture();
    const beamGeo = new THREE.CylinderGeometry(0.9, 2.4, 90, 16, 1, true);
    beamGeo.translate(0, 45, 0);

    for (let i = 0; i < PIECE_COUNT; i++) {
      const color = new THREE.Color(PHRASES[i]!.color);
      const root = new THREE.Group();
      const base = pieceSpot(i);
      root.position.copy(base);

      const mesh = new THREE.Mesh(
        lumpGeometry(i * 977 + 13, PIECE_WIDTH * 0.6),
        new THREE.MeshStandardMaterial({
          color: color.clone().multiplyScalar(0.3),
          emissive: color,
          emissiveIntensity: 0.2,
          roughness: 0.6,
          metalness: 0.1,
        }),
      );
      root.add(mesh);

      const haloMat = new THREE.SpriteMaterial({
        map: glow,
        color,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      });
      const halo = new THREE.Sprite(haloMat);
      halo.scale.setScalar(22);
      root.add(halo);

      const light = new THREE.PointLight(color, 110, 68, 1.4);
      root.add(light);

      const beamMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
        uniforms: { uColor: { value: color }, uTime: { value: 0 }, uFade: { value: 1 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uTime;
          uniform float uFade;
          varying vec2 vUv;
          void main() {
            float a = pow(1.0 - vUv.y, 1.6) * (0.75 + 0.25 * sin(uTime * 2.0 + vUv.y * 12.0));
            gl_FragColor = vec4(uColor * a * 0.4 * uFade, 1.0);
          }`,
      });
      const beam = new THREE.Mesh(beamGeo, beamMat);
      root.add(beam);

      this.group.add(root);
      this.items.push({
        root,
        mesh,
        halo,
        haloMat,
        beamMat,
        light,
        base,
        phase: i * 1.37,
        collected: false,
        flyStart: -1,
        flyFrom: new THREE.Vector3(),
      });
    }
  }

  /** Where an uncollected piece currently floats. */
  position(i: number): THREE.Vector3 {
    return this.items[i]!.root.position;
  }

  isCollected(i: number): boolean {
    return this.items[i]!.collected;
  }

  collect(i: number, t: number): void {
    const it = this.items[i]!;
    it.collected = true;
    it.flyStart = t;
    it.flyFrom.copy(it.root.position);
  }

  reset(): void {
    for (const it of this.items) {
      it.collected = false;
      it.flyStart = -1;
      it.root.visible = true;
      it.root.scale.setScalar(1);
      it.root.position.copy(it.base);
      it.beamMat.uniforms.uFade!.value = 1;
    }
  }

  update(t: number, dt: number, camera: THREE.Camera): void {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const down = new THREE.Vector3(0, -1, 0).applyQuaternion(camera.quaternion);
    for (const it of this.items) {
      it.beamMat.uniforms.uTime!.value = t;
      if (!it.collected) {
        it.mesh.rotation.y = t * 0.6 + it.phase;
        it.mesh.rotation.x = Math.sin(t * 0.7 + it.phase) * 0.25;
        it.root.position.y = it.base.y + Math.sin(t * 1.1 + it.phase) * 0.6;
        const pulse = 0.5 + 0.5 * Math.sin(t * 2.2 + it.phase);
        it.haloMat.opacity = 0.6 + pulse * 0.35;
        it.halo.scale.setScalar(19 + pulse * 5);
        it.light.intensity = 85 + pulse * 45;
        it.mesh.scale.setScalar(1 + pulse * 0.07);
        continue;
      }
      if (it.flyStart < 0) continue;
      const k = Math.min(1, (t - it.flyStart) / FLY_TIME);
      const e = easeInOut(k);
      const target = camera.position.clone().addScaledVector(forward, 4).addScaledVector(down, 1.2);
      it.root.position.lerpVectors(it.flyFrom, target, e);
      it.root.scale.setScalar(Math.max(0.001, 1 - e * 0.92));
      it.mesh.rotation.y += dt * (4 + e * 14);
      it.beamMat.uniforms.uFade!.value = 1 - e;
      it.haloMat.opacity = 0.9 * (1 - e * 0.6);
      it.light.intensity = 120 * (1 - e);
      if (k >= 1) {
        it.root.visible = false;
        it.flyStart = -1;
      }
    }
  }
}
