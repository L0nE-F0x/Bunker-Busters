// The v1.0 shot list for shots-v1.mjs. Points are [x, heightAboveGround, z]; `space` converts them
// first: 'camp' / 'town' (local frames), 'rel:<bunker>' (offsets from a bunker's origin), 'abs'
// (an absolute y). `mode: 'play'` keeps the run going (interiors, first person) and sets the camera
// after the game's own; otherwise the free camera ('cine'). `each` runs every frame after the camera.
const SWARM_QUIET = `D.g.cathedral.swarm.sense = () => {};`;
const FP = '(t) => {}'; // the player's own camera

/** First person: empty hands (or a weapon), the torch, a place relative to a bunker, a look. */
const fp = ({ b, at, yaw = 0, pitch = 0, torch = false, weapon = null, crouch = false, extra = '' }) => `
  D.arm('${weapon || 'revolver'}'); ${weapon ? '' : 'D.g.arms.equip(null, true);'}
  D.g.hands.flashlightOn = ${torch}; D.g.player.flashlight = ${torch}; D.g.hands.root.visible = true;
  { const o = D.g.${b}.b.origin; D.place(o.x + ${at[0]}, o.z + ${at[1]}, ${yaw}, ${pitch}); }
  D.hold('crouch', ${crouch});
  ${extra}`;

/** A camera that circles a person at an absolute spot (scout: all the way round; takes: an arc). */
const person = ({ p, r = 1.7, eye = 1.6, look = 1.55, ang = [0, Math.PI * 2], fov = 40 }) =>
  `(t) => { const k = t / 7; const a = ${ang[0]} + (${ang[1]} - ${ang[0]}) * k;
    D.cam(D.abs([${p[0]} + Math.sin(a) * ${r}, ${p[1]} + ${eye}, ${p[2]} + Math.cos(a) * ${r}]), D.abs([${p[0]}, ${p[1]} + ${look}, ${p[2]}]), ${fov}); }`;

export const SHOTS = [
  // ---------------------------------------------------------------- the world
  { name: 'camp-gold', hour: 17.75, dur: 7, cam: { space: 'camp', e: [[-19, 2.3, -4.5], [-17.4, 2.0, -3.5]], a: [[-5.9, 1.2, 2.9], [-5.9, 1.1, 2.9]], fov: [32, 31] } },
  { name: 'camp-close', hour: 18.3, dur: 7, cam: { space: 'camp', e: [[-12.4, 1.45, 0.2], [-11.2, 1.3, 1.4]], a: [[-7.2, 0.95, 4.6], [-7.2, 0.95, 4.6]], fov: [50, 46] } },
  { name: 'camp-night', hour: 21.8, expo: 1.35, dur: 7, cam: { space: 'camp', e: [[-14.5, 1.3, 9.5], [-13.2, 1.2, 8.6]], a: [[-7.4, 0.9, 4.8], [-7.4, 0.9, 4.8]], fov: [46, 44] } },
  { name: 'creek-dusk', hour: 18.6, dur: 6, cam: { space: 'town', e: [[0.6, 1.5, 6.1], [0.2, 1.4, 4.6]], a: [[-0.7, 1.0, 0], [-0.7, 1.0, 0]], fov: [54, 52] } },
  { name: 'vista', hour: 17.6, dur: 7, cam: { e: [[-60, 1.6, 40], [-64, 2.6, 33]], a: [[-340, 40, -380], [-340, 38, -380]], fov: [40, 38] } },
  { name: 'storm-wall', hour: 16.8, storm: 0.3, dur: 6, cam: { e: [[-60, 2, 40], [-58, 2.2, 36]], a: [[200, 30, 40], [200, 26, 0]], fov: [55, 55] } },
  { name: 'storm-city', hour: 16.8, storm: 0.6, dur: 6, cam: { e: [[-60, 2, 40], [-60, 2.4, 34]], a: [[-60, 20, -300], [-40, 22, -300]], fov: [55, 52] } },
  { name: 'lightning', hour: 21.5, storm: 0.95, expo: 1.6, dur: 7, strikes: [0.8, 3.6, 5.4], cam: { e: [[-60, 2, 40], [-60, 2.2, 38]], a: [[200, 40, 40], [200, 40, 20]], fov: [60, 60] } },
  { name: 'nightsky', hour: 23.0, expo: 1.3, dur: 7, cam: { e: [[-60, 2, 40], [-60, 2, 40]], a: [[-200, 140, -200], [-200, 25, -200]], fov: [60, 60], ease: 'ease' } },

  // ---------------------------------------------------------------- the eight bunkers, outside
  // Tier 1: the Garage at night, neon and SeedBot's lamp
  { name: 'garage-night', hour: 22.3, expo: 1.35, dur: 7, cam: { orbit: { c: [96, 0, -150], ang: [0.25, 0.35], dist: [32, 27], h: [1.6, 1.8], atH: 3, fov: 55 } } },
  // Tier 2: Apex over the salt at golden hour
  { name: 'apex-salt', hour: 17.55, dur: 7, cam: { e: [[-284, 1.6, -204], [-292, 2.0, -196]], a: [-366, 12, -126], fov: [50, 47] } },
  { name: 'apex-rocket', hour: 17.55, dur: 7, cam: { space: 'rel:apex', e: [[30, 1.2, 22], [26, 1.4, 19]], a: [[14, 26, 2], [14, 30, 2]], fov: [58, 56] } },
  // Tier 3: the Panopticon's lamp over the valley
  { name: 'pan-valley', hour: 19.3, expo: 1.25, dur: 7, cam: { e: [[-283, 2, -296], [-285, 2.2, -303]], a: [-297, 16, -350], fov: [50, 48] } },
  { name: 'pan-gate', hour: 19.3, expo: 1.3, dur: 7, cam: { space: 'rel:panopticon', e: [[14, 1.4, 34], [11, 1.6, 30]], a: [[0, 26, 0], [0, 28, 0]], fov: [58, 56] } },
  // Tier 4: the Spire on its bench
  { name: 'spire-road', hour: 17.55, dur: 7, cam: { e: [[341, 1.7, -97], [343, 1.9, -88]], a: [378, 40, 4], fov: [42, 40] } },
  { name: 'spire-court', hour: 17.6, dur: 7, cam: { space: 'rel:spire', e: [[-9, 1.5, -28], [-6, 1.6, -23]], a: [[0, 22, 0], [0, 26, 0]], fov: [62, 60] } },
  { name: 'spire-night', hour: 21.4, expo: 1.4, dur: 7, cam: { e: [[318, 2.5, 30], [322, 2.6, 28]], a: [378, 44, 4], fov: [46, 44] } },
  // Tier 5: the Dome, glowing at night
  { name: 'dome-night', hour: 20.4, expo: 1.3, dur: 7, cam: { e: [[118, 2.0, 252], [124, 2.0, 261]], a: [150, 9, 318], fov: [46, 44] } },
  { name: 'dome-inside', hour: 20.6, expo: 1.3, dur: 7, cam: { space: 'rel:dome', e: [[0, 1.7, -17], [0, 1.8, -13]], a: [[0, 3.0, -4.8], [0, 3.0, -4.8]], fov: [58, 56] } },
  // Tier 6: the Cathedral at dusk, drones round the towers
  { name: 'cath-lot', hour: 18.0, dur: 7, setup: SWARM_QUIET, cam: { e: [[206, 2.6, -182], [204, 3.6, -194]], a: [198, 13, -252], fov: [50, 48] } },
  { name: 'cath-tower', hour: 18.0, dur: 7, setup: SWARM_QUIET, cam: { space: 'rel:cathedral', e: [[-24, 1.5, 48], [-20, 1.6, 44]], a: [[-6, 20, 20], [-6, 22, 20]], fov: [56, 54] } },
  // Tier 7: the Fortress in its moat
  { name: 'fort-crane', hour: 17.85, dur: 7, cam: { e: [[-106, 8, 276], [-110, 12, 281]], a: [-127, 3, 322], fov: [50, 48] } },
  { name: 'fort-bridge', hour: 18.15, dur: 7, cam: { e: [[-121, 1.6, 289], [-123, 1.6, 292]], a: [-127, 4, 318], fov: [56, 54] } },

  // ---------------------------------------------------------------- fixes after the first scout
  { name: 'apex-crane', hour: 17.55, dur: 7, cam: { e: [[-286, 1.4, -202], [-286, 4.2, -202]], a: [[-366, 11, -126], [-366, 13, -126]], fov: [48, 48], ease: 'ease' } },
  { name: 'spire-bench', hour: 17.55, dur: 7, cam: { e: [[300, 3, -46], [304, 3.4, -40]], a: [378, 34, 4], fov: [40, 39] } },
  { name: 'cath-tower2', hour: 18.0, dur: 7, setup: SWARM_QUIET, cam: { space: 'rel:cathedral', e: [[-26, 3.2, 54], [-21, 3.0, 47]], a: [[-6, 20, 20], [-6, 22, 20]], fov: [56, 54] } },
  { name: 'fort-gate', hour: 17.8, dur: 7, cam: { e: [[-119, 3.2, 286], [-121, 3.0, 289]], a: [-127, 4, 318], fov: [58, 56] } },
  { name: 'storm-dusk', hour: 19.2, storm: 0.9, expo: 1.3, dur: 7, strikes: [0.6, 2.9, 5.2], cam: { e: [[-60, 2, 40], [-60, 2.2, 38]], a: [[200, 40, 40], [200, 40, 20]], fov: [60, 60] }, scoutAt: [0.09, 0.42, 0.75] },
  { name: 'camp-night2', hour: 21.8, expo: 1.35, dur: 7, cam: { space: 'camp', e: [[-2.5, 1.4, 9.5], [-3.2, 1.3, 8.6]], a: [[-7.6, 0.9, 4.8], [-7.6, 0.9, 4.8]], fov: [46, 44] } },

  // ---------------------------------------------------------------- the heists, first person
  // the Apex hangar door: five pins by torchlight (the real interactable: the door opens, Vesper reacts)
  { name: 'h-lockpick', mode: 'play', hands: true, hour: 21.3, expo: 1.3, dur: 8.5, settle: 0.4, cam: FP,
    setup: fp({ b: 'apex', at: [-10, 17.4], yaw: 0, pitch: -0.06, torch: true, extra: `D.g.state.addItem('lockpick', 5, true, true); document.body.classList.add('capmg');
      setTimeout(() => D.g.apex.interactables.find((i) => i.id === 'hangar').primary.run(), 30);` }),
    each: '(t, dt) => S.lock(t, dt)' },
  // the Fortress gatehouse keypad (1599); the bridge comes down
  { name: 'h-keypad', mode: 'play', hands: true, hour: 18.1, dur: 6, settle: 0.4, cam: FP,
    setup: fp({ b: 'fortress', at: [-3.1, -37.2], yaw: Math.PI, pitch: -0.05, extra: `document.body.classList.add('capmg');
      setTimeout(() => D.g.fortress.interactables.find((i) => i.id === 'bridge').primary.run(), 30);` }),
    each: '(t, dt) => S.type(t, dt)' },
  // the drawbridge coming down over the coolant (free camera from the gatehouse)
  { name: 'fort-bridge-down', hour: 17.7, dur: 7, each: `(t) => { if (t > 0.4 && !window.__bd) { window.__bd = 1; D.g.fortress.openEntry('bridge'); } }`,
    setup: `window.__bd = 0;`, cam: { e: [[-119.5, 2.4, 286], [-120.5, 2.2, 288.5]], a: [-127, 2.2, 312], fov: [54, 52] } },
  // SPLICE on the Dome's gate: your voice goes on the list as Hunter's
  { name: 'h-splice', mode: 'play', hands: true, hour: 20.4, expo: 1.25, dur: 8, settle: 0.4, cam: FP,
    setup: fp({ b: 'dome', at: [-2.5, -45.5], yaw: Math.PI, pitch: -0.02, extra: `document.body.classList.add('capmg');
      setTimeout(() => D.g.ui.hack({ title: 'DOME GATE', host: 'ASCEND · VOICE ACCESS', difficulty: 3, daemons: ['voiceprint', 'domecams'].map((id) => DAEMONS[id]) }), 30);` }),
    each: '(t, dt) => S.hack(t, dt)' },
  // Apex's launch corridor: three beams, the camera sweeping, crouched along the west wall
  { name: 'h-corridor', mode: 'play', hands: true, hour: 21.0, expo: 1.2, dur: 7, settle: 1.0, cam: FP,
    setup: fp({ b: 'apex', at: [-11.0, -8.6], yaw: 0, pitch: -0.04, crouch: true, torch: true, extra: `for (const f of ['apex.hangar.open', 'apex.airlock.open']) D.g.state.set(f); D.g.apex.applyFlags(true); D.g.apex.triggerAlarm = () => {};` }),
    pre: `(t, dt) => { D.hold('crouch', true); D.hold('forward', t > 1.2 && t < 3.6); }` },
  // the Cathedral's swarm tags you on the lot at night: searchlights, and they crowd you (the catch is off)
  { name: 'h-swarm', mode: 'play', hands: true, hour: 20.3, expo: 1.3, dur: 8, settle: 0.3, cam: FP,
    setup: fp({ b: 'cathedral', at: [-6, 40], yaw: 0, pitch: 0.25, extra: `const sw = D.g.cathedral.swarm; sw.host.onCatch = () => {}; sw.release = () => {};
      sw.tagNow('out', D.g.player.position.clone(), sw.list.find((d) => !d.inside));` }),
    pre: `(t, dt) => { const ds = D.g.cathedral.swarm.list.filter((d) => !d.inside && d.state === 'converge'); if (!ds.length) return;
      const c = ds.reduce((a, d) => a.add(d.pos), new D.V()).multiplyScalar(1 / ds.length); D.aim(c, 1.6, dt); }` },
  // a Careful sentinel on the Spire road sees your gun and apologises (down the road from it, facing it)
  { name: 'h-sentinel', mode: 'play', hands: true, hour: 17.15, dur: 7, settle: 0.3, cam: FP,
    setup: `D.arm('revolver'); D.g.hands.root.visible = true; const o = D.g.spire.b.origin;
      const s = [...D.g.spire.sentinels.list].sort((a, b) => b.group.position.distanceTo(o) - a.group.position.distanceTo(o))[0];
      const p = s.group.getWorldPosition(new D.V()); const r = D.g.spire.b.points.road;
      const dx = r.x - p.x, dz = r.z - p.z, L = Math.hypot(dx, dz);
      D.place(p.x + dx / L * 9, p.z + dz / L * 9, 0, 0); window.__sent = p;`,
    pre: `(t, dt) => { D.aim(window.__sent.clone().setY(window.__sent.y + 0.2), 8, dt); }` },
  // the corridor again, torch off, down the middle, a short crouched creep that stops short of the
  // first beam (the first take, torch on and walking, showed dark shards floating over the beams)
  { name: 'h-corridor2', mode: 'play', hands: true, hour: 21.0, dur: 7, settle: 1.0, cam: FP,
    setup: fp({ b: 'apex', at: [-10.0, -7.6], yaw: 0, pitch: -0.03, crouch: true, extra: `for (const f of ['apex.hangar.open', 'apex.airlock.open']) D.g.state.set(f); D.g.apex.applyFlags(true); D.g.apex.triggerAlarm = () => {};` }),
    pre: `(t, dt) => { D.hold('crouch', true); }`, each: `(t) => { D.hold('forward', t > 1.0 && t < 2.1); }` },
  // a Helper walking the Dome's yard at night, the glass lit behind it
  { name: 'dome-helper', hour: 20.6, expo: 1.25, dur: 7, settle: 1,
    cam: `(t) => { const h = D.g.dome.helpers.list.filter((x) => x.pos.z < 300).sort((a, b) => a.pos.x - b.pos.x)[0] ?? D.g.dome.helpers.list[0]; const p = h.pos;
      D.cam([p.x - 3.2, 1.0, p.z - 3.6], [p.x, 1.25, p.z], 44); }` },
  // the Panopticon's lamp passes over you at the gate (the lamp's clock is set so the beam comes round)
  { name: 'pan-sweep', hour: 19.6, expo: 1.3, dur: 7, settle: 1,
    each: `(t) => { if (t < 0.02) { const o = D.g.panopticon.b.origin, c = D.g.camera.position; const y = Math.atan2(c.x - o.x, c.z - o.z);
      D.g.panopticon.t = ((((y - 3.4 * Math.PI * 2 / 40) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 40; } }`,
    cam: { space: 'rel:panopticon', e: [[9, 1.4, 31], [8, 1.5, 29]], a: [[0, 30, 0], [0, 31, 0]], fov: [62, 60] } },
  // Model Zero: the push-in, then the door starts to swing (the tease)
  { name: 'zero-door', mode: 'play', hour: 16, dur: 7, settle: 1.5,
    each: `(t) => { if (t > 4.2 && !window.__zd) { window.__zd = 1; D.g.zero.openEntry('zero', { line: null }); } }`,
    setup: `window.__zd = 0; const z = D.g.zero; for (const d of z.doormen.list) d.update = () => {};
      for (const f of ['garage.complete', 'apex.complete', 'panopticon.complete', 'spire.complete', 'dome.complete', 'cathedral.complete', 'fortress.complete', 'zero.known', 'zero.hatch.open', 'zero.door61.open', 'zero.clock.open', 'zero.showroom.said']) D.g.state.set(f);
      z.applyFlags(true); z.triggerAlarm = () => {}; const o = z.b.origin; D.g.player.teleport(o.clone().add({ x: 0.4, y: -25.9, z: -38.0 }));`,
    cam: `(t) => { const o = D.g.zero.b.origin; const k = D.easeOut(t / 7); D.cam(D.abs([o.x + 0.05, -21.5, o.z - 33 - k * 4.5]), D.abs([o.x, -21.7, o.z - 43.6]), 50); }` },

  // ---------------------------------------------------------------- the people (orbits in the scout)
  // (takes: slow arcs at the angles the scout liked; the scout itself went all the way round)
  { name: 'p-ezra', mode: 'play', hour: 20, dur: 7, settle: 0.5, setup: `{ const o = D.g.panopticon.b.origin; D.g.player.teleport(new D.V(o.x + 1, 7.3, o.z + 1.5)); }`,
    cam: person({ p: [-293.4, 7.0, -349.8], ang: [3.75, 4.35], r: 2.0, eye: 1.62, look: 1.5 }) },
  { name: 'p-ezra-face', mode: 'play', hour: 20, dur: 7, settle: 0.5, setup: `{ const o = D.g.panopticon.b.origin; D.g.player.teleport(new D.V(o.x + 1, 7.3, o.z + 1.5)); }`,
    cam: person({ p: [-293.4, 7.0, -349.8], ang: [-0.25, 0.25], r: 1.5, eye: 1.62, look: 1.58, fov: 36 }) },
  { name: 'p-orrin', mode: 'play', hour: 18, dur: 7, settle: 0.5, setup: `D.g.player.teleport(new D.V(200.2, 0.6, -279.6));`,
    cam: person({ p: [198.8, 0.5, -281.6], ang: [-0.35, 0.3], r: 1.7, eye: 1.6, look: 1.5, fov: 38 }) },
  { name: 'p-kit', mode: 'play', hour: 18, dur: 7, settle: 0.5, setup: `D.g.player.teleport(new D.V(-127.2, 1.2, 326.6));`,
    cam: person({ p: [-126.8, 1.0, 327.9], ang: [1.75, 2.35], eye: 1.3, look: 1.15 }) },
  { name: 'p-prudence', mode: 'play', hour: 17.8, dur: 7, settle: 0.5, setup: `D.g.player.teleport(new D.V(377.0, 31.4, 2.2));`,
    cam: person({ p: [374.4, 31.2, 3.3], ang: [1.55, 2.25], r: 2.1, eye: 1.6, look: 1.4, fov: 44 }) },
  { name: 'p-gil', hour: 20.5, expo: 1.2, dur: 7, cam: person({ p: [134.4, 7.0, 314.1], ang: [-0.3, 0.3], eye: 1.35, look: 1.1 }) },
  { name: 'p-ada', mode: 'play', hour: 20, dur: 7, settle: 0.5, scoutAt: [0, 0.33, 0.66], setup: `{ const o = D.g.panopticon.b.origin; D.g.player.teleport(new D.V(o.x - 2, 7.3, o.z - 4)); }`,
    cam: person({ p: [-302.2, 7.0, -360.6], eye: 1.35, look: 1.15 }) },

  // ---------------------------------------------------------------- stills only (store art)
  // the library hero (3840×1240, no text; the key content inside the central 860×380): the camp at golden hour, wide
  { name: 's-libhero', hour: 17.75, dur: 2, scoutAt: [0.5], cam: { space: 'camp', e: [-24, 2.0, -8.5], a: [-7.3, 0.45, 4.9], fov: 22 } },
  // portrait capsules: the tall ones
  { name: 's-portrait-apex', hour: 17.55, dur: 2, scoutAt: [0.5], cam: { space: 'rel:apex', e: [34, 1.3, 26], a: [14, 24, 2], fov: 62 } },
  { name: 's-portrait-pan', hour: 19.4, expo: 1.3, dur: 8, scoutAt: [0, 0.5, 1], cam: { space: 'rel:panopticon', e: [12, 1.4, 34], a: [0, 22, 0], fov: 60 } },
  { name: 's-portrait-spire', hour: 17.6, dur: 2, scoutAt: [0.5], cam: { space: 'rel:spire', e: [-7, 1.5, -25], a: [0, 24, 0], fov: 64 } },

  // ---------------------------------------------------------------- Bunker Zero, under the forecourt
  { name: 'zero-showroom', mode: 'play', hour: 16, dur: 7, settle: 1.5, setup: `const z = D.g.zero;
      for (const d of z.doormen.list) d.update = () => {};
      for (const f of ['garage.complete', 'apex.complete', 'panopticon.complete', 'spire.complete', 'dome.complete', 'cathedral.complete', 'fortress.complete', 'zero.known', 'zero.hatch.open', 'zero.door61.open', 'zero.showroom.said']) D.g.state.set(f);
      z.applyFlags(true); z.triggerAlarm = () => {}; const o = z.b.origin; D.g.player.teleport(o.clone().add({ x: 0.4, y: -25.9, z: -24.0 }));`,
    cam: `(t) => { const o = D.g.zero.b.origin; const k = D.ease(t / 7); D.cam(D.abs([o.x + 0.1, -21.45, o.z - 27 - k * 9]), D.abs([o.x, -21.6, o.z - 43.6]), 52); }` },
];
