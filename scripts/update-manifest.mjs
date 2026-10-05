// Build the in-app updater manifest (latest.json) for a release. Run by .github/workflows/release.yml
// after every platform has uploaded its assets and signatures.
//   node scripts/update-manifest.mjs v0.1.1 <dir with *.sig> latest.json
// The desktop app fetches releases/latest/download/latest.json and picks the entry matching how it
// was installed: `{os}-{arch}-{installer}`, falling back to `{os}-{arch}` (the plain tarball binary).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [tag, sigDir, out] = process.argv.slice(2);
if (!tag || !sigDir || !out) { console.error('usage: update-manifest.mjs <tag> <sigdir> <out.json>'); process.exit(1); }
const repo = process.env.GITHUB_REPOSITORY ?? 'L0nE-F0x/Bunker-Busters';
const base = `https://github.com/${repo}/releases/download/${tag}/`;
// updater target → [release asset, signature file]
const TARGETS = {
  'linux-x86_64': ['BunkerBusters-linux-x86_64-update.bin', 'linux-x86_64.sig'],
  'linux-x86_64-appimage': ['BunkerBusters-linux-x86_64.AppImage', 'linux-x86_64-appimage.sig'],
  'linux-x86_64-deb': ['BunkerBusters-linux-amd64.deb', 'linux-x86_64-deb.sig'],
  'windows-x86_64-nsis': ['BunkerBusters-windows-x64-setup.exe', 'windows-x86_64-nsis.sig'],
  'windows-x86_64': ['BunkerBusters-windows-x64-setup.exe', 'windows-x86_64-nsis.sig'],
};
const platforms = {};
for (const [target, [asset, sig]] of Object.entries(TARGETS)) {
  const f = join(sigDir, sig);
  if (!existsSync(f)) { console.error(`missing signature ${f}`); process.exit(1); }
  platforms[target] = { signature: readFileSync(f, 'utf8').trim(), url: base + asset };
}
const changelog = fileURLToPath(new URL('./changelog.mjs', import.meta.url));
const notes = execFileSync('node', [changelog, tag], { encoding: 'utf8' }).trim();
const manifest = { version: tag.replace(/^v/, ''), notes, pub_date: new Date().toISOString(), platforms };
writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${out}: ${manifest.version}, ${Object.keys(platforms).length} targets`);
