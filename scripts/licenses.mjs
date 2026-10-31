// Third-party licences for everything Bunker Busters ships, as one plain-text file:
//   1. the JavaScript bundled into the game (the site, /play/ and the desktop app ship the same build),
//   2. the Rust crates linked into the desktop app, for Linux and Windows (`cargo metadata` per target,
//      normal dependencies only: build scripts, proc-macros and dev-only crates aren't in the binary),
//   3. what else is in the downloads: the WebView2 loader, the AppImage's system libraries, the voices.
// It writes public/licenses.txt: the site serves it at /licenses.txt, the desktop app has it built in
// (at /licenses.txt inside the app), Tauri copies it next to the installed program (`bundle.resources`)
// and release.yml puts it in the Linux tarball. No dates and everything sorted, so a rerun with the
// same lockfiles gives the same bytes.
//
//   node scripts/licenses.mjs           regenerate public/licenses.txt
//   node scripts/licenses.mjs --check   exit 1 if public/licenses.txt is out of date
//
// Needs node_modules and the crates' sources in ~/.cargo/registry: any desktop build has them, or run
// `cargo fetch --manifest-path src-tauri/Cargo.toml` (it fetches for every target, Windows included).
// A crate that offers MIT among alternatives ("MIT OR Apache-2.0") is used under MIT, and only its MIT
// text is listed. MIT texts are grouped by their terms, with each crate's copyright lines listed above.
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'public', 'licenses.txt');
const CHECK = process.argv.includes('--check');
const TARGETS = ['x86_64-unknown-linux-gnu', 'x86_64-pc-windows-msvc'];
const RULE = '='.repeat(78);
const rule = (c = '-') => c.repeat(78);
// plain code-point order (localeCompare depends on the machine's locale)
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const cmpVersion = (a, b) => {
  const pa = a.split(/[.+-]/), pb = b.split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '', y = pb[i] ?? '';
    const d = /^\d+$/.test(x) && /^\d+$/.test(y) ? Number(x) - Number(y) : cmp(x, y);
    if (d) return d;
  }
  return 0;
};

// ---- texts --------------------------------------------------------------------------------------
const clean = (t) =>
  t.replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ')
    .split('\n').map((l) => l.replace(/\s+$/, '')).join('\n')
    .replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
const flat = (t) => t.replace(/\s+/g, ' ').trim();

const MIT_TERMS = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

const BSD3_TERMS = `Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;

// The Microsoft WebView2 SDK's licence (nuget.org/packages/Microsoft.Web.WebView2, License tab). The
// Windows app links the SDK's WebView2LoaderStatic.lib through the webview2-com-sys crate.
const WEBVIEW2_SDK = `Copyright (C) Microsoft Corporation. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer
in the documentation and/or other materials provided with the
distribution.
   * The name of Microsoft Corporation, or the names of its contributors
may not be used to endorse or promote products derived from this
software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;

const LGPL21 = readFileSync(join(ROOT, 'scripts', 'licenses', 'LGPL-2.1.txt'), 'utf8');

// ---- licence files on disk ------------------------------------------------------------------------
const LICENSE_FILE = /^(licen[cs]e|copying|copyright|notice|unlicense)/i;
function licenseFiles(dir) {
  return readdirSync(dir)
    .filter((f) => LICENSE_FILE.test(f) && !/\.(spdx|rs|toml|json|html?)$/i.test(f) && statSync(join(dir, f)).isFile())
    .sort()
    .map((f) => ({ name: f, text: clean(readFileSync(join(dir, f), 'utf8')) }))
    .filter((f) => f.text);
}
const isMit = (f) => /(^|[-_.])mit([-_.]|$)/i.test(f.name) || /Permission is hereby granted, free of charge/i.test(f.text);
const isApache = (f) => /apache/i.test(f.name) || (/Apache License/i.test(f.text) && /Version 2\.0/.test(f.text) && /TERMS AND CONDITIONS/.test(f.text));
const isMpl = (f) => /Mozilla Public License,? (Version|v\.?) ?2\.0/i.test(f.text) && /1\. Definitions/.test(f.text);

/** Splits an MIT text into its notice (copyright lines) and the licence terms, or null if it doesn't
 *  look like a plain MIT text (then it's listed whole). */
function splitMit(text) {
  const i = text.search(/Permission is hereby granted, free of charge,/i);
  if (i < 0) return null;
  const terms = text.slice(i);
  const end = [...terms.matchAll(/DEALINGS\s+IN\s+THE\s+SOFTWARE\.?/gi)].pop();
  if (!end || terms.slice(end.index + end[0].length).trim()) return null;
  const notice = text.slice(0, i).split('\n').map((l) => l.trim())
    .filter((l) => l && !/^(the\s+)?mit\s+licen[cs]e(\s*\(mit\))?[:.]?$/i.test(l) && !/^[-=]{3,}$/.test(l));
  if (notice.join(' ').length > 600) return null;
  return { notice, terms: clean(terms.split('\n').map((l) => l.trim()).join('\n')) };
}

// ---- 1. the game's JavaScript -----------------------------------------------------------------------
function jsPackages() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const seen = new Map();
  const visit = (name) => {
    if (seen.has(name)) return;
    const dir = join(ROOT, 'node_modules', name);
    if (!existsSync(join(dir, 'package.json'))) throw new Error(`node_modules/${name} is missing: run npm ci first`);
    const j = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const files = licenseFiles(dir);
    if (!files.length) throw new Error(`${name} has no licence file`);
    seen.set(name, { name, version: j.version, license: j.license, homepage: j.homepage, files });
    for (const dep of Object.keys(j.dependencies ?? {})) visit(dep);
  };
  for (const name of Object.keys(pkg.dependencies ?? {})) visit(name);
  return [...seen.values()].sort((a, b) => cmp(a.name, b.name));
}

// Vite adds its module-preload helper to every page's bundle; only Vite's own MIT licence applies to
// that (its LICENSE.md goes on to list what the Vite package itself bundles, which we don't ship).
function viteHelper() {
  const dir = join(ROOT, 'node_modules', 'vite');
  const j = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const md = clean(readFileSync(join(dir, 'LICENSE.md'), 'utf8'));
  const core = clean(md.split(/^# Licenses of bundled dependencies/m)[0].split('\n').filter((l) => !l.startsWith('#')).join('\n'));
  if (!/Permission is hereby granted/.test(core)) throw new Error('node_modules/vite/LICENSE.md changed shape: check viteHelper()');
  return { name: 'vite', version: j.version, license: 'MIT', homepage: 'https://vite.dev', files: [{ name: 'LICENSE.md', text: core }] };
}

// ---- 2. the desktop app's Rust crates ---------------------------------------------------------------
function crates() {
  const all = new Map();
  for (const target of TARGETS) {
    const meta = JSON.parse(execFileSync('cargo', ['metadata', '--format-version', '1', '--offline', '--filter-platform', target], {
      cwd: join(ROOT, 'src-tauri'), encoding: 'utf8', maxBuffer: 256 << 20,
    }));
    const pkgs = new Map(meta.packages.map((p) => [p.id, p]));
    const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
    const seen = new Set();
    const todo = [meta.resolve.root];
    while (todo.length) {
      const id = todo.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      for (const dep of nodes.get(id).deps) {
        if (!dep.dep_kinds.some((k) => k.kind === null)) continue; // build-/dev-only edge
        if (pkgs.get(dep.pkg).targets.some((t) => t.kind.includes('proc-macro'))) continue; // runs in the compiler
        todo.push(dep.pkg);
      }
    }
    seen.delete(meta.resolve.root);
    for (const id of seen) {
      const p = pkgs.get(id);
      const key = `${p.name} ${p.version}`;
      if (!all.has(key)) all.set(key, { ...p, platforms: new Set() });
      all.get(key).platforms.add(target.includes('windows') ? 'Windows' : 'Linux');
    }
  }
  return [...all.values()].sort((a, b) => cmp(a.name, b.name) || cmpVersion(a.version, b.version));
}

const holders = (p) => {
  const names = (p.authors ?? []).map((a) => a.replace(/\s*<[^>]*>/g, '').trim()).filter(Boolean);
  return names.length ? names.join(', ') : `the ${p.name} authors${p.repository ? ` (${p.repository})` : ''}`;
};

/** The licence texts a crate is used under, chosen from its files by its SPDX expression. */
function crateTexts(p, canon) {
  const dir = dirname(p.manifest_path);
  if (!existsSync(dir)) throw new Error(`${p.name} ${p.version}: no sources in ${dir}. Run: cargo fetch --manifest-path src-tauri/Cargo.toml`);
  const files = licenseFiles(dir);
  const expr = (p.license ?? '').replace(/\s*\/\s*/g, ' OR ').trim();
  if (!expr) throw new Error(`${p.name} ${p.version} declares no licence`);
  // a plain choice ("A OR B OR C") picks one; anything with AND or brackets needs every file it ships
  const terms = /\bAND\b|\(/.test(expr) ? [expr] : expr.split(/\s+OR\s+/);
  let chosen = files;
  let used = expr;
  if (terms.length > 1) {
    const mit = files.filter(isMit);
    const apache = files.filter((f) => isApache(f) || /^notice/i.test(f.name));
    if (terms.includes('MIT') && mit.length) [chosen, used] = [mit, 'MIT'];
    else if (terms.includes('Apache-2.0') && apache.length) [chosen, used] = [apache, 'Apache-2.0'];
    else if (!files.length) used = terms.includes('MIT') ? 'MIT' : terms.includes('Apache-2.0') ? 'Apache-2.0' : terms[0];
  }
  if (chosen.length) return { used, texts: chosen.map((f) => f.text) };
  // no licence file in the published crate: write the notice from its metadata
  const who = holders(p);
  if (used === 'MIT') return { used, texts: [`Copyright (c) ${who}\n\n${MIT_TERMS}`] };
  if (used === 'BSD-3-Clause') return { used, texts: [`Copyright (c) ${who}\nAll rights reserved.\n\n${BSD3_TERMS}`] };
  if (used === 'MPL-2.0' && canon.mpl) return { used, texts: [canon.mpl] };
  if (used === 'Apache-2.0' && canon.apache) return { used, texts: [canon.apache] };
  throw new Error(`${p.name} ${p.version} (${expr}) ships no licence file and there's no template for it: add one to scripts/licenses.mjs`);
}

// ---- output ---------------------------------------------------------------------------------------
function render() {
  const out = [];
  const say = (...lines) => out.push(...lines);
  const wrap = (s, indent = '') => {
    const words = s.split(/\s+/);
    const lines = [];
    let line = indent;
    for (const w of words) {
      if (line.trim() && (line + ' ' + w).length > 78) { lines.push(line); line = indent + w; } else line = line.trim() ? `${line} ${w}` : indent + w;
    }
    if (line.trim()) lines.push(line);
    return lines.join('\n');
  };
  const heading = (t) => say('', '', RULE, t, RULE, '');
  const sub = (t) => say('', t, rule(), '');

  say('BUNKER BUSTERS: THIRD-PARTY LICENCES', RULE, '',
    wrap('Bunker Busters is built on the open-source software listed below. This file covers every download: the game in the browser, the Windows and Linux apps, and the Linux AppImage. Each item is used under the licence shown with it.'),
    '', 'Website: https://bunker-busters.netlify.app/',
    'Source and bug reports: https://github.com/L0nE-F0x/Bunker-Busters', '',
    'Contents',
    '  1. The game (browser, phone and desktop)',
    '  2. The desktop app: Rust crates',
    '  3. The desktop app: other components',
    '  4. Voices');

  // 1
  heading('1. THE GAME (browser, phone and desktop)');
  say(wrap('The game itself is the same JavaScript build everywhere. It includes these libraries and fonts:'));
  for (const p of [...jsPackages(), viteHelper()]) {
    sub(`${p.name} ${p.version} (${p.license})${p.homepage ? `  ${p.homepage}` : ''}`);
    if (p.name === 'vite') say(wrap('Only the small module-preload helper Vite adds to each page is shipped.'), '');
    say(p.files.map((f) => f.text).join('\n\n'));
  }

  // 2
  heading('2. THE DESKTOP APP: RUST CRATES');
  say(wrap('The Windows and Linux apps are built with Tauri and link the Rust crates below (marked [Linux] or [Windows] where a crate is in one build only). Where a crate offers a choice of licences that includes MIT, it is used under MIT.'));
  const list = crates();
  const canon = {};
  for (const p of list) {
    const dir = dirname(p.manifest_path);
    if (!existsSync(dir)) continue;
    for (const f of licenseFiles(dir)) {
      if (!canon.mpl && isMpl(f)) canon.mpl = f.text;
      if (!canon.apache && isApache(f) && /^\s*Apache License/.test(f.text)) canon.apache = f.text;
    }
  }
  const mitGroups = new Map(); // flat terms -> { terms, crates: [[label, notice]] }
  const textGroups = new Map(); // flat text -> { text, used: Set, crates: [label] }
  const mpl = [];
  for (const p of list) {
    const only = p.platforms.size === 1 ? ` [${[...p.platforms][0]}]` : '';
    const label = `${p.name} ${p.version}${only}`;
    const { used, texts } = crateTexts(p, canon);
    if (used.includes('MPL')) mpl.push(p);
    for (const text of texts) {
      const mit = splitMit(text);
      if (mit) {
        const k = flat(mit.terms);
        if (!mitGroups.has(k)) mitGroups.set(k, { terms: mit.terms, crates: [] });
        mitGroups.get(k).crates.push([label, mit.notice]);
      } else {
        const k = flat(text);
        if (!textGroups.has(k)) textGroups.set(k, { text, used: new Set(), crates: [] });
        textGroups.get(k).used.add(used);
        textGroups.get(k).crates.push(label);
      }
    }
  }
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const mits = [...mitGroups.values()].sort((a, b) => b.crates.length - a.crates.length || cmp(a.crates[0][0], b.crates[0][0]));
  mits.forEach((g, i) => {
    sub(`MIT License${mits.length > 1 ? ` (wording ${i + 1} of ${mits.length})` : ''}: ${plural(g.crates.length, 'crate')}`);
    say(wrap('Each crate is listed with the copyright notice from its licence file. The licence terms follow the list.'), '');
    for (const [label, notice] of g.crates) {
      say(`* ${label}`);
      for (const l of notice) say(wrap(l, '    '));
    }
    say('', g.terms);
  });
  const others = [...textGroups.values()].sort((a, b) => b.crates.length - a.crates.length || cmp(a.crates[0], b.crates[0]));
  for (const g of others) {
    sub(`${[...g.used].sort(cmp).join(' / ')}: ${plural(g.crates.length, 'crate')}`);
    say(wrap(`Used by: ${g.crates.join(', ')}`), '', g.text);
  }
  if (mpl.length) {
    sub('Source code of the MPL-2.0 crates');
    say(wrap('These crates are covered by the Mozilla Public License 2.0 (text above). They are used unmodified; their source code is on crates.io:'), '');
    for (const p of mpl) say(`* ${p.name} ${p.version}: https://crates.io/crates/${p.name}/${p.version}`);
  }

  // 3
  heading('3. THE DESKTOP APP: OTHER COMPONENTS');
  sub('Web view (all desktop builds)');
  say(wrap('The app draws the game with the web view your system already has: Microsoft Edge WebView2 on Windows, WebKitGTK on Linux. The Windows installer downloads WebView2 from Microsoft if it is missing; the .deb and the tarball use your distribution\'s WebKitGTK. Neither is part of those downloads.'));
  sub('Microsoft WebView2 SDK: WebView2LoaderStatic.lib (Windows app)');
  say(wrap('The Windows app links the WebView2 loader from the Microsoft.Web.WebView2 SDK (through the webview2-com-sys crate):'), '', WEBVIEW2_SDK);
  sub('Windows installer');
  say(wrap('The installer is built with NSIS (zlib/libpng licence, https://nsis.sourceforge.io) and Tauri\'s NSIS plugins (MIT or Apache-2.0).'));
  sub('Linux AppImage: bundled system libraries');
  say(wrap('The AppImage also carries the libraries the app needs to run on any distribution, copied unmodified from Ubuntu 22.04 LTS ("jammy"): WebKitGTK and JavaScriptCore, GTK 3, GLib, libsoup and the libraries they use. Most of them are under the GNU Lesser General Public License 2.1 or later (text below); the rest are under permissive licences listed in the copyright file of the Ubuntu package each came from (/usr/share/doc/<package>/copyright).'), '',
    wrap('Their source code is Ubuntu\'s jammy source packages (https://launchpad.net/ubuntu/jammy, or `apt-get source <package>` on Ubuntu 22.04). If you would rather have it from us, open an issue at https://github.com/L0nE-F0x/Bunker-Busters/issues and we will send a copy of the sources for any AppImage we have published. The AppImage runtime itself is MIT-licensed (https://github.com/AppImage/type2-runtime).'),
    '', LGPL21.trim());

  // 4
  heading('4. VOICES');
  say(wrap('Every spoken line was rendered ahead of time with the Kokoro-82M text-to-speech model (https://huggingface.co/hexgrad/Kokoro-82M, Apache License 2.0). The game ships only the recorded lines, not the model.'));
  say('');
  return out.join('\n').replace(/\n{4,}/g, '\n\n\n') + '\n';
}

const text = render();
if (CHECK) {
  const now = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (now !== text) {
    console.error('public/licenses.txt is out of date: run node scripts/licenses.mjs and commit it.');
    process.exit(1);
  }
  console.log('public/licenses.txt is up to date.');
} else {
  const before = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  writeFileSync(OUT, text);
  console.log(`${before === text ? 'unchanged' : 'wrote'} public/licenses.txt (${(text.length / 1024).toFixed(0)} KB)`);
}
