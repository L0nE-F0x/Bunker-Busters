// In-page helpers for trailer shots (injected by the promo scripts; runs in the game page).
// World positions are [x, heightAboveGround, z]; `at` targets the same way.
window.D = (() => {
  const g = window.game;
  const V = g.camera.position.constructor;
  const ground = (x, z) => g.hf.heightAt(x, z);
  const P = (p) => new V(p[0], ground(p[0], p[2]) + p[1], p[2]);
  const lerp = (a, b, k) => a + (b - a) * k;
  const ease = (k) => { const x = Math.min(1, Math.max(0, k)); return x * x * (3 - 2 * x); };
  const easeOut = (k) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);
  const easeIn = (k) => Math.pow(Math.min(1, Math.max(0, k)), 2.2);
  const lin = (k) => Math.min(1, Math.max(0, k));
  const L = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
  const D = {
    expo: 1, grain: undefined,
    g, V, P, ground, lerp, ease, easeOut, easeIn, lin, L,
    /** Free camera (title machinery off). */
    cine(hour, { pause = true } = {}) {
      g.mode = 'cine';
      g.director.title = () => null; g.director.fade = 0; g.post.fade.value = 0; g.post.menuShade.value = 0;
      if (hour !== undefined) { g.atmo.hour = hour; g.envTimer = 0; }
      g.atmo.paused = pause;
      if (g.hands) g.hands.root.visible = false; // no first-person hands on the free camera
    },
    /** Put the camera at eye looking at `at` (both [x, h, z]), with a roll in radians. */
    cam(eye, at, fov = 50, roll = 0) {
      const c = g.camera;
      const e = Array.isArray(eye) ? P(eye) : eye, a = Array.isArray(at) ? P(at) : at;
      c.position.copy(e);
      c.up.set(0, 1, 0);
      c.lookAt(a);
      if (roll) c.rotateZ(roll);
      if (Math.abs(c.fov - fov) > 1e-4) { c.fov = fov; c.updateProjectionMatrix(); }
      c.updateMatrixWorld();
      // free camera in a run: the world's scatter streams around the player, so the (shadow-only)
      // body goes where the camera is, out of sight
      if (g.mode === 'cine' && g.player) {
        const p = g.player.position.clone(); p.set(c.position.x, D.ground(c.position.x, c.position.z) + 0.2, c.position.z);
        if (p.distanceToSquared(g.player.position) > 0.01) g.player.teleport(p);
        g.player.model.root.visible = false;
      }
    },
    /** Polar camera around a point: angle (rad, 0 = +z side), distance, height above ground. */
    orbit(center, ang, dist, h, atH = 1.5, fov = 50, roll = 0) {
      const ex = center[0] + Math.sin(ang) * dist, ez = center[2] + Math.cos(ang) * dist;
      D.cam([ex, h, ez], [center[0], atH, center[2]], fov, roll);
    },
    /** Hide the HUD (or bring it back). */
    hud(on) { document.getElementById('ui').style.display = on ? '' : 'none'; },
  };
  return D;
})();

// ---- first-person helpers (playing mode)
Object.assign(window.D, (() => {
  const g = window.game;
  const D = window.D;
  const tmp = new D.V();
  return {
    /** Contractors still standing (Recovery members with a body). */
    hostiles() { return g.recovery.members.filter((m) => m.alive); },
    /** The squad `summon` made (still standing). */
    squad() { return (g.recovery.patrol?.members ?? []).filter((m) => m.alive); },
    /** SeedBot zaps without the knockout (the cut to black and the walk of shame). */
    tame() { const d = g.garage.drone; d.events.onZap = () => { g.audio.play('zap'); g.cam.addTrauma(0.9); }; },
    /** The live contractor nearest the view direction (within `maxAng` rad), or null. */
    target(maxAng = 1.2, maxDist = 120) {
      const eye = g.camera.position;
      let best = null, bestA = maxAng;
      for (const m of D.hostiles()) {
        tmp.copy(m.h.pos).setY(m.h.pos.y + 1.25).sub(eye);
        const d = tmp.length();
        if (d > maxDist) continue;
        const yaw = Math.atan2(-tmp.x, -tmp.z);
        let da = Math.abs(((yaw - g.cam.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (da < bestA) { bestA = da; best = m; }
      }
      return best;
    },
    /** Yaw/pitch that look from the eye at a world point. */
    look(p) {
      tmp.copy(p).sub(g.camera.position);
      return [Math.atan2(-tmp.x, -tmp.z), Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z))];
    },
    /** Ease the first-person aim toward a point (rate per second); returns the remaining error (rad). */
    aim(p, rate, dt) {
      const [y, pt] = D.look(p);
      let dy = ((y - g.cam.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const dp = pt - g.cam.pitch;
      const k = 1 - Math.exp(-rate * dt);
      g.cam.yaw += dy * k; g.cam.pitch += dp * k;
      return Math.hypot(dy * (1 - k), dp * (1 - k));
    },
    chest(m, h = 1.2) { return tmp.copy(m.h.pos).setY(m.h.pos.y + h).clone(); },
    /** Arm the player for a staged fight: god mode on Story, weapon out, mouse "captured". */
    arm(weapon = 'rifle') {
      g.combat.difficulty = 'story';
      D.god = true;
      g.state.data.skills.firearms = 5; // a veteran: tight hip-fire for the camera
      g.state.data.focuses.firearms = 'marksman';
      if (!D._god) D._god = setInterval(() => { g.state.data.health = 100; }, 16);
      const ammo = { rifle: 'ammo3030', revolver: 'ammo38', shotgun: 'shells' }[weapon];
      g.state.addItem(weapon, 1, true, true);
      if (ammo) g.state.addItem(ammo, 60, true, true);
      if (ammo) g.state.data.arms.mags[weapon] = { rifle: 7, revolver: 6, shotgun: 5 }[weapon];
      g.input.locked = true;
      g.hands.root.visible = true;
      g.arms.equip(weapon, true);
    },
    /** Put the player at [x, z] looking (yaw, pitch). */
    place(x, z, yaw, pitch = 0) {
      const p = g.player.position.clone(); p.x = x; p.z = z; p.y = g.hf.heightAt(x, z) + 0.2;
      g.player.teleport(p); g.cam.snap(yaw, pitch);
    },
    /** Hold or release an input action (forward, back, left, right, sprint, crouch, aim...). */
    hold(act, on = true) { if (on) g.input.down.add(`act:${act}`); else g.input.down.delete(`act:${act}`); },
    releaseAll() { for (const k of [...g.input.down]) if (k.startsWith('act:')) g.input.down.delete(k); },
  };
})());

// ---- space helpers: camp and town local points as world [x, heightAboveGround, z]
Object.assign(window.D, (() => {
  const g = window.game;
  const D = window.D;
  const rel = (v) => [v.x, v.y - D.ground(v.x, v.z), v.z];
  return {
    camp: (p) => rel(g.landmarks.campPoint(p[0], p[1], p[2])),
    town: (p) => { const v = g.scene.getObjectByName('dry-creek').localToWorld(new D.V(p[0], 0, p[2])); return [v.x, p[1], v.z]; },
    garage: (p) => { const o = g.garage.b.origin; return [o.x + p[0], p[1], o.z + p[2]]; },
    /** A move: eye and target from → to over `dur` seconds, with an easing name. */
    move(t, dur, e0, e1, a0, a1, fov0 = 50, fov1 = fov0, easing = 'lin', roll = 0) {
      const k = D[easing](t / dur);
      D.cam(D.L(e0, e1, k), D.L(a0, a1, k), D.lerp(fov0, fov1, k), roll);
    },
  };
})());
