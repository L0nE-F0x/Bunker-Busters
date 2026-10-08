import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';

/**
 * The Meshy models (public/models/*.glb), fetched once and early. `prefetchModels` starts the
 * downloads at boot, a few at a time in the order the boot asks for them, so the network works
 * while the CPU builds the terrain and props; the loaders then parse from these bytes (`loadGLB`).
 * The URLs carry a content hash (`?v=`, from vite.config.ts), so the site can cache them for a year.
 * Byte counts drive the loading bar (`modelBytes`).
 */
const BASE = `${import.meta.env.BASE_URL}models/`;
const REV: Record<string, { v: string; size: number }> = typeof __MODEL_REV__ === 'undefined' ? {} : __MODEL_REV__;

interface Entry { promise: Promise<ArrayBuffer>; loaded: number; size: number }
const entries = new Map<string, Entry>();
const queue: { name: string; resolve: (b: ArrayBuffer) => void; reject: (e: unknown) => void }[] = [];
let active = 0;
let limit = 3;

export function modelUrl(name: string) {
  const r = REV[name];
  return `${BASE}${name}.glb${r ? `?v=${r.v}` : ''}`;
}

async function download(name: string, e: Entry): Promise<ArrayBuffer> {
  const res = await fetch(modelUrl(name));
  if (!res.ok) throw new Error(`${name}.glb: HTTP ${res.status}`);
  // (progress counts decoded bytes against the build's known size: content-length may be compressed)
  if (!res.body) {
    const b = await res.arrayBuffer();
    e.loaded = e.size = b.byteLength;
    return b;
  }
  // stream it, so the loading bar sees bytes as they arrive
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    n += value.byteLength;
    e.loaded = n;
  }
  const out = new Uint8Array(n);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.byteLength; }
  e.loaded = e.size = n;
  return out.buffer;
}

function pump() {
  while (active < limit && queue.length) {
    const job = queue.shift()!;
    const e = entries.get(job.name)!;
    active++;
    download(job.name, e).then(job.resolve, job.reject).finally(() => { active--; pump(); });
  }
}

function enqueue(name: string, front = false): Entry {
  let e = entries.get(name);
  if (e) return e;
  const size = REV[name]?.size ?? 0;
  let resolve!: (b: ArrayBuffer) => void, reject!: (err: unknown) => void;
  const promise = new Promise<ArrayBuffer>((res, rej) => { resolve = res; reject = rej; });
  promise.catch(() => {}); // a failure surfaces where it's awaited (the loaders fall back)
  e = { promise, loaded: 0, size };
  entries.set(name, e);
  const job = { name, resolve, reject };
  if (front) queue.unshift(job); else queue.push(job);
  pump();
  return e;
}

/** Start fetching `names`, in this order, at most `concurrency` at once. */
export function prefetchModels(names: string[], concurrency = 3) {
  limit = concurrency;
  for (const n of names) enqueue(n);
}

/** The bytes of one model: from the prefetch if it was queued, else fetched now (ahead of the queue). */
export function modelBytes(name: string): Promise<ArrayBuffer> {
  const e = entries.get(name);
  if (e) {
    // still waiting in the queue: it's wanted now, so it goes next
    const i = queue.findIndex((j) => j.name === name);
    if (i > 0) queue.unshift(...queue.splice(i, 1));
    return e.promise;
  }
  return enqueue(name, true).promise;
}

/** Parse a model (textures included) from its prefetched bytes. */
export async function loadGLB(name: string): Promise<GLTF> {
  const buf = await modelBytes(name);
  return new GLTFLoader().parseAsync(buf, BASE);
}

/** Downloaded / total bytes over the given models (all queued ones by default). */
export function modelProgress(names?: readonly string[]) {
  let loaded = 0, total = 0;
  for (const [n, e] of entries) {
    if (names && !names.includes(n)) continue;
    loaded += e.loaded;
    total += Math.max(e.size, e.loaded);
  }
  return { loaded, total, fraction: total ? loaded / total : 1 };
}
