import { QUESTS, QUEST, questOutcome, currentStep, type QuestDef, type QuestView, type QuestReward } from '@/content/quests';
import { PEOPLE, PERSON, standingTier, STANDING_WORD, shortName, type PersonView } from '@/content/people';
import { journalEntries } from '@/content/story';
import { ITEMS } from '@/content/items';
import { WORLD_INTEL, LORE_SERIES } from '@/content/world';
import type { PersonId } from '@/content/types';
import type { GameState } from '@/game/State';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** What the journal needs from the quest runtime (src/game/Story.ts). */
export interface JournalSource {
  view(): QuestView;
  focusQuest(): QuestDef | null;
  track(id: string): void;
}

export type JournalSub = 'quests' | 'people' | 'story' | 'papers';

export interface JournalSel {
  sub: JournalSub;
  quest: string;
  person: PersonId | '';
}

export function initials(name: string) {
  const parts = name.replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export function monogram(id: PersonId | '', name: string, big = false) {
  const accent = (id && PERSON[id]?.accent) || '#b9ab95';
  return `<span class="mono${big ? ' big' : ''}" style="--pc:${accent}">${esc(initials(name))}</span>`;
}

/** Pips for standing: four slots, filled up to the value; a cold relationship shows red. */
export function standingPips(rep: number) {
  if (rep < 0) return `<span class="pips cold">${'<i class="on"></i>'.repeat(Math.min(3, -rep))}</span>`;
  return `<span class="pips">${Array.from({ length: 4 }, (_, i) => `<i class="${i < rep ? 'on' : ''}"></i>`).join('')}</span>`;
}

function rewardText(r: QuestReward | undefined) {
  if (!r) return '';
  const bits = [`${r.xp} XP`];
  for (const it of r.items ?? []) bits.push(`${it.qty}× ${ITEMS[it.id]?.name ?? it.id}`);
  for (const [id, d] of Object.entries(r.rep ?? {})) {
    if (d) bits.push(`${shortName(id as PersonId)} ${d > 0 ? '+' : '−'}${Math.abs(d)}`);
  }
  return bits.join(' · ');
}

function questLists(s: GameState, src: JournalSource) {
  const focus = src.focusQuest();
  const started = QUESTS.filter((q) => s.has(`q:${q.id}`));
  const active = started.filter((q) => !s.has(`q:${q.id}:done`));
  active.sort((a, b) => (a.kind === 'main' ? 0 : 1) - (b.kind === 'main' ? 0 : 1) || (a === focus ? -1 : b === focus ? 1 : 0));
  const done = started.filter((q) => s.has(`q:${q.id}:done`));
  return { active, done, focus };
}

function questRow(q: QuestDef, s: GameState, v: QuestView, sel: string, focus: QuestDef | null) {
  const done = s.has(`q:${q.id}:done`);
  const step = done ? null : currentStep(q, v);
  const tracked = focus === q;
  return `<button class="jq-row ${q.id === sel ? 'sel' : ''} ${done ? 'done' : ''} ${q.kind}" data-quest="${q.id}">
      <span class="kind">${q.kind === 'main' ? 'Story' : 'Favour'}</span>
      <span class="t">${esc(q.title)}${tracked ? '<i class="trk">Tracking</i>' : ''}</span>
      <small>${done ? esc(questOutcome(q, v)?.label ?? 'Done.') : esc(step?.text ?? 'Report back.')}</small>
    </button>`;
}

function questDetail(q: QuestDef, s: GameState, v: QuestView, focus: QuestDef | null) {
  const done = s.has(`q:${q.id}:done`);
  const giver = PERSON[q.giver];
  const cur = done ? null : currentStep(q, v);
  const steps = q.steps.map((st) => {
    const ok = !st.locked && st.done(v);
    const state = ok ? 'ok' : st.locked ? 'lockd' : st === cur ? 'cur' : 'todo';
    const glyph = ok ? '✓' : state === 'cur' ? '▸' : state === 'lockd' ? '◇' : '○';
    const hint = (state === 'cur' || (st.optional && !ok)) && st.hint ? `<small>${esc(st.hint)}</small>` : '';
    const tag = st.optional ? '<em>optional</em>' : st.locked ? '<em>Act II</em>' : '';
    return `<li class="${state}${st.optional ? ' optional' : ''}"><span class="g">${glyph}</span><div><b>${esc(st.text)}</b>${tag}${hint}</div></li>`;
  }).join('');
  const outcome = questOutcome(q, v);
  let end = '';
  if (done && outcome) end = `<div class="jq-end"><span class="label">How it ended</span><b>${esc(outcome.label)}</b><p>${esc(outcome.text)}</p><small>${esc(rewardText(outcome.reward))}</small></div>`;
  else if (done) end = `<div class="jq-end"><span class="label">Done</span><small>${esc(rewardText(q.reward))}</small></div>`;
  else if (q.outcomes) {
    const xs = q.outcomes.map((o) => o.reward.xp);
    end = `<div class="jq-end soft"><span class="label">Reward</span><small>${Math.min(...xs) === Math.max(...xs) ? Math.min(...xs) : `${Math.min(...xs)}–${Math.max(...xs)}`} XP, and the rest depends on what you choose. People remember.</small></div>`;
  } else if (q.reward) end = `<div class="jq-end soft"><span class="label">Reward</span><small>${esc(rewardText(q.reward))}</small></div>`;
  const trackable = !done && q.steps.some((st) => !st.locked && !st.done(v));
  const isFocus = focus === q;
  const track = !trackable ? '' : q.kind === 'main'
    ? (isFocus ? '<span class="trk-note">The corner follows the story when nothing else is tracked.</span>' : '<button class="btn track" data-track="">Follow the story instead</button>')
    : `<button class="btn track ${isFocus ? 'on' : ''}" data-track="${q.id}">${isFocus ? 'Tracking · stop' : 'Track this'}</button>`;
  return `<div class="jq-detail">
      <div class="jq-head">
        ${monogram(q.giver, giver?.name ?? '', true)}
        <div><span class="label">${q.kind === 'main' ? 'Main story' : 'Favour'} · from ${esc(giver?.name ?? q.giver)}</span><h4>${esc(q.title)}</h4><small>${esc(q.where)}</small></div>
        ${track}
      </div>
      <p class="blurb">${esc(q.blurb)}</p>
      <ol class="jq-steps">${steps}</ol>
      ${end}
    </div>`;
}

function personView(s: GameState): PersonView {
  return { has: (f) => s.has(f), rep: (id) => s.rep(id) };
}

function favourLines(s: GameState, id: PersonId) {
  const f = s.favours();
  const out: string[] = [];
  if (id === 'nia' && f.niaPlate) out.push('A free plate at the counter, once per rest.');
  if (id === 'doc' && f.docCalls) out.push('House calls: patched up once per rest.');
  if (id === 'inez' && f.inezRate !== 3) out.push(`Bottles cost ${f.inezRate} scrap at the Till.`);
  if (id === 'sol' && f.solLesson) out.push('Taught you to bend a third pick from the same scrap.');
  if (id === 'wick' && f.wickSeep) out.push('A bottle from the seep in the Cut, once per rest.');
  if (id === 'ren' && f.renAtCamp) out.push('Keeps watch at Last Chance now.');
  if (s.has(`crew.${id}`)) out.push('Said yes to walking west, to Apex.');
  return out;
}

function peopleList(s: GameState, sel: PersonId | '') {
  const pv = personView(s);
  const known = PEOPLE.filter((p) => p.known(pv));
  const row = (p: (typeof PEOPLE)[number]) => {
    const r = s.rep(p.id);
    return `<button class="jp-row ${p.id === sel ? 'sel' : ''}" data-person="${p.id}">
        ${monogram(p.id, p.name)}
        <span class="t">${esc(p.name)}<small>${esc(p.role)}</small></span>
        <span class="st">${STANDING_WORD[standingTier(r)]}${standingPips(r)}</span>
      </button>`;
  };
  const folk = known.filter((p) => !p.faction);
  const places = known.filter((p) => p.faction);
  return `${folk.map(row).join('')}${places.length ? `<div class="label jl-sep">Places</div>${places.map(row).join('')}` : ''}`;
}

function personDetail(s: GameState, id: PersonId) {
  const p = PERSON[id];
  if (!p) return '';
  const pv = personView(s);
  const r = s.rep(id);
  const seen = new Set<string>();
  const about = p.about.filter((a) => {
    if (seen.has(a.who)) return false;
    if (a.when && !a.when(pv)) return false;
    const other = PERSON[a.who];
    if (other && !other.known(pv)) return false;
    seen.add(a.who);
    return true;
  }).map((a) => `<li><b>On ${esc(PERSON[a.who]?.name ?? a.who)}</b><span>“${esc(a.line)}”</span></li>`).join('');
  const fav = favourLines(s, id).map((l) => `<li>${esc(l)}</li>`).join('');
  return `<div class="jp-detail">
      <div class="jq-head">${monogram(id, p.name, true)}<div><span class="label">${esc(p.place)}</span><h4>${esc(p.name)}</h4><small>${esc(p.role)}</small></div>
        <div class="jp-standing"><span>${STANDING_WORD[standingTier(r)]}</span>${standingPips(r)}</div></div>
      <p class="blurb">${esc(p.bio)}</p>
      <div class="jp-quote"><span class="label">${p.faction ? 'The word on you' : 'What they think of you'}</span><p>“${esc(p.ofYou[standingTier(r)])}”</p></div>
      ${about ? `<ul class="jp-about">${about}</ul>` : ''}
      ${fav ? `<div class="label" style="margin-top:14px">Favours</div><ul class="jp-fav">${fav}</ul>` : ''}
    </div>`;
}

/**
 * Papers: every document you've read, the founders' chat first and in page order (missing pages
 * shown as gaps, so the collection reads as one), then the rest newest first. Bodies are our own
 * markup (the chat's handles are bold), so they're rendered as is.
 */
function papersHTML(s: GameState) {
  const read = WORLD_INTEL.filter((i) => s.has(`intel:${i.id}`));
  const out: string[] = [];
  for (const [key, series] of Object.entries(LORE_SERIES)) {
    const got = series.ids.filter((id) => s.has(`intel:${id}`)).length;
    if (!got) continue;
    const pages = series.ids.map((id, n) => {
      const it = WORLD_INTEL.find((i) => i.id === id);
      if (!it || !s.has(`intel:${id}`)) return `<div class="intel-item gap"><b>Page ${n + 1} of ${series.ids.length}</b><span>Not found yet.${s.has(`q:dez.lifeboat`) ? ' Dez can point you at it.' : ''}</span></div>`;
      return `<div class="intel-item chat"><b>Page ${n + 1} · ${esc(it.title.split('—')[0].trim())}</b><span>${it.body}</span></div>`;
    }).join('');
    out.push(`<div class="label jl-sep">${esc(series.title)} · ${got} of ${series.ids.length}${got === series.ids.length ? ' · complete' : ''}</div>${pages}`);
    void key;
  }
  const rest = read.filter((i) => !i.series).reverse();
  if (rest.length) out.push(`<div class="label jl-sep">Everything else you've read · ${rest.length}</div>${rest.map((i) => `<div class="intel-item"><b>${esc(i.title)}</b><span>${i.body}</span></div>`).join('')}`);
  return out.join('') || '<div class="intel-item"><span>Nothing read yet. Paper turns up where people left in a hurry.</span></div>';
}

/** The Journal tab: quests, people, and the story so far. */
export function journalHTML(s: GameState, src: JournalSource, sel: JournalSel) {
  const v = src.view();
  const { active, done, focus } = questLists(s, src);
  const nPapers = WORLD_INTEL.filter((i) => s.has(`intel:${i.id}`)).length;
  const tabs = (['quests', 'people', 'story', 'papers'] as JournalSub[]).map((t) =>
    `<button class="jsub ${sel.sub === t ? 'on' : ''}" data-jsub="${t}">${t === 'quests' ? `Quests <i>${active.length}</i>` : t === 'people' ? 'People' : t === 'story' ? 'Story' : `Papers <i>${nPapers}</i>`}</button>`).join('');
  let left = '', right = '';
  if (sel.sub === 'quests') {
    const q = QUEST[sel.quest] && s.has(`q:${sel.quest}`) ? QUEST[sel.quest] : active[0] ?? done[0] ?? null;
    left = `${active.map((x) => questRow(x, s, v, q?.id ?? '', focus)).join('') || '<p class="empty">Nothing open. Mara talks first.</p>'}
      ${done.length ? `<div class="label jl-sep">Done · ${done.length}</div>${done.map((x) => questRow(x, s, v, q?.id ?? '', focus)).join('')}` : ''}`;
    right = q ? questDetail(q, s, v, focus) : '<p class="empty">Your quests will be here.</p>';
  } else if (sel.sub === 'people') {
    const pv = personView(s);
    const first = PEOPLE.find((p) => p.known(pv));
    const pid = sel.person && PERSON[sel.person]?.known(pv) ? sel.person : first?.id ?? '';
    left = peopleList(s, pid);
    right = pid ? personDetail(s, pid) : '<p class="empty">Nobody yet.</p>';
  } else if (sel.sub === 'papers') {
    const lb = LORE_SERIES.lifeboat;
    const got = lb.ids.filter((id) => s.has(`intel:${id}`)).length;
    left = `<div class="jl-arch">${monogram('dez', 'Dez Marlow', true)}<div><b>${esc(lb.title)}</b><small>The founders' group chat · ${got} of ${lb.ids.length} pages</small></div></div>
      <p class="jl-motive">${got >= lb.ids.length ? 'All eight pages. Seven founders, and Tanner, who kept rejoining.' : got ? 'Every device that died out here kept its last page. Dez hears them try to sync at three in the morning.' : 'Paper turns up where people left in a hurry. Read what you find.'}</p>`;
    right = `<div class="intel-list journal papers">${papersHTML(s)}</div>`;
  } else {
    const entries = journalEntries({ has: (f) => s.has(f), archetype: s.archetype });
    left = `<div class="jl-arch">${monogram('', s.archetype.name, true)}<div><b>${esc(s.archetype.name)}</b><small>${esc(s.archetype.role)} · ${esc(s.archetype.tagline)}</small></div></div>
      <p class="jl-motive">${esc(s.archetype.motive)}</p>`;
    right = `<div class="intel-list journal">${entries.length ? entries.map((e) => `<div class="intel-item"><b>${esc(e.title)}</b><span>${esc(e.body)}</span></div>`).join('') : '<div class="intel-item"><span>Nothing written yet. Mara talks first.</span></div>'}</div>`;
  }
  return `<div class="body journal-screen">
      <aside class="jl-side"><div class="jsubs">${tabs}</div><div class="jl-list">${left}</div></aside>
      <section class="jl-main">${right}</section>
    </div>`;
}

export function bindJournal(root: HTMLElement, src: JournalSource, sel: JournalSel, rerender: () => void) {
  root.querySelectorAll<HTMLElement>('[data-jsub]').forEach((b) => (b.onclick = () => { sel.sub = b.dataset.jsub as JournalSub; rerender(); }));
  root.querySelectorAll<HTMLElement>('[data-quest]').forEach((b) => (b.onclick = () => { sel.quest = b.dataset.quest ?? ''; rerender(); }));
  root.querySelectorAll<HTMLElement>('[data-person]').forEach((b) => (b.onclick = () => { sel.person = (b.dataset.person ?? '') as PersonId; rerender(); }));
  root.querySelectorAll<HTMLElement>('[data-track]').forEach((b) => (b.onclick = () => {
    const id = b.dataset.track ?? '';
    if (id) src.track(id);
    else { const f = src.focusQuest(); if (f && f.kind === 'side') src.track(f.id); }
    rerender();
  }));
}
