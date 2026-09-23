import * as THREE from 'three';

export const COLS = 3;
export const ROWS = 2;
export const PIECE_COUNT = COLS * ROWS;
/** One cell of the artwork, in art pixels. */
export const CELL = 200;
export const ART_W = COLS * CELL;
export const ART_H = ROWS * CELL;
/** Room around a cell for tabs that stick out past its square. */
export const PAD = 0.3;
const TAB = 0.24;

type Pen = {
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
  bezierCurveTo(ax: number, ay: number, bx: number, by: number, x: number, y: number): unknown;
};

/** +1: the upper piece pokes down into the lower one. Indexed by column. */
const H_EDGES = [1, -1, 1];
/** +1: the left piece pokes right. Indexed [row][left column]. */
const V_EDGES = [
  [-1, 1],
  [1, -1],
];

export function cellOf(i: number): { c: number; r: number } {
  return { c: i % COLS, r: Math.floor(i / COLS) };
}

function edgesOf(i: number): { top: number; right: number; bottom: number; left: number } {
  const { c, r } = cellOf(i);
  return {
    top: r === 0 ? 0 : -H_EDGES[c]!,
    bottom: r === ROWS - 1 ? 0 : H_EDGES[c]!,
    left: c === 0 ? 0 : -V_EDGES[r]![c - 1]!,
    right: c === COLS - 1 ? 0 : V_EDGES[r]![c]!,
  };
}

function edge(pen: Pen, ax: number, ay: number, bx: number, by: number, nx: number, ny: number, s: number): void {
  if (s === 0) {
    pen.lineTo(bx, by);
    return;
  }
  const dx = bx - ax;
  const dy = by - ay;
  const k = s * CELL;
  const P = (u: number, v: number): [number, number] => [ax + dx * u + nx * v * k, ay + dy * u + ny * v * k];
  const L = (u: number, v: number): void => {
    const [x, y] = P(u, v);
    pen.lineTo(x, y);
  };
  const B = (u1: number, v1: number, u2: number, v2: number, u3: number, v3: number): void => {
    const a = P(u1, v1);
    const b = P(u2, v2);
    const c = P(u3, v3);
    pen.bezierCurveTo(a[0], a[1], b[0], b[1], c[0], c[1]);
  };
  L(0.36, 0);
  B(0.42, 0.03, 0.26, TAB, 0.5, TAB);
  B(0.74, TAB, 0.58, 0.03, 0.64, 0);
  L(1, 0);
}

/** Traces piece `i` in art-pixel coordinates (y down), clockwise. */
export function tracePiece(pen: Pen, i: number): void {
  const { c, r } = cellOf(i);
  const e = edgesOf(i);
  const x0 = c * CELL;
  const y0 = r * CELL;
  const x1 = x0 + CELL;
  const y1 = y0 + CELL;
  pen.moveTo(x0, y0);
  edge(pen, x0, y0, x1, y0, 0, -1, e.top);
  edge(pen, x1, y0, x1, y1, 1, 0, e.right);
  edge(pen, x1, y1, x0, y1, 0, 1, e.bottom);
  edge(pen, x0, y1, x0, y0, -1, 0, e.left);
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

/** The picture the six pieces make: a whale drifting under moonlight, with the song's staff running through the water. */
export function createArtwork(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = ART_W;
  cv.height = ART_H;
  const g = cv.getContext('2d')!;
  const rnd = mulberry(7);

  const bg = g.createLinearGradient(0, 0, 0, ART_H);
  bg.addColorStop(0, '#fde6f2');
  bg.addColorStop(0.25, '#cfd8f7');
  bg.addColorStop(0.6, '#7391d2');
  bg.addColorStop(1, '#212a66');
  g.fillStyle = bg;
  g.fillRect(0, 0, ART_W, ART_H);

  const moon = g.createRadialGradient(ART_W * 0.5, 40, 4, ART_W * 0.5, 40, 240);
  moon.addColorStop(0, 'rgba(255,252,240,1)');
  moon.addColorStop(0.18, 'rgba(255,240,248,0.75)');
  moon.addColorStop(1, 'rgba(255,240,248,0)');
  g.fillStyle = moon;
  g.fillRect(0, 0, ART_W, ART_H);

  g.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 9; k++) {
    const x = ART_W * 0.5 + (k - 4) * 34 + (rnd() - 0.5) * 20;
    const spread = 40 + rnd() * 70;
    const grad = g.createLinearGradient(0, 0, 0, ART_H);
    grad.addColorStop(0, 'rgba(255,245,255,0.12)');
    grad.addColorStop(1, 'rgba(255,245,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x - 6, 0);
    g.lineTo(x + 6, 0);
    g.lineTo(x + (k - 4) * 40 + spread, ART_H);
    g.lineTo(x + (k - 4) * 40 - spread, ART_H);
    g.closePath();
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';

  // The song itself: a five-line staff drifting through the water like a current.
  const staffY = (x: number, k: number): number => 128 + k * 8 + Math.sin(x * 0.011) * 34 + Math.sin(x * 0.029 + 1) * 7;
  g.strokeStyle = 'rgba(255,238,200,0.55)';
  g.lineWidth = 1.3;
  for (let k = 0; k < 5; k++) {
    g.beginPath();
    for (let x = -10; x <= ART_W + 10; x += 6) {
      const y = staffY(x, k);
      if (x === -10) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  g.fillStyle = 'rgba(255,244,214,0.9)';
  g.strokeStyle = 'rgba(255,244,214,0.9)';
  const noteSteps = [2, 3, 4.5, 4, 3.5, 3, 2, 2.5, 3.5, 4, 3.5, 3, 4.5, 3, 2.5, 3.5, 4, 3];
  noteSteps.forEach((step, k) => {
    const x = 26 + k * 32.5;
    const y = staffY(x, 0) + (5 - step) * 8;
    g.save();
    g.translate(x, y);
    g.rotate(-0.35);
    g.beginPath();
    g.ellipse(0, 0, 5.2, 3.6, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(x + 4.6, y - 1);
    g.lineTo(x + 4.6, y - 24);
    g.stroke();
  });

  // Whale.
  g.save();
  g.translate(0, 18);
  const body = g.createLinearGradient(0, 170, 0, 280);
  body.addColorStop(0, '#34457f');
  body.addColorStop(1, '#1c2458');
  g.fillStyle = body;
  g.beginPath();
  g.moveTo(130, 238);
  g.bezierCurveTo(140, 186, 262, 162, 362, 194);
  g.bezierCurveTo(404, 206, 434, 206, 462, 192);
  g.bezierCurveTo(474, 172, 494, 152, 522, 140);
  g.bezierCurveTo(512, 166, 510, 186, 528, 214);
  g.bezierCurveTo(500, 210, 482, 206, 466, 206);
  g.bezierCurveTo(432, 234, 382, 264, 300, 268);
  g.bezierCurveTo(218, 272, 142, 264, 130, 238);
  g.fill();
  g.fillStyle = 'rgba(214,226,255,0.35)';
  g.beginPath();
  g.moveTo(150, 248);
  g.bezierCurveTo(200, 262, 300, 266, 380, 246);
  g.bezierCurveTo(330, 270, 210, 276, 150, 248);
  g.fill();
  g.fillStyle = '#2a3772';
  g.beginPath();
  g.moveTo(250, 252);
  g.bezierCurveTo(240, 280, 226, 300, 214, 312);
  g.bezierCurveTo(248, 300, 276, 278, 288, 258);
  g.fill();
  g.fillStyle = 'rgba(255,248,236,0.95)';
  g.beginPath();
  g.arc(178, 230, 2.8, 0, Math.PI * 2);
  g.fill();
  g.restore();

  // Seafloor silhouette.
  g.fillStyle = '#181f4e';
  g.beginPath();
  g.moveTo(0, ART_H);
  for (let x = 0; x <= ART_W; x += 10) {
    g.lineTo(x, ART_H - 26 - Math.sin(x * 0.02) * 10 - Math.sin(x * 0.053) * 6);
  }
  g.lineTo(ART_W, ART_H);
  g.closePath();
  g.fill();

  // Bubbles and glints.
  for (let k = 0; k < 46; k++) {
    const x = rnd() * ART_W;
    const y = rnd() * ART_H * 0.9;
    const r = 1 + rnd() * 5;
    g.strokeStyle = `rgba(255,255,255,${0.25 + rnd() * 0.4})`;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.stroke();
  }
  for (let k = 0; k < 70; k++) {
    g.fillStyle = `rgba(255,246,255,${0.3 + rnd() * 0.6})`;
    const s = rnd() < 0.15 ? 2.2 : 1.1;
    g.fillRect(rnd() * ART_W, rnd() * ART_H * 0.8, s, s);
  }

  return cv;
}

/** A single piece cut from the artwork, on a transparent square canvas. */
export function renderPiece(art: HTMLCanvasElement, i: number, size: number): HTMLCanvasElement {
  const span = CELL * (1 + PAD * 2);
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const g = cv.getContext('2d')!;
  const s = size / span;
  const { c, r } = cellOf(i);
  g.scale(s, s);
  g.translate(-c * CELL + PAD * CELL, -r * CELL + PAD * CELL);
  g.beginPath();
  tracePiece(g, i);
  g.closePath();
  g.save();
  g.clip();
  g.drawImage(art, 0, 0);
  g.restore();
  g.strokeStyle = 'rgba(255,248,255,0.9)';
  g.lineWidth = 3;
  g.stroke();
  return cv;
}

/** The HUD board: collected pieces show their part of the picture, missing ones are dashed ghosts. */
export function drawBoard(target: HTMLCanvasElement, art: HTMLCanvasElement, collected: boolean[], glow = -1): void {
  const padPx = PAD * CELL;
  target.width = ART_W + padPx * 2;
  target.height = ART_H + padPx * 2;
  const g = target.getContext('2d')!;
  g.clearRect(0, 0, target.width, target.height);
  g.translate(padPx, padPx);
  for (let i = 0; i < PIECE_COUNT; i++) {
    g.beginPath();
    tracePiece(g, i);
    g.closePath();
    if (collected[i]) {
      g.save();
      if (i === glow) {
        g.shadowColor = 'rgba(255,240,255,0.95)';
        g.shadowBlur = 40;
      }
      g.clip();
      g.drawImage(art, 0, 0);
      g.restore();
      g.setLineDash([]);
      g.strokeStyle = 'rgba(255,248,255,0.85)';
      g.lineWidth = 4;
      g.stroke();
    } else {
      g.fillStyle = 'rgba(200,220,255,0.06)';
      g.fill();
      g.setLineDash([12, 12]);
      g.strokeStyle = 'rgba(220,235,255,0.4)';
      g.lineWidth = 3;
      g.stroke();
    }
  }
}

/** Piece `i` as a thick 3D slab, the artwork mapped onto its faces, centered on the origin. */
export function pieceGeometry(i: number, width: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  const flipY: Pen = {
    moveTo: (x, y) => shape.moveTo(x, -y),
    lineTo: (x, y) => shape.lineTo(x, -y),
    bezierCurveTo: (ax, ay, bx, by, x, y) => shape.bezierCurveTo(ax, -ay, bx, -by, x, -y),
  };
  tracePiece(flipY, i);
  const depth = CELL * 0.07;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: CELL * 0.03,
    bevelSize: CELL * 0.02,
    bevelSegments: 3,
    curveSegments: 14,
  });
  const pos = geo.attributes.position!;
  const uv = geo.attributes.uv!;
  for (let k = 0; k < pos.count; k++) {
    uv.setXY(k, pos.getX(k) / ART_W, 1 + pos.getY(k) / ART_H);
  }
  uv.needsUpdate = true;
  const { c, r } = cellOf(i);
  geo.translate(-(c + 0.5) * CELL, (r + 0.5) * CELL, -depth / 2);
  const k = width / CELL;
  geo.scale(k, k, k);
  return geo;
}
