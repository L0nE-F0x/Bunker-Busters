// The game's own score as stems for the trailer: the generative music engine rendered offline
// (no sound effects, no ambience), one mood at a time. Writes <out>/music-<mood>.wav.
//   node scripts/promo/score.mjs <outdir>
import { openRig } from './rig.mjs';

const OUT = process.argv[2];
const SEG = [
  // [name, seconds, scene overrides]
  ['title', 75, { mood: 'title', night: false, tension: 0, combat: 0 }],
  ['fight', 80, { mood: 'play', night: false, tension: 0, combat: 1 }],
  ['lament', 25, { mood: 'play', night: false, tension: 0, combat: 0 }],
  ['camp', 50, { mood: 'camp', night: true, tension: 0, combat: 0 }],
  ['tension', 45, { mood: 'play', night: true, tension: 0.9, combat: 0 }],
];
const rig = await openRig({ url: '/play/?webgl&q=low&skip=ui&autostart', size: [480, 270], audio: SEG.reduce((a, s) => a + s[1] + 6, 20) });
await rig.begin({ music: 1, sfx: 0 });
await rig.eval(() => {
  const a = window.game.audio;
  a.ambOut.gain.value = 0; // music only
  const u = a.update.bind(a);
  a.update = (dt, cam, wind, tension, storm, scene) => {
    const o = window.SCENE || {};
    return u(dt, cam, 0, o.tension ?? tension, 0, { ...scene, ...o, alarm: false, inside: false });
  };
  window.game.weather.storm(0, true);
});
for (const [name, secs, scene] of SEG) {
  await rig.eval((s) => { window.SCENE = s; window.game.audio.ambOut.gain.value = 0; }, scene);
  await rig.run(name === 'lament' ? 0.5 : 4, { fps: 30 }); // the mood turns over on a bar line
  await rig.listen(`${OUT}/music-${name}.wav`, secs, { fps: 30 });
}
await rig.close();
