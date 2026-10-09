import { ITEMS, canteenSips, CANTEEN_SIPS } from '@/content/items';
import { TILL_STOCK, TILL_QUIPS, rollStock, sellable, sellPrice, buyPrice } from '@/content/trade';
import type { GameState } from '@/game/State';
import { ICONS } from './icons';

/**
 * The Till: Inez's shop as one DOM panel. Her shelf on the left (today's stock, her price), your pack on
 * the right (her offer), and the slate between: selling writes value on it, buying rubs it off. Plain
 * buttons only, so the controller navigator (PadNav) and touch both drive it; no CSS filters (WebKitGTK).
 */

export interface TillHost {
  root: HTMLElement;
  modalOpen: boolean;
  audio: { play(name: string): void };
  refreshHotbar?(): void;
}

export interface TillOpts {
  /** Her line at the top. */
  line: string;
  /** Price multiplier on `value` when you buy (1.1 … 1.45). */
  markup: number;
  /** Share of `value` she pays (0.45 … 0.7). */
  offer: number;
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** Today's shelf, rolled once per in-game day (`till.day`), with what's left of each line (`till.q.<id>`). */
export function tillShelf(s: GameState) {
  const m = s.data.marks;
  const day = s.data.days ?? 0;
  if (m['till.day'] !== day) {
    for (const k of Object.keys(m)) if (k.startsWith('till.q.')) delete m[k];
    for (const l of rollStock(day)) m[`till.q.${l.id}`] = l.qty;
    m['till.day'] = day;
  }
  return TILL_STOCK.map((l) => ({ id: l.id, qty: m[`till.q.${l.id}`] ?? 0 })).filter((l) => l.qty > 0);
}

export function tillBuy(s: GameState, id: string, markup: number): string | null {
  const m = s.data.marks;
  const left = m[`till.q.${id}`] ?? 0;
  if (left <= 0) return 'Sold out.';
  const price = buyPrice(id, markup);
  const slate = m['till.slate'] ?? 0;
  if (slate < price) return `Short ${price - slate} on the slate. Sell her something.`;
  const fresh = (id === 'vest' || id === 'canteen') && !s.count(id);
  if (!s.addItem(id, 1)) return 'Your pack won\'t take it.';
  if (fresh) delete m[`gear.${id}`];
  m['till.slate'] = slate - price;
  m[`till.q.${id}`] = left - 1;
  return null;
}

export function tillSell(s: GameState, id: string, n: number, offer: number): string | null {
  if (!sellable(id)) return 'She won\'t take that.';
  const have = s.count(id);
  n = Math.min(n, have);
  if (n <= 0 || !s.removeItem(id, n)) return 'Nothing to sell.';
  const m = s.data.marks;
  m['till.slate'] = (m['till.slate'] ?? 0) + sellPrice(id, offer) * n;
  if ((id === 'vest' || id === 'canteen') && !s.count(id)) delete m[`gear.${id}`];
  return null;
}

export function openTill(host: TillHost, s: GameState, opts: TillOpts): Promise<void> {
  host.modalOpen = true;
  host.audio.play('ui');
  const ov = document.createElement('div');
  ov.className = 'overlay';
  const panel = document.createElement('div');
  panel.className = 'panel modal interactive till-panel';
  ov.appendChild(panel);
  host.root.appendChild(ov);
  let note = opts.line;
  let desc = '';
  let lastKey = '';
  return new Promise((resolve) => {
    const finish = () => {
      window.removeEventListener('keydown', onKey, true);
      ov.remove();
      host.modalOpen = false;
      host.refreshHotbar?.();
      resolve();
    };
    const row = (id: string, qty: number, side: 'buy' | 'sell') => {
      const d = ITEMS[id];
      if (!d) return '';
      const price = side === 'buy' ? buyPrice(id, opts.markup) : sellPrice(id, opts.offer);
      const slate = s.data.marks['till.slate'] ?? 0;
      const btns = side === 'buy'
        ? `<button class="btn till-buy" data-id="${id}" data-key="b:${id}" ${slate < price ? 'disabled' : ''}>Buy · ${price}</button>`
        : `<button class="btn till-sell" data-id="${id}" data-n="1" data-key="s:${id}">Sell · ${price}</button>${qty > 1 ? `<button class="btn till-sell all" data-id="${id}" data-n="${qty}" data-key="a:${id}">All · ${price * qty}</button>` : ''}`;
      return `<div class="till-row cat-${d.category}" data-desc="${esc(id)}"><span class="ic">${ICONS[d.icon] ?? ''}</span><span class="nm"><b>${esc(d.name)}</b><small>×${qty} · ${d.weight}kg</small></span><span class="bt">${btns}</span></div>`;
    };
    const paint = () => {
      const lists = panel.querySelectorAll<HTMLElement>('.till-list');
      const scroll = [...lists].map((l) => l.scrollTop);
      const shelf = tillShelf(s);
      const pack = s.data.inventory.filter((it) => sellable(it.id) && sellPrice(it.id, opts.offer) > 0);
      const slate = s.data.marks['till.slate'] ?? 0;
      const salvage = pack.filter((it) => ITEMS[it.id].category === 'loot');
      const salvageValue = salvage.reduce((v, it) => v + sellPrice(it.id, opts.offer) * it.qty, 0);
      const can = s.count('canteen') > 0 && canteenSips(s) < CANTEEN_SIPS;
      const over = s.weight > s.carryLimit + 0.05;
      panel.innerHTML = `<div class="scan"></div>
        <header><h3>THE TILL</h3><div class="label">Inez Quill · Dry Creek · ${esc(s.dayLabel)}</div></header>
        <div class="body till-body">
          <p class="till-note">${esc(note)}</p>
          <div class="till-slate"><span class="label">On the slate</span><b>${slate}</b><small>Sell to put value on it. Buy to rub it off. She writes in pencil.</small></div>
          <div class="till-cols">
            <div class="till-col"><div class="label">Her shelf · new stock at midnight</div>
              <div class="till-list">${shelf.length ? shelf.map((l) => row(l.id, l.qty, 'buy')).join('') : '<p class="empty">Bare. Come back tomorrow.</p>'}</div></div>
            <div class="till-col"><div class="label">Your pack · her offer</div>
              <div class="till-list">${pack.length ? pack.map((it) => row(it.id, it.qty, 'sell')).join('') : '<p class="empty">Nothing she wants.</p>'}</div>
              <div class="till-extra">
                ${salvage.length ? `<button class="btn till-salvage" data-key="salvage">Sell all salvage · ${salvageValue}</button>` : ''}
                ${s.count('canteen') ? `<button class="btn till-fill" data-key="fill" ${can && s.count('scrap') ? '' : 'disabled'}>${can ? 'Fill the canteen · 1 scrap' : 'Canteen\'s full'}</button>` : ''}
              </div></div>
          </div>
          <p class="till-desc">${esc(desc)}</p>
        </div>
        <footer><span class="kb"><span class="kbd">Esc</span> leave</span><span class="${over ? 'over' : ''}">CARRY ${s.weight.toFixed(1)} / ${s.carryLimit} KG</span></footer>`;
      panel.querySelectorAll<HTMLElement>('.till-list').forEach((l, i) => (l.scrollTop = scroll[i] ?? 0));
      const x = document.createElement('button');
      x.className = 'btn close-x';
      x.textContent = '✕';
      x.setAttribute('aria-label', 'Close');
      x.onclick = () => { host.audio.play('ui'); finish(); };
      panel.querySelector('header')!.appendChild(x);
      const act = (key: string, fn: () => string | null, ok: string) => {
        lastKey = key;
        const err = fn();
        host.audio.play(err ? 'deny' : 'uiConfirm');
        note = err ?? ok;
        paint();
      };
      panel.querySelectorAll<HTMLButtonElement>('.till-buy').forEach((b) => (b.onclick = () => {
        const id = b.dataset.id!;
        act(b.dataset.key!, () => tillBuy(s, id, opts.markup), TILL_QUIPS[id]?.buy ?? `${ITEMS[id].name}. She wraps it in yesterday's news.`);
      }));
      panel.querySelectorAll<HTMLButtonElement>('.till-sell').forEach((b) => (b.onclick = () => {
        const id = b.dataset.id!;
        const n = Number(b.dataset.n) || 1;
        act(b.dataset.key!, () => tillSell(s, id, n, opts.offer), TILL_QUIPS[id]?.sell ?? (n > 1 ? `${ITEMS[id].name} ×${n}. Onto the slate, in pencil.` : `${ITEMS[id].name}. Onto the slate.`));
      }));
      const sv = panel.querySelector<HTMLButtonElement>('.till-salvage');
      if (sv) sv.onclick = () => act('salvage', () => {
        for (const it of s.data.inventory.filter((i) => sellable(i.id) && ITEMS[i.id].category === 'loot')) tillSell(s, it.id, it.qty, opts.offer);
        return null;
      }, 'She sweeps the lot into a crate marked FUTURE. "Pleasure."');
      const fill = panel.querySelector<HTMLButtonElement>('.till-fill');
      if (fill) fill.onclick = () => act('fill', () => {
        if (!s.removeItem('scrap', 1)) return 'One scrap for the water.';
        delete s.data.marks['gear.canteen'];
        return null;
      }, 'She fills it from a jerrycan she keeps behind the counter. "Don\'t tell the town."');
      // what you're pointing at: the item's own words under the lists
      panel.querySelectorAll<HTMLElement>('.till-row').forEach((r) => {
        const show = () => {
          const d = ITEMS[r.dataset.desc!];
          const t = d ? `${d.name}: ${d.description}` : '';
          if (t !== desc) { desc = t; const el = panel.querySelector('.till-desc'); if (el) el.textContent = t; }
        };
        r.addEventListener('mouseenter', show);
        r.addEventListener('focusin', show);
      });
      // keep the controller's place after a repaint
      const again = lastKey ? panel.querySelector<HTMLElement>(`[data-key="${lastKey}"]`) : null;
      if (again && !(again as HTMLButtonElement).disabled) again.focus({ preventScroll: true });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      finish();
    };
    window.addEventListener('keydown', onKey, true);
    paint();
  });
}
