// Regenerate the 1200×630 social share card public/og.jpg from debug/og.html (uses public/media/hero.jpg).
// Needs `npm run dev`. Link previews are cached by Discord/Facebook/etc. — re-scrape after changing it.
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';
// dev server origin (BB_PORT=5183 for a second server, e.g. from a worktree)
const ORIGIN = `http://localhost:${process.env.BB_PORT || 5173}`;

const out = fileURLToPath(new URL('../../public/og.jpg', import.meta.url));
const b = await launch('soft');
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.goto(ORIGIN + '/debug/og.html', { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__ready === true);
await p.waitForTimeout(300);
await p.screenshot({ path: out, type: 'jpeg', quality: 88 });
console.log('saved', out);
await b.close();
