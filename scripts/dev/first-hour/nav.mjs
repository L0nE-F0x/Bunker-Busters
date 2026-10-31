// Walking with the real keyboard: W (and Shift) held, the head turned toward a target each beat
// (the turning stands in for the mouse; what's judged is where the game sends you and what it says).

/** Install page helpers (yaw convention: forward = (-sin yaw, -cos yaw)). */
export async function navInit(p) {
  await p.evaluate(() => {
    window.__face = (x, z, pitch) => {
      const pp = game.player.position;
      const yaw = Math.atan2(-(x - pp.x), -(z - pp.z));
      game.cam.yaw = yaw;
      if (pitch !== undefined) game.cam.pitch = pitch;
      return Math.hypot(x - pp.x, z - pp.z);
    };
    window.__lookAt = (x, y, z) => {
      const e = game.camera.position;
      const dx = x - e.x, dy = y - e.y, dz = z - e.z;
      game.cam.yaw = Math.atan2(-dx, -dz);
      game.cam.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    };
    window.__pos = () => { const q = game.player.position; return [+q.x.toFixed(1), +q.y.toFixed(1), +q.z.toFixed(1)]; };
  });
}

/**
 * Walk to (x, z) holding the bound forward key; `sprint` holds Shift. Returns { ok, d, stalls }.
 * `onTick(d)` runs every beat (log/screenshot hooks); return true to stop early.
 */
export async function walkTo(p, x, z, { stop = 1.6, sprint = false, timeout = 120000, pitch = -0.05, onTick, say = () => {} } = {}) {
  const t0 = Date.now();
  let last = null, stuckT = 0, stalls = 0, d = Infinity;
  await p.keyboard.down('KeyW');
  if (sprint) await p.keyboard.down('ShiftLeft');
  try {
    while (Date.now() - t0 < timeout) {
      d = await p.evaluate(([x, z, pitch]) => window.__face(x, z, pitch), [x, z, pitch]);
      if (d < stop) return { ok: true, d, stalls };
      if (onTick && (await onTick(d))) return { ok: false, d, stalls, stopped: true };
      const pos = await p.evaluate(() => window.__pos());
      if (last && Math.hypot(pos[0] - last[0], pos[2] - last[2]) < 0.15) {
        stuckT += 1;
        if (stuckT === 4) { stalls++; say(`  stall at ${pos} (d=${d.toFixed(1)})`); }
        if (stuckT >= 4 && stuckT % 4 === 0) {
          // a stranger backs off and walks round whatever's in the way (alternating sides, wider each time)
          const side = stalls % 2 ? 'KeyD' : 'KeyA';
          const ms = 600 + 400 * Math.min(4, stalls);
          await p.keyboard.up('KeyW');
          await p.keyboard.down('KeyS'); await p.waitForTimeout(350); await p.keyboard.up('KeyS');
          await p.keyboard.down(side); await p.waitForTimeout(ms);
          await p.keyboard.down('KeyW'); await p.waitForTimeout(500); await p.keyboard.up(side);
          stalls++;
        }
        if (stuckT > 40) return { ok: false, d, stalls, stuck: pos };
      } else stuckT = 0;
      last = pos;
      await p.waitForTimeout(150);
    }
    return { ok: false, d, stalls, timeout: true };
  } finally {
    await p.keyboard.up('KeyW');
    if (sprint) await p.keyboard.up('ShiftLeft');
  }
}

/** Follow a polyline of [x, z] points. */
export async function walkPath(p, pts, opts = {}) {
  let r;
  for (const [x, z] of pts) {
    r = await walkTo(p, x, z, { ...opts, stop: opts.stop ?? 3 });
    if (!r.ok) return r;
  }
  return r;
}
