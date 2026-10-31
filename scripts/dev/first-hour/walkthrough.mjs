// Agent C's first-hour walkthrough with real input (keyboard + mouse clicks), as a stranger:
// title → New Game → Take the radio → the briefing → the note → follow the marker to the Garage →
// pick the gate (by feel) → the yard → back at the fire → radio Mara → Act II → Dry Creek. Checks that
// the guidance names the controls actually bound, that the objective, its marker and the world agree,
// and that nothing talks over the radio. Then a rebind (crouch → Z), a pad and Continue.
//   node scripts/dev/first-hour/walkthrough.mjs [shotsDir]   (BB_PORT / DEV_ORIGIN, OUT, GPU_MODE as elsewhere)
import { start, newRun, clickEl, textOf, waitForGame } from './lib.mjs';
import { walkTo } from './nav.mjs';
import { playLockpick } from './mini.mjs';

const g = await start('', { shots: process.argv[2] || 'walk' });
const { p, ev, wait, shot, say, drain } = g;
const results = [];
const check = (name, ok, extra = '') => { results.push([name, !!ok]); say(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`); };
const events = () => ev(() => window.__all.slice());
const said = async (re) => (await events()).some(([, k, s]) => re.test(s));
const objective = async () => (await textOf(p, '#hud .objective .text'));
try {
  // ---------------------------------------------------------------- the radio
  await newRun(g, 'infiltrator');
  await wait(2200);
  const brief = await ev(() => window.__ev.filter(([, k]) => k === 'pages').map(([, , s]) => s).join(' '));
  check('briefing names no keys', !/\bTab is your kit|K your skills|J your journal/.test(brief));
  await shot('after-radio');
  check('menus toast in bound keys', await said(/^Tab kit · K skills · J journal · M map · Esc pause\./), (await events()).filter(([, k]) => k === 'toast').map(([, , s]) => s).join(' / '));
  check('no camp discovery banner over LAST CHANCE', !(await said(/^LAST CHANCE GAS \|/)));
  check('objective: the note', /note on the pump island/.test(await objective()), await objective());
  // toasts sit under the objective box
  const lay = await ev(() => { const o = document.querySelector('#hud .objective').getBoundingClientRect(); const t = document.querySelector('#hud .toasts').getBoundingClientRect(); return { ob: Math.round(o.bottom), tt: Math.round(t.top) }; });
  check('toasts start below the objective', lay.tt >= lay.ob, JSON.stringify(lay));
  // ---------------------------------------------------------------- the note, by its prompt
  const note = await ev(() => { const it = game.interactables.find((i) => i.id === 'intel.gas.note'); return [it.pos.x, it.pos.y, it.pos.z]; });
  check('walked to the note', (await walkTo(p, note[0], note[2], { stop: 1.6, say })).ok);
  await ev(([x, y, z]) => window.__lookAt(x, y, z), note);
  await wait(400);
  check('prompt names E', /^E\s*Read: Note on the Pump/.test((await textOf(p, '#hud .prompt')).replace(/\n/g, ' ')), await textOf(p, '#hud .prompt'));
  await p.keyboard.press('KeyE'); await wait(1200);
  await shot('note');
  await clickEl(p, '.intel-reader .btn'); await wait(900);
  await p.mouse.click(640, 360); await wait(600);
  check('objective: find the Garage, north-east', /Find the Garage\. Northeast of camp/.test(await objective()), await objective());
  const tgt = await ev(() => game.story.target());
  check('marker on the Garage', tgt && Math.hypot(tgt.x - 96, tgt.z + 150) < 1, JSON.stringify(tgt));
  // ---------------------------------------------------------------- the walk, by the marker
  const t0 = Date.now();
  const walk = await walkTo(p, tgt.x, tgt.z, { stop: 45, sprint: true, timeout: 200000, say, onTick: async () => { await drain(); return false; } });
  check('reached the Garage on foot by the marker', walk.ok, `${((Date.now() - t0) / 1000).toFixed(0)} s, ${walk.stalls} stalls`);
  check('torch named at the first dark', await said(/^It's dark\. Your torch \(L\)/));
  await shot('garage-in-sight');
  check('objective: past the fence', /Get past the fence/.test(await objective()), await objective());
  // ---------------------------------------------------------------- the gate, by feel
  const gate = await ev(() => { const it = game.garage.interactables.find((i) => i.id === 'gate'); return [it.pos.x, it.pos.y, it.pos.z]; });
  await walkTo(p, gate[0], gate[2], { stop: 1.2, say });
  await ev(([x, y, z]) => window.__lookAt(x, y, z), gate);
  await wait(500);
  check('tripwire toast names the bound crouch', await said(/^Tripwire ahead — crouch \(C\) to step over it\./));
  await p.keyboard.press('KeyE'); await wait(1300);
  check('lockpick footer: bound movement keys', /A D \/ mouse — choose pin/.test(await textOf(p, '.panel.mg footer')), (await textOf(p, '.panel.mg footer')).replace(/\n/g, ' '));
  await shot('lockpick');
  check('gate picked by feel', (await playLockpick(p, say)) === 'open');
  await wait(1800);
  await drain();
  check('Garage advice names crouch', /crouch \(C\) and keep the torch off/.test(await objective()), await objective());
  await shot('yard');
  // ---------------------------------------------------------------- home with the names (the vault was played in garage.mjs)
  await ev(() => { const s = game.state; for (const f of ['garage.side.open', 'garage.vault.open', 'garage.complete']) s.set(f); s.addItem('seed_manifest', 1, true, true); });
  await wait(1200);
  check('objective: radio Mara', /Radio Mara from the campfire/.test(await objective()), await objective());
  await ev(() => { const it = game.interactables.find((i) => i.id === 'camp'); const v = it.pos.clone().add(new (it.pos.constructor)(3, 0, 3)); v.y = game.hf.heightAt(v.x, v.z) + 0.2; game.player.teleport(v); });
  await wait(1200);
  const camp = await ev(() => { const it = game.interactables.find((i) => i.id === 'camp'); return [it.pos.x, it.pos.y, it.pos.z]; });
  await walkTo(p, camp[0], camp[2], { stop: 2.2, say });
  await ev(([x, y, z]) => window.__lookAt(x, y, z), camp);
  await wait(500);
  await ev(() => { const a = game.audio; const f = a.speak.bind(a); window.__spoke = []; const t1 = performance.now(); a.speak = (sp, tx, o) => { window.__spoke.push([+((performance.now() - t1) / 1000).toFixed(1), sp, tx.slice(0, 50)]); return f(sp, tx, o); }; });
  await p.keyboard.press('KeyE'); await wait(1300);
  const radio = await ev(() => { const b = [...document.querySelectorAll('.overlay .btn')].find((x) => /radio/i.test(x.textContent)); const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await p.mouse.click(radio[0], radio[1]); await wait(1000);
  let closedAt = 0;
  for (let i = 0; i < 14; i++) {
    if (await ev(() => !!document.querySelector('.panel.talk'))) {
      check('talk card footer: keyboard words', /Esc leaves/.test(await textOf(p, '.panel.talk .brief-foot')));
      await shot('choice'); await p.keyboard.press('Digit1'); await wait(900); continue;
    }
    if (!(await ev(() => !!document.querySelector('.panel.brief')))) break;
    // a reader's pace once the choice is made
    if (await ev(() => game.state.has('act1.broadcast'))) await wait(4500);
    await p.keyboard.press('Enter'); await wait(600);
  }
  closedAt = await ev(() => +((performance.now()) / 1000).toFixed(1));
  await wait(1500);
  await drain();
  await shot('act1-banner');
  const bannerUp = await ev(() => /ACT I/.test(document.querySelector('#hud .banner .big')?.textContent ?? '') && !document.querySelector('#hud.dim'));
  await wait(3500);
  await drain();
  const spoke = await ev(() => window.__spoke);
  const wrapI = spoke.findIndex(([, , t]) => /^That's Act I/.test(t));
  const lastPage = spoke.findIndex(([, , t]) => /finished the delivery/.test(t));
  check('Act I wrap line plays after the epilogue, not over it', wrapI > lastPage && lastPage >= 0, JSON.stringify(spoke.slice(-3)));
  check('Act I banner on screen once the radio closed', bannerUp && (await said(/^ACT I · THE CISTERN \|/)));
  check('objective: Act II, Dry Creek, plain words', /Ask Dry Creek who would come west\. Talk to people there and do their favours\./.test(await objective()), await objective());
  const t2 = await ev(() => game.story.target());
  check('marker on Dry Creek', t2 && Math.hypot(t2.x + 262, t2.z + 48) < 1, JSON.stringify(t2));
  const w2 = await walkTo(p, t2.x, t2.z, { stop: 14, sprint: true, timeout: 200000, say, onTick: async () => { await drain(); return false; } });
  check('reached Dry Creek by the marker', w2.ok, `${w2.stalls} stalls`);
  await wait(1500);
  await shot('dry-creek');
  // ---------------------------------------------------------------- rebind crouch to Z (Controls screen), and a pad
  await ev(() => { const b = window.__binds ?? null; return b; });
  const reb = await ev(async () => {
    const { binds } = await import('/src/engine/bindings.ts');
    binds.bindKey('crouch', 0, 'KeyZ');
    const { keyWord } = await import('/src/ui/keyWords.ts');
    const { TUT } = await import('/src/game/tutorial.ts');
    const out = { crouch: keyWord('crouch'), menus: TUT.menus() };
    document.documentElement.classList.add('pad');
    out.padMenus = TUT.menus(); out.padCrouch = keyWord('crouch'); out.padTorch = TUT.torch();
    document.documentElement.classList.remove('pad');
    binds.reset();
    return out;
  });
  check('rebound crouch is what the hint names', reb.crouch === 'Z', JSON.stringify(reb));
  check('pad: menus in pad buttons', /^View kit, skills and journal · Hold View map · Menu pause\.$/.test(reb.padMenus), reb.padMenus);
  check('pad: crouch is B, torch is Hold LB', reb.padCrouch === 'B' && /Hold LB/.test(reb.padTorch), `${reb.padCrouch} / ${reb.padTorch}`);
  // ---------------------------------------------------------------- Continue
  await ev(() => game.save(true));
  await p.goto(p.url().replace(/\?.*$/, '?webgl'));
  await waitForGame(p);
  await wait(1500);
  check('title offers Continue', /Continue/i.test(await textOf(p, '#title .menu')));
  await clickEl(p, '#title .menu .btn.primary');
  await wait(4000);
  await shot('continue');
  check('Continue: PREVIOUSLY, and the same objective', /Ask Dry Creek who would come west/.test(await textOf(p, '#hud .objective .text')), await textOf(p, '#hud .objective .text'));
} finally {
  const failed = results.filter(([, ok]) => !ok).length;
  say(`${results.length - failed}/${results.length} checks pass`);
  await g.done('walkthrough');
  console.log(failed ? 'SOME FAILED' : 'ALL PASS');
  process.exitCode = failed ? 1 : 0;
}
