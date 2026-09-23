import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const FOG_COLOR = new THREE.Color('#2d5f93');
export const FOG_DENSITY = 0.0095;
export const SURFACE_Y = 66;
export const CEILING_Y = 52;
export const WORLD_CENTER = new THREE.Vector2(0, -100);
export const WORLD_RADIUS = 235;
export const START_XZ = new THREE.Vector2(0, 62);

export function seabedHeight(x: number, z: number): number {
  let h = -18;
  h += Math.sin(x * 0.021) * 4 + Math.cos(z * 0.017) * 4;
  h += Math.sin((x + z) * 0.043) * 1.6 + Math.cos((x - z) * 0.051) * 1.2;
  h += Math.sin(x * 0.11 + z * 0.07) * 0.5;
  // The trench where the whale bones rest.
  const tx = x + 130;
  const tz = z + 200;
  h -= 14 * Math.exp(-(tx * tx + tz * tz) / (2 * 50 * 50));
  // Dunes rise at the edge of the world so it closes softly.
  const r = Math.hypot(x - WORLD_CENTER.x, z - WORLD_CENTER.y);
  h += Math.max(0, r - 215) * 0.35;
  return h;
}

type Spot = { x: number; z: number; lift: number; absY?: number };

/** Where each puzzle piece waits — piece i sits at its phrase's landmark. */
const SPOTS: Spot[] = [
  { x: 0, z: -25, lift: 5 },
  { x: 95, z: -70, lift: 10 },
  { x: -105, z: -40, lift: 6.5 },
  { x: -40, z: -160, lift: 0, absY: 24 },
  { x: 70, z: -195, lift: 8.5 },
  { x: -130, z: -200, lift: 5 },
];

export function pieceSpot(i: number): THREE.Vector3 {
  const s = SPOTS[i]!;
  const y = s.absY ?? seabedHeight(s.x, s.z) + s.lift;
  return new THREE.Vector3(s.x, y, s.z);
}

function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FOG_GLSL = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
vec3 applyFog(vec3 col, float dist) {
  float f = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  return mix(col, uFogColor, clamp(f, 0.0, 1.0));
}
`;

const CAUSTIC_GLSL = /* glsl */ `
float caustic(vec2 xz, float t) {
  vec2 p = mod(xz * 0.045 * 6.28318, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 1.0);
}
`;

const WORLD_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

type Jelly = {
  group: THREE.Group;
  bell: THREE.Mesh;
  tentacles: THREE.Line[];
  base: THREE.Vector3;
  phase: number;
  mats: (THREE.MeshBasicMaterial | THREE.LineBasicMaterial)[];
};

type School = { center: THREE.Vector3; radius: number; speed: number; phase: number; count: number; offset: number };

export class Ocean {
  readonly scene = new THREE.Scene();
  private time = { value: 0 };
  private fogUniforms = {
    uFogColor: { value: FOG_COLOR },
    uFogDensity: { value: FOG_DENSITY },
  };
  private sky!: THREE.Mesh;
  private snow!: THREE.Points;
  private snowCam = { value: new THREE.Vector3() };
  private jellies: Jelly[] = [];
  private fish!: THREE.InstancedMesh;
  private schools: School[] = [];
  private whale!: THREE.Group;
  private whaleTail!: THREE.Group;
  private rays: THREE.Mesh[] = [];
  private dummy = new THREE.Object3D();
  private rnd = mulberry(20260923);

  constructor() {
    this.scene.background = FOG_COLOR.clone();
    this.scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);

    this.scene.add(new THREE.HemisphereLight('#cdeaff', '#2c2350', 1.1));
    const sun = new THREE.DirectionalLight('#eaf6ff', 1.4);
    sun.position.set(30, 100, 20);
    this.scene.add(sun);

    this.buildSky();
    this.buildSurface();
    this.buildSeabed();
    this.buildKelp();
    this.buildRocks();
    this.buildCoral();
    this.buildClam();
    this.buildRuins();
    this.buildBones();
    this.buildJellies();
    this.buildFish();
    this.buildWhale();
    this.buildLanterns();
    this.buildSnow();
    this.buildBubbles();
    this.buildRays();
  }

  private buildSky(): void {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: this.time,
        uTop: { value: new THREE.Color('#b9e3fb') },
        uHorizon: { value: FOG_COLOR },
        uBottom: { value: new THREE.Color('#0b1335') },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uBottom;
        varying vec3 vDir;
        void main() {
          float y = vDir.y;
          vec3 col = y > 0.0 ? mix(uHorizon, uTop, pow(y, 0.7)) : mix(uHorizon, uBottom, pow(-y, 0.55));
          col += vec3(0.9, 0.95, 1.0) * pow(max(0.0, y), 7.0) * 0.8;
          float a = atan(vDir.z, vDir.x);
          float rays = sin(a * 23.0 + uTime * 0.2) * sin(a * 37.0 - uTime * 0.13);
          col += vec3(0.55, 0.8, 1.0) * max(0.0, rays) * pow(max(0.0, y), 2.0) * 0.18;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), mat);
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
  }

  private buildSurface(): void {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
      uniforms: { uTime: this.time },
      vertexShader: WORLD_VERT,
      fragmentShader:
        CAUSTIC_GLSL +
        /* glsl */ `
        uniform float uTime;
        varying vec3 vWorld;
        void main() {
          float c = caustic(vWorld.xz * 0.6, uTime * 0.4);
          float d = distance(cameraPosition.xz, vWorld.xz);
          float fade = exp(-d * 0.006);
          vec3 col = vec3(0.5, 0.78, 1.0) * (0.14 + c * 0.9);
          gl_FragColor = vec4(col * fade, 1.0);
        }`,
    });
    const surface = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400, 1, 1), mat);
    surface.rotation.x = Math.PI / 2;
    surface.position.set(0, SURFACE_Y, -100);
    this.scene.add(surface);
  }

  private buildSeabed(): void {
    const geo = new THREE.PlaneGeometry(760, 760, 220, 220);
    geo.rotateX(-Math.PI / 2);
    geo.translate(WORLD_CENTER.x, 0, WORLD_CENTER.y);
    const pos = geo.attributes.position!;
    for (let k = 0; k < pos.count; k++) {
      pos.setY(k, seabedHeight(pos.getX(k), pos.getZ(k)));
    }
    geo.computeVertexNormals();
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.time, ...this.fogUniforms },
      vertexShader: WORLD_VERT,
      fragmentShader:
        FOG_GLSL +
        CAUSTIC_GLSL +
        /* glsl */ `
        uniform float uTime;
        varying vec3 vWorld;
        varying vec3 vNormal;
        void main() {
          vec3 deep = vec3(0.10, 0.08, 0.26);
          vec3 sand = vec3(0.72, 0.60, 0.68);
          vec3 base = mix(deep, sand, smoothstep(-34.0, -8.0, vWorld.y));
          float rip = sin(vWorld.x * 0.9 + sin(vWorld.z * 0.3) * 2.0) * 0.5 + 0.5;
          base *= 0.9 + rip * 0.1;
          float lambert = clamp(dot(normalize(vNormal), normalize(vec3(0.3, 1.0, 0.2))), 0.0, 1.0);
          vec3 col = base * (0.3 + 0.7 * lambert);
          float c = caustic(vWorld.xz, uTime * 0.5);
          col += vec3(0.7, 0.92, 1.0) * c * 0.6 * smoothstep(-42.0, -6.0, vWorld.y);
          col = applyFog(col, distance(cameraPosition, vWorld));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.scene.add(new THREE.Mesh(geo, mat));
  }

  private buildKelp(): void {
    const blades: THREE.BufferGeometry[] = [];
    const add = (x: number, z: number, height: number): void => {
      const g = new THREE.PlaneGeometry(1.9, height, 1, 16);
      g.translate(0, height / 2, 0);
      const p = g.attributes.position!;
      const t = new Float32Array(p.count);
      const phase = new Float32Array(p.count);
      const ph = x * 0.05 + z * 0.07 + this.rnd() * 6;
      for (let k = 0; k < p.count; k++) {
        const y = p.getY(k);
        const f = Math.max(0, y / height);
        p.setX(k, p.getX(k) * (1 - 0.7 * Math.pow(f, 1.2)) + Math.sin(y * 0.4 + ph) * 0.5);
        t[k] = f;
        phase[k] = ph;
      }
      g.setAttribute('aT', new THREE.BufferAttribute(t, 1));
      g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
      g.rotateY(this.rnd() * Math.PI);
      g.translate(x, seabedHeight(x, z) - 0.6, z);
      blades.push(g);
    };
    for (let k = 0; k < 170; k++) {
      const a = this.rnd() * Math.PI * 2;
      const r = Math.sqrt(this.rnd()) * 42;
      const x = 95 + Math.cos(a) * r;
      const z = -70 + Math.sin(a) * r;
      if (Math.hypot(x - 95, z + 70) < 5) continue;
      add(x, z, 16 + this.rnd() * 22);
    }
    for (let k = 0; k < 110; k++) {
      const x = WORLD_CENTER.x + (this.rnd() - 0.5) * 420;
      const z = WORLD_CENTER.y + (this.rnd() - 0.5) * 420;
      if (Math.hypot(x - START_XZ.x, z - START_XZ.y) < 14) continue;
      add(x, z, 8 + this.rnd() * 16);
    }
    const mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { uTime: this.time, ...this.fogUniforms },
      vertexShader: /* glsl */ `
        attribute float aT;
        attribute float aPhase;
        uniform float uTime;
        varying float vT;
        varying vec3 vWorld;
        void main() {
          vec3 p = position;
          float bend = pow(aT, 1.5);
          p.x += sin(uTime * 0.7 + aPhase + p.y * 0.12) * bend * 3.0;
          p.z += cos(uTime * 0.5 + aPhase * 1.3 + p.y * 0.08) * bend * 1.6;
          vT = aT;
          vec4 w = modelMatrix * vec4(p, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader:
        FOG_GLSL +
        CAUSTIC_GLSL +
        /* glsl */ `
        uniform float uTime;
        varying float vT;
        varying vec3 vWorld;
        void main() {
          vec3 col = mix(vec3(0.02, 0.07, 0.10), vec3(0.22, 0.55, 0.42), vT);
          float glow = smoothstep(0.75, 1.0, vT) * (0.5 + 0.5 * sin(uTime * 1.3 + vWorld.x * 0.2));
          col += vec3(0.4, 0.8, 0.6) * glow * 0.45;
          col += vec3(0.3, 0.5, 0.5) * caustic(vWorld.xz + vWorld.y * 0.3, uTime * 0.5) * 0.25;
          col = applyFog(col, distance(cameraPosition, vWorld));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.scene.add(new THREE.Mesh(mergeGeometries(blades), mat));
  }

  private buildRocks(): void {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const p = geo.attributes.position!;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k);
      const y = p.getY(k);
      const z = p.getZ(k);
      const s = 1 + 0.25 * Math.sin(x * 3.1 + y * 1.7) * Math.cos(z * 2.3 + x);
      p.setXYZ(k, x * s, y * s, z * s);
    }
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: '#7670ad', roughness: 0.95, flatShading: true });
    const count = 70;
    const rocks = new THREE.InstancedMesh(geo, mat, count);
    for (let k = 0; k < count; k++) {
      const x = WORLD_CENTER.x + (this.rnd() - 0.5) * 440;
      const z = WORLD_CENTER.y + (this.rnd() - 0.5) * 440;
      const s = 1.5 + this.rnd() * 6;
      this.dummy.position.set(x, seabedHeight(x, z) + s * 0.1, z);
      this.dummy.rotation.set(this.rnd() * 3, this.rnd() * 3, this.rnd() * 3);
      this.dummy.scale.set(s, s * (0.5 + this.rnd() * 0.6), s * (0.8 + this.rnd() * 0.4));
      this.dummy.updateMatrix();
      rocks.setMatrixAt(k, this.dummy.matrix);
    }
    this.scene.add(rocks);
  }

  private buildCoral(): void {
    const palette = ['#ff9ec8', '#ffc4a8', '#c6a8ff', '#9ee8ff', '#fff0a8'].map((c) => new THREE.Color(c));
    const parts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 42; k++) {
      const cx = WORLD_CENTER.x + (this.rnd() - 0.5) * 400;
      const cz = WORLD_CENTER.y + (this.rnd() - 0.5) * 400;
      const color = palette[Math.floor(this.rnd() * palette.length)]!;
      const n = 5 + Math.floor(this.rnd() * 5);
      for (let j = 0; j < n; j++) {
        const len = 1.4 + this.rnd() * 3.6;
        const g = new THREE.CapsuleGeometry(0.3 + this.rnd() * 0.3, len, 4, 8);
        g.translate(0, len / 2, 0);
        g.rotateZ((this.rnd() - 0.5) * 1.1);
        g.rotateX((this.rnd() - 0.5) * 1.1);
        const x = cx + (this.rnd() - 0.5) * 3;
        const z = cz + (this.rnd() - 0.5) * 3;
        g.translate(x, seabedHeight(x, z) - 0.3, z);
        const colors = new Float32Array(g.attributes.position!.count * 3);
        for (let v = 0; v < colors.length; v += 3) {
          colors[v] = color.r;
          colors[v + 1] = color.g;
          colors[v + 2] = color.b;
        }
        g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        parts.push(g);
      }
    }
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.6,
      emissive: '#3b1d4d',
      emissiveIntensity: 0.6,
    });
    this.scene.add(new THREE.Mesh(mergeGeometries(parts), mat));
  }

  /** Giant clam, lid open, a pearl glowing inside — piece 3 floats over it. */
  private buildClam(): void {
    const at = pieceSpot(2);
    const floor = seabedHeight(at.x, at.z);
    const mat = new THREE.MeshStandardMaterial({
      color: '#e8dcf6',
      roughness: 0.35,
      metalness: 0.1,
      emissive: '#3a2a58',
      emissiveIntensity: 0.5,
      side: THREE.DoubleSide,
    });
    const shellGeo = (): THREE.BufferGeometry => {
      const g = new THREE.SphereGeometry(9, 40, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
      const p = g.attributes.position!;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k);
        const z = p.getZ(k);
        const a = Math.atan2(z, x);
        const s = 1 + 0.06 * Math.abs(Math.sin(a * 9));
        p.setXYZ(k, x * s, p.getY(k), z * s);
      }
      g.scale(1, 0.45, 0.85);
      g.computeVertexNormals();
      return g;
    };
    const clam = new THREE.Group();
    clam.position.set(at.x, floor + 2, at.z);
    clam.rotation.y = 0.6;
    const bottom = new THREE.Mesh(shellGeo(), mat);
    clam.add(bottom);
    const hinge = new THREE.Group();
    hinge.position.set(0, 0, -7.6);
    const lidGeo = shellGeo();
    lidGeo.rotateX(Math.PI);
    lidGeo.translate(0, 0, 7.6);
    const lid = new THREE.Mesh(lidGeo, mat);
    hinge.add(lid);
    hinge.rotation.x = -1.05;
    clam.add(hinge);
    const pearl = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 24, 16),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.0, 2.4) }),
    );
    pearl.position.set(0, 0.6, 1);
    clam.add(pearl);
    this.scene.add(clam);
  }

  /** A ring of sunken, broken pillars around a standing arch. */
  private buildRuins(): void {
    const at = pieceSpot(4);
    const floor = seabedHeight(at.x, at.z);
    const mat = new THREE.MeshStandardMaterial({
      color: '#bab1dc',
      roughness: 0.9,
      flatShading: true,
      emissive: '#1f1838',
      emissiveIntensity: 0.4,
    });
    const group = new THREE.Group();
    group.position.set(at.x, floor, at.z);
    const column = (x: number, z: number, h: number, tilt: number): void => {
      const c = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.7, h, 10), mat);
      shaft.position.y = h / 2;
      c.add(shaft);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.2, 4.2), mat);
      cap.position.y = h + 0.6;
      if (h > 10) c.add(cap);
      c.position.set(x, -1, z);
      c.rotation.set(tilt * 0.6, this.rnd() * 3, tilt);
      group.add(c);
    };
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.3;
      const broken = k % 3 === 1;
      column(Math.cos(a) * 20, Math.sin(a) * 20, broken ? 4 + this.rnd() * 4 : 12 + this.rnd() * 6, (this.rnd() - 0.5) * 0.3);
    }
    column(-7.5, 0, 16, 0);
    column(7.5, 0, 16, 0);
    const arch = new THREE.Mesh(new THREE.TorusGeometry(7.5, 1.3, 8, 24, Math.PI), mat);
    arch.position.y = 16;
    group.add(arch);
    const fallen = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 14, 10), mat);
    fallen.rotation.set(0.1, 0.7, Math.PI / 2);
    fallen.position.set(10, 0.8, 12);
    group.add(fallen);
    this.scene.add(group);
  }

  /** A whale skeleton in the deepest trench — the last phrase lies between its ribs. */
  private buildBones(): void {
    const at = pieceSpot(5);
    const floor = seabedHeight(at.x, at.z);
    const mat = new THREE.MeshStandardMaterial({
      color: '#f1e8df',
      roughness: 0.7,
      emissive: '#40354a',
      emissiveIntensity: 0.5,
    });
    const group = new THREE.Group();
    group.position.set(at.x, floor + 1.2, at.z);
    group.rotation.y = 0.4;
    const count = 11;
    for (let k = 0; k < count; k++) {
      const x = (k - count / 2) * 3.2;
      const size = 7 * Math.sin(((k + 1) / (count + 1)) * Math.PI) + 3;
      const rib = new THREE.Mesh(new THREE.TorusGeometry(size, 0.35, 6, 20, Math.PI), mat);
      rib.position.set(x, -1, 0);
      rib.rotation.y = Math.PI / 2;
      rib.scale.set(1, 1.15, 1);
      group.add(rib);
      const v = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), mat);
      v.scale.set(1.3, 0.8, 0.9);
      v.position.set(x, size * 1.15 - 1, 0);
      group.add(v);
    }
    const skull = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 12), mat);
    skull.scale.set(2.2, 0.8, 1.2);
    skull.position.set(-(count / 2) * 3.2 - 7, 0.8, 0);
    group.add(skull);
    this.scene.add(group);
  }

  private makeJelly(pos: THREE.Vector3, color: THREE.Color, size: number): Jelly {
    const group = new THREE.Group();
    group.position.copy(pos);
    const mats: Jelly['mats'] = [];
    const bellMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    mats.push(bellMat);
    const bell = new THREE.Mesh(new THREE.SphereGeometry(size, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), bellMat);
    group.add(bell);
    const coreMat = new THREE.MeshBasicMaterial({
      color: color.clone().multiplyScalar(1.6),
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    mats.push(coreMat);
    const core = new THREE.Mesh(new THREE.SphereGeometry(size * 0.35, 12, 8), coreMat);
    core.position.y = size * 0.3;
    bell.add(core);
    const lineMat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    mats.push(lineMat);
    const tentacles: THREE.Line[] = [];
    for (let k = 0; k < 7; k++) {
      const pts = new Float32Array(14 * 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      const line = new THREE.Line(g, lineMat);
      line.userData = { a: (k / 7) * Math.PI * 2, len: size * (2.2 + this.rnd() * 2) };
      group.add(line);
      tentacles.push(line);
    }
    this.scene.add(group);
    return { group, bell, tentacles, base: pos.clone(), phase: this.rnd() * 10, mats };
  }

  private buildJellies(): void {
    const colors = ['#ffb8e6', '#c5b5ff', '#a8e6ff', '#ffd9f2'].map((c) => new THREE.Color(c));
    const grove = pieceSpot(3);
    for (let k = 0; k < 16; k++) {
      const a = this.rnd() * Math.PI * 2;
      const r = 7 + this.rnd() * 30;
      const pos = new THREE.Vector3(grove.x + Math.cos(a) * r, 12 + this.rnd() * 30, grove.z + Math.sin(a) * r);
      this.jellies.push(this.makeJelly(pos, colors[k % colors.length]!, 1.2 + this.rnd() * 1.8));
    }
    for (let k = 0; k < 10; k++) {
      const x = WORLD_CENTER.x + (this.rnd() - 0.5) * 380;
      const z = WORLD_CENTER.y + (this.rnd() - 0.5) * 380;
      const pos = new THREE.Vector3(x, seabedHeight(x, z) + 10 + this.rnd() * 25, z);
      this.jellies.push(this.makeJelly(pos, colors[k % colors.length]!, 1 + this.rnd() * 1.4));
    }
  }

  private buildFish(): void {
    const geo = new THREE.ConeGeometry(0.32, 1.4, 5);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: '#ffe7c4', emissive: '#6a4a7a', emissiveIntensity: 0.6, roughness: 0.4 });
    const centers: [number, number, number][] = [
      [20, -40, 6],
      [80, -120, 9],
      [-80, -80, 7],
      [-20, -210, 10],
      [40, 20, 5],
      [-150, -140, 8],
    ];
    let offset = 0;
    for (const [x, z, lift] of centers) {
      const count = 16;
      this.schools.push({
        center: new THREE.Vector3(x, seabedHeight(x, z) + lift, z),
        radius: 10 + this.rnd() * 10,
        speed: 0.12 + this.rnd() * 0.1,
        phase: this.rnd() * 10,
        count,
        offset,
      });
      offset += count;
    }
    this.fish = new THREE.InstancedMesh(geo, mat, offset);
    this.scene.add(this.fish);
  }

  /** Far away and huge, only ever a silhouette in the fog. */
  private buildWhale(): void {
    const mat = new THREE.MeshStandardMaterial({ color: '#233a70', roughness: 0.8 });
    this.whale = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat);
    body.scale.set(6, 5, 24);
    this.whale.add(body);
    for (const side of [1, -1]) {
      const fin = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), mat);
      fin.scale.set(7, 0.5, 2.5);
      fin.position.set(side * 7, -2.5, -6);
      fin.rotation.z = side * -0.4;
      this.whale.add(fin);
    }
    this.whaleTail = new THREE.Group();
    this.whaleTail.position.z = 20;
    const fluke = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), mat);
    fluke.scale.set(10, 0.6, 3.5);
    fluke.position.z = 5;
    this.whaleTail.add(fluke);
    this.whale.add(this.whaleTail);
    this.scene.add(this.whale);
  }

  /** Twinkling glow motes hovering just over the seabed. */
  private buildLanterns(): void {
    const count = 320;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    const size = new Float32Array(count);
    const palette = ['#ffd6ec', '#b6f0e0', '#c9b8ff', '#9fdcff', '#ffe9b0'].map((c) => new THREE.Color(c));
    for (let k = 0; k < count; k++) {
      const x = WORLD_CENTER.x + (this.rnd() - 0.5) * 440;
      const z = WORLD_CENTER.y + (this.rnd() - 0.5) * 440;
      pos[k * 3] = x;
      pos[k * 3 + 1] = seabedHeight(x, z) + 0.6 + this.rnd() * 4;
      pos[k * 3 + 2] = z;
      const c = palette[k % palette.length]!;
      col[k * 3] = c.r;
      col[k * 3 + 1] = c.g;
      col[k * 3 + 2] = c.b;
      phase[k] = this.rnd() * 20;
      size[k] = 0.5 + this.rnd() * 1.1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.time },
      vertexShader: /* glsl */ `
        attribute vec3 color;
        attribute float aPhase;
        attribute float aSize;
        uniform float uTime;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec3 p = position + vec3(0.0, sin(uTime * 0.6 + aPhase) * 0.6, 0.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = aSize * 320.0 / -mv.z;
          vColor = color;
          vAlpha = (0.45 + 0.55 * sin(uTime * 1.7 + aPhase * 3.0)) * exp(-(-mv.z) * 0.012);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vColor * a * a * vAlpha * 1.6, 1.0);
        }`,
    });
    this.scene.add(new THREE.Points(geo, mat));
  }

  /** Marine snow: an endless cube of drifting motes wrapped around the camera. */
  private buildSnow(): void {
    const count = 2200;
    const size = 140;
    const pos = new Float32Array(count * 3);
    for (let k = 0; k < pos.length; k++) pos[k] = (this.rnd() - 0.5) * size;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.time, uCam: this.snowCam, uSize: { value: size } },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uCam;
        uniform float uSize;
        varying float vAlpha;
        void main() {
          vec3 p = position + vec3(sin(uTime * 0.1 + position.y) * 1.5, -uTime * 0.7, cos(uTime * 0.13 + position.x) * 1.5);
          p = mod(p - uCam + uSize * 0.5, uSize) - uSize * 0.5 + uCam;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float dist = -mv.z;
          gl_PointSize = clamp(90.0 / dist, 1.0, 7.0);
          vAlpha = smoothstep(uSize * 0.5, 4.0, dist) * 0.55;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.1, d) * vAlpha;
          gl_FragColor = vec4(vec3(0.85, 0.92, 1.0) * a, 1.0);
        }`,
    });
    this.snow = new THREE.Points(geo, mat);
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);
  }

  private buildBubbles(): void {
    const vents: [number, number][] = [
      [-100, -34],
      [62, -188],
      [-124, -196],
      [18, -38],
      [112, -122],
      [-62, -92],
      [30, 40],
    ];
    const per = 50;
    const count = vents.length * per;
    const vent = new Float32Array(count * 3);
    const seed = new Float32Array(count * 3);
    let k = 0;
    for (const [x, z] of vents) {
      const y = seabedHeight(x, z);
      for (let j = 0; j < per; j++, k++) {
        vent[k * 3] = x + (this.rnd() - 0.5) * 2;
        vent[k * 3 + 1] = y;
        vent[k * 3 + 2] = z + (this.rnd() - 0.5) * 2;
        seed[k * 3] = this.rnd();
        seed[k * 3 + 1] = 2 + this.rnd() * 3;
        seed[k * 3 + 2] = 0.5 + this.rnd();
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(vent, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: this.time, uTop: { value: SURFACE_Y } },
      vertexShader: /* glsl */ `
        attribute vec3 aSeed;
        uniform float uTime;
        uniform float uTop;
        varying float vAlpha;
        void main() {
          float h = uTop - position.y;
          float rise = mod(uTime * aSeed.y + aSeed.x * h, h);
          vec3 p = position + vec3(sin(uTime * 2.0 + aSeed.x * 40.0 + rise * 0.3) * 0.6 * (rise / h + 0.2), rise, cos(uTime * 1.7 + aSeed.x * 30.0) * 0.5 * (rise / h + 0.2));
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = aSeed.z * (1.0 + rise / h) * 260.0 / -mv.z;
          vAlpha = exp(-(-mv.z) * 0.012) * (1.0 - rise / h);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float ring = smoothstep(0.5, 0.4, d) * (0.25 + smoothstep(0.25, 0.45, d));
          vec2 hl = gl_PointCoord - vec2(0.35, 0.3);
          ring += smoothstep(0.12, 0.0, length(hl)) * 0.8;
          gl_FragColor = vec4(vec3(0.85, 0.95, 1.0) * ring * vAlpha, 1.0);
        }`,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.scene.add(pts);
  }

  private buildRays(): void {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0);
    for (let k = 0; k < 26; k++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uTime: this.time, uSeed: { value: this.rnd() * 10 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying float vDist;
          void main() {
            vUv = uv;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vDist = -mv.z;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform float uSeed;
          varying vec2 vUv;
          varying float vDist;
          void main() {
            float edge = smoothstep(0.0, 0.5, vUv.x) * smoothstep(1.0, 0.5, vUv.x);
            float vert = smoothstep(0.0, 0.4, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
            float flick = 0.55 + 0.45 * sin(uTime * 0.45 + uSeed * 6.0);
            float near = smoothstep(4.0, 30.0, vDist) * exp(-vDist * 0.006);
            float a = edge * edge * vert * flick * near * 0.13;
            gl_FragColor = vec4(vec3(0.72, 0.9, 1.0) * a, 1.0);
          }`,
      });
      const ray = new THREE.Mesh(geo, mat);
      const x = WORLD_CENTER.x + (this.rnd() - 0.5) * 400;
      const z = WORLD_CENTER.y + (this.rnd() - 0.5) * 400;
      ray.position.set(x, seabedHeight(x, z) - 2, z);
      ray.scale.set(10 + this.rnd() * 18, SURFACE_Y + 30, 1);
      this.rays.push(ray);
      this.scene.add(ray);
    }
  }

  update(t: number, camera: THREE.Camera): void {
    this.time.value = t;
    this.sky.position.copy(camera.position);
    this.snowCam.value.copy(camera.position);

    for (const ray of this.rays) {
      ray.rotation.y = Math.atan2(camera.position.x - ray.position.x, camera.position.z - ray.position.z);
    }

    for (const j of this.jellies) {
      const pulse = Math.sin(t * 1.6 + j.phase);
      j.bell.scale.set(1 + 0.12 * pulse, 1 - 0.14 * pulse, 1 + 0.12 * pulse);
      j.group.position.set(
        j.base.x + Math.sin(t * 0.13 + j.phase) * 3,
        j.base.y + Math.sin(t * 0.35 + j.phase) * 3 + pulse * 0.3,
        j.base.z + Math.cos(t * 0.11 + j.phase) * 3,
      );
      const size = (j.bell.geometry as THREE.SphereGeometry).parameters.radius;
      for (const line of j.tentacles) {
        const { a, len } = line.userData as { a: number; len: number };
        const attr = line.geometry.attributes.position as THREE.BufferAttribute;
        for (let k = 0; k < attr.count; k++) {
          const f = k / (attr.count - 1);
          const r = size * 0.6 * (1 - f * 0.4);
          attr.setXYZ(
            k,
            Math.cos(a) * r + Math.sin(t * 1.3 + f * 4 + j.phase + a) * f * 0.8,
            -f * len,
            Math.sin(a) * r + Math.cos(t * 1.1 + f * 3 + j.phase) * f * 0.8,
          );
        }
        attr.needsUpdate = true;
      }
      const fade = THREE.MathUtils.clamp(1.2 - j.group.position.distanceTo(camera.position) / 180, 0, 1);
      j.mats[0]!.opacity = 0.5 * fade;
      j.mats[1]!.opacity = 0.6 * fade;
      j.mats[2]!.opacity = 0.45 * fade;
    }

    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    for (const s of this.schools) {
      for (let k = 0; k < s.count; k++) {
        const at = (tt: number, out: THREE.Vector3): THREE.Vector3 => {
          const a = tt * s.speed + s.phase + k * 0.04;
          return out.set(
            s.center.x + Math.cos(a) * s.radius + Math.sin(k * 1.7 + tt * 0.8) * 2.5,
            s.center.y + Math.sin(tt * 0.3 + s.phase) * 2 + Math.cos(k * 2.3 + tt * 0.6) * 1.2,
            s.center.z + Math.sin(a) * s.radius + Math.cos(k * 1.1 + tt * 0.7) * 2.5,
          );
        };
        at(t, p);
        at(t + 0.1, q);
        this.dummy.position.copy(p);
        this.dummy.scale.setScalar(1);
        this.dummy.lookAt(q);
        this.dummy.updateMatrix();
        this.fish.setMatrixAt(s.offset + k, this.dummy.matrix);
      }
    }
    this.fish.instanceMatrix.needsUpdate = true;

    const wa = t * 0.035;
    const wr = 200;
    this.whale.position.set(WORLD_CENTER.x + Math.cos(wa) * wr, 30 + Math.sin(t * 0.05) * 6, WORLD_CENTER.y + Math.sin(wa) * wr);
    this.whale.rotation.y = -wa + Math.PI;
    this.whaleTail.rotation.x = Math.sin(t * 0.6) * 0.25;
  }
}
