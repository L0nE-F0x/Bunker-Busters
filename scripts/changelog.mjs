// Print the CHANGELOG.md section for a version (without its heading). Exit 1 if there isn't one.
//   node scripts/changelog.mjs 0.1.1
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const v = (process.argv[2] ?? '').replace(/^v/, '');
const md = readFileSync(fileURLToPath(new URL('../CHANGELOG.md', import.meta.url)), 'utf8');
const m = md.match(new RegExp(`^## v${v.replace(/\./g, '\\.')}\\s*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'));
if (!v || !m || !m[1].trim()) {
  console.error(`CHANGELOG.md has no "## v${v}" section.`);
  process.exit(1);
}
console.log(m[1].trim());
