// Deliverable encodes for social sites, from the cuts' masters:
//   node scripts/promo/squeeze.mjs loop <in.mp4> <out.mp4> [maxMB=7.8]       two-pass H.264 under a size cap
//   node scripts/promo/squeeze.mjs gif <in.mp4> <out.gif> <start> <secs> [maxMB=4.9]   palette GIF, shrinks until it fits
//   node scripts/promo/squeeze.mjs x <in.mp4> <out.mp4>                        30 fps 1080p for X (its limit is 40 fps)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [mode, src, out, ...rest] = process.argv.slice(2);
const ff = (...a) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...a.flat()]);
const dur = (f) => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString();
const mb = (f) => fs.statSync(f).size / 1048576;
const tmp = fs.mkdtempSync(path.join(process.env.EVID || os.tmpdir(), 'sq-'));

if (mode === 'loop') {
  const cap = +(rest[0] || 7.8);
  const d = dur(src);
  let kbps = Math.min(9000, Math.floor((cap * 8 * 1024 * 0.97) / d - 128));
  for (let tries = 0; tries < 4; tries++) {
    const log = path.join(tmp, 'pass');
    const v = ['-c:v', 'libx264', '-preset', 'slow', '-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.5)}k`, '-bufsize', `${kbps * 2}k`, '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-passlogfile', log];
    ff('-i', src, v, '-pass', '1', '-an', '-f', 'null', '/dev/null');
    ff('-i', src, v, '-pass', '2', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out);
    if (mb(out) <= cap) break;
    kbps = Math.floor(kbps * 0.9);
  }
  console.log(`${path.basename(out)}: ${d.toFixed(1)} s, ${mb(out).toFixed(2)} MB at ${kbps} kb/s`);
} else if (mode === 'gif') {
  const [start, secs, capArg] = rest;
  const cap = +(capArg || 4.9);
  const pal = path.join(tmp, 'pal.png');
  for (const [w, fps] of [[640, 15], [600, 15], [560, 14], [520, 12], [480, 12], [420, 10]]) {
    const f = `fps=${fps},scale=${w}:-2:flags=lanczos`;
    ff('-ss', start, '-t', secs, '-i', src, '-vf', `${f},palettegen=max_colors=192:stats_mode=diff`, pal);
    ff('-ss', start, '-t', secs, '-i', src, '-i', pal, '-lavfi', `${f}[x];[x][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle`, '-loop', '0', out);
    if (mb(out) <= cap) { console.log(`${path.basename(out)}: ${w}px ${fps} fps, ${mb(out).toFixed(2)} MB`); break; }
  }
  if (mb(out) > cap) console.log(`${path.basename(out)}: still ${mb(out).toFixed(2)} MB (over ${cap})`);
} else if (mode === 'x') {
  ff('-i', src, '-vf', 'fps=30,scale=1920:-2:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-maxrate', '12M', '-bufsize', '24M',
    '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out);
  console.log(`${path.basename(out)}: ${dur(out).toFixed(1)} s, ${mb(out).toFixed(1)} MB`);
} else {
  console.log('modes: loop | gif | x');
}
fs.rmSync(tmp, { recursive: true });
