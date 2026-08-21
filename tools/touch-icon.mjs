#!/usr/bin/env node
// Derive apps/home/public/apple-touch-icon.png from apps/home/public/favicon.png.
//
// A favicon and an iOS home-screen icon want opposite things. The favicon is 32px of
// pixel art on a transparent background, which is right for a tab: it sits on whatever
// colour the browser's chrome happens to be. iOS wants 180px and flattens transparency
// onto black — which would swallow every black pixel of this particular icon — and it
// masks the result to a rounded square, so anything in the corners gets cut.
//
// So: scale by a whole number with nearest-neighbour, since smooth interpolation turns
// pixel art to mush, flatten onto an opaque background, and inset it far enough that
// the mask has only background to bite into.
//
// Usage: node tools/touch-icon.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync, crc32 } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(root, 'apps/home/public/favicon.png');
const TARGET = join(root, 'apps/home/public/apple-touch-icon.png');

/** The size iOS asks for, and the whole-number zoom of a 32px source that fits it. */
const CANVAS = 180;
const SCALE = 4;
/** What shows through where the artwork is transparent. The art is black and blue. */
const BACKDROP = [255, 255, 255];

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const paeth = (a, b, c) => {
  const p = a + b - c;
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** An 8-bit RGBA PNG in, flat pixel bytes out. Anything else is the caller's problem. */
function decode(file) {
  const data = readFileSync(file);
  if (!data.subarray(0, 8).equals(SIGNATURE)) throw new Error(`${file} is not a PNG`);

  let width, height, deflated = [];
  for (let i = 8; i < data.length; ) {
    const length = data.readUInt32BE(i);
    const kind = data.subarray(i + 4, i + 8).toString('latin1');
    const body = data.subarray(i + 8, i + 8 + length);
    if (kind === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, colour, , , interlace] = [body[8], body[9], body[10], body[11], body[12]];
      if (depth !== 8 || colour !== 6 || interlace !== 0)
        throw new Error(`want an 8-bit RGBA PNG, got depth ${depth} colour type ${colour}`);
    } else if (kind === 'IDAT') deflated.push(body);
    i += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(deflated));
  const stride = width * 4;
  const pixels = Buffer.alloc(height * stride);

  // Undo the per-scanline filter each row declares in its first byte.
  for (let y = 0, at = 0; y < height; y++) {
    const filter = raw[at++];
    const row = Buffer.from(raw.subarray(at, at + stride));
    at += stride;
    const above = y ? pixels.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? row[x - 4] : 0;
      const up = above[x];
      const corner = x >= 4 ? above[x - 4] : 0;
      if (filter === 1) row[x] = (row[x] + left) & 255;
      else if (filter === 2) row[x] = (row[x] + up) & 255;
      else if (filter === 3) row[x] = (row[x] + ((left + up) >> 1)) & 255;
      else if (filter === 4) row[x] = (row[x] + paeth(left, up, corner)) & 255;
    }
    row.copy(pixels, y * stride);
  }

  return { width, height, pixels };
}

/** Written as RGB, with no alpha channel at all: an icon iOS cannot misread. */
function encode(file, width, height, pixels) {
  const chunk = (kind, body) => {
    const name = Buffer.from(kind, 'latin1');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc32(Buffer.concat([name, body])) >>> 0);
    return Buffer.concat([length, name, body, sum]);
  };

  // Filter 0 on every row: at this size the bytes are cheap and the code is cheaper.
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);

  writeFileSync(file, Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

const { width, height, pixels } = decode(SOURCE);
if (width !== height) throw new Error(`favicon.png must be square, got ${width}x${height}`);

const art = width * SCALE;
if (art > CANVAS) throw new Error(`${width}px at ${SCALE}x is ${art}px, too big for a ${CANVAS}px icon`);
const inset = Math.round((CANVAS - art) / 2);

const out = Buffer.alloc(CANVAS * CANVAS * 3);
for (let i = 0; i < out.length; i += 3) out.set(BACKDROP.slice(0, 3), i);

for (let y = 0; y < art; y++) {
  for (let x = 0; x < art; x++) {
    // Nearest neighbour: whole source pixels become whole SCALE-sized blocks.
    const from = ((Math.floor(y / SCALE) * width) + Math.floor(x / SCALE)) * 4;
    const alpha = pixels[from + 3] / 255;
    if (!alpha) continue;
    const to = ((y + inset) * CANVAS + x + inset) * 3;
    for (let c = 0; c < 3; c++) {
      // Straight alpha over the backdrop, so a soft edge stays soft.
      out[to + c] = Math.round(pixels[from + c] * alpha + BACKDROP[c] * (1 - alpha));
    }
  }
}

encode(TARGET, CANVAS, CANVAS, out);
console.log(`✓ apple-touch-icon.png — ${width}px art at ${SCALE}x, inset ${inset}px in ${CANVAS}px, flattened opaque`);
