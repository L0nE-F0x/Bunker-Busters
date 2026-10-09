// Title cards, subtitles and labels for the trailer, rendered by Chrome in the game's own type
// (Big Shoulders Stencil, Chakra Petch, JetBrains Mono) as transparent 1920×1080 PNGs.
//   node scripts/promo/overlays.mjs <outdir> <specs.json>
// specs: [{ name, kind: 'card'|'logo'|'sub'|'label'|'endcard', ...fields }]
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { launch } from '../dev/browser.mjs';

const [OUT, SPECS] = process.argv.slice(2);
const specs = JSON.parse(fs.readFileSync(SPECS, 'utf8'));
// fonts inlined (a setContent page can't load file:// URLs)
const fsrc = (pkg, file) => 'data:font/woff2;base64,' + fs.readFileSync(fileURLToPath(new URL(`../../node_modules/@fontsource/${pkg}/files/${file}`, import.meta.url))).toString('base64');

const CSS = `
@font-face { font-family: 'BSS'; font-weight: 700; src: url('${fsrc('big-shoulders-stencil-display', 'big-shoulders-stencil-display-latin-700-normal.woff2')}'); }
@font-face { font-family: 'BSS'; font-weight: 900; src: url('${fsrc('big-shoulders-stencil-display', 'big-shoulders-stencil-display-latin-900-normal.woff2')}'); }
@font-face { font-family: 'CP'; font-weight: 500; src: url('${fsrc('chakra-petch', 'chakra-petch-latin-500-normal.woff2')}'); }
@font-face { font-family: 'CP'; font-weight: 600; src: url('${fsrc('chakra-petch', 'chakra-petch-latin-600-normal.woff2')}'); }
@font-face { font-family: 'CP'; font-weight: 700; src: url('${fsrc('chakra-petch', 'chakra-petch-latin-700-normal.woff2')}'); }
@font-face { font-family: 'JB'; font-weight: 400; src: url('${fsrc('jetbrains-mono', 'jetbrains-mono-latin-400-normal.woff2')}'); }
@font-face { font-family: 'JB'; font-weight: 600; src: url('${fsrc('jetbrains-mono', 'jetbrains-mono-latin-600-normal.woff2')}'); }
:root { --ink: #f3e9d8; --dim: #b9ab95; --amber: #ffb347; --hot: #ff7a1f; --teal: #3ff2e0; }
html, body { margin: 0; width: 1920px; height: 1080px; background: transparent; overflow: hidden; }
body { font-family: 'CP', sans-serif; color: var(--ink); position: relative; }
.grad { background: linear-gradient(180deg, #ffe0a6 0%, #ffb347 35%, #ff6a1a 70%, #b8300c 100%); -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 7px 0 rgba(60, 20, 5, 0.9)) drop-shadow(0 0 46px rgba(255, 106, 26, 0.38)); }
.center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.kicker { font-weight: 600; font-size: 40px; letter-spacing: 0.42em; text-transform: uppercase; color: var(--dim); margin: 0 0 6px 0.42em; text-shadow: 0 2px 10px rgba(0,0,0,0.8); }
.big { font-family: 'BSS'; font-weight: 900; font-size: 196px; line-height: 0.9; letter-spacing: 0.015em; }
.rule { width: 520px; height: 2px; margin: 34px auto 0; background: linear-gradient(90deg, transparent, var(--amber), transparent); opacity: 0.85; }
.logo { font-family: 'BSS'; font-weight: 900; line-height: 0.8; }
.logo span { display: block; font-size: 250px; }
.logo span + span { margin-left: 0.4em; }
.tag { font-size: 36px; letter-spacing: 0.3em; text-transform: uppercase; color: var(--dim); margin-top: 40px; text-shadow: 0 2px 8px #000; }
.tag b { color: var(--teal); font-weight: 600; }
.meta { font-family: 'JB'; font-size: 30px; letter-spacing: 0.24em; color: var(--teal); margin-top: 26px; text-transform: uppercase; }
.url { font-family: 'CP'; font-weight: 600; font-size: 56px; letter-spacing: 0.08em; color: var(--ink); margin-top: 18px; }
.pill .v { text-transform: none; }
.pill { display: inline-block; margin-top: 30px; padding: 12px 28px; border: 2px solid rgba(255, 179, 71, 0.55); background: linear-gradient(90deg, rgba(255,122,31,0.22), rgba(255,94,26,0.1)); font-weight: 700; font-size: 36px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--amber); }
.sub { position: absolute; left: 50%; bottom: 70px; transform: translateX(-50%); width: max-content; max-width: 1680px; text-align: center; padding: 18px 36px 22px; background: rgba(5,3,2,0.66); }
.sub .who { display: block; color: var(--amber); font-weight: 700; font-size: 28px; letter-spacing: 0.18em; text-transform: uppercase; margin-bottom: 4px; }
.sub .who.bot { color: var(--teal); }
.sub .line { font-weight: 600; font-size: 54px; line-height: 1.22; text-shadow: 0 2px 4px #000; }
.label { position: absolute; left: 96px; top: 84px; }
.keyart { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(8,5,3,0.86) 0%, rgba(8,5,3,0.55) 34%, rgba(8,5,3,0.0) 62%), linear-gradient(0deg, rgba(8,5,3,0.55) 0%, rgba(8,5,3,0) 26%); }
.keyart .blk { position: absolute; left: 110px; top: 50%; transform: translateY(-50%); }
.keyart .logo span { font-size: 190px; }
.keyart .tag { text-align: left; margin-top: 34px; font-size: 25px; }
.keyart .pill { font-size: 25px; }
.corner { position: absolute; right: 56px; bottom: 44px; font-family: 'JB'; font-size: 22px; letter-spacing: 0.22em; color: rgba(243,233,216,0.85); text-transform: uppercase; text-shadow: 0 2px 8px #000; }
.corner b { color: var(--amber); font-weight: 600; }
.label .k { font-family: 'JB'; font-size: 26px; letter-spacing: 0.3em; color: var(--teal); text-transform: uppercase; }
.label .n { font-family: 'BSS'; font-weight: 900; font-size: 92px; line-height: 0.95; letter-spacing: 0.02em; margin-top: 4px; }
.label .bar { width: 120px; height: 3px; background: var(--amber); margin-top: 12px; box-shadow: 0 0 12px rgba(255,138,42,0.6); }
.label .k, .label .n { text-shadow: 0 2px 10px rgba(0,0,0,0.7); }
`;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const html = (s) => {
  switch (s.kind) {
    case 'card':
      return `<div class="center">${s.kicker ? `<div class="kicker">${esc(s.kicker)}</div>` : ''}<div class="big ${s.plain ? '' : 'grad'}" style="${s.size ? `font-size:${s.size}px` : ''}">${esc(s.text)}</div>${s.rule ? '<div class="rule"></div>' : ''}</div>`;
    case 'logo':
      return `<div class="center" style="${s.y ? `transform:translateY(${s.y}px)` : ''}"><div class="logo grad"><span>BUNKER</span><span>BUSTERS</span></div>
        ${s.tag ? `<div class="tag">${s.tag}</div>` : ''}
        ${s.pill ? `<div class="pill">${s.pill}</div>` : ''}
        ${s.url ? `<div class="url">${esc(s.url)}</div>` : ''}
        ${s.meta ? `<div class="meta">${esc(s.meta)}</div>` : ''}</div>`;
    case 'sub':
      return `<div class="sub"><span class="who ${s.bot ? 'bot' : ''}">${esc(s.who)}</span><span class="line">${esc(s.text)}</span></div>`;
    case 'keyart':
      return `<div class="keyart"><div class="blk"><div class="logo grad"><span>BUNKER</span><span>BUSTERS</span></div>
        <div class="tag">${s.tag}</div>${s.pill ? `<div class="pill">${s.pill}</div>` : ''}${s.url ? `<div class="url" style="text-align:left">${esc(s.url)}</div>` : ''}</div></div>`;
    case 'corner':
      return `<div class="corner">${s.text}</div>`;
    case 'label':
      return `<div class="label"><div class="k">${esc(s.kicker)}</div><div class="n grad">${esc(s.text)}</div><div class="bar"></div></div>`;
    default:
      throw new Error('unknown kind ' + s.kind);
  }
};

const b = await launch(process.env.GPU_MODE || 'soft');
const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: +(process.env.SCALE || 1) });
fs.mkdirSync(OUT, { recursive: true });
for (const s of specs) {
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${html(s)}</body></html>`);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(80);
  await p.screenshot({ path: `${OUT}/${s.name}.png`, omitBackground: true });
  console.log('overlay', s.name);
}
await b.close();
