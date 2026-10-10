import * as THREE from 'three/webgpu';
import { Bunker } from './Bunker';
import { GarageBuilder, YARD } from './GarageBuilder';
import { Drone } from './Drone';
import { CH } from './garageDressing';
import { uPoolNight, uPoolBoost } from './garageAtlas';
import { GARAGE } from '@/content/bunkers/garage';
import { XP_REWARDS } from '@/content/progression';
import { TANNER, visibleChoices } from '@/content/dialogue';
import type { TalkCtx } from '@/content/dialogue';
import type { GameContext } from '../context';
import type { LoopHandle } from '@/engine/audio';

/** Flags the Garage's own code reads (the runtime derives the rest from content/bunkers/garage.ts). */
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

/**
 * Tier 1, one instance of the bunker runtime (Bunker.ts): locks, hazards, loot, alarm and Tanner's
 * taunts are data in content/bunkers/garage.ts. What's left here is Tanner himself (the intercom
 * conversation and its effects), what the SPLICE daemons do, the lights, and the objective text.
 */
export class Garage extends Bunker<GarageBuilder> {
  /** World-time of the last "go check your battery" order. */
  private recallAt = -999;
  private genLoop: LoopHandle | null = null;
  private neonLoop: LoopHandle | null = null;

  constructor(ctx: GameContext) {
    super(ctx, GARAGE, (origin) => new GarageBuilder(ctx.physics, origin));
    for (const f of this.b.floodlights) ctx.scene.add(f.light, f.light.target);
    this.guard(new Drone(ctx.physics, this.b.dronePath, this.b.points.dock, this.b.innerBox, this.b.groundsBox, this.b.origin.y));
    this.init();
  }

  /** SeedBot. */
  get drone() {
    return this.drones[0];
  }

  get houseBox() {
    return this.b.innerBox;
  }

  get yardBox() {
    return this.b.groundsBox;
  }

  get playerInYard() {
    return this.playerOnGrounds;
  }

  override startAudio() {
    super.startAudio();
    const a = this.ctx.audio;
    this.genLoop ??= a.loop('generator', this.b.points.generator);
    this.neonLoop ??= a.loop('neon', this.b.w(0, 3.9, 0.2));
  }

  // ------------------------------------------------------------------ Tanner on the intercom
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

  protected override talk() {
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
      this.openEntry('side');
      s.addXP(35, 'Talked the side door open');
    }
  }

  // ------------------------------------------------------------------ SPLICE (the vault keypad's controller)
  /** The keypad, the lasers and SeedBot's dock all hang off one controller. */
  protected override onDaemon(id: string) {
    if (id === 'vault') {
      this.ctx.ui.subtitle('Tanner Pivotson', 'Did you just sudo my door? I paid for the enterprise tier!', { pos: this.b.points.megaphone });
      this.ctx.audio.play('megaphone', { pos: this.b.points.megaphone });
      this.openEntry('vault', { line: null, trauma: 0.15 });
    } else if (id === 'seedbot') {
      this.drone.recall(40);
      this.ctx.ui.subtitle('SeedBot', 'FIRMWARE REVIEW IN PROGRESS. PLEASE DO NOT STEAL ANYTHING DURING THIS TIME.', { pos: this.drone.position.clone() });
    } else super.onDaemon(id);
  }

  // ------------------------------------------------------------------ per-frame visuals
  protected override frame(_dt: number, p: THREE.Vector3) {
    this.b.roof.visible = true; // first person: the roof stays (interior is lit by lamps + your torch)
    // the halo sprite is never frustum-culled (instanced), so drop it when the Garage is far away
    this.b.halos.sprite.visible = p.distanceTo(this.b.origin) < 260;
  }

  protected override updateLights(dt: number, night: number) {
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
  override objective(): string {
    const s = this.s;
    if (s.has(F.complete)) return '';
    const near = this.playerInside || this.playerOnGrounds || d2(this.ctx.player.position, this.b.origin) < 70 * 70;
    if (!near) return '';
    if (s.has(F.vault)) return 'Loot the Runway Room. Water first, then the manifest.';
    if (this.playerInside) {
      if (!s.has(F.lasers)) return 'Lasers in the hall. Jump the low beams, crouch the high ones, or kill them at the fuse box.';
      if (s.has('social.code')) return 'The vault. He said 1234. The lockpick still works if you don\'t trust him.';
      if (s.has('social.digit')) return 'The vault. The code starts with 12. Or pick the five pins.';
      return 'The vault. Five pins, or a code he thinks is obvious.';
    }
    if (s.has(F.side)) return 'Get inside. SeedBot doesn\'t follow you through the door.';
    if (this.playerOnGrounds) return 'Side door is on the east wall. The intercom inside the gate still reaches Tanner.';
    if (s.has(F.gate) || s.has(F.gap)) return 'You\'re through the fence. The drone goes for light and noise, so keep both down.';
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
