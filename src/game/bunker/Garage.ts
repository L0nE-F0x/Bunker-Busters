import * as THREE from 'three/webgpu';
import { Interior } from '../world/interiors';
import { GarageBuilder, YARD, HOUSE, type Door } from './GarageBuilder';
import { Drone, type DroneState } from './Drone';
import { CH } from './garageDressing';
import { Sparks } from '../world/effects';
import { uPoolNight, uPoolBoost } from './garageAtlas';
import { GARAGE } from '@/content/bunkers/garage';
import { ITEMS } from '@/content/items';
import { XP_REWARDS, empRadius, stealthMeter } from '@/content/progression';
import { TANNER, visibleChoices } from '@/content/dialogue';
import type { TalkCtx } from '@/content/dialogue';
import type { GameContext, Interactable } from '../context';
import { isTouch } from '@/engine/device';

const CROUCH_KEY = isTouch ? 'crouch' : 'crouch [C]';
import type { LoopHandle } from '@/engine/audio';

const F = {
  gate: 'garage.gate.open',
  gap: 'garage.gap.open',
  side: 'garage.side.open',
  vault: 'garage.vault.open',
  lasers: 'garage.lasers.off',
  complete: 'garage.complete',
  intelGap: 'garage.gap',
  intelDrone: 'garage.drone',
};

function segIntersect(p1: THREE.Vector2, p2: THREE.Vector2, q1: THREE.Vector2, q2: THREE.Vector2) {
  const d = (p2.x - p1.x) * (q2.y - q1.y) - (p2.y - p1.y) * (q2.x - q1.x);
  if (Math.abs(d) < 1e-9) return false;
  const u = ((q1.x - p1.x) * (q2.y - q1.y) - (q1.y - p1.y) * (q2.x - q1.x)) / d;
  const v = ((q1.x - p1.x) * (p2.y - p1.y) - (q1.y - p1.y) * (p2.x - p1.x)) / d;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1;
}

/** Gameplay controller for Tier 1 — owns the builder, the drone and every lock/hazard. */
export class Garage {
  b: GarageBuilder;
  drone: Drone;
  /** hot sparks (drone brown-outs and crashes, shorted fuse box, EMP bursts) */
  sparks = new Sparks();
  houseBox: THREE.Box3;
  yardBox: THREE.Box3;
  interactables: Interactable[] = [];
  playerInside = false;
  playerInYard = false;
  alarm = 0;
  private prevFeet = new THREE.Vector2();
  private twCooldown: Record<string, number> = {};
  private laserCooldown = 0;
  private tauntTimer = 6;
  private tauntIdx = 0;
  private greeted = false;
  private wrongCodes = 0;
  private droneLoop: LoopHandle | null = null;
  private genLoop: LoopHandle | null = null;
  private neonLoop: LoopHandle | null = null;
  private t = 0;
  private shownCrouchHint = false;
  /** World-time of the last "go check your battery" order. */
  private recallAt = -999;
  // per-frame scratch (update() runs every frame; no garbage in the hot path)
  private readonly feet2 = new THREE.Vector2();
  private readonly twA = new THREE.Vector2();
  private readonly twB = new THREE.Vector2();
  private readonly probe = new THREE.Vector3();
  private readonly chest = new THREE.Vector3();
  private readonly feet = new THREE.Vector3();

  constructor(private ctx: GameContext) {
    const [gx, , gz] = GARAGE.location.position;
    const origin = new THREE.Vector3(gx, ctx.hf.heightAt(gx, gz), gz);
    this.b = new GarageBuilder(ctx.physics, origin);
    ctx.scene.add(this.b.group);
    for (const f of this.b.floodlights) ctx.scene.add(f.light, f.light.target);

    this.houseBox = new THREE.Box3(this.b.w(HOUSE.x0, 0, HOUSE.z0), this.b.w(HOUSE.x1, HOUSE.h, HOUSE.z1));
    this.yardBox = new THREE.Box3(this.b.w(YARD.x0, -2, YARD.z0), this.b.w(YARD.x1, 8, YARD.z1));

    this.drone = new Drone(ctx.physics, this.b.dronePath, this.b.points.dock, this.houseBox, this.yardBox, origin.y, {
      onStateChange: (s, prev) => this.onDroneState(s, prev),
      onZap: () => this.zap(),
      onSputter: () => {
        ctx.audio.play('droneSputter', { pos: this.drone.position });
        if (this.distToPlayer() < 30) ctx.ui.subtitle('SeedBot', '*bzzt* LOW BATTERY. ENTERING POWER-SAVE. *whirr*');
      },
      onCrash: (k) => {
        ctx.audio.play('thud', { pos: this.drone.position, intensity: 0.4 + k * 0.5 });
        ctx.audio.play('bounce', { pos: this.drone.position, intensity: 0.6 + k * 0.4 });
        ctx.puffs?.emit(this.drone.position.clone().setY(this.drone.position.y - 0.3), 10, 1 + k * 1.5, 0.4, 0.45);
      },
    });
    ctx.scene.add(this.drone.group);
    ctx.scene.add(this.sparks.sprite);
    this.drone.fx = { sparks: this.sparks, get puffs() { return ctx.puffs; } };

    this.applyFlags(true);
    this.buildInteractables();
  }

  private get s() {
    return this.ctx.state;
  }

  private distToPlayer() {
    const pl = this.ctx.player as GameContext["player"] | null;
    return pl ? pl.position.distanceTo(this.b.origin) : Infinity;
  }

  /** Make the world match saved progress. */
  applyFlags(instant = false) {
    const st = this.ctx.state as GameContext['state'] | null;
    const has = (f: string) => st?.has(f) ?? false;
    const open = (d: Door, on: boolean) => {
      d.target = on ? 1 : 0;
      if (instant) d.open = d.target;
      if (on && d.collider) {
        this.ctx.physics.world.removeCollider(d.collider, false);
        d.collider = null;
      } else if (!on && !d.collider) {
        d.collider = this.ctx.physics.addBox(d.colliderSpec.pos, d.colliderSpec.half);
      }
    };
    open(this.b.doors.gateL, has(F.gate));
    open(this.b.doors.gateR, has(F.gate));
    this.b.gateLockMesh.visible = !has(F.gate);
    open(this.b.doors.gap, has(F.gap));
    open(this.b.doors.side, has(F.side));
    open(this.b.doors.vault, has(F.vault));
    for (const l of this.b.lasers) l.mesh.visible = !has(F.lasers);
    for (const tw of this.b.tripwires) {
      tw.armed = !has(`garage.${tw.id}.disarmed`);
      tw.mesh.visible = tw.armed;
    }
    for (const spot of this.b.lootSpots) {
      if (!spot.lid) continue;
      spot.lid.userData.opening = false;
      spot.lid.rotation.x = has(`garage.loot.${spot.id}`) ? -1.9 : 0;
    }
    this.wrongCodes = 0;
    this.greeted = false;
  }

  startAudio() {
    const a = this.ctx.audio;
    this.droneLoop ??= a.loop('drone', this.drone.position);
    this.genLoop ??= a.loop('generator', this.b.points.generator);
    this.neonLoop ??= a.loop('neon', this.b.w(0, 3.9, 0.2));
  }

  // ------------------------------------------------------------------ interactions
  private buildInteractables() {
    const { ctx } = this;
    const picks = () => this.s.count('lockpick');
    const pickAction = (pins: number, title: string, onSuccess: () => void) => ({
      label: `Pick lock · ${pins} pins`,
      available: (): true | string => (picks() > 0 ? true : 'Need a lockpick'),
      run: async () => {
        const res = await ctx.ui.lockpick({
          pins,
          title,
          onBreak: () => {
            this.s.removeItem('lockpick', 1);
            this.s.events.emit('toast', { text: `Lockpick snapped (${picks()} left)`, kind: 'bad' });
            return picks() > 0;
          },
        });
        if (res === 'success') {
          this.s.data.stats.picks++;
          ctx.audio.play('unlock', { pos: ctx.player.position });
          this.s.addXP(XP_REWARDS.lockPicked + pins * 5, 'Lock picked');
          onSuccess();
        }
      },
    });

    // perimeter gate
    this.interactables.push({
      id: 'gate',
      pos: this.b.points.gate,
      radius: 2.2,
      visible: () => !this.s.has(F.gate),
      primary: pickAction(3, 'GATE PADLOCK', () => {
        this.s.set(F.gate);
        this.applyFlags();
        this.ctx.audio.play('door', { pos: this.b.points.gate });
        this.taunt('My gate! That padlock had a five-star rating!');
      }),
      secondary: {
        label: 'Place a breach charge',
        available: () => this.chargeReason('gate'),
        run: () => this.breach('gate'),
      },
    });
    // intercom just outside the gate, and one inside the yard, so a recall is reachable mid-job
    const gate = this.b.points.gate;
    const hail = (id: string, pos: THREE.Vector3) => {
      this.interactables.push({
        id,
        pos,
        radius: 2.1,
        visible: () => !this.s.has('debriefed'),
        primary: {
          label: 'Hail Tanner on the intercom',
          available: () => true,
          run: () => this.talk(),
        },
      });
    };
    hail('intercom-out', new THREE.Vector3(gate.x, this.b.origin.y + 1.1, gate.z + 4.2));
    hail('intercom-in', new THREE.Vector3(gate.x + 2.4, this.b.origin.y + 1.1, gate.z - 3.2));
    // secret fence gap
    this.interactables.push({
      id: 'gap',
      pos: this.b.points.gap,
      radius: 2.6,
      visible: () => !this.s.has(F.gap) && this.s.has(F.intelGap),
      primary: {
        label: 'Peel back the loose fence',
        available: () => true,
        run: () => {
          this.s.set(F.gap);
          this.applyFlags();
          ctx.audio.play('door', { pos: this.b.points.gap });
          this.s.addXP(20, 'Found another way in');
          this.s.events.emit('toast', { text: 'The raccoons were right.', kind: 'good' });
        },
      },
    });
    // tripwires
    for (const tw of this.b.tripwires) {
      this.interactables.push({
        id: tw.id,
        pos: tw.a.clone().lerp(tw.b, 0.5),
        radius: 2.4,
        visible: () => tw.armed,
        primary: {
          label: 'Disarm tripwire',
          available: () => (this.s.skill('electronics') >= 1 ? true : `Requires Electronics 1 — or ${CROUCH_KEY} to step over`),
          run: () => {
            tw.armed = false;
            tw.mesh.visible = false;
            this.s.set(`garage.${tw.id}.disarmed`);
            ctx.audio.play('disarm');
            this.s.addXP(XP_REWARDS.tripwireDisarmed, 'Tripwire disarmed');
          },
        },
        secondary: {
          label: 'Yank the wire',
          available: () => (this.s.skill('demolition') >= 3 ? true : 'Requires Demolition 3 — or crouch over it'),
          run: () => this.yankWire(tw),
        },
      });
    }
    // side door
    this.interactables.push({
      id: 'side',
      pos: this.b.points.sideDoor,
      radius: 2.0,
      visible: () => !this.s.has(F.side),
      primary: pickAction(4, 'SIDE DOOR PADLOCK', () => this.openSide()),
      secondary: {
        label: 'Another way through the door',
        available: () => true,
        run: () => this.sideOptions(),
      },
    });
    // fuse box
    this.interactables.push({
      id: 'fuse',
      pos: this.b.points.fuseBox,
      radius: 1.8,
      visible: () => !this.s.has(F.lasers),
      primary: {
        label: 'Cut power to the lasers',
        available: () => true,
        run: async () => {
          const elec = this.s.skill('electronics');
          if (elec >= 5) {
            this.s.addXP(20, 'Lasers disabled');
            this.s.events.emit('toast', { text: 'You know this box. The lasers die quietly.', kind: 'good' });
          } else if (elec >= 1) {
            const ok = await ctx.ui.circuit({ title: 'FUSE BOX', difficulty: 0 });
            if (!ok) return;
            this.s.addXP(20, 'Lasers disabled');
          } else {
            ctx.audio.play('zap');
            ctx.post.damage.value = 0.8;
            ctx.cam.addTrauma(0.5);
            this.s.damage(15);
            this.s.events.emit('toast', { text: 'You yanked every wire. Lasers off. So is your hair.', kind: 'bad' });
          }
          this.s.set(F.lasers);
          this.applyFlags();
          ctx.audio.play('disarm');
          const fb = this.b.points.fuseBox;
          this.sparks.emit(fb.clone().add(new THREE.Vector3(-0.45, 0.3, 0)), 36, 3, { up: 1, floorY: this.b.origin.y + 0.1, size: 0.025, life: 0.8 });
          for (const l of this.b.lasers) for (const e of [l.a, l.b]) this.sparks.emit(e, 10, 1.6, { up: 0.5, floorY: this.b.origin.y + 0.1, size: 0.02, life: 0.5 });
        },
      },
    });
    // vault door
    this.interactables.push({
      id: 'vault',
      pos: this.b.points.vaultDoor,
      radius: 2.0,
      visible: () => !this.s.has(F.vault),
      primary: pickAction(5, 'VAULT LOCK', () => this.openVault()),
      secondary: {
        label: 'Keypad, or something louder',
        available: () => true,
        run: () => this.vaultOptions(),
      },
    });
    // loot
    for (const spot of this.b.lootSpots) {
      this.interactables.push({
        id: spot.id,
        pos: spot.pos,
        radius: 1.9,
        visible: () => this.s.has(F.vault) && !this.s.has(`garage.loot.${spot.id}`),
        primary: {
          label: spot.id === 'safe' ? "Crack Tanner's safe" : 'Open supply crate',
          available: () => true,
          run: () => this.loot(spot.id),
        },
      });
    }
  }

  private chargeReason(which: 'gate' | 'side' | 'vault'): true | string {
    const need = which === 'gate' ? 1 : which === 'side' ? 3 : 5;
    if (this.s.skill('demolition') < need) return `Requires Demolition ${need}`;
    if (this.s.count('charge') < 1) return 'Need a breach charge';
    return true;
  }

  private breach(which: 'gate' | 'side' | 'vault') {
    if (this.chargeReason(which) !== true) { this.ctx.audio.play('deny'); return; }
    if (!this.s.removeItem('charge', 1)) return;
    const quiet = which !== 'vault' && this.s.skill('demolition') >= 4 && this.ctx.player.crouching;
    if (which === 'gate') {
      this.s.set(F.gate);
      this.applyFlags();
      this.ctx.audio.play('door', { pos: this.b.points.gate });
      this.taunt('MY GATE. That was not in the terms of service!');
    } else if (which === 'side') this.openSide();
    else this.openVault();
    this.ctx.audio.play('thud', { pos: this.ctx.player.position, intensity: 0.85 });
    this.ctx.cam.addTrauma(quiet ? 0.15 : 0.45);
    if (quiet) this.s.events.emit('toast', { text: 'Shaped charge. The alarm stayed asleep.', kind: 'good' });
    else {
      const at = which === 'gate' ? this.b.points.gate : which === 'side' ? this.b.points.sideDoor : this.b.points.vaultDoor;
      this.triggerAlarm(at, which === 'vault' ? 'The vault door leaves in pieces.' : 'Breach charge. Everyone heard that.');
    }
    this.s.addXP(XP_REWARDS.breach, 'Lock breached');
  }

  private yankWire(tw: { id: string; armed: boolean; mesh: { visible: boolean }; a: THREE.Vector3; b: THREE.Vector3 }) {
    tw.armed = false;
    tw.mesh.visible = false;
    this.s.set(`garage.${tw.id}.disarmed`);
    const quiet = this.s.skill('demolition') >= 4 && this.ctx.player.crouching;
    const at = tw.a.clone().lerp(tw.b, 0.5);
    if (quiet) {
      this.ctx.audio.play('disarm');
      this.s.events.emit('toast', { text: 'You eased the cans down. The alarm stayed asleep.', kind: 'good' });
      this.s.addXP(XP_REWARDS.tripwireDisarmed, 'Tripwire eased out');
    } else {
      this.ctx.audio.play('cans', { pos: at });
      this.triggerAlarm(at, 'You ripped a tripwire out. The cans noticed.');
      this.s.addXP(8, 'Tripwire yanked');
    }
  }

  private async sideOptions() {
    const charge = this.chargeReason('side');
    const pick = await this.ctx.ui.choose({
      speaker: 'Side door',
      text: 'The padlock is the patient way. These are the other two.',
      choices: [
        { id: 'short', label: 'Short the keypad', disabled: this.s.skill('electronics') >= 1 ? undefined : 'Requires Electronics 1' },
        { id: 'charge', label: 'Place a breach charge', disabled: charge === true ? undefined : charge },
        { id: 'no', label: 'Leave it' },
      ],
    });
    if (pick === 'short') {
      const ok = await this.ctx.ui.circuit({ title: 'KEYPAD BYPASS', difficulty: 1 });
      if (ok) {
        this.s.addXP(XP_REWARDS.keypadShorted, 'Keypad shorted');
        this.openSide();
      }
    } else if (pick === 'charge') this.breach('side');
  }

  private vaultHint() {
    if (this.s.has('social.code')) return 'He said it out loud. 1 2 3 4.';
    if (this.s.has('social.digit')) return 'Tanner slipped. It starts with 1, then 2. He said the rest was obvious.';
    if (this.s.has('social.told') || this.s.has(F.intelDrone)) return 'Everyone who knows him says the code is obvious. Nobody wrote the digits down.';
    return 'No hint on the housing. Three wrong codes and it locks you out.';
  }

  private async vaultOptions() {
    const locked = this.wrongCodes >= 3;
    const charge = this.chargeReason('vault');
    const pick = await this.ctx.ui.choose({
      speaker: 'Runway Room',
      text: 'Five pins, or a keypad Tanner is very proud of, or a noise.',
      choices: [
        { id: 'pad', label: 'Use the keypad', disabled: locked ? 'Keypad locked out' : undefined },
        { id: 'charge', label: 'Place a breach charge', disabled: charge === true ? undefined : charge },
        { id: 'no', label: 'Step back' },
      ],
    });
    if (pick === 'charge') { this.breach('vault'); return; }
    if (pick !== 'pad') return;
    const res = await this.ctx.ui.keypad({ title: 'RUNWAY ROOM', code: '1234', hint: this.vaultHint() });
    if (res === 'ok') {
      this.s.addXP(40, 'Vault code cracked');
      this.openVault();
    } else if (res === 'wrong') {
      this.wrongCodes++;
      if (this.wrongCodes >= 3) this.triggerAlarm(this.b.points.vaultDoor, 'Keypad lockout!');
    }
  }

  /** Tanner hears the Defector one Social rank up (Insider). Handler halves the recall cooldown. */
  private talkCtx(): TalkCtx {
    const insider = this.s.archetype.perk === 'insider' ? 1 : 0;
    const cooldown = this.s.capstone('social') === 'handler' ? 37.5 : 75;
    return {
      skill: (id) => this.s.skill(id) + (id === 'social' ? insider : 0),
      has: (f) => this.s.has(f),
      gateOpen: this.s.has(F.gate),
      sideOpen: this.s.has(F.side),
      recallReady: this.t - this.recallAt > cooldown,
      archetype: this.s.archetype.id,
    };
  }

  private talk() {
    const start = this.s.has(F.complete) ? 'after' : 'hello';
    return this.ctx.ui.converse({
      start,
      node: (id) => {
        const node = TANNER[id];
        if (!node) return null;
        const ctx = this.talkCtx();
        return {
          speaker: node.speaker,
          text: node.text(ctx),
          choices: visibleChoices(id, ctx).map((c) => ({
            id: c.id,
            label: c.label,
            next: c.next,
            disabled: c.disabled?.(ctx) ?? undefined,
          })),
        };
      },
      onChoice: (nodeId, choiceId) => {
        const choice = TANNER[nodeId]?.choices.find((c) => c.id === choiceId);
        if (choice?.effect) this.applyTalk(choice.effect);
      },
    });
  }

  private applyTalk(effect: NonNullable<(typeof TANNER)[string]['choices'][number]['effect']>) {
    const s = this.s;
    if (effect === 'told' && s.set('social.told')) s.addXP(XP_REWARDS.talk, 'He explained the scam');
    if (effect === 'past' && s.set('social.past')) s.addXP(20, 'He remembers you');
    if (effect === 'kade' && s.set('tanner.kade')) s.addXP(XP_REWARDS.talk, 'Who Tanner pays');
    if (effect === 'digit' && s.set('social.digit')) s.addXP(35, 'Half a vault code');
    if (effect === 'code' && s.set('social.code')) s.addXP(45, 'He said the code out loud');
    if (effect === 'recall') {
      this.recallAt = this.t;
      const extra = s.focus('social') === 'longcon' ? 5 : 0;
      const handler = s.capstone('social') === 'handler' ? 2 : 1;
      this.drone.recall((8 + s.skill('social') + extra) * handler);
      if (s.set('social.recalled')) s.addXP(15, 'SeedBot sent home');
      this.ctx.audio.play('megaphone', { pos: this.b.points.megaphone });
    }
    if (effect === 'openGate' && !s.has(F.gate)) {
      s.set(F.gate);
      s.set('social.gate');
      this.applyFlags();
      this.ctx.audio.play('door', { pos: this.b.points.gate });
      s.addXP(30, 'Talked the gate open');
    }
    if (effect === 'openSide' && !s.has(F.side)) {
      s.set('social.side');
      this.openSide();
      s.addXP(35, 'Talked the side door open');
    }
  }

  private openSide() {
    this.s.set(F.side);
    this.applyFlags();
    this.ctx.audio.play('door', { pos: this.b.points.sideDoor });
    this.taunt('That door was load-bearing! Emotionally!');
  }

  private openVault() {
    this.s.set(F.vault);
    this.applyFlags();
    this.ctx.audio.play('door', { pos: this.b.points.vaultDoor });
    this.ctx.cam.addTrauma(0.25);
    this.taunt('NO. Not the Runway Room. That is where I keep my runway!');
  }

  private loot(id: string) {
    const { ctx } = this;
    this.s.set(`garage.loot.${id}`);
    const spot = this.b.lootSpots.find((l) => l.id === id)!;
    if (spot.lid) spot.lid.userData.opening = true;
    ctx.audio.play('loot');
    const table = GARAGE.loot;
    const got: string[] = [];
    if (id === 'safe') {
      // The water and the manifest come with you even if the pack is already rude about it.
      for (const g of table.guaranteed) {
        const n = this.s.addItem(g.item, g.qty, false, true);
        if (n) got.push(`${n}× ${ITEMS[g.item].name}`);
      }
      if (this.s.weight > this.s.carryLimit + 0.05) {
        this.s.events.emit('toast', { text: 'Overburdened. The water is the point. Drop the junk.', kind: 'info' });
      }
    } else {
      const half = id === 'crate_a' ? table.rolls.slice(0, 4) : table.rolls.slice(4);
      for (const r of half) {
        if (Math.random() > r.chance) continue;
        const qty = r.qty[0] + Math.floor(Math.random() * (r.qty[1] - r.qty[0] + 1));
        const n = this.s.addItem(r.item, qty);
        if (n) got.push(`${n}× ${ITEMS[r.item].name}`);
      }
    }
    ctx.ui.banner('LOOTED', got.join('  ·  '), 'good');
    const all = this.b.lootSpots.every((l) => this.s.has(`garage.loot.${l.id}`));
    if (all && this.s.set(F.complete)) {
      this.s.data.stats.busted++;
      setTimeout(() => {
        this.s.addXP(table.xp, 'BUNKER BUSTED: The Garage');
        ctx.audio.sting('busted');
        ctx.ui.banner('BUNKER BUSTED', 'The cistern is open. Radio Mara at the campfire. She wants the names read out loud.', 'good');
        this.s.events.emit('bunkerComplete', { id: 'garage' });
        this.taunt('Fine. FINE. I am pivoting. To grief.');
      }, 1800);
    }
  }

  private taunt(text?: string) {
    const line = text ?? GARAGE.owner.taunts[this.tauntIdx++ % GARAGE.owner.taunts.length];
    this.ctx.audio.play('megaphone', { pos: this.b.points.megaphone });
    this.ctx.ui.subtitle(GARAGE.owner.name, line, { pos: this.b.points.megaphone });
  }

  private onDroneState(s: DroneState, prev: DroneState) {
    const a = this.ctx.audio;
    if (s === 'suspicious') a.play('droneAlert', { pos: this.drone.position });
    if (s === 'alert') {
      this.triggerAlarm(null, 'SeedBot spotted you!');
    }
    if (s === 'disabled') a.play('emp', { pos: this.drone.position });
    if (prev === 'disabled' && s === 'patrol') {
      a.play('droneAlert', { pos: this.drone.position });
      if (this.distToPlayer() < 35) this.ctx.ui.subtitle('SeedBot', 'REBOOT COMPLETE. HAVE I MISSED ANY INVESTOR CALLS?');
    }
  }

  triggerAlarm(at: THREE.Vector3 | null, reason: string) {
    this.alarm = 7;
    this.ctx.audio.setAlarm(true, this.b.points.megaphone);
    this.s.events.emit('toast', { text: reason, kind: 'bad' });
    if (at) this.drone.investigate(at);
    if (Math.random() < 0.7) this.taunt(['INTRUDER! SeedBot, disrupt them!', 'Security breach! This is going in the investor update!', 'Alarm! Somebody tell my lawyer! ...Oh right.'][Math.floor(Math.random() * 3)]);
  }

  private zap() {
    const { ctx } = this;
    ctx.audio.play('zap');
    ctx.post.damage.value = 1;
    ctx.cam.addTrauma(0.9);
    ctx.caught('SeedBot tased you. You wake up outside the fence, lighter by one lockpick.');
    this.drone.detection = 0;
  }

  /** EMP blast from the player's grenade. */
  emp(pos: THREE.Vector3, _radius?: number) {
    let reach = empRadius(this.s.skill('demolition'));
    if (this.s.focus('demolition') === 'wide') reach *= 1.18;
    if (this.drone.position.distanceTo(pos) <= reach && this.drone.state !== 'disabled') {
      let dur = 12 * (this.s.skill('electronics') >= 2 ? 1.5 : 1);
      if (this.s.focus('electronics') === 'deepcell') dur *= 1.3;
      this.drone.emp(dur);
      this.s.addXP(XP_REWARDS.droneEmp, 'SeedBot fried');
      this.ctx.ui.subtitle('SeedBot', 'ERR_VIBES_NOT_FOUND. SHUTTING DOWN.');
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ per-frame
  /**
   * Draw culling only (no gameplay): the far stand-in past ~140 m from the fence, and the interior's
   * own draws (vault door, whiteboard, lasers, loot) whenever nobody can see in. The house is closed
   * except the side door, so the interior shows from inside, or from near that door once it's open.
   */
  private _interior: Interior | null = null;
  /**
   * The house as a sealed interior (see world/interiors.ts): block walls, the roll-up welded shut,
   * window slits that are solid glowing panels. The one way out is the east side door, a portal
   * while it's open.
   */
  get interior() {
    if (this._interior) return this._interior;
    const hb = this.houseBox, side = this.b.doors.side;
    const { pos, half } = side.colliderSpec;
    const door = new THREE.Box3(pos.clone().sub(half), pos.clone().add(half)).expandByVector(new THREE.Vector3(0.6, 0.15, 0.2));
    return (this._interior = new Interior('garage', new THREE.Matrix4(),
      (p) => p.x > hb.min.x + 0.05 && p.x < hb.max.x - 0.05 && p.z > hb.min.z + 0.05 && p.z < hb.max.z - 0.05 && p.y < hb.max.y,
      [{ box: door, open: () => side.open > 0.005 || side.target > 0 }],
      [this.b.group, this.drone.group]));
  }

  cull(cam: THREE.Vector3) {
    this.b.lod.update(cam);
    const hb = this.houseBox, side = this.b.doors.side;
    const inside = cam.x > hb.min.x - 0.5 && cam.x < hb.max.x + 0.5 && cam.z > hb.min.z - 0.5 && cam.z < hb.max.z + 0.5 && cam.y < hb.max.y + 1;
    const throughDoor = (side.open > 0.01 || side.target > 0) && cam.distanceToSquared(this.b.points.sideDoor) < 32 * 32;
    this.b.interior.visible = inside || throughDoor;
  }

  update(dt: number) {
    const { ctx } = this;
    this.t += dt;
    this.sparks.update(dt);
    const player = ctx.player as GameContext['player'] | null;
    if (!player) { this.updateAmbient(dt); return; }
    const p = player.position;
    const feet2 = this.feet2.set(p.x, p.z);

    this.playerInside = this.houseBox.containsPoint(this.probe.copy(p).setY(this.houseBox.min.y + 1));
    this.playerInYard = this.yardBox.containsPoint(this.probe.copy(p).setY(this.yardBox.min.y + 1));
    this.b.roof.visible = true; // first person: the roof stays (interior is lit by lamps + your torch)
    // the halo sprite is never frustum-culled (instanced), so drop it when the Garage is far away
    this.b.halos.sprite.visible = p.distanceTo(this.b.origin) < 260;

    // doors
    for (const d of Object.values(this.b.doors)) {
      d.open += (d.target - d.open) * (1 - Math.exp(-3 * dt));
      d.pivot.rotation.y = d.open * d.amount;
    }
    for (const spot of this.b.lootSpots) {
      if (spot.lid?.userData.opening) spot.lid.rotation.x += (-1.9 - spot.lid.rotation.x) * (1 - Math.exp(-5 * dt));
    }

    // tripwires: crossing the wire while standing triggers the cans
    for (const tw of this.b.tripwires) {
      this.twCooldown[tw.id] = Math.max(0, (this.twCooldown[tw.id] ?? 0) - dt);
      if (!tw.armed || this.twCooldown[tw.id] > 0) continue;
      const a = this.twA.set(tw.a.x, tw.a.z), b = this.twB.set(tw.b.x, tw.b.z);
      if (segIntersect(this.prevFeet, feet2, a, b) && player.grounded) {
        if (player.crouching) {
          if (!this.shownCrouchHint) { this.shownCrouchHint = true; this.s.events.emit('toast', { text: 'Carefully stepped over a tripwire.', kind: 'info' }); }
        } else {
          this.twCooldown[tw.id] = 4;
          ctx.audio.play('cans', { pos: tw.a.clone().lerp(tw.b, 0.5) });
          this.triggerAlarm(tw.a.clone().lerp(tw.b, 0.5), 'You tripped a wire! Tin cans everywhere.');
        }
      } else if (!this.shownCrouchHint && Math.hypot(feet2.x - (a.x + b.x) / 2, feet2.y - (a.y + b.y) / 2) < 4.5) {
        this.shownCrouchHint = true;
        this.s.events.emit('toast', { text: `Tripwire ahead — ${CROUCH_KEY} to step over it.`, kind: 'info' });
      }
    }

    // lasers
    this.laserCooldown = Math.max(0, this.laserCooldown - dt);
    if (!this.s.has(F.lasers)) {
      for (const l of this.b.lasers) {
        const pulse = 0.85 + Math.sin(this.t * 12) * 0.15;
        l.intensity.value = (this.alarm > 0 ? 14 : 7) * pulse;
        if (this.laserCooldown > 0 || !this.playerInside) continue;
        const dz = Math.abs(p.z - l.a.z);
        const bottom = p.y, top = p.y + player.height;
        if (dz < 0.3 && bottom < l.a.y && top > l.a.y && p.x > l.a.x && p.x < l.b.x) {
          this.laserCooldown = 5;
          ctx.audio.play('droneAlert');
          this.triggerAlarm(this.b.points.sideDoor.clone(), l.id === 'laser_low' ? 'Laser tripped! (Jump over low beams.)' : 'Laser tripped! (Crouch under high beams.)');
          ctx.post.alert.value = 1;
        }
      }
    }

    // drone
    const night = ctx.atmo.uNight.value as number;
    const stealthMult = ctx.state.archetype.stats.stealth * stealthMeter(this.s.skill('stealth')) * (this.s.skill('electronics') >= 3 ? 0.85 : 1);
    this.drone.update(dt, {
      playerChest: this.chest.copy(p).setY(p.y + (player.crouching ? 0.7 : 1.2)),
      playerFeet: this.feet.copy(p),
      noise: player.noise,
      stealthMult,
      playerCollider: player.collider,
      night,
      insideHouse: this.playerInside,
      visibility: ctx.atmo.visibility,
    });
    this.droneLoop?.setPosition(this.drone.position);
    this.droneLoop?.setGain(this.drone.state === 'disabled' ? 0 : this.drone.state === 'sputter' ? 0.35 : 0.9);
    this.droneLoop?.setPitch(this.drone.state === 'alert' ? 1.25 : this.drone.state === 'sputter' ? 0.7 : 1);

    // alarm decay
    if (this.alarm > 0) {
      this.alarm -= dt;
      if (this.alarm <= 0 && this.drone.state !== 'alert') ctx.audio.setAlarm(false);
      else if (this.drone.state === 'alert') this.alarm = Math.max(this.alarm, 1);
    }

    this.updateLights(dt, night);

    // taunts
    const d = this.distToPlayer();
    if (!this.greeted && d < 55) {
      this.greeted = true;
      this.taunt('Hey! You! This is a PRIVATE apocalypse. Members only.');
      this.tauntTimer = 30;
    }
    if (d < 45 && !this.s.has(F.complete) && !this.playerInside) {
      this.tauntTimer -= dt;
      if (this.tauntTimer <= 0) {
        this.tauntTimer = 28 + Math.random() * 20;
        this.taunt();
      }
    }

    this.prevFeet.copy(feet2);
  }

  /** Title-screen mode: no player, just make the place feel alive. */
  private updateAmbient(dt: number) {
    this.sparks.update(dt);
    for (const d of Object.values(this.b.doors)) {
      d.open += (d.target - d.open) * (1 - Math.exp(-3 * dt));
      d.pivot.rotation.y = d.open * d.amount;
    }
    const night = this.ctx.atmo.uNight.value as number;
    const far = new THREE.Vector3(0, -1000, 0);
    this.drone.update(dt, { playerChest: far, playerFeet: far, noise: 0, stealthMult: 0, playerCollider: undefined, night, insideHouse: false });
    this.droneLoop?.setPosition(this.drone.position);
    this.updateLights(dt, night);
  }

  private updateLights(dt: number, night: number) {
    for (const f of this.b.floodlights) {
      const on = night > 0.3 ? 1 : 0;
      f.light.intensity = on * 90;
      f.cone.intensity.value = on * (this.alarm > 0 ? 0.7 : 0.35);
      f.cone.mesh.visible = on > 0; // by day the cone adds nothing: skip its draw
      if (this.alarm > 0) f.light.color.setHSL(0.0, 1, 0.5 + 0.5 * Math.max(0, Math.sin(this.t * 10)));
      else f.light.color.set(0xffe6c0);
    }
    for (const bulb of this.b.floodBulbs) bulb.value = night > 0.3 ? 8 : 0.3;
    const n = Math.sin(this.t * 13) * Math.sin(this.t * 2.7 + 1);
    this.b.neonFlicker.value = n > 0.93 ? 0.1 : 1;
    this.b.interiorLight.intensity = (this.alarm > 0 ? 6 + Math.max(0, Math.sin(this.t * 10)) * 20 : 14) * (Math.sin(this.t * 31) > 0.97 ? 0.4 : 1);
    this.b.interiorLight.color.set(this.alarm > 0 ? 0xff3020 : 0xffb070);
    for (const bc of this.b.beacons) {
      bc.visible = this.alarm > 0;
      if (bc.visible) bc.rotation.y += dt * 5;
    }
    // the Runway Room pulses with its ceiling beacon during an alarm
    this.b.vaultLight.color.set(this.alarm > 0 ? 0xff2a18 : 0xffc070);
    this.b.vaultLight.intensity = this.alarm > 0 ? 4 + Math.max(0, Math.sin(this.t * 10)) * 14 : 10;
    const ch = this.b.halos.channels;
    this.b.blinkers.forEach((bl, i) => {
      const ph = ((this.t + bl.offset) % bl.period) / bl.period;
      bl.u.value = ph < 0.5 ? bl.on : bl.on * 0.08;
      ch[this.b.blinkChannel[i]] = ph < 0.5 ? 1 : 0.04;
    });
    // halos, tubes and light pools follow the same lights
    const nightOn = THREE.MathUtils.smoothstep(night, 0.2, 0.45);
    const flick = Math.sin(this.t * 31) > 0.97 ? 0.4 : 1;
    const alarmOn = this.alarm > 0;
    const alarmPulse = alarmOn ? Math.max(0, Math.sin(this.t * 10)) : 0;
    ch[CH.ON] = 1;
    ch[CH.NIGHT] = 0.04 + nightOn * 0.96;
    ch[CH.TUBES] = (alarmOn ? 0.25 : 1) * flick;
    ch[CH.ALARM] = alarmOn ? 0.3 + alarmPulse : 0;
    ch[CH.NEON] = this.b.neonFlicker.value;
    ch[CH.LASER] = this.b.lasers[0]?.mesh.visible ? (alarmOn ? 1.4 : 1) : 0;
    this.b.tubeGlow.value = (alarmOn ? 1.2 : 5) * flick;
    (this.b.tubeColor.value as THREE.Color).set(alarmOn ? 0xff6050 : 0xffe2b8);
    uPoolNight.value = nightOn;
    uPoolBoost.value = this.b.neonFlicker.value < 0.5 ? 0.75 : 1;
  }

  /**
   * Context-sensitive advice while you are at the Garage (inside, in the yard, or within 70 m).
   * Elsewhere it stays quiet and the quest log (Story) speaks for the main story.
   */
  objective(): string {
    const s = this.s;
    if (s.has(F.complete)) return '';
    const near = this.playerInside || this.playerInYard || d2(this.ctx.player.position, this.b.origin) < 70 * 70;
    if (!near) return '';
    if (s.has(F.vault)) return 'Loot the Runway Room. The water is the point. The manifest is the map.';
    if (this.playerInside) {
      if (!s.has(F.lasers)) return 'Lasers in the hall. Jump the low beams, crouch the high ones, or kill them at the fuse box.';
      if (s.has('social.code')) return 'The vault. He said 1234. The lockpick still works if you don\'t trust him.';
      if (s.has('social.digit')) return 'The vault. The code starts with 12. Or pick the five pins.';
      return 'The vault. Five pins, or a code he thinks is obvious.';
    }
    if (s.has(F.side)) return 'Get inside. SeedBot doesn\'t follow you through the door.';
    if (this.playerInYard) return 'Side door is on the east wall. The intercom inside the gate still reaches Tanner.';
    if (s.has(F.gate) || s.has(F.gap)) return 'You\'re through the fence. The drone is the tax on being bright or loud.';
    const gap = s.has(F.intelGap) ? ', use the loose panel on the north-east fence,' : '';
    return `Get past the fence: pick the gate${gap} or hail Tanner on the intercom beside it.`;
  }

  /** Respawn point just outside the gate. */
  get outsidePoint() {
    return this.b.w(2, 0, YARD.z1 + 7);
  }
}

function d2(a: THREE.Vector3, b: THREE.Vector3) {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}
