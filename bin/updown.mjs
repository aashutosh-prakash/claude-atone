#!/usr/bin/env node
// updown.mjs — a pixel-graphics terminal animation: the Claude mascot holding
// its ears doing up-down squats (the school "uthak-baithak" punishment).
//
// Rendered with the chafa technique built in: each frame draws the figure as
// colored pixels into a framebuffer, then paints two vertical pixels per
// character cell using the ▀ half-block (fg = top pixel, bg = bottom pixel)
// with 24-bit truecolor. No external tools, no GIF, no dependencies.
//
// Run continuously:  node updown.mjs
// Play ~5s then exit (used by the Stop hook):  node updown.mjs --once

const ESC = '\x1b[';
const W = 18;
const H = 24; // 24 px tall -> 12 character rows (compact)
const PAD = '  '; // left margin (2 spaces)
const ONCE = process.argv.includes('--once');
const ONCE_TICKS = 55; // --once runs ~5s (55 frames * 90ms) then exits

// --- framebuffer ---------------------------------------------------------
let fb = new Array(W * H).fill(null); // each cell: [r,g,b] or null (empty)

const setPx = (x, y, c) => {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi >= 0 && xi < W && yi >= 0 && yi < H) fb[yi * W + xi] = c;
};

const disc = (cx, cy, r, c) => {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) setPx(cx + dx, cy + dy, c);
};

const limb = (x0, y0, x1, y1, r, c) => {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, c);
  }
};

// --- palette -------------------------------------------------------------
// Mid-tone colors chosen to stay visible on BOTH light and dark terminal
// backgrounds (near-black tones vanish on dark profiles, near-white on light).
const SHIRT = [70, 150, 220];
const PANTS = [95, 105, 140];
const SHOE = [90, 70, 55];
const SWEAT = [90, 170, 230];
const CLAUDE = [217, 119, 87]; // Claude mascot terracotta (head)
const CLAUDE_HAND = [171, 90, 62]; // darker terracotta so hands don't blob into the face
const EYE = [25, 25, 25];

// --- draw the figure at squat-depth p (0 = standing, 1 = deep squat) ------
function drawFigure(p) {
  fb = new Array(W * H).fill(null);
  const cx = W / 2;
  const footY = 22;
  const headHW = 3; // head half-width
  const hipY = 12 + 7 * p; // standing 12 -> deep squat 19 (feet at 22)
  const neckY = hipY - 6;
  const headCy = neckY - headHW + 1;
  const shoulderY = neckY + 1;

  // legs: knees splay out wide and bend sharply as it squats
  const kneeX = 2 + 5 * p;
  const kneeY = hipY + (footY - hipY) * 0.55 + 1;
  const footX = 3 + p;
  limb(cx - 1, hipY, cx - kneeX, kneeY, 1, PANTS);
  limb(cx - kneeX, kneeY, cx - footX, footY, 1, PANTS);
  limb(cx + 1, hipY, cx + kneeX, kneeY, 1, PANTS);
  limb(cx + kneeX, kneeY, cx + footX, footY, 1, PANTS);
  disc(cx - footX, footY, 1, SHOE);
  disc(cx + footX, footY, 1, SHOE);

  // torso
  limb(cx, neckY, cx, hipY, 1, SHIRT);
  // clear the single protruding tip pixel so the t-shirt doesn't dangle
  // between the legs at the bottom of a deep squat
  const tipY = Math.round(hipY + 1);
  if (tipY >= 0 && tipY < H) fb[tipY * W + cx] = null;

  // arms bent UP to grip the ears. Hands reach one px past the head edge so the
  // hand reads as a clear block by the ear (the head would otherwise swallow a
  // closer hand).
  const earY = headCy;
  const handX = headHW + 2;
  limb(cx - 1, shoulderY, cx - handX, shoulderY - 1, 1, SHIRT);
  limb(cx - handX, shoulderY - 1, cx - handX, earY, 1, SHIRT);
  disc(cx - handX, earY, 1, CLAUDE_HAND); // left hand on ear
  limb(cx + 1, shoulderY, cx + handX, shoulderY - 1, 1, SHIRT);
  limb(cx + handX, shoulderY - 1, cx + handX, earY, 1, SHIRT);
  disc(cx + handX, earY, 1, CLAUDE_HAND); // right hand on ear

  // Claude mascot head: a clean WIDE rectangle (wider than tall) with two small
  // black eyes set apart with a center gap — matching the logo.
  const hh = 2; // head half-height (< headHW => wider than tall)
  for (let dy = -hh; dy <= hh; dy++)
    for (let dx = -headHW; dx <= headHW; dx++) setPx(cx + dx, headCy + dy, CLAUDE);
  for (const ey of [headCy - 1, headCy]) {
    setPx(cx - 2, ey, EYE);
    setPx(cx + 2, ey, EYE);
  }

  if (p > 0.75) setPx(cx + headHW + 2, headCy - 2, SWEAT); // sweat drop deep in the squat
}

// --- paint framebuffer to the terminal (▀ = top pixel, bg = bottom pixel) -
function paint() {
  let out = `${ESC}H`;
  for (let row = 0; row < H / 2; row++) {
    out += PAD;
    for (let x = 0; x < W; x++) {
      const top = fb[row * 2 * W + x];
      const bot = fb[(row * 2 + 1) * W + x];
      if (top && bot) out += `${ESC}38;2;${top[0]};${top[1]};${top[2]}m${ESC}48;2;${bot[0]};${bot[1]};${bot[2]}m▀`;
      else if (top) out += `${ESC}49m${ESC}38;2;${top[0]};${top[1]};${top[2]}m▀`;
      else if (bot) out += `${ESC}49m${ESC}38;2;${bot[0]};${bot[1]};${bot[2]}m▄`;
      else out += `${ESC}0m `;
    }
    out += `${ESC}0m${ESC}0K\n`;
  }
  process.stdout.write(out);
}

// --- run loop ------------------------------------------------------------
let t = 0;
let reps = 0;
let wasDown = false;

function frame() {
  const p = (1 - Math.cos(t * 0.5)) / 2; // smooth 0 -> 1 -> 0
  if (p > 0.9 && !wasDown) {
    reps++;
    wasDown = true;
  }
  if (p < 0.1) wasDown = false;

  drawFigure(p);
  paint();

  // Mid-tone truecolor caption so it stays legible on light AND dark terminals.
  const accent = '\x1b[38;2;200;120;70m'; // warm terracotta
  // center each caption line under the figure (W-wide drawing area after PAD)
  const line = (s, b = false) => {
    const pad = PAD + ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2)));
    return `${b ? '\x1b[1m' : ''}${accent}${pad}${s}\x1b[0m${ESC}0K\n`;
  };
  process.stdout.write(`${ESC}0m` + line(`up-down ×${reps}`));
  if (ONCE) {
    process.stdout.write(line('🙏 kaan pakad ke', true));
    process.stdout.write(line('Sorry Sir!', true));
  } else {
    process.stdout.write(line('Ctrl+C to stop', true));
  }
  t++;

  // in --once mode, run ~5 seconds then exit (the hook then closes the window)
  if (ONCE && t >= ONCE_TICKS) quit();
}

// 2J clears the screen, 3J also clears the scrollback so nothing (login banner,
// the command line) sits above the figure; H homes the cursor.
process.stdout.write(`${ESC}2J${ESC}3J${ESC}H${ESC}?25l`);
const timer = setInterval(frame, 90);

function quit() {
  clearInterval(timer);
  process.stdout.write(`${ESC}?25h${ESC}0m\n`); // show cursor, reset
  process.exit(0);
}
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
