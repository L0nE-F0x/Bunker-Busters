// Offline play for the browser build (/play/). This is a template: `npm run build` fills in the file
// list (vite.config.ts, offlinePlugin) and writes it to dist/play/sw.js.
//
// Every file the game page uses (~55 MB: the bundle, fonts, models, voice clips, icons) is saved in
// one cache, keyed by path + content hash. A deploy only downloads the files whose hash changed, and
// the game's own URLs (`x.glb?v=…`, `clip.mp3?v=<voice rev>`) map to those keys through FILES.
// Navigations go to the network first (4 s), then to the saved page, so online players always get
// the latest deploy and offline players get the one they saved.
const FILES = /* FILES */ []; // [url the page asks for, cache key, bytes]
const INDEX = /* INDEX */ ''; // cache key of /play/index.html
const CACHE = 'bb-offline';
const BY_URL = new Map(FILES.map(([u, k]) => [u, k]));
const TOTAL = FILES.reduce((s, f) => s + f[2], 0);

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(fill().catch((err) => { tell({ failed: true }); throw err; }));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // drop files the new list no longer has (older deploys)
    const keep = new Set(FILES.map((f) => f[1]));
    const cache = await caches.open(CACHE);
    for (const req of await cache.keys()) if (!keep.has(path(req.url))) await cache.delete(req);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'status') e.waitUntil(status().then((s) => e.source?.postMessage(s)));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== location.origin) return;
  if (req.mode === 'navigate') {
    if (u.pathname.startsWith('/play/')) e.respondWith(page(req));
    return;
  }
  const key = BY_URL.get(u.pathname + u.search);
  if (key) e.respondWith(caches.open(CACHE).then((c) => c.match(key)).then((hit) => hit ?? fetch(req)));
});

const path = (url) => { const u = new URL(url); return u.pathname + u.search; };

async function page(req) {
  try {
    return await Promise.race([fetch(req), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 4000))]);
  } catch (err) {
    const hit = await (await caches.open(CACHE)).match(INDEX);
    if (hit) return hit;
    throw err;
  }
}

/** Download whatever isn't saved yet, six at a time. Resumes where a failed install stopped. */
async function fill() {
  const cache = await caches.open(CACHE);
  const have = new Set((await cache.keys()).map((r) => path(r.url)));
  let done = 0;
  const todo = [];
  for (const f of FILES) if (have.has(f[1])) done += f[2]; else todo.push(f);
  let next = 0, sent = 0;
  tell({ done, total: TOTAL, ready: !todo.length });
  const worker = async () => {
    while (next < todo.length) {
      const [url, key, bytes] = todo[next++];
      // unhashed files (the page, the manifest, icons) must come from this deploy, not the HTTP cache
      let res = await fetch(url, { cache: url.includes('?') || url.startsWith('/assets/') ? 'default' : 'no-cache' });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      // a redirected response can't answer a navigation: store a plain copy
      if (res.redirected) res = new Response(await res.blob(), { status: res.status, headers: res.headers });
      await cache.put(key, res);
      done += bytes;
      if (done - sent > TOTAL / 100) { sent = done; tell({ done, total: TOTAL, ready: false }); }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  tell({ done: TOTAL, total: TOTAL, ready: true });
}

async function status() {
  const have = new Set((await (await caches.open(CACHE)).keys()).map((r) => path(r.url)));
  let done = 0;
  for (const f of FILES) if (have.has(f[1])) done += f[2];
  return { type: 'bb-offline', done, total: TOTAL, ready: done === TOTAL };
}

async function tell(msg) {
  for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) c.postMessage({ type: 'bb-offline', ...msg });
}
