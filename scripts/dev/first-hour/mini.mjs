// Minigames played with real keys, using only what the player sees: the panel's message line.

const msg = (p) => p.evaluate(() => document.querySelector('.panel.mg .msg')?.textContent ?? null);
const open = (p) => p.evaluate(() => !!document.querySelector('.panel.mg'));

/**
 * Lockpick by feel: walk the pins with D, hold W for a while and let go, and read the line at the top.
 * "springs freely" → not this pin; "Not high enough" → hold longer; "Too high" / "Overset" → shorter.
 */
export async function playLockpick(p, say = () => {}, { maxTries = 60 } = {}) {
  const n = await p.evaluate(() => +(document.querySelector('.panel.mg .sub')?.textContent.match(/(\d+)-PIN/)?.[1] ?? 0));
  say(`  lockpick: ${n} pins, footer: ${await p.evaluate(() => document.querySelector('.panel.mg footer')?.innerText.replace(/\n/g, ' '))}`);
  let sel = 0, tries = 0;
  const lo = new Array(n).fill(900), hi = new Array(n).fill(2000);
  const free = new Set();
  let setCount = 0;
  while (tries++ < maxTries && (await open(p))) {
    const t = Math.round((lo[sel] + hi[sel]) / 2);
    await p.evaluate(() => { const e = document.querySelector('.panel.mg .msg'); if (e && !/OPEN/.test(e.textContent)) e.textContent = ''; });
    await p.keyboard.down('KeyW');
    await p.waitForTimeout(t);
    await p.keyboard.up('KeyW');
    await p.waitForTimeout(260);
    const m = (await msg(p)) ?? '';
    if (/OPEN/.test(m) || !(await open(p))) { say(`  lockpick: open after ${tries} lifts`); return 'open'; }
    if (/springs freely/.test(m)) {
      free.add(sel);
    } else if (/Not high enough/.test(m)) { lo[sel] = t; continue; }
    else if (/Too high|Overset|bends|SNAP/.test(m)) {
      hi[sel] = t;
      if (/SNAP/.test(m)) say('  lockpick: a pick snapped');
      if (/Out of lockpicks/.test(m)) return 'out';
      await p.waitForTimeout(400);
      continue;
    } else if (/Click\. Next pin/.test(m)) { setCount++; free.clear(); }
    // move on to the next pin (wrapping back with A)
    const next = (sel + 1) % n;
    if (next > sel) { await p.keyboard.press('KeyD'); } else { for (let i = 0; i < n; i++) await p.keyboard.press('KeyA'); }
    sel = next;
    await p.waitForTimeout(120);
  }
  return (await open(p)) ? 'gave-up' : 'closed';
}
