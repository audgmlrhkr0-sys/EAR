import { BEAT, PHRASES, arpFreqs, chordFreqs, noteFreq, noteMidi, midiFreq, phraseBeats, type Chord } from './song';

type PhraseOpts = {
  melodyGain: number;
  padGain: number;
  bass?: boolean;
  arp?: boolean;
  harmony?: boolean;
};

/**
 * Everything is synthesized: a music-box voice for the melody, a slow pad,
 * a harp arpeggio, and an underwater bed of brown noise + drone. All music
 * runs through a long generated reverb and a soft delay so notes smear into
 * the water instead of ending.
 */
export class SeaAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private ambience!: GainNode;
  private reverbIn!: ConvolverNode;
  private timers: number[] = [];

  get ready(): boolean {
    return this.ctx !== null;
  }

  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    const reverb = ctx.createConvolver();
    reverb.buffer = this.impulse(5, 2.4);
    const wet = ctx.createGain();
    wet.gain.value = 0.6;
    reverb.connect(wet);
    wet.connect(this.master);
    this.reverbIn = reverb;

    const delay = ctx.createDelay(2);
    delay.delayTime.value = BEAT * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.34;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 2000;
    const dOut = ctx.createGain();
    dOut.gain.value = 0.26;
    delay.connect(dlp);
    dlp.connect(fb);
    fb.connect(delay);
    dlp.connect(dOut);
    dOut.connect(this.master);
    dOut.connect(reverb);

    this.music = ctx.createGain();
    this.music.connect(this.master);
    this.music.connect(reverb);
    this.music.connect(delay);

    this.ambience = ctx.createGain();
    this.ambience.gain.value = 0;
    this.ambience.connect(this.master);
    this.ambience.connect(reverb);

    this.startAmbience();
    void ctx.resume();
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  private startAmbience(): void {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 340;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);
    const ng = ctx.createGain();
    ng.gain.value = 0.55;
    noise.connect(lp);
    lp.connect(ng);
    ng.connect(this.ambience);
    noise.start();
    lfo.start();

    const droneLp = ctx.createBiquadFilter();
    droneLp.type = 'lowpass';
    droneLp.frequency.value = 520;
    droneLp.connect(this.ambience);
    const drones: [string, number, number][] = [
      ['D2', 0.05, 0.05],
      ['A2', 0.03, 0.083],
      ['D3', 0.018, 0.031],
    ];
    for (const [name, gain, rate] of drones) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = noteFreq(name);
      const g = ctx.createGain();
      g.gain.value = gain;
      const trem = ctx.createOscillator();
      trem.frequency.value = rate;
      const tg = ctx.createGain();
      tg.gain.value = gain * 0.8;
      trem.connect(tg);
      tg.connect(g.gain);
      o.connect(g);
      g.connect(droneLp);
      o.start();
      trem.start();
    }
  }

  setAmbience(level: number, fade = 3): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.ambience.gain.cancelScheduledValues(now);
    this.ambience.gain.setValueAtTime(this.ambience.gain.value, now);
    this.ambience.gain.linearRampToValueAtTime(level, now + fade);
  }

  private panned(pan: number): AudioNode {
    if (pan === 0) return this.music;
    const p = this.ctx!.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(this.music);
    return p;
  }

  /** Music-box voice: bright attack, bell partials, long watery tail. */
  private chime(freq: number, when: number, dur: number, gain: number, dest: AudioNode): void {
    const ctx = this.ctx!;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(gain, when + 0.008);
    env.gain.exponentialRampToValueAtTime(gain * 0.35, when + 0.25);
    env.gain.exponentialRampToValueAtTime(0.0001, when + dur + 1.4);
    env.connect(dest);
    const partials: [number, number, OscillatorType][] = [
      [1, 1, 'sine'],
      [2, 0.26, 'sine'],
      [3.01, 0.07, 'triangle'],
      [4.18, 0.035, 'sine'],
    ];
    for (const [mul, g, type] of partials) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq * mul;
      o.detune.value = (Math.random() - 0.5) * 6;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og);
      og.connect(env);
      o.start(when);
      o.stop(when + dur + 1.5);
    }
  }

  /** Breathy sine with a slow vibrato — the second voice in the finale. */
  private flute(freq: number, when: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const vib = ctx.createOscillator();
    vib.frequency.value = 4.8;
    const vg = ctx.createGain();
    vg.gain.value = freq * 0.006;
    vib.connect(vg);
    vg.connect(o.frequency);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(gain, when + 0.12);
    env.gain.setValueAtTime(gain, when + Math.max(0.12, dur - 0.1));
    env.gain.linearRampToValueAtTime(0, when + dur + 0.5);
    o.connect(env);
    env.connect(this.music);
    o.start(when);
    vib.start(when);
    o.stop(when + dur + 0.6);
    vib.stop(when + dur + 0.6);
  }

  private pad(freqs: number[], when: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.4;
    lp.frequency.setValueAtTime(450, when);
    lp.frequency.linearRampToValueAtTime(1100, when + dur * 0.5);
    lp.frequency.linearRampToValueAtTime(500, when + dur + 1.6);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(gain, when + 0.9);
    env.gain.setValueAtTime(gain, when + dur);
    env.gain.linearRampToValueAtTime(0, when + dur + 1.6);
    lp.connect(env);
    env.connect(this.music);
    const per = 1 / (freqs.length * 2);
    for (const f of freqs) {
      for (const detune of [-8, 8]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = detune;
        const g = ctx.createGain();
        g.gain.value = per;
        o.connect(g);
        g.connect(lp);
        o.start(when);
        o.stop(when + dur + 1.7);
      }
    }
  }

  private bass(freq: number, when: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(gain, when + 0.15);
    env.gain.exponentialRampToValueAtTime(gain * 0.4, when + dur);
    env.gain.linearRampToValueAtTime(0, when + dur + 0.6);
    o.connect(env);
    env.connect(this.music);
    o.start(when);
    o.stop(when + dur + 0.7);
  }

  private arp(chord: Chord, when: number, gain: number): void {
    const tones = arpFreqs(chord);
    const order = [0, 1, 2, 3, 2, 1];
    const steps = Math.round(chord[2] * 2);
    for (let s = 0; s < steps; s++) {
      this.chime(tones[order[s % order.length]!]!, when + s * BEAT * 0.5, BEAT * 0.4, gain, this.music);
    }
  }

  private phrase(i: number, when: number, opts: PhraseOpts, pan = 0): number {
    const ph = PHRASES[i]!;
    const dest = this.panned(pan);
    let t = when;
    for (const [n, b] of ph.melody) {
      if (n) {
        this.chime(noteFreq(n), t, b * BEAT, opts.melodyGain, dest);
        if (opts.harmony) this.flute(noteFreq(n) / 2, t, b * BEAT, opts.melodyGain * 0.3);
      }
      t += b * BEAT;
    }
    let c = when;
    for (const ch of ph.chords) {
      const dur = ch[2] * BEAT;
      this.pad(chordFreqs(ch), c, dur, opts.padGain);
      if (opts.bass) this.bass(noteFreq(ch[0]), c, dur, 0.11);
      if (opts.arp) this.arp(ch, c, 0.028);
      c += dur;
    }
    return phraseBeats(ph) * BEAT;
  }

  /** Short glitter run when a piece is picked up. */
  private sparkle(when: number, gain = 0.05): void {
    const run = ['D6', 'E6', 'F#6', 'A6', 'B6', 'D7'];
    run.forEach((n, k) => this.chime(noteFreq(n), when + k * 0.06, 0.2, gain * (1 - k * 0.1), this.music));
  }

  /** Pick-up: sparkle, then that piece's phrase with its own chords. Returns seconds. */
  collect(i: number): number {
    if (!this.ctx) return 4;
    const now = this.ctx.currentTime + 0.05;
    this.sparkle(now);
    const dur = this.phrase(i, now + 0.55, { melodyGain: 0.17, padGain: 0.045, arp: true });
    return 0.55 + dur + 0.8;
  }

  replay(i: number): number {
    if (!this.ctx) return 0;
    const now = this.ctx.currentTime + 0.05;
    return this.phrase(i, now, { melodyGain: 0.14, padGain: 0.035 });
  }

  /**
   * An uncollected piece hums the head of its phrase. Volume and stereo pan
   * come from where it is relative to the listener, so you can swim toward it
   * by ear.
   */
  beacon(i: number, vol: number, pan: number): void {
    if (!this.ctx || vol <= 0.002) return;
    const dest = this.panned(pan);
    const now = this.ctx.currentTime + 0.02;
    const head = PHRASES[i]!.melody.filter((n) => n[0]).slice(0, 3);
    head.forEach(([n], k) => this.chime(noteFreq(n!), now + k * BEAT * 0.5, BEAT * 0.4, vol, dest));
  }

  /** The complete song, in order, fully arranged. Returns total seconds. */
  playSong(onPhrase: (i: number) => void): number {
    if (!this.ctx) return 0;
    this.stopTimers();
    const ctx = this.ctx;
    const start = ctx.currentTime + 0.3;
    const intro: Chord = ['D3', 'maj', 4];
    this.pad(chordFreqs(intro), start, intro[2] * BEAT, 0.05);
    this.arp(intro, start, 0.03);
    this.bass(noteFreq('D2'), start, intro[2] * BEAT, 0.08);
    let t = start + intro[2] * BEAT;

    PHRASES.forEach((_, i) => {
      const at = t;
      this.timers.push(window.setTimeout(() => onPhrase(i), (at - ctx.currentTime) * 1000));
      t += this.phrase(i, at, { melodyGain: 0.16, padGain: 0.05, bass: true, arp: true, harmony: i >= 2 });
    });

    const coda: Chord = ['D3', 'maj', 8];
    this.pad(chordFreqs(coda), t, coda[2] * BEAT, 0.06);
    this.bass(noteFreq('D2'), t, coda[2] * BEAT, 0.1);
    this.chime(noteFreq('D6'), t, BEAT * 6, 0.15, this.music);
    this.flute(noteFreq('A4'), t, BEAT * 6, 0.04);
    this.sparkle(t + BEAT * 2, 0.04);
    this.sparkle(t + BEAT * 4, 0.03);
    this.timers.push(window.setTimeout(() => onPhrase(PHRASES.length), (t - ctx.currentTime) * 1000));

    return t + coda[2] * BEAT + 1.5 - ctx.currentTime;
  }

  stopTimers(): void {
    for (const id of this.timers) window.clearTimeout(id);
    this.timers = [];
  }

  bubble(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const count = 1 + Math.floor(Math.random() * 4);
    for (let k = 0; k < count; k++) {
      const when = ctx.currentTime + k * (0.06 + Math.random() * 0.12);
      const o = ctx.createOscillator();
      o.type = 'sine';
      const f0 = 280 + Math.random() * 380;
      o.frequency.setValueAtTime(f0, when);
      o.frequency.exponentialRampToValueAtTime(f0 * 3.2, when + 0.07);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(0.025, when + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.09);
      o.connect(g);
      g.connect(this.ambience);
      o.start(when);
      o.stop(when + 0.12);
    }
  }

  /** A far-off whale — a slow sliding moan, mostly reverb. */
  whale(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const when = ctx.currentTime + 0.05;
    const base = midiFreq(noteMidi('A3') + Math.floor(Math.random() * 3) * 2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.05, when + 1.2);
    g.gain.linearRampToValueAtTime(0.035, when + 3);
    g.gain.linearRampToValueAtTime(0, when + 4.8);
    lp.connect(g);
    g.connect(this.reverbIn);
    g.connect(this.ambience);
    for (const [type, det] of [['sine', 0], ['triangle', 9]] as [OscillatorType, number][]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = det;
      o.frequency.setValueAtTime(base * 0.8, when);
      o.frequency.linearRampToValueAtTime(base * 1.25, when + 1.4);
      o.frequency.linearRampToValueAtTime(base * 0.9, when + 3.2);
      o.frequency.linearRampToValueAtTime(base * 0.6, when + 4.8);
      o.connect(lp);
      o.start(when);
      o.stop(when + 5);
    }
  }
}

export const audio = new SeaAudio();
