// Does the Meshy contractor body stay on the procedural skeleton through a kill and its ragdoll (no
// drift, no layer build-up)? Summons a squad, shoots one, and logs the gap between the model's left
// hand and the procedural one every 0.5 s for 10 s: it should settle and then hold steady. (Idle sway
// of a standing squad: prop lab `what=human&meshy&pose=relaxed&still=6` logs it.) Needs `npm run dev`.
//   node scripts/dev/human-drift.mjs
import { launch, waitForGame } from './browser.mjs';

const b = await launch();
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto((process.env.DEV_ORIGIN ?? 'http://localhost:5173') + '/play/?webgl&autostart');
console.log('mode:', await waitForGame(p));
const out = await p.evaluate(async () => {
  const g = window.game, R = g.recovery;
  g.combat.difficulty = 'story';
  R.summon(g.player.position, g.cam.yaw, 14, 3, false);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await wait(3000);
  const m = R.patrol.members[0];
  // BONE.handL = 5
  const gap = () => {
    const s = R.crowd.skins?.slots?.[m.h.slot];
    if (!s || !s.root.visible) return null;
    return +s.b.LeftHand.getWorldPosition(m.h.pos.clone()).distanceTo(m.h.pos.clone().setFromMatrixPosition(m.h.mats[5])).toFixed(3);
  };
  const before = gap();
  m.damage({ amount: 500, dir: m.h.pos.clone().sub(g.player.position).setY(0).normalize(), point: m.h.chestPos.clone(), zone: 'body', source: 'player' });
  const after = [];
  for (let i = 0; i < 20; i++) { await wait(500); after.push(gap()); }
  return { before, after };
});
console.log('hand gap alive:', out.before, 'm; after the kill, every 0.5 s:', out.after.join(' '));
await b.close();
