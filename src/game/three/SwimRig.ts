import * as THREE from 'three';

const ACCEL = 30;
const DRAG = 1.55;
const PITCH_LIMIT = 1.25;

export type SwimInput = { x: number; forward: number; up: number };

/**
 * First-person swimming: pointer-lock mouse look like DREAM's rig, but
 * movement follows where you look (including up/down) and carries momentum,
 * so every stroke glides on a little after you let go.
 */
export class SwimRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  enabled = false;
  private roll = 0;
  private locked = false;
  private sensitivity = 0.0021;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement, aspect: number) {
    this.canvas = canvas;
    this.camera = new THREE.PerspectiveCamera(66, aspect, 0.3, 1600);
    this.camera.rotation.order = 'YXZ';

    canvas.addEventListener('click', () => {
      if (this.enabled) this.requestLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      this.lookBy(e.movementX * this.sensitivity, e.movementY * this.sensitivity);
    });
  }

  requestLock(): void {
    if (document.pointerLockElement !== this.canvas) {
      const req = this.canvas.requestPointerLock?.() as Promise<void> | undefined;
      void req?.catch?.(() => undefined);
    }
  }

  releaseLock(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  lookBy(dx: number, dy: number): void {
    this.yaw -= dx;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy, -PITCH_LIMIT, PITCH_LIMIT);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, t: number, input: SwimInput): void {
    const cp = Math.cos(this.pitch);
    const fwd = new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const acc = new THREE.Vector3()
      .addScaledVector(fwd, input.forward)
      .addScaledVector(right, input.x)
      .add(new THREE.Vector3(0, input.up, 0));
    if (acc.lengthSq() > 1) acc.normalize();
    this.vel.addScaledVector(acc, ACCEL * dt);
    this.vel.multiplyScalar(Math.exp(-DRAG * dt));
    this.pos.addScaledVector(this.vel, dt);

    const lean = -input.x * 0.07 + Math.sin(t * 0.6) * 0.018;
    this.roll += (lean - this.roll) * Math.min(1, dt * 2.5);
    this.apply(t);
  }

  /** Camera pose only — for scenes where the rig drifts without input. */
  apply(t: number): void {
    this.camera.position.set(this.pos.x, this.pos.y + Math.sin(t * 1.1) * 0.25, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
  }
}
