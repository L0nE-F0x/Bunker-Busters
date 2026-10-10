// Meshy API from the command line: make a character end to end, or one step at a time.
// The key is read from ~/.config/meshy/key at run time (never put it in the repo or a default).
// Task ids and credits go to Assets/meshy-tasks.json (git-ignored with the rest of Assets/ raw files).
//
//   node scripts/models/meshy.mjs balance
//   node scripts/models/meshy.mjs character <name> --prompt "…" [--lite] [--height 1.75] [--anims 318,364]
//       [--preview <id>] (reuse a mesh you've checked) [--texture "…"] (texture prompt) [--preview-only]
//       preview → refine (2k colour) → rig → optional library clips; downloads into Assets/:
//       Meshy_AI_<name>_Rigged.glb (+ _Animations.glb), and the preview thumbnail as a PNG
//   node scripts/models/meshy.mjs status <kind> <id>        kind: text-to-3d | rigging | animations
//   node scripts/models/meshy.mjs animate <name> <rigTaskId> <ids,…>
//
// Prices (2026-10): preview 20 (meshy-7.1) / 5 (meshy-6-lite), refine 10, rig 5, 3 per clip.
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const API = 'https://api.meshy.ai/openapi';
const KEY = fs.readFileSync(`${os.homedir()}/.config/meshy/key`, 'utf8').trim();
const ASSETS = fileURLToPath(new URL('../../Assets/', import.meta.url));
const LOG = ASSETS + 'meshy-tasks.json';

const [cmd, ...rest] = process.argv.slice(2);
const opt = (k, d = null) => { const i = rest.indexOf(`--${k}`); return i < 0 ? d : (rest[i + 1] ?? true); };
const flag = (k) => rest.includes(`--${k}`);

async function api(method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path}: HTTP ${r.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

function log(entry) {
  const all = fs.existsSync(LOG) ? JSON.parse(fs.readFileSync(LOG, 'utf8')) : [];
  all.push({ at: new Date().toISOString(), ...entry });
  fs.writeFileSync(LOG, JSON.stringify(all, null, 2));
}

/** Poll a task until it finishes. */
async function wait(kind, id, label) {
  let last = -1;
  for (;;) {
    const t = await api('GET', `/${kind === 'text-to-3d' ? 'v2' : 'v1'}/${kind}/${id}`);
    if (t.progress !== last) { last = t.progress; process.stdout.write(`\r[${label}] ${t.status} ${t.progress ?? 0}%   `); }
    if (t.status === 'SUCCEEDED') { process.stdout.write('\n'); return t; }
    if (t.status === 'FAILED' || t.status === 'CANCELED') throw new Error(`${label} ${t.status}: ${JSON.stringify(t.task_error)}`);
    await new Promise((ok) => setTimeout(ok, 6000));
  }
}

async function download(url, file) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${file}: HTTP ${r.status}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  console.log('  →', file.replace(ASSETS, 'Assets/'), `${(fs.statSync(file).size / 1e6).toFixed(1)} MB`);
}

async function animate(name, rig, ids) {
  const { result: id } = await api('POST', '/v1/animations', { rig_task_id: rig, action_ids: ids });
  log({ name, step: 'animations', id, ids });
  const t = await wait('animations', id, `${name} clips`);
  log({ name, step: 'animations.done', id, credits: t.consumed_credits });
  await download(t.result.animation_glb_url, `${ASSETS}Meshy_AI_${name}_Animations.glb`);
}

if (cmd === 'balance') {
  console.log(await api('GET', '/v1/balance'));
} else if (cmd === 'status') {
  console.log(JSON.stringify(await api('GET', `/${rest[0] === 'text-to-3d' ? 'v2' : 'v1'}/${rest[0]}/${rest[1]}`), null, 2));
} else if (cmd === 'animate') {
  await animate(rest[0], rest[1], rest[2].split(',').map(Number));
} else if (cmd === 'character') {
  const name = rest[0];
  const prompt = opt('prompt');
  if (!name || !prompt) throw new Error('character <name> --prompt "…"');
  const lite = flag('lite');
  // 1. the mesh: A-pose, remeshed to about the cast's 12k triangles
  const preview = opt('preview') || (await api('POST', '/v2/text-to-3d', {
    mode: 'preview', prompt, ai_model: lite ? 'meshy-6-lite' : 'meshy-7.1', topology: 'triangle',
    should_remesh: true, target_polycount: 12000, pose_mode: 'a-pose',
  })).result;
  log({ name, step: 'preview', id: preview, prompt, lite });
  const p = await wait('text-to-3d', preview, `${name} mesh`);
  log({ name, step: 'preview.done', id: preview, credits: p.consumed_credits });
  if (p.thumbnail_url) await download(p.thumbnail_url, `${ASSETS}Meshy_AI_${name}_preview.png`);
  if (flag('preview-only')) process.exit(0);
  // 2. the texture: colour only (the game uses nothing else)
  const tex = opt('texture');
  const { result: refine } = await api('POST', '/v2/text-to-3d', { mode: 'refine', preview_task_id: preview, texture_resolution: '2k', enable_pbr: false, ...(tex && tex !== true ? { texture_prompt: tex } : {}) });
  log({ name, step: 'refine', id: refine });
  const r = await wait('text-to-3d', refine, `${name} texture`);
  log({ name, step: 'refine.done', id: refine, credits: r.consumed_credits });
  if (r.thumbnail_url) await download(r.thumbnail_url, `${ASSETS}Meshy_AI_${name}_textured.png`);
  // 3. the rig (humanoid auto-rig)
  const { result: rig } = await api('POST', '/v1/rigging', { input_task_id: refine, height_meters: Number(opt('height', 1.75)) });
  log({ name, step: 'rig', id: rig });
  const g = await wait('rigging', rig, `${name} rig`);
  log({ name, step: 'rig.done', id: rig, credits: g.consumed_credits });
  await download(g.result.rigged_character_glb_url, `${ASSETS}Meshy_AI_${name}_Rigged.glb`);
  // the free walk and run that come with a humanoid rig
  const basic = g.result.basic_animations;
  if (basic?.walking_glb_url) await download(basic.walking_glb_url, `${ASSETS}Meshy_AI_${name}_Walking_Basic.glb`);
  if (basic?.running_glb_url) await download(basic.running_glb_url, `${ASSETS}Meshy_AI_${name}_Running_Basic.glb`);
  // 4. library clips, merged into one file
  const anims = opt('anims');
  if (anims && anims !== true) await animate(name, rig, String(anims).split(',').map(Number));
  console.log(await api('GET', '/v1/balance'));
} else {
  console.log('usage: balance | character <name> --prompt "…" [--lite] [--height m] [--anims ids] [--preview-only] | status <kind> <id> | animate <name> <rig> <ids>');
}
