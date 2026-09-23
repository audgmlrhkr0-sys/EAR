import * as THREE from 'three';
import { PIECE_COUNT, pieceGeometry } from '../puzzle';
import { PHRASES } from '../song';
import { pieceSpot } from './Ocean';

const PIECE_WIDTH = 7;
const FLY_TIME = 1.3;

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

  constructor(art: HTMLCanvasElement) {
    const tex = new THREE.CanvasTexture(art);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const glow = glowTexture();
    const beamGeo = new THREE.CylinderGeometry(0.9, 2.4, 90, 16, 1, true);
    beamGeo.translate(0, 45, 0);

    for (let i = 0; i < PIECE_COUNT; i++) {
      const color = new THREE.Color(PHRASES[i]!.color);
      const root = new THREE.Group();
      const base = pieceSpot(i);
      root.position.copy(base);

      const mesh = new THREE.Mesh(
        pieceGeometry(i, PIECE_WIDTH),
        new THREE.MeshStandardMaterial({
          map: tex,
          emissive: 0xffffff,
          emissiveMap: tex,
          emissiveIntensity: 0.75,
          roughness: 0.35,
          metalness: 0.05,
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
      halo.scale.setScalar(18);
      root.add(halo);

      const light = new THREE.PointLight(color, 70, 55, 1.5);
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
            gl_FragColor = vec4(uColor * a * 0.28 * uFade, 1.0);
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
        it.haloMat.opacity = 0.55 + pulse * 0.35;
        it.halo.scale.setScalar(16 + pulse * 4);
        it.light.intensity = 55 + pulse * 30;
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
