// First-load benchmark for the browser build: serves `dist/` the way Netlify does (netlify.toml's
// [[headers]], ETag revalidation, brotli for text types only) and loads /play/ headlessly through a
// throttled network, cold and then warm (same browser cache). Run `npm run build` first.
//
//   node scripts/dev/load-bench.mjs [--mbit 20] [--latency 40] [--runs 1] [--phone] [--cpu 1] [--no-warm]
//     [--dist other/dist --toml other/netlify.toml] [--json out.json]   (A/B against another build)
//
// Prints, per run: time to the title (boot done), to "playing" and to the first frame of play,
// the loading-bar timeline, bytes over the wire by type, and the longest main-thread tasks.
// --phone: 844×390 touch emulation (?touch=1), defaults to 10 Mbit / 70 ms / 4× CPU slowdown.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const phone = args.includes('--phone');
const mbit = Number(opt('--mbit', phone ? 10 : 20));
const latency = Number(opt('--latency', phone ? 70 : 40));
const cpu = Number(opt('--cpu', phone ? 4 : 1));
const runs = Number(opt('--runs', 1));
const warm = !args.includes('--no-warm');
const root = fileURLToPath(new URL('../../', import.meta.url));
const dist = path.resolve(root, opt('--dist', 'dist'));
if (!fs.existsSync(path.join(dist, 'play/index.html'))) { console.log('no dist/: run npm run build first'); process.exit(1); }

// ---- netlify.toml [[headers]] (simple `for = "/x/*"` patterns are all we use)
const rules = [];
{
  const toml = fs.readFileSync(path.resolve(root, opt('--toml', 'netlify.toml')), 'utf8');
  for (const block of toml.split('[[headers]]').slice(1)) {
    const f = /for\s*=\s*"([^"]+)"/.exec(block)?.[1];
    if (!f) continue;
    const h = {};
    for (const m of block.matchAll(/^\s*([A-Za-z-]+)\s*=\s*"([^"]*)"/gm)) if (m[1] !== 'for') h[m[1]] = m[2];
    const re = new RegExp('^' + f.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    rules.push({ re, h });
  }
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm', '.glb': 'application/octet-stream', '.bin': 'application/octet-stream' };
const TEXT = /^(text\/|application\/(json|javascript|manifest\+json|wasm)|image\/svg)/; // what Netlify compresses
const brCache = new Map();
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(dist, p);
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
  let body = fs.readFileSync(file);
  const etag = '"' + crypto.createHash('md5').update(body).digest('hex') + '"';
  const headers = { 'content-type': type, etag, 'cache-control': 'public,max-age=0,must-revalidate' };
  for (const r of rules) if (r.re.test(p)) for (const [k, v] of Object.entries(r.h)) headers[k.toLowerCase()] = v;
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return; }
  if (TEXT.test(type) && /\bbr\b/.test(req.headers['accept-encoding'] ?? '')) {
    if (!brCache.has(file)) brCache.set(file, zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }));
    body = brCache.get(file);
    headers['content-encoding'] = 'br';
  }
  headers['content-length'] = body.length;
  res.writeHead(200, headers);
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
console.log(`serving dist on ${base} · ${mbit} Mbit/s, ${latency} ms, CPU ×${cpu}${phone ? ', phone' : ''}`);

const INIT = () => {
  window.__bench = { marks: [], long: [] };
  const t0 = performance.timeOrigin;
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__bench.long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true });
  let last = '';
  const poll = () => {
    const m = document.querySelector('.msg')?.textContent ?? '';
    const w = document.querySelector('.bar i')?.style.width ?? '';
    const k = `${m} ${w}`;
    if (m && k !== last) { last = k; window.__bench.marks.push([Math.round(performance.now()), w, m]); }
    const g = typeof window.game?.mode === 'string' ? window.game : null; // (window.game is the canvas until the Game exists)
    if (g && !window.__bench.title && g.mode !== 'loading') window.__bench.title = performance.now();
    if (g && !window.__bench.playing && g.mode === 'playing') { window.__bench.playing = performance.now(); window.__bench.f0 = g.frames; }
    if (g && window.__bench.playing && !window.__bench.play1 && g.frames >= window.__bench.f0 + 2) window.__bench.play1 = performance.now();
    if (!window.__bench.play1) setTimeout(poll, 10);
  };
  poll();
  void t0;
};

function kind(url, mime) {
  const e = path.extname(new URL(url).pathname);
  if (e === '.glb') return 'glb';
  if (e === '.mp3') return 'voice';
  if (e === '.js') return 'js';
  if (e === '.css') return 'css';
  if (e === '.wasm' || /wasm/.test(mime)) return 'wasm';
  if (/font/.test(mime) || /\.woff2?$/.test(e)) return 'font';
  if (/image/.test(mime)) return 'image';
  if (/html/.test(mime)) return 'html';
  return 'other';
}

const b = await launch();
const results = [];
for (let r = 0; r < runs; r++) {
  const ctx = await b.newContext(phone ? {
    viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  } : { viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/GL Driver/.test(m.text())) console.log('[console.error]', m.text().slice(0, 200));
    else if (/warm/.test(m.text())) console.log('  ', m.text().slice(0, 200));
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency, downloadThroughput: (mbit * 1e6) / 8, uploadThroughput: (5e6) / 8 });
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  for (const pass of warm ? ['cold', 'warm'] : ['cold']) {
    const reqs = new Map();
    const onResp = (e) => reqs.set(e.requestId, { url: e.response.url, mime: e.response.mimeType, status: e.response.status, cached: e.response.fromDiskCache || e.response.fromMemoryCache });
    const onDone = (e) => { const q = reqs.get(e.requestId); if (q) q.bytes = e.encodedDataLength; };
    const onCache = (e) => { const q = reqs.get(e.requestId); if (q) q.cached = true; };
    cdp.on('Network.responseReceived', onResp);
    cdp.on('Network.loadingFinished', onDone);
    cdp.on('Network.requestServedFromCache', onCache);
    const url = `${base}/play/?webgl&autostart${phone ? '&touch=1' : ''}`;
    await page.goto(url);
    await page.waitForFunction(() => window.__bench?.play1, null, { timeout: 300000, polling: 200 });
    await page.waitForTimeout(500);
    const B = await page.evaluate(() => window.__bench);
    cdp.off('Network.responseReceived', onResp);
    cdp.off('Network.loadingFinished', onDone);
    cdp.off('Network.requestServedFromCache', onCache);
    const by = {};
    let n304 = 0, nCached = 0;
    for (const q of reqs.values()) {
      const k = kind(q.url, q.mime);
      by[k] ??= { n: 0, bytes: 0 };
      by[k].n++;
      by[k].bytes += q.bytes ?? 0;
      if (q.status === 304) n304++;
      if (q.cached) nCached++;
    }
    const long = [...B.long].sort((a, z) => z[1] - a[1]);
    const res = { run: r, pass, title: B.title, playing: B.playing, play1: B.play1, by, n304, nCached, reqs: reqs.size, longTotal: long.reduce((s, x) => s + x[1], 0), long: long.slice(0, 6), marks: B.marks };
    results.push(res);
    console.log(`\n== ${pass} (run ${r + 1}) ==`);
    console.log(`title ${(B.title / 1000).toFixed(2)} s · playing ${(B.playing / 1000).toFixed(2)} s · first play frame ${(B.play1 / 1000).toFixed(2)} s`);
    console.log(`requests ${reqs.size} (${nCached} from cache, ${n304} revalidated 304)`);
    console.log('bytes:', Object.entries(by).sort((a, z) => z[1].bytes - a[1].bytes).map(([k, v]) => `${k} ${(v.bytes / 1e6).toFixed(2)} MB/${v.n}`).join(' · '));
    console.log(`long tasks: total ${(res.longTotal / 1000).toFixed(2)} s; top ${res.long.map(([s, d]) => `${d}ms@${(s / 1000).toFixed(1)}s`).join(', ')}`);
    console.log('bar:', B.marks.map(([t, w, m]) => `${(t / 1000).toFixed(2)}s ${w} ${m.toLowerCase()}`).join(' | '));
  }
  await ctx.close();
}
const outFile = opt('--json', null);
if (outFile) fs.writeFileSync(outFile, JSON.stringify(results, null, 1));
await b.close();
server.close();
