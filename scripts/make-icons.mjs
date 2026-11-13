// Generates the PWA icons (no external image tooling required).
// Usage: node scripts/make-icons.mjs
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
};

const encodePNG = (width, height, rgba) => {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

const drawIcon = (size, padding) => {
  const SS = 4;
  const W = size * SS;
  const buf = Buffer.alloc(W * W * 4);
  const bg = hex('#141518');
  for (let i = 0; i < W * W; i++) {
    buf[i * 4] = bg[0];
    buf[i * 4 + 1] = bg[1];
    buf[i * 4 + 2] = bg[2];
    buf[i * 4 + 3] = 255;
  }

  const fill = (pts, color) => {
    const minY = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1]))));
    const maxY = Math.min(W - 1, Math.ceil(Math.max(...pts.map((p) => p[1]))));
    for (let y = minY; y <= maxY; y++) {
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if (a[1] === b[1]) continue;
        if ((y + 0.5 >= Math.min(a[1], b[1])) && (y + 0.5 < Math.max(a[1], b[1]))) {
          xs.push(a[0] + ((y + 0.5 - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const x0 = Math.max(0, Math.ceil(xs[k] - 0.5));
        const x1 = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
        for (let x = x0; x <= x1; x++) {
          const o = (y * W + x) * 4;
          buf[o] = color[0];
          buf[o + 1] = color[1];
          buf[o + 2] = color[2];
          buf[o + 3] = 255;
        }
      }
    }
  };

  const cx = W / 2;
  const cy = W / 2;
  const r = (W / 2) * (1 - padding) * 0.92;
  const dx = r * 0.866;
  const dy = r * 0.5;
  const top = [cx, cy - r];
  const right = [cx + dx, cy - dy];
  const bottom = [cx, cy];
  const left = [cx - dx, cy - dy];
  const leftLow = [cx - dx, cy + dy];
  const bottomLow = [cx, cy + r];
  const rightLow = [cx + dx, cy + dy];

  fill([top, right, bottom, left], hex('#e7ecf2'));
  fill([left, bottom, bottomLow, leftLow], hex('#aeb7c1'));
  fill([right, bottom, bottomLow, rightLow], hex('#818a95'));

  // Accent edge on the top-right of the cube.
  const accent = hex('#3f8cff');
  const t = 0.06;
  const lerp = (a, b, s) => [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s];
  fill(
    [lerp(top, right, 0.02), lerp(top, right, 0.94), lerp(bottom, right, 0.96), lerp(bottom, right, 0.04)],
    accent,
  );

  // Box-filter downsample.
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r0 = 0;
      let g0 = 0;
      let b0 = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const o = ((y * SS + sy) * W + (x * SS + sx)) * 4;
          r0 += buf[o];
          g0 += buf[o + 1];
          b0 += buf[o + 2];
        }
      }
      const n = SS * SS;
      const o = (y * size + x) * 4;
      out[o] = Math.round(r0 / n);
      out[o + 1] = Math.round(g0 / n);
      out[o + 2] = Math.round(b0 / n);
      out[o + 3] = 255;
    }
  }
  return encodePNG(size, size, out);
};

const dir = path.join(process.cwd(), 'public', 'icons');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'icon-192.png'), drawIcon(192, 0.16));
fs.writeFileSync(path.join(dir, 'icon-512.png'), drawIcon(512, 0.16));
fs.writeFileSync(path.join(dir, 'icon-512-maskable.png'), drawIcon(512, 0.28));
fs.writeFileSync(
  path.join(dir, 'icon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#141518"/><path d="M32 10l19 11v22L32 54 13 43V21z" fill="#e7ecf2"/><path d="M13 21l19 11v22L13 43z" fill="#aeb7c1"/><path d="M51 21L32 32v22l19-11z" fill="#818a95"/><path d="M32 10l19 11-19 11-19-11z" fill="#e7ecf2"/></svg>`,
);
fs.writeFileSync(
  path.join(dir, 'icon-192.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" fill="#141518"/><path d="M96 30l57 33v66L96 162 39 129V63z" fill="#e7ecf2"/></svg>`,
);
console.log('icons written to public/icons');
