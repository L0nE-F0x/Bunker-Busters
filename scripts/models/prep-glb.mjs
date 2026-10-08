// Make a Meshy GLB game-ready: drop the emissive hookup (Meshy wires the colour map into emission at
// full strength, so the model glows in the dark), strip material extensions we don't use, and
// re-encode the textures as JPEG (a 2048² PNG colour map is ~4 MB; JPEG is a fraction of that).
//
//   node scripts/models/prep-glb.mjs Assets/Meshy_AI_Lone_Wolf_Walking.glb public/models/wolf.glb [--size 2048] [--q 4]
//
// Needs ffmpeg. Geometry, skin and animations are then packed smaller by slim-glb.mjs (same look;
// --no-slim skips it).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { slimGlb } from './slim-glb.mjs';

const [src, dst, ...rest] = process.argv.slice(2);
if (!src || !dst) { console.log('usage: prep-glb.mjs <in.glb> <out.glb> [--size N] [--q 2..8]'); process.exit(1); }
const opt = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d; };
const size = Number(opt('--size', 2048)), q = Number(opt('--q', 4));

const b = fs.readFileSync(src);
const jsonLen = b.readUInt32LE(12);
const json = JSON.parse(b.subarray(20, 20 + jsonLen).toString());
const binStart = 20 + jsonLen + 8;
const bin = b.subarray(binStart, binStart + b.readUInt32LE(20 + jsonLen));

for (const m of json.materials ?? []) {
  delete m.emissiveTexture;
  delete m.emissiveFactor;
  delete m.extensions;
  m.pbrMetallicRoughness = { ...m.pbrMetallicRoughness, metallicFactor: 0, roughnessFactor: 0.9 };
}
json.extensionsUsed = (json.extensionsUsed ?? []).filter((e) => !/specular|ior/.test(e));
if (!json.extensionsUsed.length) delete json.extensionsUsed;

// rebuild the binary: every bufferView copied as is, except images, which become JPEGs
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glb-'));
const imageViews = new Map((json.images ?? []).map((im, i) => [im.bufferView, i]));
const chunks = [];
let off = 0;
json.bufferViews = json.bufferViews.map((v, vi) => {
  let data = bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
  if (imageViews.has(vi)) {
    const im = json.images[imageViews.get(vi)];
    const inF = path.join(tmp, `in${vi}`), outF = path.join(tmp, `out${vi}.jpg`);
    fs.writeFileSync(inF, data);
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', inF, '-vf', `scale=${size}:${size}:flags=lanczos`, '-q:v', String(q), outF]);
    data = fs.readFileSync(outF);
    im.mimeType = 'image/jpeg';
  }
  const pad = (4 - (data.length % 4)) % 4;
  chunks.push(data, Buffer.alloc(pad));
  const nv = { ...v, byteOffset: off, byteLength: data.length };
  off += data.length + pad;
  return nv;
});
json.buffers = [{ byteLength: off }];
fs.rmSync(tmp, { recursive: true, force: true });

let js = Buffer.from(JSON.stringify(json));
js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const body = Buffer.concat(chunks);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + js.length + 8 + body.length, 8);
const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
const bh = Buffer.alloc(8); bh.writeUInt32LE(body.length, 0); bh.writeUInt32LE(0x004e4942, 4);
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, rest.includes('--no-slim') ? Buffer.concat([header, jh, js, bh, body]) : slimGlb(Buffer.concat([header, jh, js, bh, body])));
console.log(`${dst}: ${(fs.statSync(src).size / 1e6).toFixed(1)} MB → ${(fs.statSync(dst).size / 1e6).toFixed(1)} MB`);
