// Contact sheet of the prop lab (debug/props.ts; needs the dev server). Iterate on world props with this.
//   node scripts/dev/props-lab.mjs sheet.png "what=car&kind=sedan" "what=car&kind=pickup&yaw=2.4" ...
// Each query renders one 960x600 tile; tiles go two per row. DEV_ORIGIN=http://localhost:5185 picks another dev server.
import { launch } from './browser.mjs';

const [out = 'props.png', ...qs] = process.argv.slice(2);
if (!qs.length) qs.push('what=car');
const b = await launch();
const p = await b.newPage({ viewport: { width: 960, height: 600 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
p.on('console', (m) => {
  if (m.type() === 'error' && !/GL Driver/.test(m.text())) console.log('[console.error]', m.text().slice(0, 300));
  else if (m.text().startsWith('[lab]')) console.log(m.text());
});
const shots = [];
for (const q of qs) {
  await p.goto((process.env.DEV_ORIGIN ?? 'http://localhost:5173') + '/debug/props.html?' + q);
  await p.waitForFunction(() => window.__done, null, { timeout: 60000 });
  await p.waitForTimeout(300);
  shots.push(await p.screenshot());
}
const cols = Math.min(2, shots.length);
const sheet = await b.newPage({ viewport: { width: 960 * cols, height: 600 * Math.ceil(shots.length / cols) } });
await sheet.setContent(`<body style="margin:0;display:grid;grid-template-columns:repeat(${cols},960px)">` + shots.map((s, i) => `<div style="position:relative"><img src="data:image/png;base64,${s.toString('base64')}"><span style="position:absolute;left:8px;top:6px;color:#fff;font:14px monospace;background:#0008;padding:2px 6px">${qs[i]}</span></div>`).join('') + '</body>');
await sheet.screenshot({ path: out, fullPage: true });
console.log('saved', out);
await b.close();
