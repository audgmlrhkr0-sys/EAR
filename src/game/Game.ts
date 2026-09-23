import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CEILING_Y, Ocean, START_XZ, WORLD_CENTER, WORLD_RADIUS, seabedHeight } from './three/Ocean';
import { PuzzlePieces } from './three/Pieces';
import { SwimRig } from './three/SwimRig';
import { DreamPass } from './three/DreamPass';
import { PIECE_COUNT, createArtwork } from './puzzle';
import { audio } from './audio';
import { GamepadInput } from './GamepadInput';
import { FinaleOverlay, Hud, PickupOverlay, SubtitleOverlay, TitleOverlay } from './ui';

type Scene = 'TITLE' | 'SWIM' | 'FINALE';

/** Internal render height; width follows the window's aspect. Low-res on purpose, like DREAM. */
const RENDER_H = 480;
const PICKUP_RADIUS = 6.5;
const BEACON_RANGE = 170;
const IDLE_RESET_MS = 5 * 60 * 1000;
const LOOK_SENS_PAD = 0.045;
const TURN_SPEED = 1.6;
const FLICKER_MIN = 7000;
const FLICKER_RANGE = 9000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export class Game {
  private renderer!: THREE.WebGLRenderer;
  private composer!: EffectComposer;
  private dream!: DreamPass;
  private ocean!: Ocean;
  private pieces!: PuzzlePieces;
  private rig!: SwimRig;

  private art = createArtwork();
  private title = new TitleOverlay();
  private hud = new Hud(this.art);
  private pickup = new PickupOverlay(this.art);
  private finale = new FinaleOverlay(this.art);
  private subtitle = new SubtitleOverlay();
  private pad = new GamepadInput();

  private scene: Scene = 'TITLE';
  private collected: boolean[] = new Array(PIECE_COUNT).fill(false);
  private nextBeacon: number[] = new Array(PIECE_COUNT).fill(0);
  private keys = new Set<string>();
  private idleSince = Date.now();
  private lastTime = 0;
  private flash = 0;
  private slowUntil = 0;
  private nextBubble = 5;
  private nextWhale = 18;
  private nextFlicker = FLICKER_MIN + Math.random() * FLICKER_RANGE;
  private edgeWarned = false;
  private runId = 0;

  async start(host: HTMLDivElement): Promise<void> {
    host.classList.add('game-host');

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.82;
    const canvas = this.renderer.domElement;
    canvas.classList.add('game-canvas');
    host.appendChild(canvas);

    this.ocean = new Ocean();
    this.pieces = new PuzzlePieces(this.art);
    this.ocean.scene.add(this.pieces.group);
    this.rig = new SwimRig(canvas, window.innerWidth / window.innerHeight);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.ocean.scene, this.rig.camera));
    this.composer.addPass(new OutputPass());
    this.dream = new DreamPass(512, RENDER_H);
    this.composer.addPass(this.dream);

    this.subtitle.mount(host);
    this.hud.mount(host);
    this.pickup.mount(host);
    this.finale.mount(host);
    this.title.mount(host);
    this.hud.update(this.collected);

    this.title.setOnStart(() => this.beginSwim());
    this.finale.setHandlers(
      () => void this.playSong(),
      () => this.softReset(),
    );

    this.placeAtStart();
    this.wireInput();
    window.addEventListener('resize', this.resize);
    this.resize();

    this.lastTime = performance.now();
    requestAnimationFrame(this.loop);
  }

  private resize = (): void => {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const w = Math.round(RENDER_H * aspect);
    this.renderer.setSize(w, RENDER_H, false);
    this.composer.setSize(w, RENDER_H);
    this.dream.setResolution(w, RENDER_H);
    this.rig.setAspect(aspect);
  };

  private loop = (now: number): void => {
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.tick(dt, now / 1000);
    requestAnimationFrame(this.loop);
  };

  private wireInput(): void {
    const touch = (): void => {
      this.idleSince = Date.now();
    };
    window.addEventListener('keydown', (e) => {
      touch();
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (this.scene === 'TITLE' && (e.code === 'Enter' || e.code === 'Space')) {
        this.title.trigger();
        return;
      }
      if (this.scene === 'SWIM' && e.code.startsWith('Digit')) {
        const i = Number(e.code.slice(5)) - 1;
        if (i >= 0 && i < PIECE_COUNT && this.collected[i]) audio.replay(i);
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('pointerdown', () => {
      touch();
      audio.unlock();
    });
    window.addEventListener('mousemove', touch);
    window.addEventListener('gamepadconnected', touch);
  }

  private placeAtStart(): void {
    this.rig.pos.set(START_XZ.x, seabedHeight(START_XZ.x, START_XZ.y) + 7, START_XZ.y);
    this.rig.vel.set(0, 0, 0);
    this.rig.yaw = 0;
    this.rig.pitch = 0.05;
  }

  private beginSwim(): void {
    if (this.scene !== 'TITLE') return;
    audio.unlock();
    audio.setAmbience(1, 4);
    this.scene = 'SWIM';
    this.title.setVisible(false);
    this.hud.setVisible(true);
    this.rig.enabled = true;
    this.rig.requestLock();
    this.rig.yaw = 0;
    this.rig.pitch = 0.05;
    const t = performance.now() / 1000;
    this.nextBeacon = this.nextBeacon.map((_, i) => t + 6 + i * 0.6);
  }

  private readInput(dt: number): { x: number; forward: number; up: number } {
    const k = this.keys;
    const look = this.pad.look();
    if (look.x || look.y) {
      this.rig.lookBy(look.x * LOOK_SENS_PAD, look.y * LOOK_SENS_PAD);
      this.idleSince = Date.now();
    }
    if (k.has('ArrowLeft')) this.rig.lookBy(-TURN_SPEED * dt, 0);
    if (k.has('ArrowRight')) this.rig.lookBy(TURN_SPEED * dt, 0);

    const axis = this.pad.axis();
    let x = axis.x;
    let forward = -axis.y;
    let up = this.pad.vertical();
    if (x || forward || up) this.idleSince = Date.now();
    if (k.has('KeyA')) x -= 1;
    if (k.has('KeyD')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) forward += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) forward -= 1;
    if (k.has('Space') || k.has('KeyE')) up += 1;
    if (k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyQ') || k.has('KeyC')) up -= 1;
    return { x, forward, up };
  }

  private constrain(): void {
    const p = this.rig.pos;
    const v = this.rig.vel;
    const floor = seabedHeight(p.x, p.z) + 2.4;
    if (p.y < floor) {
      p.y = floor;
      if (v.y < 0) v.y *= -0.2;
    }
    if (p.y > CEILING_Y) {
      p.y = CEILING_Y;
      if (v.y > 0) v.y = 0;
      if (!this.edgeWarned) this.subtitle.show('위로는, 아직 아니야.', 2800);
      this.edgeWarned = true;
    }
    const dx = p.x - WORLD_CENTER.x;
    const dz = p.z - WORLD_CENTER.y;
    const d = Math.hypot(dx, dz);
    if (d > WORLD_RADIUS) {
      const k = WORLD_RADIUS / d;
      p.x = WORLD_CENTER.x + dx * k;
      p.z = WORLD_CENTER.y + dz * k;
      v.x *= 0.4;
      v.z *= 0.4;
      if (!this.edgeWarned) this.subtitle.show('더 가면, 돌아오지 못해.', 2800);
      this.edgeWarned = true;
    }
  }

  /** Uncollected pieces call out — louder when near, panned toward where they are. */
  private updateBeacons(t: number): void {
    const cam = this.rig.camera;
    const inv = cam.quaternion.clone().invert();
    for (let i = 0; i < PIECE_COUNT; i++) {
      if (this.collected[i] || t < this.nextBeacon[i]!) continue;
      this.nextBeacon[i] = t + 3.4 + Math.random() * 1.2;
      const to = this.pieces.position(i).clone().sub(cam.position);
      const dist = to.length();
      if (dist > BEACON_RANGE || t < this.slowUntil) continue;
      const local = to.applyQuaternion(inv);
      const pan = THREE.MathUtils.clamp(local.x / (Math.hypot(local.x, local.z) || 1), -1, 1) * 0.85;
      const vol = Math.pow(1 - dist / BEACON_RANGE, 2) * 0.14 + 0.004;
      audio.beacon(i, vol, pan);
    }
  }

  private checkPickups(t: number): void {
    for (let i = 0; i < PIECE_COUNT; i++) {
      if (this.collected[i]) continue;
      if (this.pieces.position(i).distanceTo(this.rig.pos) < PICKUP_RADIUS) {
        this.collect(i, t);
        return;
      }
    }
  }

  private collect(i: number, t: number): void {
    this.collected[i] = true;
    this.pieces.collect(i, t);
    const secs = audio.collect(i);
    this.slowUntil = t + secs;
    this.flash = 0.55;
    this.pickup.show(i, secs * 1000 - 600);
    this.hud.update(this.collected, i);
    if (this.collected.every(Boolean)) {
      const run = this.runId;
      window.setTimeout(() => {
        if (run === this.runId) void this.startFinale();
      }, secs * 1000 + 1400);
    }
  }

  private async startFinale(): Promise<void> {
    const run = this.runId;
    this.scene = 'FINALE';
    this.rig.enabled = false;
    this.rig.releaseLock();
    this.hud.setVisible(false);
    this.subtitle.show('전부 모였다. 이제, 끝까지 들어.', 3600);
    audio.setAmbience(0.45, 5);
    await wait(4600);
    if (run !== this.runId) return;
    this.finale.open();
    await wait(2600);
    if (run !== this.runId) return;
    await this.playSong();
  }

  private songPlaying = false;

  private async playSong(): Promise<void> {
    if (this.songPlaying) return;
    const run = this.runId;
    this.songPlaying = true;
    this.finale.replay();
    const secs = audio.playSong((i) => {
      if (run === this.runId) this.finale.sing(i);
    });
    await wait(secs * 1000);
    this.songPlaying = false;
    if (run !== this.runId) return;
    this.finale.showEnd();
  }

  private tick(dt: number, t: number): void {
    if (this.scene !== 'TITLE' && Date.now() - this.idleSince > IDLE_RESET_MS && !this.songPlaying) {
      this.softReset();
    }

    const edges = this.pad.edges();
    if (this.scene === 'TITLE' && (edges.confirm || edges.start)) this.title.trigger();

    if (this.scene === 'TITLE') {
      this.rig.yaw = Math.sin(t * 0.07) * 0.6;
      this.rig.pitch = 0.32 + Math.sin(t * 0.11) * 0.06;
      this.rig.apply(t);
    } else if (this.scene === 'SWIM') {
      const input = this.readInput(dt);
      if (t < this.slowUntil) {
        input.x *= 0.35;
        input.forward *= 0.35;
        input.up *= 0.35;
      }
      this.rig.update(dt, t, input);
      this.constrain();
      this.rig.apply(t);
      this.checkPickups(t);
      this.updateBeacons(t);
    } else {
      // Rising slowly toward the light while the song plays.
      this.rig.pitch += (0.75 - this.rig.pitch) * Math.min(1, dt * 0.4);
      this.rig.update(dt, t, { x: 0, forward: 0, up: this.rig.pos.y < CEILING_Y - 4 ? 0.12 : 0 });
      this.constrain();
      this.rig.apply(t);
    }

    if (this.scene !== 'TITLE' && audio.ready) {
      if (t > this.nextBubble) {
        this.nextBubble = t + 4 + Math.random() * 7;
        audio.bubble();
      }
      if (t > this.nextWhale) {
        this.nextWhale = t + 35 + Math.random() * 30;
        audio.whale();
      }
      if (t > this.nextFlicker) {
        this.nextFlicker = t + FLICKER_MIN + Math.random() * FLICKER_RANGE;
        this.doFlicker();
      }
    }

    this.ocean.update(t, this.rig.camera);
    this.pieces.update(t, dt, this.rig.camera);

    this.flash = Math.max(0, this.flash - dt * 0.8);
    this.dream.setFlash(this.flash);
    this.dream.setTime(t);
    this.dream.setWave(this.scene === 'FINALE' ? 2.4 : 1);
    this.composer.render(dt);
  }

  /** A brief, unnatural strobe — the light flickering somewhere it shouldn't. */
  private doFlicker(): void {
    const canvas = this.renderer.domElement;
    canvas.classList.add('flicker-burst');
    audio.bubble();
    window.setTimeout(() => canvas.classList.remove('flicker-burst'), 130 + Math.random() * 120);
  }

  softReset(): void {
    this.runId++;
    audio.stopTimers();
    audio.setAmbience(0.35, 2);
    this.songPlaying = false;
    this.collected.fill(false);
    this.pieces.reset();
    this.hud.update(this.collected);
    this.hud.setVisible(false);
    this.pickup.hide();
    this.finale.close();
    this.subtitle.hide();
    this.rig.enabled = false;
    this.rig.releaseLock();
    this.placeAtStart();
    this.edgeWarned = false;
    this.slowUntil = 0;
    this.idleSince = Date.now();
    this.scene = 'TITLE';
    this.title.setVisible(true);
  }
}

export function enableKiosk(host: HTMLElement, game: Game): void {
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('keydown', (e) => {
    if (
      (e.ctrlKey && (e.key === 'r' || e.key === 'R' || e.key === '+' || e.key === '-' || e.key === '0')) ||
      e.key === 'F5'
    ) {
      e.preventDefault();
    }
  });

  const tryFs = (): void => {
    if (!document.fullscreenElement) void host.requestFullscreen?.().catch(() => undefined);
  };
  host.addEventListener('pointerdown', tryFs, { once: true });

  let taps = 0;
  host.addEventListener('pointerdown', (e) => {
    if (e.clientX < 40 && e.clientY < 40) {
      taps++;
      if (taps >= 5) {
        taps = 0;
        game.softReset();
      }
      window.setTimeout(() => {
        taps = 0;
      }, 2000);
    }
  });
}
