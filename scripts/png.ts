// Minimal PNG codec for the asset pipeline (no dependencies; zlib is built into Node).
// Decodes 8-bit RGBA, RGB, grey, grey+alpha and palette images, non-interlaced: what pixel-art tools export.
import zlib from 'node:zlib';

export interface Image {
  w: number;
  h: number;
  /** RGBA, 4 bytes per pixel. */
  data: Uint8Array;
}
const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function decodePng(buf: Buffer): Image {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG file');
  let pos = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0, palette: Buffer | null = null, trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos), name = buf.toString('latin1', pos + 4, pos + 8), body = buf.subarray(pos + 8, pos + 8 + len);
    if (pos + 12 + len > buf.length) throw new Error('truncated PNG');
    if (name === 'IHDR') { w = body.readUInt32BE(0); h = body.readUInt32BE(4); depth = body[8]; type = body[9]; interlace = body[12]; }
    else if (name === 'PLTE') palette = body;
    else if (name === 'tRNS') trns = body;
    else if (name === 'IDAT') idat.push(body);
    else if (name === 'IEND') break;
    pos += 12 + len;
  }
  if (!w || !h) throw new Error('PNG has no header');
  if (w > 8192 || h > 8192) throw new Error(`image too large (${w}x${h})`);
  if (depth !== 8) throw new Error(`unsupported bit depth ${depth} (export 8-bit PNG)`);
  if (interlace) throw new Error('interlaced PNG is not supported (export without interlacing)');
  const ch = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (!ch) throw new Error(`unsupported colour type ${type}`);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch;
  if (raw.length < (stride + 1) * h) throw new Error('PNG pixel data is incomplete');
  const cur = new Uint8Array(stride), prev = new Uint8Array(stride), out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      let v = row[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (f !== 0) throw new Error('corrupt PNG filter');
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, i = x * ch;
      if (type === 6) { out[o] = cur[i]; out[o + 1] = cur[i + 1]; out[o + 2] = cur[i + 2]; out[o + 3] = cur[i + 3]; }
      else if (type === 2) { out[o] = cur[i]; out[o + 1] = cur[i + 1]; out[o + 2] = cur[i + 2]; out[o + 3] = 255; }
      else if (type === 0) { out[o] = out[o + 1] = out[o + 2] = cur[i]; out[o + 3] = 255; }
      else if (type === 4) { out[o] = out[o + 1] = out[o + 2] = cur[i]; out[o + 3] = cur[i + 1]; }
      else { const p = cur[i]; if (!palette || p * 3 + 2 >= palette.length) throw new Error('palette index out of range'); out[o] = palette[p * 3]; out[o + 1] = palette[p * 3 + 1]; out[o + 2] = palette[p * 3 + 2]; out[o + 3] = trns && p < trns.length ? trns[p] : 255; }
    }
    prev.set(cur);
  }
  return { w, h, data: out };
}

export function encodePng(img: Image): Buffer {
  const stride = img.w * 4, raw = Buffer.alloc((stride + 1) * img.h);
  for (let y = 0; y < img.h; y++) Buffer.from(img.data.buffer, img.data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  const chunk = (name: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(name, 4, 'latin1');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.w, 0);
  ihdr.writeUInt32BE(img.h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
