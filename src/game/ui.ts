import { PAD, PIECE_COUNT, cellOf, drawBoard, renderPiece } from './puzzle';
import { PHRASES } from './song';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

function bubbleField(count: number): HTMLDivElement {
  const field = el('div', 'bubble-field');
  for (let k = 0; k < count; k++) {
    const b = el('span', 'bubble');
    b.style.setProperty('--x', `${Math.random() * 100}%`);
    b.style.setProperty('--s', `${4 + Math.random() * 16}px`);
    b.style.setProperty('--d', `${9 + Math.random() * 14}s`);
    b.style.setProperty('--delay', `${-Math.random() * 20}s`);
    b.style.setProperty('--sway', `${(Math.random() - 0.5) * 60}px`);
    field.appendChild(b);
  }
  return field;
}

export class TitleOverlay {
  readonly root = el('div', 'title-overlay');
  private onStart: (() => void) | null = null;

  constructor() {
    this.root.appendChild(bubbleField(18));
    const inner = el('div', 'title-inner');
    inner.appendChild(el('h1', 'title-main', 'EAR'));
    inner.appendChild(el('div', 'title-sub', '바다가 잃어버린 노래'));
    const btn = el('button', 'title-start', '귀 기울이기');
    btn.addEventListener('click', () => this.onStart?.());
    inner.appendChild(btn);
    inner.appendChild(el('div', 'title-keys', 'WASD · MOUSE · SPACE / SHIFT'));
    this.root.appendChild(inner);
  }

  mount(host: HTMLElement): void {
    host.appendChild(this.root);
  }

  setOnStart(cb: () => void): void {
    this.onStart = cb;
  }

  trigger(): void {
    this.onStart?.();
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('gone', !v);
  }
}

export class Hud {
  readonly root = el('div', 'hud gone');
  private board = el('canvas', 'hud-board');
  private count = el('div', 'hud-count');
  private replay = el('div', 'hud-replay', '1–6');
  private art: HTMLCanvasElement;

  constructor(art: HTMLCanvasElement) {
    this.art = art;
    const panel = el('div', 'hud-panel');
    panel.appendChild(this.board);
    panel.appendChild(this.count);
    panel.appendChild(this.replay);
    this.root.appendChild(panel);
    this.root.appendChild(el('div', 'hud-reticle'));
  }

  mount(host: HTMLElement): void {
    host.appendChild(this.root);
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('gone', !v);
  }

  update(collected: boolean[], fresh = -1): void {
    drawBoard(this.board, this.art, collected, fresh);
    const n = collected.filter(Boolean).length;
    this.count.textContent = `${n} / ${PIECE_COUNT}`;
    this.replay.classList.toggle('gone', n === 0);
    if (fresh >= 0) {
      this.board.classList.remove('pulse');
      void this.board.offsetWidth;
      this.board.classList.add('pulse');
    }
  }
}

export class SubtitleOverlay {
  readonly root = el('div', 'subtitle');
  private timer = 0;

  mount(host: HTMLElement): void {
    host.appendChild(this.root);
  }

  show(text: string, ms = 4000): void {
    window.clearTimeout(this.timer);
    this.root.textContent = text;
    this.root.classList.remove('show');
    void this.root.offsetWidth;
    this.root.classList.add('show');
    this.timer = window.setTimeout(() => this.root.classList.remove('show'), ms);
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.root.classList.remove('show');
  }
}

/** The moment a piece is caught: it rises before you while its phrase plays, then drifts into the board. */
export class PickupOverlay {
  readonly root = el('div', 'pickup gone');
  private card = el('div', 'pickup-card');
  private title = el('div', 'pickup-title');
  private line = el('div', 'pickup-line');
  private art: HTMLCanvasElement;
  private timer = 0;

  constructor(art: HTMLCanvasElement) {
    this.art = art;
    this.root.appendChild(this.card);
    this.root.appendChild(this.title);
    this.root.appendChild(this.line);
    this.root.appendChild(el('div', 'pickup-notes'));
  }

  mount(host: HTMLElement): void {
    host.appendChild(this.root);
  }

  show(i: number, ms: number): void {
    window.clearTimeout(this.timer);
    this.card.replaceChildren(renderPiece(this.art, i, 320));
    this.card.style.setProperty('--glow', PHRASES[i]!.color);
    this.title.textContent = PHRASES[i]!.title;
    this.line.textContent = PHRASES[i]!.line;
    this.root.classList.remove('gone', 'leave');
    void this.root.offsetWidth;
    this.root.classList.add('enter');
    this.timer = window.setTimeout(() => {
      this.root.classList.remove('enter');
      this.root.classList.add('leave');
      this.timer = window.setTimeout(() => this.root.classList.add('gone'), 1200);
    }, ms);
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.root.classList.remove('enter', 'leave');
    this.root.classList.add('gone');
  }
}

/** All six pieces drift together into the picture while the whole song plays through once. */
export class FinaleOverlay {
  readonly root = el('div', 'finale gone');
  private board = el('div', 'finale-board');
  private full = el('img', 'finale-full');
  private line = el('div', 'finale-line');
  private end = el('div', 'finale-end gone');
  private pieces: HTMLCanvasElement[] = [];
  private onReplay: (() => void) | null = null;
  private onRestart: (() => void) | null = null;

  constructor(art: HTMLCanvasElement) {
    this.root.appendChild(bubbleField(14));
    this.full.src = art.toDataURL();
    this.full.alt = '';
    for (let i = 0; i < PIECE_COUNT; i++) {
      const cv = renderPiece(art, i, 360);
      cv.className = 'finale-piece';
      const { c, r } = cellOf(i);
      const span = 1 + PAD * 2;
      cv.style.left = `${((c - PAD) / 3) * 100}%`;
      cv.style.top = `${((r - PAD) / 2) * 100}%`;
      cv.style.width = `${(span / 3) * 100}%`;
      cv.style.height = `${(span / 2) * 100}%`;
      cv.style.setProperty('--glow', PHRASES[i]!.color);
      this.pieces.push(cv);
      this.board.appendChild(cv);
    }
    this.board.appendChild(this.full);
    this.root.appendChild(this.board);
    this.root.appendChild(this.line);

    this.end.appendChild(el('div', 'finale-title', '노래가, 돌아왔다.'));
    const buttons = el('div', 'finale-buttons');
    const again = el('button', '', '다시 듣기');
    again.addEventListener('click', () => this.onReplay?.());
    const home = el('button', '', '처음으로');
    home.addEventListener('click', () => this.onRestart?.());
    buttons.append(again, home);
    this.end.appendChild(buttons);
    this.root.appendChild(this.end);
  }

  mount(host: HTMLElement): void {
    host.appendChild(this.root);
  }

  setHandlers(onReplay: () => void, onRestart: () => void): void {
    this.onReplay = onReplay;
    this.onRestart = onRestart;
  }

  open(): void {
    this.root.classList.remove('gone', 'assembled', 'complete');
    this.end.classList.add('gone');
    this.line.textContent = '';
    this.pieces.forEach((p) => {
      p.classList.remove('singing', 'sung');
      p.style.setProperty('--dx', `${(Math.random() - 0.5) * 140}vw`);
      p.style.setProperty('--dy', `${(Math.random() - 0.5) * 90}vh`);
      p.style.setProperty('--rot', `${(Math.random() - 0.5) * 120}deg`);
    });
    void this.root.offsetWidth;
    this.root.classList.add('visible');
    window.setTimeout(() => this.root.classList.add('assembled'), 200);
  }

  /** Called as phrase `i` begins; PIECE_COUNT means the coda. */
  sing(i: number): void {
    this.pieces.forEach((p, k) => {
      p.classList.toggle('singing', k === i);
      if (k < i) p.classList.add('sung');
    });
    if (i < PIECE_COUNT) {
      this.setLine(PHRASES[i]!.line);
    } else {
      this.pieces.forEach((p) => p.classList.add('sung'));
      this.root.classList.add('complete');
      this.setLine('');
    }
  }

  private setLine(text: string): void {
    this.line.classList.remove('show');
    window.setTimeout(() => {
      this.line.textContent = text;
      if (text) this.line.classList.add('show');
    }, 500);
  }

  replay(): void {
    this.end.classList.add('gone');
    this.root.classList.remove('complete');
    this.pieces.forEach((p) => p.classList.remove('singing', 'sung'));
  }

  showEnd(): void {
    this.end.classList.remove('gone');
  }

  close(): void {
    this.root.classList.remove('visible', 'assembled', 'complete');
    this.root.classList.add('gone');
  }
}
