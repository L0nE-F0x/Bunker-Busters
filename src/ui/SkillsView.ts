import { SKILLS, SKILL_ORDER, SKILL_GLYPH, focusesFor, capstonesFor, FOCUS_RANK, CAPSTONE_RANK, type FocusDef } from '@/content/skills';
import type { SkillId } from '@/content/types';
import type { GameState } from '@/game/State';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

type BranchKind = 'focus' | 'capstone';

/** Anything on this skill the player could buy right now. */
function canBuy(s: GameState, id: SkillId) {
  if (s.data.skillPoints <= 0) return false;
  const lv = s.skill(id);
  if (lv < SKILLS[id].max) return true;
  if (lv >= FOCUS_RANK && !s.focus(id)) return true;
  if (lv >= CAPSTONE_RANK && !s.capstone(id)) return true;
  return false;
}

function branchOwned(s: GameState, id: SkillId, kind: BranchKind) {
  return kind === 'focus' ? s.focus(id) : s.capstone(id);
}

/** The compact track on the left list: five ranks, a diamond after 2 and after 4. */
function miniTrack(s: GameState, id: SkillId) {
  const lv = s.skill(id);
  const pip = (n: number) => `<i class="${n <= lv ? 'on' : ''}"></i>`;
  const dia = (kind: BranchKind, at: number) => {
    const owned = branchOwned(s, id, kind);
    const cls = owned ? 'taken' : lv >= at ? 'open' : '';
    return `<em class="${cls}"></em>`;
  };
  return `${pip(1)}${pip(2)}${dia('focus', FOCUS_RANK)}${pip(3)}${pip(4)}${dia('capstone', CAPSTONE_RANK)}${pip(5)}`;
}

function rankNode(s: GameState, id: SkillId, n: number) {
  const lv = s.skill(id);
  const pts = s.data.skillPoints;
  const state = n <= lv ? 'owned' : n === lv + 1 ? 'next' : 'locked';
  const btn = state === 'next'
    ? `<button class="btn raise" data-raise="${id}" ${pts > 0 ? '' : 'disabled'}>${pts > 0 ? 'Raise · 1 point' : 'Needs a point'}</button>`
    : '';
  return `<li class="node rank ${state}">
      <span class="pin">${n}</span>
      <div class="tx"><b>Rank ${n}</b><span>${esc(SKILLS[id].perLevel[n])}</span></div>${btn}
    </li>`;
}

function branchNode(s: GameState, id: SkillId, kind: BranchKind) {
  const at = kind === 'focus' ? FOCUS_RANK : CAPSTONE_RANK;
  const lv = s.skill(id);
  const owned = branchOwned(s, id, kind);
  const defs: FocusDef[] = kind === 'focus' ? focusesFor(id) : capstonesFor(id);
  const pts = s.data.skillPoints;
  const title = kind === 'focus' ? 'Focus' : 'Capstone';
  const sub = owned
    ? `Chosen. The other ${kind} is closed.`
    : lv < at
      ? `Opens at rank ${at}. Pick one of two.`
      : 'Pick one of two. Costs a point, not a rank. The other one closes.';
  const opts = defs.map((f) => {
    let cls = 'locked', tag = `Opens at rank ${at}`, dis = 'disabled';
    if (owned === f.id) { cls = 'chosen'; tag = 'Chosen'; }
    else if (owned) { cls = 'closed'; tag = 'Closed'; }
    else if (lv >= at) { cls = 'open'; tag = pts > 0 ? 'Choose · 1 point' : 'Needs a point'; dis = pts > 0 ? '' : 'disabled'; }
    const attr = kind === 'focus' ? 'data-focus' : 'data-capstone';
    return `<button class="opt ${cls}" ${attr}="${f.id}" ${dis}><b>${esc(f.name)}</b><span>${esc(f.blurb)}</span><em>${tag}</em></button>`;
  }).join('');
  return `<li class="node branch ${kind} ${owned ? 'owned' : lv >= at ? 'open' : 'locked'}">
      <span class="pin"></span>
      <div class="tx"><b>${title}</b><span>${esc(sub)}</span></div>
      <div class="opts">${opts}</div>
    </li>`;
}

/** Kit modal's Skills tab: the six skills on the left, the selected one's tree on the right. */
export function skillsHTML(s: GameState, sel: SkillId) {
  const d = s.data;
  const pct = Math.min(100, (d.xp / s.xpToNext) * 100);
  const rows = SKILL_ORDER.map((id) => {
    const lv = s.skill(id);
    return `<button class="sk-row ${id === sel ? 'sel' : ''}" data-sel="${id}">
        <span class="glyph">${SKILL_GLYPH[id]}</span>
        <span class="nm">${SKILLS[id].name}<small>Rank ${lv} of ${SKILLS[id].max}</small></span>
        <span class="track">${miniTrack(s, id)}</span>
        ${canBuy(s, id) ? '<span class="dot" title="Something to spend on"></span>' : ''}
      </button>`;
  }).join('');
  const sk = SKILLS[sel];
  const lv = s.skill(sel);
  const path = [
    rankNode(s, sel, 1),
    rankNode(s, sel, 2),
    branchNode(s, sel, 'focus'),
    rankNode(s, sel, 3),
    rankNode(s, sel, 4),
    branchNode(s, sel, 'capstone'),
    rankNode(s, sel, 5),
  ].join('');
  return `<div class="body skills-screen">
      <aside class="sk-side">
        <div class="sk-points ${d.skillPoints ? 'has' : ''}">
          <b>${d.skillPoints}</b>
          <span>Skill point${d.skillPoints === 1 ? '' : 's'} to spend<small>Level ${d.level} · ${d.xp} / ${s.xpToNext} XP to the next point</small></span>
          <i class="xp"><i style="width:${pct}%"></i></i>
        </div>
        <div class="sk-list">${rows}</div>
        <p class="sk-help">Every rank and every branch changes how a door opens. A careful Act I won't fill this sheet, so pick a way in.</p>
      </aside>
      <section class="sk-tree">
        <header class="sk-head">
          <span class="glyph big">${SKILL_GLYPH[sel]}</span>
          <div><h4>${sk.name}</h4><p>${esc(sk.blurb)}</p></div>
          <div class="rank">${lv}<small>/${sk.max}</small></div>
        </header>
        ${lv === 0 ? `<p class="sk-untrained">${esc(sk.perLevel[0])}</p>` : ''}
        <ol class="sk-path">${path}</ol>
      </section>
    </div>`;
}

/** Wire the buttons. `after` re-renders. */
export function bindSkills(root: HTMLElement, s: GameState, on: { select: (id: SkillId) => void; spent: () => void; deny: () => void }) {
  root.querySelectorAll<HTMLElement>('[data-sel]').forEach((b) => (b.onclick = () => on.select(b.dataset.sel as SkillId)));
  root.querySelectorAll<HTMLButtonElement>('[data-raise]').forEach((b) => (b.onclick = () => (s.spendPoint(b.dataset.raise as SkillId) ? on.spent() : on.deny())));
  root.querySelectorAll<HTMLButtonElement>('[data-focus]').forEach((b) => (b.onclick = () => (s.spendFocus(b.dataset.focus ?? '') ? on.spent() : on.deny())));
  root.querySelectorAll<HTMLButtonElement>('[data-capstone]').forEach((b) => (b.onclick = () => (s.spendCapstone(b.dataset.capstone ?? '') ? on.spent() : on.deny())));
}

/** The skill the screen should open on: the first with something to buy, else the highest rank. */
export function defaultSkill(s: GameState): SkillId {
  return SKILL_ORDER.find((id) => canBuy(s, id) && s.skill(id) > 0)
    ?? [...SKILL_ORDER].sort((a, b) => s.skill(b) - s.skill(a))[0];
}
