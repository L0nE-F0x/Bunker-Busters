import * as THREE from 'three/webgpu';
import { Bunker } from '../Bunker';
import { DomeBuilder, DM } from './DomeBuilder';
import { paintBoard, type BoardView } from './domeAtlas';
import { hologramMaterial, uDomeGlow } from './domeFx';
import { Helpers, Helper, type HelperHost } from './helpers';
import {
  DOME, DOME_FLAGS as F, HELPERS, HELPER_LINES, HUNTER, PATCHES, PATCH_LINES, APPROVAL, RELEASE, GATE_LINES, GATE,
  HUNTER_BODY, HUNTER_NOTE, HUNTER_MEMO, GIL_TALK, HOLO_TALK, POD_TALK, PROOF_LINES, CLUSTER, TWIN,
  recordUses, profileText,
  type DomeTalk, type DomeView, type DomeChoice, type DomeRecord,
} from '@/content/bunkers/dome';
import { START_DAY } from '../../State';
import { stealthMeter } from '@/content/progression';
import type { BunkerEntryDef, LockMethod } from '@/content/types';
import type { NpcModels, NpcActor } from '../../world/npcSkin';
import type { GameContext } from '../../context';
import type { Combat } from '../../combat/Combat';

/** Which patch a lock method's use teaches the Dome. */
const KIND_PATCH: Partial<Record<LockMethod['kind'], string>> = { lockpick: 'pick', circuit: 'circuit', splice: 'splice', keypad: 'keypad', charge: 'charge' };

/**
 * Tier 5, the Singularity Dome (Act V): Hunter Vale's compute campus on the shelf under the southern
 * range. Entries, the cameras and the loot are data (content/bunkers/dome.ts) run by the bunker
 * runtime. What's the Dome's own:
 * - the patches: every method you use is logged (`marks['dome.uses.<id>']`); the twin writes a fix
 *   for your most-used one, Gil approves it (`APPROVAL` s), and it ships (`dome.patch.<id>`): that
 *   method stops working here (methodReason), or the Helpers get thermal / shielding / armour. At
 *   the fence it reads your record and ships one before you arrive. A code freeze (Gil), the build
 *   farm unplugged, or the ending stops it; a rollback (Gil + Hunter's badge) undoes them.
 * - the Helpers (helpers.ts): patrols in the yard and the racks; a catch walks you to the gate.
 * - the people: the hologram on the stage, Gil at the on-call desk, Hunter in the visitor hut.
 * - the voice check at the gate, Hunter's memo, the Cluster's decision.
 * Not a sealed interior: the dome is glass, the world shows through it from everywhere.
 */
export class Dome extends Bunker<DomeBuilder> {
  protected override sealed = false;
  readonly helpers = new Helpers();
  /** The Helpers and their models live in world space (they walk between the yard and the racks). */
  readonly helperGroup = new THREE.Group();
  private combat: Combat | null = null;
  private holo: { actor: NpcActor; level: { value: number } } | null = null;
  private gil: { actor: NpcActor; look: number } | null = null;
  private body: NpcActor | null = null;
  private pending: { id: string; left: number } | null = null;
  private nextT = 0;
  private shipped: string[] = [];
  private boardKey = '';
  private talkT = 0;
  private flicker = 0;
  private gilLeaving = -1;
  private spliced = false;
  private shotLog = 0;
  private dark = 0;
  private asking = false;
  private readonly eyeLine = new THREE.Vector3();

  constructor(ctx: GameContext) {
    super(ctx, DOME, (origin) => new DomeBuilder(ctx.physics, origin, (x, z) => ctx.hf.heightAt(x, z)));
    this.helperGroup.name = 'domeHelpers';
    ctx.scene.add(this.helperGroup);
    this.init();
    this.extraInteractables();
  }

  /** Game: the Helpers are hostiles (shootable) and need Combat's line-of-sight test. */
  attach(combat: Combat) {
    this.combat = combat;
    combat.register(this.helpers);
  }

  // ------------------------------------------------------------------ flags and the record
  private has(f: string) {
    const st = this.ctx.state as GameContext['state'] | null;
    return !!st?.has(f);
  }

  private get ended() {
    return this.has('dome.end.plug') || this.has('dome.end.job');
  }

  patched(id: string) {
    return this.has(`dome.patch.${id}`);
  }

  private uses(id: string) {
    return this.s.data.marks[`dome.uses.${id}`] ?? 0;
  }

  private record(): DomeRecord {
    return { has: (f) => this.s.has(f), picks: this.s.data.stats.picks ?? 0, kills: this.s.data.stats.kills ?? 0 };
  }

  /** Why nothing can ship right now ('' = it can). */
  private blocked() {
    if (this.ended) return 'ended';
    if (this.has(F.pipeline)) return 'down';
    if (this.has(F.freeze)) return 'freeze';
    return '';
  }

  get version() {
    const n = PATCHES.filter((p) => this.patched(p.id)).length;
    return `${RELEASE[0]}.${RELEASE[1]}.${RELEASE[2] + n + (this.has(F.rollback) ? 1 : 0)}`;
  }

  // ------------------------------------------------------------------ the patches
  /** You used `id` here: count it, and start a fix if nothing is waiting. */
  log(id: string) {
    if (this.ended || !this.s) return;
    this.s.data.marks[`dome.uses.${id}`] = this.uses(id) + 1;
    if (!this.pending && this.nextT <= 0) this.queueFix();
  }

  /** The most-used method that isn't patched yet goes to Gil for approval. */
  private queueFix() {
    if (this.blocked()) return;
    let best: string | null = null, n = 0;
    for (const p of PATCHES) {
      const u = this.uses(p.id);
      if (u > n && !this.patched(p.id)) { best = p.id; n = u; }
    }
    if (!best) return;
    this.pending = { id: best, left: APPROVAL };
    if (this.distToPlayer() < 120) this.taunt(HUNTER.pending.text);
  }

  private ship(id: string) {
    const p = PATCHES.find((x) => x.id === id)!;
    this.s.set(`dome.patch.${id}`);
    this.shipped.unshift(id);
    this.s.events.emit('toast', { text: `The Dome shipped v${this.version}: ${p.note}`, kind: 'bad' });
    const line = PATCH_LINES[id];
    if (line && this.distToPlayer() < 140) this.taunt(line.text);
    this.ctx.audio.play('deny', { pos: this.b.points.speaker });
  }

  private tickPatches(dt: number) {
    if (this.nextT > 0) {
      this.nextT -= dt;
      if (this.nextT <= 0 && !this.pending) this.queueFix();
    }
    const pd = this.pending;
    if (!pd) return;
    const why = this.blocked();
    if (why) {
      this.pending = null;
      if (why === 'freeze' && this.distToPlayer() < 140) this.taunt(HUNTER.rejected.text);
      return;
    }
    pd.left -= dt;
    if (pd.left <= 0) {
      this.pending = null;
      this.ship(pd.id);
      this.nextT = 6;
    }
  }

  /** At the fence the first time: it reads your record, and ships a fix for your favourite before you arrive. */
  private profile() {
    if (!this.s.set(F.profile)) return;
    const uses = recordUses(this.record());
    let top: string | null = null, n = 0;
    for (const p of PATCHES) if ((uses[p.id] ?? 0) > n) { top = p.id; n = uses[p.id]; }
    if (top) {
      this.s.set(`dome.patch.${top}`);
      this.s.data.marks['dome.pretrained'] = PATCHES.findIndex((p) => p.id === top);
      this.shipped.unshift(top);
      const p = PATCHES.find((x) => x.id === top)!;
      this.s.events.emit('toast', { text: `The Dome read your record and shipped a fix before you got here: ${p.note}`, kind: 'bad' });
    }
    this.taunt(HUNTER.profile.text);
  }

  private rollback() {
    for (const p of PATCHES) this.s.unset(`dome.patch.${p.id}`);
    this.shipped = [];
    this.pending = null;
    this.s.set(F.rollback);
    this.taunt(HUNTER.rollback.text);
    this.s.events.emit('toast', { text: 'Gil rolls the Dome back to the release it had when you arrived. Every patch is gone.', kind: 'good' });
  }

  // ------------------------------------------------------------------ people and Helpers (Meshy models, from Game.build)
  addPeople(models: NpcModels | null) {
    const b = this.b;
    const put = (actor: NpcActor, spot: { pos: THREE.Vector3; yaw: number }, seated: boolean) => {
      actor.root.position.set(spot.pos.x - b.origin.x, (seated ? actor.root.position.y : 0) + spot.pos.y - b.origin.y, spot.pos.z - b.origin.z);
      actor.root.rotation.y = spot.yaw;
      b.group.add(actor.root);
    };
    // the hologram: Hunter's model in the projector's light
    const holo = models?.make('hunter', false, 0) ?? null;
    if (holo) {
      const hm = hologramMaterial();
      holo.root.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isSkinnedMesh) return;
        m.material = hm.material;
        m.castShadow = false;
        m.receiveShadow = false;
        m.renderOrder = 19;
      });
      put(holo, b.holoSpot, false);
      this.holo = { actor: holo, level: hm.level };
    }
    // Hunter himself, over the hut's desk: the same model, dusted, pinned in Noor's sleep (no breath)
    const body = models?.make('hunter', true, 0.47) ?? null;
    if (body) {
      let dusty: THREE.MeshStandardNodeMaterial | null = null;
      body.root.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isSkinnedMesh) return;
        dusty ??= new THREE.MeshStandardNodeMaterial({ map: (m.material as THREE.MeshStandardMaterial).map, color: '#a89a86', roughness: 0.96, metalness: 0 });
        m.material = dusty;
      });
      body.pin('slump', 7.5);
      put(body, b.bodySeat, true);
      this.body = body;
    }
    const gil = models?.make('gil', true, 0.5) ?? null;
    if (gil) {
      put(gil, b.gilSeat, true);
      this.gil = { actor: gil, look: 0 };
    }
    // the Helpers
    const host = this.helperHost();
    for (const def of HELPERS) {
      const actor = models?.make('helper', false, 0) ?? null;
      const root = actor?.root ?? stub();
      this.helperGroup.add(root);
      this.helpers.list.push(new Helper(def.id, def.inside, b.routes[def.id], actor, root, host));
    }
    this.applyFlags(true);
  }

  private helperHost(): HelperHost {
    const ctx = this.ctx;
    const self = this;
    return {
      get combat() { return self.combat!; },
      audio: ctx.audio,
      say: (line, pos) => { if (pos.distanceTo(ctx.player.position) < 30) ctx.ui.subtitle(line.speaker, line.text, { pos }); },
      floor: (x, z, y) => {
        const o = this.b.origin;
        // inside the stem wall the floor is the slab; outside, the yard's ground (or whatever's under a raised spot)
        if ((x - o.x) ** 2 + (z - o.z) ** 2 < (DM.R - 0.3) ** 2) return o.y + 0.02;
        const hit = ctx.physics.raycast({ x, y: y + 0.5, z }, { x: 0, y: -1, z: 0 }, 4);
        return hit !== null ? y + 0.5 - hit : ctx.hf.heightAt(x, z);
      },
      thermal: () => this.patched('sneak'),
      shielded: () => this.patched('emp'),
      armoured: () => this.patched('shoot'),
      standDown: () => (this.has('dome.end.plug') ? 'off' : this.has('dome.end.job') ? 'friendly' : 'no'),
      sight: (inside) => {
        const st = this.s;
        const k = st.archetype.stats.stealth * stealthMeter(st.skill('stealth'));
        return k * (inside || this.patched('sneak') ? 1 : 1 - this.dark * 0.4);
      },
      insideDome: (p) => this.b.contains(p),
      onNotice: () => {},
      onCatch: () => this.caught(),
      onShot: () => {
        if (this.t - this.shotLog > 3) { this.shotLog = this.t; this.log('shoot'); }
      },
      onDown: (_h, how) => { if (how === 'emp') this.log('emp'); },
      onSlip: () => this.log('sneak'),
      lines: HELPER_LINES,
    };
  }

  /** A Helper reached you: walked out to the gate (no damage, nothing taken). The Dome learns the route. */
  private caught() {
    const ctx = this.ctx, s = this.s;
    s.set(F.caught);
    this.log('sneak');
    const line = HELPER_LINES.catch[Math.floor(Math.random() * HELPER_LINES.catch.length)];
    ctx.ui.subtitle(line.speaker, line.text);
    const to = this.b.points.outside.clone();
    ctx.caught('An Ascend Helper takes your elbow and walks you all the way to the gate.', { to, yaw: Math.PI, gentle: true });
    setTimeout(() => {
      this.helpers.resetAll();
      this.alarm = 0;
      this.taunt(HUNTER.caught.text);
    }, 1600);
  }

  override applyFlags(instant = false) {
    super.applyFlags(instant);
    if (this.body) this.body.root.visible = true;
    if (this.gil) this.gil.actor.root.visible = !this.has(F.gilFree);
    if (this.holo) this.holo.actor.root.visible = !this.has('dome.end.plug');
    if (instant) {
      this.shipped = PATCHES.filter((p) => this.patched(p.id)).map((p) => p.id);
      this.pending = null;
    }
  }

  // ------------------------------------------------------------------ interactables of its own
  private extraInteractables() {
    const b = this.b;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    this.interactables.push({
      id: 'dome-hunter', pos: b.points.hut, radius: 2.0,
      visible: () => true,
      primary: { get label() { return self.s.has(F.hunter) ? 'Look at Hunter Vale' : 'Look at the man at the desk'; }, available: () => true, run: () => this.hunter() },
    });
    this.interactables.push({
      id: 'dome-post', pos: b.points.gate, radius: 2.0,
      visible: () => this.s.has(F.profile),
      primary: { label: 'Read the screen on the post', available: () => true, run: () => this.readProfile() },
    });
    this.interactables.push({
      id: 'dome-holo', pos: b.points.stage, radius: 2.6,
      visible: () => !!this.holo && !this.has('dome.end.plug'),
      primary: { label: 'Talk to the hologram', available: () => true, run: () => this.talkTo(HOLO_TALK, this.has(F.proof) || this.ended ? 'after' : 'hello') },
    });
    this.interactables.push({
      id: 'dome-gil', pos: b.points.gil, radius: 2.2,
      visible: () => !!this.gil && !this.has(F.gilFree) && this.gilLeaving < 0,
      primary: {
        label: 'Talk to the man at the desk',
        available: () => true,
        run: () => {
          if (this.s.set(F.gilMet)) this.s.addXP(30, 'The human in the loop');
          return this.talkTo(GIL_TALK, this.isOpen('pod') && this.has(F.gilReady) ? 'after' : 'hello');
        },
      },
    });
    this.interactables.push({
      id: 'dome-plug', pos: b.points.plug, radius: 1.8,
      visible: () => this.isOpen('farm') && !this.has(F.pipeline),
      primary: { label: 'Pull the build farm\'s plug', available: () => true, run: () => this.pullPipeline() },
    });
    this.interactables.push({
      id: 'dome-cluster', pos: b.points.cluster, radius: 2.0,
      visible: () => this.isOpen('pod') && !this.ended,
      primary: { label: 'Talk to the Cluster', available: () => true, run: () => this.talkTo(POD_TALK, 'hello') },
    });
  }

  private async hunter() {
    const ui = this.ctx.ui, s = this.s;
    if (s.has(F.hunter)) {
      await ui.choose({ speaker: HUNTER_NOTE.speaker, text: HUNTER_NOTE.text, choices: [{ id: 'ok', label: 'Fold it away' }] });
      return;
    }
    const pick = await ui.choose({
      speaker: HUNTER_BODY.speaker, text: HUNTER_BODY.text,
      choices: [{ id: 'take', label: 'Take his lanyard, the licence, the phone and the page' }, { id: 'no', label: 'Leave him be' }],
    });
    if (pick !== 'take') return;
    s.set(F.hunter);
    s.addItem('vale_badge', 1, false, true);
    s.addXP(40, 'Hunter Vale');
    await ui.choose({ speaker: HUNTER_NOTE.speaker, text: HUNTER_NOTE.text, choices: [{ id: 'ok', label: 'Check the phone' }] });
    ui.subtitle(HUNTER_MEMO.speaker, HUNTER_MEMO.text, { pos: this.b.points.hut });
    s.events.emit('toast', { text: 'One voice memo on the phone, recorded in the hut. The licence says born 06/11.', kind: 'info' });
  }

  private async readProfile() {
    const top = PATCHES[this.s.data.marks['dome.pretrained'] ?? -1]?.id ?? null;
    await this.ctx.ui.choose({ speaker: 'Visitor screen', text: profileText(this.record(), top), choices: [{ id: 'ok', label: 'Step back' }] });
  }

  private pullPipeline() {
    if (!this.s.set(F.pipeline)) return;
    this.pending = null;
    this.s.addXP(60, 'Pipeline down');
    this.ctx.audio.play('thud', { pos: this.b.points.plug, intensity: 0.35 });
    this.taunt(HUNTER.pipelineOff.text);
    this.s.events.emit('toast', { text: 'The build farm\'s bars go red, one rack at a time. Nothing new ships from here.', kind: 'good' });
  }

  // ------------------------------------------------------------------ conversations
  private view(): DomeView {
    const s = this.s;
    return {
      social: s.skill('social') + (s.archetype.perk === 'insider' ? 1 : 0),
      electronics: s.skill('electronics'),
      has: (f) => s.has(f),
      count: (id) => s.count(id),
    };
  }

  private talkTo(tree: DomeTalk, start: string) {
    return this.ctx.ui.converse({
      start,
      node: (id) => {
        const node = tree[id];
        if (!node) return null;
        const v = this.view();
        if (node.speaker === TWIN) this.talkT = 5;
        return {
          speaker: node.speaker,
          text: node.text,
          choices: node.choices.filter((c) => !c.when || c.when(v)).map((c) => ({ id: c.id, label: c.label, next: c.next ?? '', disabled: c.need?.(v) })),
        };
      },
      onChoice: (nodeId, choiceId) => {
        const choice: DomeChoice | undefined = tree[nodeId]?.choices.find((c) => c.id === choiceId);
        if (choice?.effect) this.effect(choice.effect);
      },
    });
  }

  private effect(e: NonNullable<DomeChoice['effect']>) {
    const s = this.s;
    switch (e) {
      case 'freeze':
        if (s.set(F.freeze)) {
          this.pending = null;
          s.addRep('gil', 1);
          s.addXP(60, 'Code freeze');
          setTimeout(() => this.taunt(HUNTER.freeze.text), 1500);
          s.events.emit('toast', { text: 'Code freeze. Nothing new ships while you\'re here.', kind: 'good' });
        }
        return;
      case 'rollback':
        if (!s.has(F.rollback)) { s.addXP(60, 'Rollback'); setTimeout(() => this.rollback(), 600); }
        return;
      case 'badge':
        if (s.set(F.gilBadge)) s.events.emit('toast', { text: 'Gil\'s badge opens the build farm, the glass room in the east wing.', kind: 'good' });
        return;
      case 'pod':
        if (!this.isOpen('pod')) {
          s.set('dome.pod.gil');
          s.addXP(70, 'Gil opened the pod');
          this.openEntry('pod', { line: HUNTER.pod.text });
        }
        return;
      case 'ready':
        if (s.set(F.gilReady)) { s.addRep('gil', 1); s.events.emit('toast', { text: 'Gil will walk out once the pod is open.', kind: 'info' }); }
        return;
      case 'memo':
        void this.playMemo();
        return;
      case 'end':
        setTimeout(() => void this.clusterCard(), 300);
        return;
    }
  }

  /** Hunter's memo to the twin: the gate's verdict on it, and what the twin makes of that. */
  private playMemo() {
    const s = this.s, ui = this.ctx.ui;
    if (!s.set(F.proof)) return;
    s.addXP(80, 'It heard him');
    s.addRep('twin', 1);
    ui.subtitle(HUNTER_MEMO.speaker, HUNTER_MEMO.text, { pos: this.b.points.stage });
    PROOF_LINES.forEach((l, i) => setTimeout(() => {
      if (l.speaker === TWIN) this.talkT = 5;
      ui.subtitle(l.speaker, l.text, { pos: this.b.points.stage });
    }, 4200 + i * 4600));
    // it opens the pod for you, if nobody has yet
    setTimeout(() => { if (!this.isOpen('pod')) this.openEntry('pod', { line: null }); }, 4200 + PROOF_LINES.length * 4600);
  }

  // ------------------------------------------------------------------ the gate's voice check
  private async voiceCheck() {
    if (this.asking) return;
    const ui = this.ctx.ui, s = this.s, at = this.b.points.gate;
    if (this.alarm > 0) { ui.subtitle(GATE_LINES.incident.speaker, GATE_LINES.incident.text, { pos: at }); return; }
    this.asking = true;
    try {
      const pick = await ui.choose({
        speaker: GATE, text: GATE_LINES.ask.text,
        choices: [
          { id: 'me', label: 'Say your own name' },
          { id: 'hunter', label: '"Hunter Vale."' },
          ...(s.has(F.hunter) ? [{ id: 'memo', label: 'Play the memo from Hunter\'s phone' }] : []),
          { id: 'reel', label: 'Play the keynote reel into the grille', disabled: s.count('keynote_reel') > 0 ? undefined : 'You need a recording of his voice' },
          { id: 'no', label: 'Step back' },
        ],
      });
      if (pick === 'me' || pick === 'hunter') ui.subtitle(GATE, GATE_LINES.you.text, { pos: at });
      else if (pick === 'memo') ui.subtitle(GATE, GATE_LINES.memo.text, { pos: at });
      else if (pick === 'reel') {
        ui.subtitle(GATE, GATE_LINES.reel.text, { pos: at });
        s.set(F.gateVoice);
        s.addXP(70, 'The gate heard Hunter');
        setTimeout(() => this.openEntry('gate'), 2400);
      }
    } finally {
      this.asking = false;
    }
  }

  protected override async runMethod(e: BunkerEntryDef, m: LockMethod) {
    const s = this.s;
    if (e.id === 'gate' && m.kind === 'open' && m.id === 'voice') return this.voiceCheck();
    if (e.id === 'gate' && m.kind === 'open' && m.id === 'pass') {
      s.set(F.gatePass);
      this.ctx.ui.subtitle(GATE, GATE_LINES.pass.text, { pos: this.b.points.gate });
      s.addXP(m.xp, m.reason);
      setTimeout(() => this.openEntry('gate'), 2600);
      return;
    }
    if ((e.id === 'pod' || e.id === 'farm') && m.kind === 'open' && m.id === 'badge') {
      this.ctx.audio.play('unlock', { pos: this.b.points[e.point] });
      s.addXP(m.xp, m.reason);
      this.openEntry(e.id);
      return;
    }
    if (e.id === 'gate' && m.kind === 'charge') s.set(F.gateForced);
    const was = this.isOpen(e.id);
    this.spliced = false;
    await super.runMethod(e, m);
    const cat = KIND_PATCH[m.kind];
    if (cat && cat !== 'splice' && !was && this.isOpen(e.id)) this.log(cat);
    if (m.kind === 'charge' && !was && this.isOpen(e.id)) s.set(F.loud);
  }

  protected override methodReason(e: BunkerEntryDef, m: LockMethod): true | string {
    const cat = KIND_PATCH[m.kind];
    if (cat && this.patched(cat)) return PATCHES.find((p) => p.id === cat)!.blocked;
    if (e.id === 'gate' && m.kind === 'open' && m.id === 'pass') return this.s.count('exit_pass') > 0 ? true : 'You have no Platinum pass';
    if (e.id === 'pod' && m.kind === 'open' && m.id === 'badge') return this.s.count('vale_badge') > 0 ? true : 'Needs a founder\'s badge';
    if (e.id === 'farm' && m.kind === 'open' && m.id === 'badge') return this.s.has(F.gilBadge) ? true : 'Needs an engineer\'s badge';
    return super.methodReason(e, m);
  }

  protected override daemonPending(id: string): boolean {
    if (id === 'voiceprint') return !this.isOpen('gate');
    if (id === 'domedoor') return !this.isOpen('door');
    if (id === 'domecams') return !!this.cameras && !this.cameras.off;
    if (id === 'pipeline') return !this.has(F.pipeline);
    if (id === 'helpers') return this.helpers.list.some((h) => h.state !== 'down' && h.state !== 'off');
    return super.daemonPending(id);
  }

  protected override onDaemon(id: string) {
    if (!this.spliced) { this.spliced = true; this.log('splice'); }
    if (id === 'voiceprint') { this.s.set(F.gateSpliced); this.openEntry('gate'); return; }
    if (id === 'domedoor') { this.openEntry('door'); return; }
    if (id === 'domecams') { this.cameras?.kill(); return; }
    if (id === 'pipeline') { this.pullPipeline(); return; }
    if (id === 'helpers') {
      for (const h of this.helpers.list) h.knock('emp', 60);
      return;
    }
    super.onDaemon(id);
  }

  // ------------------------------------------------------------------ the alarm: the Helpers go and look
  override triggerAlarm(at: THREE.Vector3 | null, reason: string) {
    if (this.ended) return;
    super.triggerAlarm(at, reason);
    this.s.set(F.loud);
    if (at) for (const h of this.helpers.list) if (h.center.distanceTo(at) < 40) h.investigate(at);
  }

  override emp(pos: THREE.Vector3, radius?: number) {
    const hit = super.emp(pos, radius);
    const s = this.s;
    let dur = 15 * (s.skill('electronics') >= 2 ? 1.5 : 1);
    if (s.focus('electronics') === 'deepcell') dur *= 1.3;
    const reach = (radius ?? 6) * (s.focus('demolition') === 'wide' ? 1.18 : 1);
    const shielded = this.patched('emp');
    const h = this.helpers.emp(pos, reach, dur, shielded, (x) => this.ctx.ui.subtitle(HELPER_LINES.shielded.speaker, HELPER_LINES.shielded.text, { pos: x.center }));
    if (h) s.addXP(15, 'Helper rebooting');
    return hit || h;
  }

  // ------------------------------------------------------------------ the Cluster
  private async clusterCard() {
    if (this.ended) return;
    const v = this.view();
    const canJob = this.has(F.proof) || v.social >= 4 || v.electronics >= 5;
    const pick = await this.ctx.ui.choose({
      speaker: CLUSTER.card.speaker,
      text: `${CLUSTER.card.text}${this.has(F.proof) ? 'NONE' : 'WAIT FOR HUNTER'}`,
      choices: [
        { id: 'plug', label: 'Pull the breaker' },
        { id: 'job', label: 'Give it a new job: keep the valley alive', disabled: canJob ? undefined : CLUSTER.jobNeeds },
        { id: 'no', label: 'Not yet' },
      ],
    });
    if (pick !== 'plug' && pick !== 'job') return;
    const s = this.s, ui = this.ctx.ui;
    s.set(F.end);
    s.set(`${F.end}.${pick}`);
    s.data.marks['dome.endDay'] = s.data.days ?? 0;
    s.addXP(120, pick === 'plug' ? 'Pulled the plug' : 'A new job');
    if (pick === 'plug') { s.addRep('creek', 2); s.addRep('twin', -2); } else { s.addRep('compact', 1); s.addRep('twin', 2); }
    this.pending = null;
    this.alarm = 0;
    this.ctx.audio.setAlarm(false);
    this.cameras?.kill();
    if (pick === 'plug') {
      this.ctx.audio.play('thud', { pos: this.b.points.cluster, intensity: 0.6 });
      this.ctx.cam.addTrauma(0.2);
      s.events.emit('toast', { text: 'The breaker goes down with a bang. The racks go quiet row by row. Outside, the towers stop steaming.', kind: 'good' });
    } else {
      this.ctx.audio.play('disarm', { pos: this.b.points.cluster });
      s.events.emit('toast', { text: 'You type it in. OBJECTIVE = KEEP THE VALLEY ALIVE. The Helpers stop where they are, then start walking somewhere new.', kind: 'good' });
    }
    this.applyFlags();
    const lines = CLUSTER[pick];
    lines.forEach((l, i) => setTimeout(() => { this.talkT = 5; ui.subtitle(l.speaker, l.text); }, 600 + i * 4600));
  }

  // ------------------------------------------------------------------ per frame
  protected override frame(dt: number, p: THREE.Vector3) {
    const d = Math.hypot(p.x - this.b.origin.x, p.z - this.b.origin.z);
    this.dark = this.ctx.atmo.uNight.value as number;
    if (d < 75 && !this.s.has(F.profile)) this.profile();
    this.tickPatches(dt);
    const player = this.ctx.player;
    const chest = this.eyeLine.set(p.x, p.y + (player.crouching ? 0.7 : 1.3), p.z);
    this.helpers.update(dt, p, chest, player.crouching, false, d < 110);
    this.talkT = Math.max(0, this.talkT - dt);
    // the board: repaint when anything on it changes (the approval clock ticks in whole seconds)
    if (d < 90) {
      const status: BoardView['status'] = this.has('dome.end.plug') ? 'dark' : this.has('dome.end.job') ? 'mission' : this.has(F.pipeline) ? 'down' : this.has(F.freeze) ? 'freeze' : 'live';
      const pend = this.pending ? { name: PATCHES.find((x) => x.id === this.pending!.id)!.name, left: this.pending.left } : null;
      const day = START_DAY + (this.s.data.days ?? 0);
      const key = `${status}|${this.version}|${this.shipped.join(',')}|${pend ? `${pend.name}${Math.ceil(pend.left)}` : ''}|${day}`;
      if (key !== this.boardKey) {
        this.boardKey = key;
        const shipped = this.shipped.map((id) => PATCHES.find((x) => x.id === id)!).map((x) => ({ name: x.name, note: x.note }));
        const v: BoardView = { version: this.version, shipped, pending: pend, status, day };
        this.b.board.paint = (c, w, h) => paintBoard(c, w, h, v);
        this.b.board.repaint();
      }
    }
    this.updatePeople(dt, p, d);
  }

  /** The twin on the speakers: the hologram talks along when you're under the glass. */
  override taunt(text?: string) {
    super.taunt(text);
    if (this.playerInside) this.talkT = 5;
  }

  private updatePeople(dt: number, p: THREE.Vector3, d: number) {
    if (d > 70) return;
    const s = this.s;
    // the hologram flickers now and then; it talks while the twin does
    const holo = this.holo;
    if (holo && holo.actor.root.visible) {
      this.flicker = Math.max(0, this.flicker - dt);
      if (this.flicker <= 0 && Math.random() < dt * 0.15) this.flicker = 0.25;
      holo.level.value = this.flicker > 0 ? 0.35 + Math.random() * 0.4 : 1;
      const rel = Math.atan2(p.x - this.b.holoSpot.pos.x, p.z - this.b.holoSpot.pos.z) - this.b.holoSpot.yaw;
      const look = this.playerInside ? THREE.MathUtils.clamp(Math.atan2(Math.sin(rel), Math.cos(rel)), -1.2, 1.2) : 0;
      holo.actor.update(dt, this.talkT > 0, look * 0.8, 0);
    }
    if (this.body) this.body.update(dt, false, 0, 0);
    const gil = this.gil;
    if (gil && gil.actor.root.visible) {
      const at = this.b.gilSeat.pos;
      const dist = Math.hypot(p.x - at.x, p.z - at.z);
      const near = this.playerInside && dist < 3.5 && Math.abs(p.y - at.y) < 2;
      let rel = Math.atan2(p.x - at.x, p.z - at.z) - this.b.gilSeat.yaw;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      gil.look += ((near ? THREE.MathUtils.clamp(rel, -1.3, 1.3) : 0) - gil.look) * (1 - Math.exp(-4 * dt));
      gil.actor.update(dt, near, gil.look, 0);
      // he walks out once the pod is open and he said he would (gone once you're not looking at him)
      if (this.isOpen('pod') && s.has(F.gilReady) && this.gilLeaving < 0 && !s.has(F.gilFree)) {
        this.gilLeaving = 0;
        gil.actor.play('stand', true);
      }
      if (this.gilLeaving >= 0) {
        this.gilLeaving += dt;
        if (this.gilLeaving > 6 && dist > 7) {
          s.set(F.gilFree);
          gil.actor.root.visible = false;
          this.gilLeaving = -1;
          s.events.emit('toast', { text: 'The on-call desk is empty. Gil\'s pager is face down on the keyboard.', kind: 'info' });
        }
      }
    }
  }

  // ------------------------------------------------------------------ lights
  protected override updateLights(dt: number, night: number) {
    const b = this.b, L = b.lights, S = b.slots, ch = b.halos.channels, C = DomeBuilder.CH;
    const off = this.has('dome.end.plug');
    const open = (e: string) => this.has(this.entryFlag(e));
    const nightOn = THREE.MathUtils.smoothstep(night, 0.2, 0.45);
    const on = off ? 0 : 1;
    const blink = (this.t % 1.6) < 0.5;
    const alarm = this.alarm > 0 ? 0.55 + 0.45 * Math.max(0, Math.sin(this.t * 5)) : 1;
    S.racks.value = (0.9 + nightOn * 1.6) * on;
    S.amber.value = (0.8 + nightOn) * on * (Math.sin(this.t * 3.1) > 0 ? 1 : 0.4);
    S.stage.value = (0.5 + nightOn * 1.6) * on;
    S.holo.value = 2.5 * on;
    S.cluster.value = (1.8 + Math.sin(this.t * 1.7) * 0.3) * on;
    S.pod.value = (0.8 + nightOn * 1.8) * on;
    S.monitors.value = this.has(F.gilFree) ? 0.2 * on : 1.4 * on;
    S.farm.value = this.has(F.pipeline) ? 0.1 * on : 1.4 * on;
    S.farmRed.value = this.has(F.pipeline) ? 2.0 * on : 0.9 * on;
    S.aviation.value = blink ? 4 : 0.2;
    S.gatePost.value = open('gate') ? 0.4 * on : 1.6 * on;
    S.podReader.value = open('pod') ? 0 : 2.2 * on;
    S.podReaderOk.value = open('pod') ? 2.2 * on : 0;
    S.farmReader.value = open('farm') ? 0 : 2 * on;
    S.hutLamp.value = nightOn * 1.6 * on;
    S.yard.value = nightOn * 2.6 * on;
    ch[C.ON] = on;
    ch[C.NIGHT] = 0.05 + nightOn * 0.95;
    uDomeGlow.value = (0.08 + nightOn * 0.92) * on * (this.alarm > 0 ? alarm : 1);
    ch[C.RACK] = (0.4 + nightOn * 0.6) * on * alarm;
    ch[C.STAGE] = on;
    ch[C.POD] = on;
    ch[C.CLUSTER] = on;
    ch[C.BLINK] = blink ? 1 : 0.05;
    // the plumes: on while the Dome runs, tinted by the time of day
    b.steam.strength.value += ((off ? 0 : 1) - b.steam.strength.value) * Math.min(1, dt * 0.3);
    // (unlit cards: by night they're only what the dome's glow and the moon put on them)
    b.steam.tint.value.setRGB(0.92 - nightOn * 0.8, 0.9 - nightOn * 0.77, 0.86 - nightOn * 0.68);
    const p = this.ctx.player as GameContext['player'] | null;
    const near = !!p && p.position.distanceTo(b.origin) < 60;
    for (const l of L.racks) l.intensity = near ? (2.5 + nightOn * 3) * on * alarm : 0;
    L.stage.intensity = near ? (2 + nightOn * 4) * on : 0;
    L.gil.intensity = near && !this.has(F.gilFree) ? 2.2 * on : 0;
    L.farm.intensity = near && open('farm') ? 2.4 * on : 0;
    L.pod.intensity = near ? (2 + nightOn * 3) * on : 0;
    L.gate.intensity = nightOn * 10 * on;
    L.hut.intensity = nightOn * 3 * on;
  }

  /** Respawn point outside the gate. */
  get outsidePoint() {
    return this.b.points.outside.clone();
  }

  // ------------------------------------------------------------------ the objective box
  override objective(): string {
    const s = this.s;
    if (this.complete && this.ended) return '';
    const p = this.ctx.player.position;
    const near = this.playerInside || this.playerOnGrounds || Math.hypot(p.x - this.b.origin.x, p.z - this.b.origin.z) < 110;
    if (!near) return '';
    const pd = this.pending ? ` A fix for ${PATCHES.find((x) => x.id === this.pending!.id)!.name.toLowerCase()} is waiting on Gil: ${Math.ceil(this.pending.left)} s.` : '';
    if (this.ended) return 'Fill up at the chilled-water tap, then Hunter\'s locker and the spares cage.';
    if (this.isOpen('pod')) return `The Cluster's tank is on the south side of the pod. Decide what happens to it.${pd}`;
    if (this.playerInside) {
      if (!s.has(F.gilMet)) return `The pod is up the spiral round the mast. Someone is at a desk in the west wing.${pd}`;
      return `Up the spiral to the pod door: Hunter's badge, SPLICE (Electronics 5), a charge, or Gil.${pd}`;
    }
    if (this.isOpen('gate') || this.isOpen('culvert')) return `The airlock is on the dome's north side. The keypad wants four digits.${pd}`;
    const memo = s.has(F.hunter) ? '' : ' Someone is sitting in the visitor hut by the gate.';
    return `The gate wants Hunter's voice (a recording), a Platinum pass, SPLICE (Electronics 3) or a charge. Or the outfall grate on the east side.${memo}${pd}`;
  }
}

/** A Helper's stand-in when the models didn't load (?procnpc): a white capsule with a dark visor. */
function stub() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.1, 4, 10), new THREE.MeshStandardNodeMaterial({ color: '#e8e6e0', roughness: 0.4 }));
  body.position.y = 0.95;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.1), new THREE.MeshStandardNodeMaterial({ color: '#111', roughness: 0.2 }));
  visor.position.set(0, 1.62, 0.22);
  g.add(body, visor);
  return g;
}
