/**
 * USB gamepad via the Gamepad API, same mapping idea as DREAM:
 * left stick / D-pad swims, right stick looks, A rises, B sinks.
 */
export class GamepadInput {
  private prevConfirm = false;
  private prevStart = false;

  private pads(): Gamepad[] {
    return (navigator.getGamepads?.() ?? []).filter((p): p is Gamepad => !!p);
  }

  /** Movement in [-1,1] */
  axis(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const pad of this.pads()) {
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      if (Math.abs(ax) > Math.abs(x)) x = ax;
      if (Math.abs(ay) > Math.abs(y)) y = ay;
      if (pad.buttons[14]?.pressed) x = -1;
      if (pad.buttons[15]?.pressed) x = 1;
      if (pad.buttons[12]?.pressed) y = -1;
      if (pad.buttons[13]?.pressed) y = 1;
    }
    const dead = 0.25;
    return { x: Math.abs(x) < dead ? 0 : x, y: Math.abs(y) < dead ? 0 : y };
  }

  look(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const pad of this.pads()) {
      const ax = pad.axes[2] ?? 0;
      const ay = pad.axes[3] ?? 0;
      if (Math.abs(ax) > Math.abs(x)) x = ax;
      if (Math.abs(ay) > Math.abs(y)) y = ay;
    }
    const dead = 0.2;
    return { x: Math.abs(x) < dead ? 0 : x, y: Math.abs(y) < dead ? 0 : y };
  }

  /** Held vertical swim: A / RB / RT rise, B / LB / LT sink. */
  vertical(): number {
    let v = 0;
    for (const pad of this.pads()) {
      if (pad.buttons[0]?.pressed || pad.buttons[5]?.pressed || pad.buttons[7]?.pressed) v += 1;
      if (pad.buttons[1]?.pressed || pad.buttons[4]?.pressed || pad.buttons[6]?.pressed) v -= 1;
    }
    return Math.max(-1, Math.min(1, v));
  }

  /** Rising-edge presses this frame. */
  edges(): { confirm: boolean; start: boolean } {
    let confirm = false;
    let start = false;
    for (const pad of this.pads()) {
      if (pad.buttons[0]?.pressed) confirm = true;
      if (pad.buttons[9]?.pressed || pad.buttons[8]?.pressed) start = true;
    }
    const out = { confirm: confirm && !this.prevConfirm, start: start && !this.prevStart };
    this.prevConfirm = confirm;
    this.prevStart = start;
    return out;
  }
}
