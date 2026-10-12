'use strict';

/**
 * Lula ProVeri — App icon generator.
 *
 * Writes real PNG icons with nothing but Node's built-in zlib. A PWA is only
 * installable if the manifest has usable icons, and shipping hand-made binaries
 * into the repo is worse than generating them from code that anyone can read,
 * tweak and re-run.
 *
 *   node scripts/make-icons.js
 *
 * Produces: icon-192.png, icon-512.png, maskable-512.png, apple-touch-icon.png,
 *           favicon-32.png, og-card-1200x630.png
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT_DIR = path.join(__dirname, '..', 'pwa', 'icons');

/* ---------------- minimal PNG encoder ---------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/**
 * @param {number} width
 * @param {number} height
 * @param {(x:number,y:number)=>[number,number,number,number]} pixel  RGBA 0-255
 */
function encodePng(width, height, pixel) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      const offset = y * (stride + 1) + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- brand artwork ---------------- */

const BRAND = {
  deep: [7, 62, 45],
  mid: [14, 124, 90],
  bright: [22, 168, 120],
  gold: [246, 190, 62],
  white: [255, 255, 255],
  ink: [11, 24, 20],
};

function lerp(a, b, t) {
  return a.map((value, index) => Math.round(value + (b[index] - value) * t));
}

function roundedRectSdf(x, y, w, h, radius) {
  const dx = Math.max(Math.abs(x - w / 2) - (w / 2 - radius), 0);
  const dy = Math.max(Math.abs(y - h / 2) - (h / 2 - radius), 0);
  return Math.hypot(dx, dy) - radius;
}

/** Normalised shield polygon: returns 1 inside, 0 outside, soft at the edge. */
function shieldInside(nx, ny) {
  // Shield spans x 0.20-0.80, y 0.16-0.86 with a point at the bottom.
  if (nx < 0.20 || nx > 0.80 || ny < 0.16 || ny > 0.86) return 0;
  const topEdge = 0.16;
  const shoulderY = 0.54;
  if (ny <= shoulderY) {
    const inset = 0.20 + (ny - topEdge) * 0.0;
    return nx >= inset && nx <= 1 - inset ? 1 : 0;
  }
  const t = (ny - shoulderY) / (0.86 - shoulderY);
  const halfWidth = (0.30) * (1 - t);
  return Math.abs(nx - 0.5) <= halfWidth ? 1 : 0;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function checkInside(nx, ny, thickness) {
  const points = [[0.345, 0.505], [0.455, 0.625], [0.665, 0.375]];
  for (let i = 0; i < points.length - 1; i += 1) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    if (distanceToSegment(nx, ny, ax, ay, bx, by) <= thickness) return 1;
  }
  return 0;
}

/**
 * Render the ProVeri mark.
 * @param {number} size
 * @param {object} [options]
 * @param {number} [options.safeZone=1]  scale factor for maskable icons
 * @param {boolean} [options.rounded=true]
 */
function renderMark(size, { safeZone = 1, rounded = true } = {}) {
  const radius = rounded ? size * 0.2237 : 0; // iOS/Android squircle-ish
  return (x, y) => {
    const nx = (x + 0.5) / size;
    const ny = (y + 0.5) / size;

    if (rounded) {
      const d = roundedRectSdf(x + 0.5, y + 0.5, size, size, radius);
      if (d > 0.5) return [0, 0, 0, 0];
    }

    // Maskable icons must keep artwork inside the inner 80% safe zone.
    const scale = safeZone;
    const cx = 0.5 + (nx - 0.5) / scale;
    const cy = 0.5 + (ny - 0.5) / scale;

    // Diagonal brand gradient.
    const t = Math.max(0, Math.min(1, (cx * 0.45 + cy * 0.55 - 0.15) / 0.85));
    let rgb = t < 0.5 ? lerp(BRAND.deep, BRAND.mid, t / 0.5) : lerp(BRAND.mid, BRAND.bright, (t - 0.5) / 0.5);

    if (safeZone < 1) {
      // Outside the safe zone: solid brand, no artwork.
      const outside = Math.abs(cx - 0.5) > 0.5 || Math.abs(cy - 0.5) > 0.5;
      return outside ? [...BRAND.deep, 255] : paint(cx, cy, rgb, x, y, size, rounded, radius);
    }
    return paint(cx, cy, rgb, x, y, size, rounded, radius);
  };

  function paint(cx, cy, rgb, x, y, size, isRounded, cornerRadius) {
    let [r, g, b] = rgb;
    let alpha = 255;

    // Soft inner highlight from the top-left.
    const highlight = Math.max(0, 1 - Math.hypot(cx - 0.28, cy - 0.22) / 0.62);
    r = Math.min(255, Math.round(r + highlight * 26));
    g = Math.min(255, Math.round(g + highlight * 30));
    b = Math.min(255, Math.round(b + highlight * 22));

    // Shield, anti-aliased over two samples.
    const shield = (shieldInside(cx, cy) + shieldInside(cx + 0.4 / size, cy) + shieldInside(cx, cy + 0.4 / size) + shieldInside(cx - 0.4 / size, cy)) / 4;
    if (shield > 0) {
      r = Math.round(r + (BRAND.white[0] - r) * shield);
      g = Math.round(g + (BRAND.white[1] - g) * shield);
      b = Math.round(b + (BRAND.white[2] - b) * shield);
    }

    // Checkmark knocked out of the shield in brand green.
    const thickness = 0.052;
    const tick = (checkInside(cx, cy, thickness) + checkInside(cx + 0.35 / size, cy, thickness) + checkInside(cx, cy + 0.35 / size)) / 3;
    if (tick > 0 && shield > 0.5) {
      const target = BRAND.mid;
      r = Math.round(r + (target[0] - r) * tick);
      g = Math.round(g + (target[1] - g) * tick);
      b = Math.round(b + (target[2] - b) * tick);
    }

    // Gold verification pip at the shield shoulder.
    const pip = Math.max(0, 1 - Math.hypot(cx - 0.735, cy - 0.235) / 0.055);
    if (pip > 0) {
      r = Math.round(r + (BRAND.gold[0] - r) * pip);
      g = Math.round(g + (BRAND.gold[1] - g) * pip);
      b = Math.round(b + (BRAND.gold[2] - b) * pip);
    }

    if (isRounded) {
      const d = roundedRectSdf(x + 0.5, y + 0.5, size, size, cornerRadius);
      alpha = d < -0.5 ? 255 : d > 0.5 ? 0 : Math.round(255 * (0.5 - d));
    }
    return [r, g, b, alpha];
  }
}

/* ---------------- OG / share card ---------------- */

function renderOgCard(width, height) {
  return (x, y) => {
    const nx = (x + 0.5) / width;
    const ny = (y + 0.5) / height;
    const t = Math.max(0, Math.min(1, nx * 0.7 + ny * 0.3));
    let rgb = t < 0.5 ? lerp(BRAND.ink, BRAND.deep, t / 0.5) : lerp(BRAND.deep, BRAND.mid, (t - 0.5) / 0.5);

    // Faint diagonal rule pattern for texture.
    const rule = Math.abs(((x + y) % 46) - 23) < 1 ? 12 : 0;
    rgb = rgb.map((v) => Math.min(255, v + rule));

    // Gold accent bar bottom-left.
    if (ny > 0.86 && nx < 0.30) rgb = BRAND.gold;
    return [...rgb, 255];
  };
}

/* ---------------- write ---------------- */

function write(name, width, height, pixel) {
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, encodePng(width, height, pixel));
  const kb = (fs.statSync(file).size / 1024).toFixed(1);
  process.stdout.write(`  ✓ ${name.padEnd(26)} ${String(width).padStart(4)}×${String(height).padEnd(4)} ${kb.padStart(7)} KB\n`);
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  process.stdout.write('Lula ProVeri — generating app icons\n');
  write('icon-192.png', 192, 192, renderMark(192));
  write('icon-512.png', 512, 512, renderMark(512));
  write('maskable-512.png', 512, 512, renderMark(512, { safeZone: 0.8, rounded: false }));
  write('apple-touch-icon.png', 180, 180, renderMark(180, { rounded: false }));
  write('favicon-32.png', 32, 32, renderMark(32));
  write('favicon-16.png', 16, 16, renderMark(16));
  write('og-card.png', 1200, 630, renderOgCard(1200, 630));
  process.stdout.write(`\nWrote 7 icons to ${path.relative(process.cwd(), OUT_DIR)}\n`);
}

if (require.main === module) main();

module.exports = { encodePng, renderMark, renderOgCard, BRAND };
