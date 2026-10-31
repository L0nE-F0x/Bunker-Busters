import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';

/**
 * The Meshy models (public/models/*.glb), fetched once and early. `prefetchModels` starts the
 * downloads at boot, a few at a time in the order the boot asks for them, so the network works
 * while the CPU builds the terrain and props; the loaders then parse from these bytes (`loadGLB`).
 * The URLs carry a content hash (`?v=`, from vite.config.ts), so the site can cache them for a year.
 * Byte counts drive the loading bar (`modelProgress`).
 *
 * The website's build also ships each model gzipped (`x.glb.gz`, a third smaller), unpacked here as
 * it streams in (DecompressionStream). A response that isn't gzip (a server or proxy that already
 * decoded it) is used as it is. A failed download is retried a few times before it gives up
 * (`ModelError`: the boot says what happened instead of carrying on without the model).
 */
const BASE = `${import.meta.env.BASE_URL}models/`;
const REV: Record<string, { v: string; size: number; gz?: number }> = typeof __MODEL_REV__ === 'undefined' ? {} : __MODEL_REV__;
const GZ = typeof DecompressionStream !== 'undefined' && !(globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

/** Why a model never arrived: `offline` (no network), `http` (the server said no), `network` (dropped or blocked). */
export class ModelError extends Error {
  constructor(readonly model: string, readonly why: 'offline' | 'http' | 'network', readonly status = 0, cause?: unknown) {
    super(`${model}.glb: ${why === 'http' ? `HTTP ${status}` : why === 'offline' ? 'offline' : `download failed (${cause instanceof Error ? cause.message : String(cause)})`}`);
    this.name = 'ModelError';
  }
}

interface Entry { promise: Promise<ArrayBuffer>; loaded: number; size: number; failed?: ModelError }
const entries = new Map<string, Entry>();
const queue: { name: string; resolve: (b: ArrayBuffer) => void; reject: (e: unknown) => void }[] = [];
let active = 0;
let limit = 3;
/** Waits between attempts (ms): four tries in all, about 10 s before giving up. */
const BACKOFF = [800, 2500, 6000];

const gzipped = (name: string) => GZ && !!REV[name]?.gz;

export function modelUrl(name: string) {
  const r = REV[name];
  return `${BASE}${name}.glb${gzipped(name) ? '.gz' : ''}${r ? `?v=${r.v}` : ''}`;
}

/** What the network has to carry for `name` (the gzipped size on the website). */
const wireSize = (name: string) => (gzipped(name) ? REV[name].gz! : REV[name]?.size ?? 0);

async function fetchOnce(name: string, e: Entry): Promise<ArrayBuffer> {
  e.loaded = 0;
  let res: Response;
  try {
    res = await fetch(modelUrl(name));
  } catch (err) {
    throw new ModelError(name, navigator.onLine === false ? 'offline' : 'network', 0, err);
  }
  if (!res.ok) throw new ModelError(name, 'http', res.status);
  try {
    if (!res.body) {
      const b = new Uint8Array(await res.arrayBuffer());
      e.loaded = b.byteLength;
      return isGzip(b) ? await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() : b.buffer;
    }
    // stream it, so the loading bar sees bytes as they arrive (counted as they come off the wire)
    const reader = res.body.getReader();
    const first = await reader.read();
    const counted = new ReadableStream<Uint8Array>({
      start(c) {
        if (first.value) { e.loaded += first.value.byteLength; c.enqueue(first.value); }
        if (first.done) c.close();
      },
      async pull(c) {
        const { done, value } = await reader.read();
        if (done) { c.close(); return; }
        e.loaded += value.byteLength;
        c.enqueue(value);
      },
      cancel(r) { void reader.cancel(r); },
    });
    const body = first.value && isGzip(first.value) ? (counted as ReadableStream<BufferSource>).pipeThrough(new DecompressionStream('gzip')) : counted;
    return await new Response(body).arrayBuffer();
  } catch (err) {
    throw new ModelError(name, navigator.onLine === false ? 'offline' : 'network', 0, err);
  }
}

const isGzip = (b: Uint8Array) => b.byteLength > 2 && b[0] === 0x1f && b[1] === 0x8b;

async function download(name: string, e: Entry): Promise<ArrayBuffer> {
  for (let attempt = 0; ; attempt++) {
    try {
      const b = await fetchOnce(name, e);
      e.loaded = e.size = Math.max(e.size, e.loaded);
      return b;
    } catch (err) {
      const m = err instanceof ModelError ? err : new ModelError(name, 'network', 0, err);
      // a 404 from a deploy that's still going out can clear up; 400-level otherwise won't
      const hopeless = m.why === 'http' && m.status >= 400 && m.status < 500 && m.status !== 404 && m.status !== 408 && m.status !== 429;
      if (hopeless || attempt >= BACKOFF.length) { e.failed = m; throw m; }
      console.warn(`[models] ${m.message}; trying again (${attempt + 1}/${BACKOFF.length})`);
      // offline: wait for the connection to come back (or the next try, whichever is first)
      await new Promise<void>((r) => {
        const t = setTimeout(done, BACKOFF[attempt]);
        function done() { clearTimeout(t); window.removeEventListener('online', done); r(); }
        if (navigator.onLine === false) window.addEventListener('online', done);
      });
    }
  }
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
  const size = wireSize(name);
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
    // parsed once already and its bytes let go (a second model needing the same file: the respirator):
    // fetch it again, from the HTTP cache
    if (released.has(name)) return download(name, e);
    // still waiting in the queue: it's wanted now, so it goes next
    const i = queue.findIndex((j) => j.name === name);
    if (i > 0) queue.unshift(...queue.splice(i, 1));
    return e.promise;
  }
  return enqueue(name, true).promise;
}

/** Files whose bytes were parsed and dropped (the entry stays, for the byte counts). */
const released = new Set<string>();

/**
 * Parse a model (textures included) from its prefetched bytes, then let go of them: the parser copies
 * what it keeps, and the prefetch held every model's bytes (~30 MB unpacked) for the whole session.
 */
export async function loadGLB(name: string): Promise<GLTF> {
  const buf = await modelBytes(name);
  const gltf = await new GLTFLoader().parseAsync(buf, BASE);
  const e = entries.get(name);
  if (e && !e.failed) {
    released.add(name);
    e.promise = Promise.resolve(new ArrayBuffer(0));
  }
  return gltf;
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

/** Forget these failed downloads and queue them again (the player pressed "Try again"). */
export function retryModels(names: readonly string[]) {
  for (const n of names) if (entries.get(n)?.failed) entries.delete(n);
  for (const n of names) enqueue(n);
}

/** The downloads that gave up (after their retries), for the boot's error screen. */
export function modelFailures(names?: readonly string[]): ModelError[] {
  const out: ModelError[] = [];
  for (const [n, e] of entries) if (e.failed && (!names || names.includes(n))) out.push(e.failed);
  return out;
}
