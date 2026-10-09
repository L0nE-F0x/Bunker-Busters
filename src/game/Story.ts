import type { GameState } from './State';
import type { AudioEngine } from '@/engine/audio';
import type { UI } from '@/ui/UI';
import { QUESTS, QUEST, questComplete, questOutcome, currentStep, type QuestDef, type QuestView, type QuestReward } from '@/content/quests';
import { BANTER, type BanterView } from '@/content/banter';
import { PERSON, standingTier, STANDING_WORD, shortName } from '@/content/people';
import { storyObjective } from '@/content/story';
import { LANDMARKS } from '@/content/world';
import { ITEMS } from '@/content/items';
import { GARAGE } from '@/content/bunkers/garage';
import { APEX } from '@/content/bunkers/apex';
import { OUTPOSTS } from '@/content/recovery';

/** Seconds between two banter lines, at least. Exploring should feel accompanied, not narrated. */
const BANTER_GAP = 40;

/**
 * The quest log and the voices in your ear.
 *
 * Quests are pure functions of flags (content/quests.ts). This runtime only notices when the answer
 * changes: it records progress as flags, toasts the steps, pays the rewards, and keeps the corner
 * objective pointed at the tracked quest (or the main story when nothing is tracked).
 * Banter is a list of one-shot subtitle lines gated on places and flags, throttled hard.
 */
export class Story {
  private dirty = true;
  private banterT = 8;
  private sinceBanter = BANTER_GAP - 12;
  private lastLabel = '';
  private quiet = false;
  private offs: (() => void)[] = [];

  constructor(private state: GameState, private ui: UI, private audio: AudioEngine) {
    const ev = state.events;
    this.offs.push(
      ev.on('flag', () => { this.dirty = true; }),
      ev.on('inventoryChanged', () => { this.dirty = true; }),
      ev.on('rep', ({ id, delta, value }) => {
        const p = PERSON[id];
        if (!p || this.quiet) return;
        const word = STANDING_WORD[standingTier(value)];
        this.ui.toast(`${p.name} · ${delta > 0 ? 'that went well' : 'that went badly'} · ${word}`, delta > 0 ? 'good' : 'bad');
      }),
    );
    // A loaded (or migrated) run catches up quietly: no toast per step it already walked.
    this.sync(true);
  }

  dispose() {
    for (const off of this.offs) off();
    this.offs = [];
  }

  view(): QuestView {
    const s = this.state;
    return { has: (f) => s.has(f), rep: (id) => s.rep(id), count: (id) => s.count(id), skill: (id) => s.skill(id) };
  }

  // ------------------------------------------------------------------ quests
  /** Started, not finished, newest main first. */
  active(): QuestDef[] {
    const s = this.state;
    return QUESTS.filter((q) => s.has(`q:${q.id}`) && !s.has(`q:${q.id}:done`));
  }

  /** The quest the corner follows: the tracked one if it is still open, else the open main quest. */
  focusQuest(): QuestDef | null {
    const s = this.state;
    const t = s.data.tracked ? QUEST[s.data.tracked] : null;
    if (t && s.has(`q:${t.id}`) && !s.has(`q:${t.id}:done`)) return t;
    return QUESTS.find((q) => q.kind === 'main' && s.has(`q:${q.id}`) && !s.has(`q:${q.id}:done`)) ?? null;
  }

  track(id: string) {
    const s = this.state;
    s.data.tracked = s.data.tracked === id ? '' : id;
    this.lastLabel = '';
  }

  /** Walk every quest once. `silent` is for loading: record what is already true without fanfare. */
  sync(silent = false) {
    this.dirty = false;
    this.quiet = silent;
    try {
      this.walk(silent);
    } finally {
      this.quiet = false;
    }
  }

  private walk(silent: boolean) {
    const s = this.state;
    const v = this.view();
    const migrated = silent && s.has('migrated.v3') && !s.has('migrated.v3.synced');
    let caughtUp = 0, caughtXp = 0;
    for (const q of QUESTS) {
      const started = s.has(`q:${q.id}`);
      if (!started) {
        if (!q.start(v)) continue;
        s.set(`q:${q.id}`);
        if (!silent) {
          this.audio.play('intel');
          this.ui.toast(`New ${q.kind === 'main' ? 'chapter' : 'quest'} · ${q.title}. J to read it.`, 'info');
        }
      }
      for (const step of q.steps) {
        if (step.locked || s.has(`q:${q.id}:${step.id}`) || !step.done(v)) continue;
        s.set(`q:${q.id}:${step.id}`);
        if (!silent && started) this.ui.toast(`✓ ${q.title} · ${step.text}`, 'good');
      }
      if (s.has(`q:${q.id}:done`) || !questComplete(q, v)) continue;
      s.set(`q:${q.id}:done`);
      if (s.data.tracked === q.id) s.data.tracked = '';
      const reward = questOutcome(q, v)?.reward ?? q.reward ?? { xp: 0 };
      if (migrated) {
        // old runs get the standing and the XP for what they already did, not a second pile of loot
        caughtUp++;
        caughtXp += this.pay(q, { xp: reward.xp, rep: reward.rep }, true).xp;
        continue;
      }
      const got = this.pay(q, reward, false).summary;
      if (silent) continue;
      this.audio.play('levelUp');
      const outcome = questOutcome(q, v);
      const sub = [outcome?.label ?? '', got].filter(Boolean).join('  ·  ');
      this.ui.banner(q.kind === 'main' ? q.title.toUpperCase() : 'FAVOUR DONE', q.kind === 'main' ? sub || 'Complete.' : `${q.title}${sub ? '  ·  ' + sub : ''}`, 'good');
      if (q.wrap) {
        const speaker = q.wrap.speaker === 'You' ? s.archetype.name.split(' ')[0] : q.wrap.speaker;
        setTimeout(() => this.ui.subtitle(speaker, q.wrap!.text), 2600);
        this.sinceBanter = 0;
      }
    }
    if (migrated) {
      s.set('migrated.v3.synced');
      if (caughtUp) {
        s.addXP(caughtXp, 'Journal caught up');
        setTimeout(() => this.ui.toast(`Journal caught up: ${caughtUp} finished quest${caughtUp === 1 ? '' : 's'} from before this version.`, 'info'), 1200);
      }
    }
  }

  /**
   * XP, items and standing. Word of Mouth pays 30% more XP and one more goodwill with the giver.
   * With `holdXp` the XP is returned for the caller to grant in one lump instead.
   */
  private pay(q: QuestDef, r: QuestReward, holdXp: boolean): { xp: number; summary: string } {
    const s = this.state;
    const wom = s.capstone('social') === 'wordofmouth';
    const xp = Math.round(r.xp * (wom ? 1.3 : 1));
    const bits: string[] = [];
    for (const it of r.items ?? []) {
      const n = s.addItem(it.id, it.qty, true, true);
      if (n) bits.push(`${n}× ${ITEMS[it.id]?.name ?? it.id}`);
    }
    const moved: string[] = [];
    const was = this.quiet;
    this.quiet = true; // one summary toast instead of one per person
    const nudge = (id: keyof typeof PERSON, d: number) => {
      s.addRep(id, d);
      moved.push(`${shortName(id)} ${d > 0 ? '+' : '−'}${Math.abs(d)}`);
    };
    for (const [id, d] of Object.entries(r.rep ?? {}) as [keyof typeof PERSON, number][]) {
      nudge(id, d + (wom && d > 0 && id === q.giver ? 1 : 0));
    }
    if (wom && !(r.rep && (r.rep[q.giver] ?? 0) > 0)) nudge(q.giver, 1);
    this.quiet = was;
    if (moved.length && !was) this.ui.toast(`Standing · ${moved.join(' · ')}`, 'info');
    if (xp && !holdXp) s.addXP(xp, q.title);
    if (bits.length) s.events.emit('inventoryChanged', {});
    return { xp, summary: bits.join(', ') };
  }

  // ------------------------------------------------------------------ the corner
  /** Label and text for the objective box. `garage` is the Garage's own advice when you are at it. */
  objective(garage: string, label: string = QUEST.act1.title): { label: string; text: string } {
    // asked every frame: answer from the memo unless a flag, the tracked quest or the Garage text changed
    const key = `${this.state.data.flags.length}|${this.state.data.tracked}|${garage}|${label}`;
    if (this.objMemo?.key === key) return this.objMemo.out;
    const out = this.computeObjective(garage, label);
    this.objMemo = { key, out };
    return out;
  }

  private objMemo: { key: string; out: { label: string; text: string } } | null = null;
  private targetMemo: { key: string; out: { x: number; z: number; label: string } | null } | null = null;

  private computeObjective(garage: string, label: string): { label: string; text: string } {
    const s = this.state;
    const v = this.view();
    const q = this.focusQuest();
    let out: { label: string; text: string };
    if (q && q.kind === 'side') {
      const step = currentStep(q, v);
      out = { label: q.title, text: step ? step.text + (step.hint ? `. ${firstSentence(step.hint)}` : '') : 'Go back to whoever asked.' };
    } else if (garage) {
      out = { label, text: garage };
    } else if (q) {
      const step = currentStep(q, v);
      out = { label: q.title, text: step ? `${step.text}. ${firstSentence(step.hint ?? '')}`.trim() : storyObjective({ has: (f) => s.has(f), archetype: s.archetype }) };
    } else {
      out = { label: 'Objective', text: storyObjective({ has: (f) => s.has(f), archetype: s.archetype }) };
    }
    if (out.label !== this.lastLabel) {
      this.lastLabel = out.label;
      this.ui.setObjectiveLabel(out.label);
    }
    return out;
  }

  /** World XZ for the focus quest's current step, for the map. */
  target(): { x: number; z: number; label: string } | null {
    const key = `${this.state.data.flags.length}|${this.state.data.tracked}`;
    if (this.targetMemo?.key !== key) this.targetMemo = { key, out: this.computeTarget() };
    return this.targetMemo.out;
  }

  private computeTarget(): { x: number; z: number; label: string } | null {
    const q = this.focusQuest();
    if (!q) return null;
    const step = currentStep(q, this.view());
    if (!step?.at) return null;
    if (step.at === 'garage') return { x: GARAGE.location.position[0], z: GARAGE.location.position[2], label: q.title };
    if (step.at === 'apex') return { x: APEX.location.position[0], z: APEX.location.position[2], label: q.title };
    const lm = LANDMARKS.find((l) => l.id === step.at);
    if (lm) return { x: lm.position[0], z: lm.position[2], label: q.title };
    const op = OUTPOSTS.find((o) => o.id === step.at);
    return op ? { x: op.x, z: op.z, label: q.title } : null;
  }

  // ------------------------------------------------------------------ per frame (cheap)
  update(dt: number, ctx: { blocked: boolean; px: number; pz: number; night: boolean; storm: number; alarm: boolean }) {
    if (this.dirty) this.sync(false);
    this.sinceBanter += dt;
    this.banterT -= dt;
    if (this.banterT > 0) return;
    this.banterT = 1;
    if (ctx.blocked || ctx.alarm || this.sinceBanter < BANTER_GAP || this.ui.subtitleBusy) return;
    const s = this.state;
    const v: BanterView = { has: (f) => s.has(f), archetype: s.archetype, night: ctx.night, storm: ctx.storm };
    let best: (typeof BANTER)[number] | null = null;
    for (const b of BANTER) {
      if (s.has(`b:${b.id}`)) continue;
      if (b.when && !b.when(v)) continue;
      if (b.near) {
        let x: number, z: number;
        if ('lm' in b.near) {
          const lm = LANDMARKS.find((l) => l.id === (b.near as { lm: string }).lm);
          if (!lm) continue;
          x = lm.position[0]; z = lm.position[2];
        } else ({ x, z } = b.near);
        if (Math.hypot(ctx.px - x, ctx.pz - z) > b.near.r) continue;
      }
      if (!best || (b.priority ?? 0) > (best.priority ?? 0)) best = b;
    }
    if (!best) return;
    s.set(`b:${best.id}`);
    this.sinceBanter = 0;
    const text = typeof best.text === 'function' ? best.text(v) : best.text;
    const speaker = best.speaker === 'Mara' ? 'Mara · radio' : s.archetype.name.split(' ')[0];
    this.ui.subtitle(speaker, text);
  }
}

function firstSentence(t: string) {
  const i = t.search(/[.!?](\s|$)/);
  return i < 0 ? t : t.slice(0, i + 1);
}
