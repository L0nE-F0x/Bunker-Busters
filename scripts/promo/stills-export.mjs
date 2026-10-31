// Export picked stills in the three sizes a press/social kit needs: the 2560×1440 PNG, a 1920×1080
// JPEG, and a 1:1 crop at 1080×1080 (its window placed per still, `sq` = centre x, 0…1).
//   node scripts/promo/stills-export.mjs <picks.json> <outdir>
// picks: [{ name, src, sq?, grade? }]  src: a 2560×1440 PNG; grade: an ImageMagick tweak string
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [PICKS, OUT] = process.argv.slice(2);
const picks = JSON.parse(fs.readFileSync(PICKS, 'utf8'));
for (const d of ['2560x1440', '1920x1080', '1080x1080']) fs.mkdirSync(path.join(OUT, d), { recursive: true });
const m = (...a) => execFileSync('magick', a.flat().filter(Boolean));
for (const p of picks) {
  const grade = p.grade ? p.grade.split(' ') : [];
  const big = path.join(OUT, '2560x1440', `${p.name}.png`);
  m(p.src, '-resize', '2560x1440!', grade, '-strip', big);
  m(big, '-filter', 'Lanczos', '-resize', '1920x1080', '-strip', '-quality', '92', path.join(OUT, '1920x1080', `${p.name}.jpg`));
  const x = Math.round(Math.min(1, Math.max(0, p.sq ?? 0.5)) * (2560 - 1440));
  m(big, '-crop', `1440x1440+${x}+0`, '+repage', '-filter', 'Lanczos', '-resize', '1080x1080', '-strip', '-quality', '92', path.join(OUT, '1080x1080', `${p.name}.jpg`));
  console.log('still', p.name);
}
