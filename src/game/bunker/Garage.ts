import * as THREE from 'three/webgpu';
import { GarageBuilder, YARD, HOUSE, type Door } from './GarageBuilder';
import { Drone, type DroneState } from './Drone';
import { GARAGE } from '@/content/bunkers/garage';
import { ITEMS } from '@/content/items';
import { XP_REWARDS } from '@/content/progression';
import type { GameContext, Interactable } from '../context';
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

  constructor(private ctx: GameContext) {
    const [gx, , gz] = GARAGE.location.position;
    const origin = new THREE.Vector3(gx, ctx.hf.heightAt(gx, gz), gz);
    this.b = new GarageBuilder(ctx.physics, origin);
    ctx.scene.add(this.b.group, this.b.interiorLight, this.b.vaultLight);
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
    });
    ctx.scene.add(this.drone.group);

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
    });
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
          available: () => (this.s.skill('electronics') >= 1 ? true : 'Requires Electronics 1 — or crouch [C] to step over'),
          run: () => {
            tw.armed = false;
            tw.mesh.visible = false;
            this.s.set(`garage.${tw.id}.disarmed`);
            ctx.audio.play('disarm');
            this.s.addXP(XP_REWARDS.tripwireDisarmed, 'Tripwire disarmed');
          },
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
        label: 'Short-circuit the keypad',
        available: () => (this.s.skill('electronics') >= 1 ? true : 'Requires Electronics 1'),
        run: async () => {
          const ok = await ctx.ui.circuit({ title: 'KEYPAD BYPASS', difficulty: 1 });
          if (ok) {
            this.s.addXP(XP_REWARDS.keypadShorted, 'Keypad shorted');
            this.openSide();
          }
        },
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
          if (this.s.skill('electronics') >= 1) {
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
        label: 'Use the keypad',
        available: () => (this.wrongCodes >= 3 ? 'Keypad locked out' : true),
        run: async () => {
          const res = await ctx.ui.keypad({
            title: 'RUNWAY ROOM',
            code: '1234',
            hint: this.s.has(F.intelDrone) ? 'Blueprint: "default code never changed".' : 'A sticky note reads: "default!!"',
          });
          if (res === 'ok') {
            this.s.addXP(30, 'Vault code cracked');
            this.openVault();
          } else if (res === 'wrong') {
            this.wrongCodes++;
            if (this.wrongCodes >= 3) {
              this.triggerAlarm(this.b.points.vaultDoor, 'Keypad lockout!');
            }
          }
        },
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
      for (const g of table.guaranteed) { this.s.addItem(g.item, g.qty); got.push(`${g.qty}× ${ITEMS[g.item].name}`); }
    } else {
      const half = id === 'crate_a' ? table.rolls.slice(0, 3) : table.rolls.slice(3);
      for (const r of half) {
        if (Math.random() > r.chance) continue;
        const qty = r.qty[0] + Math.floor(Math.random() * (r.qty[1] - r.qty[0] + 1));
        this.s.addItem(r.item, qty);
        got.push(`${qty}× ${ITEMS[r.item].name}`);
      }
    }
    ctx.ui.banner('LOOTED', got.join('  ·  '), 'good');
    const all = this.b.lootSpots.every((l) => this.s.has(`garage.loot.${l.id}`));
    if (all && this.s.set(F.complete)) {
      this.s.data.stats.busted++;
      setTimeout(() => {
        this.s.addXP(table.xp, 'BUNKER BUSTED: The Garage');
        ctx.ui.banner('BUNKER BUSTED', 'The Garage · Tier 1 cleared. Tier 2 "Apex Vault" intel arrives in v0.2.', 'good');
        this.s.events.emit('bunkerComplete', { id: 'garage' });
        this.taunt('Fine. FINE. I am pivoting. To grief.');
      }, 1800);
    }
  }

  private taunt(text?: string) {
    const line = text ?? GARAGE.owner.taunts[this.tauntIdx++ % GARAGE.owner.taunts.length];
    this.ctx.audio.play('megaphone', { pos: this.b.points.megaphone });
    this.ctx.ui.subtitle(GARAGE.owner.name, line);
    if (this.ctx.audio.ready && this.voiceEnabled) this.ctx.audio.say(line);
  }

  voiceEnabled = true;

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
  emp(pos: THREE.Vector3, radius: number) {
    if (this.drone.position.distanceTo(pos) <= radius && this.drone.state !== 'disabled') {
      const dur = 12 * (this.s.skill('electronics') >= 2 ? 1.5 : 1);
      this.drone.emp(dur);
      this.s.addXP(XP_REWARDS.droneEmp, 'SeedBot fried');
      this.ctx.ui.subtitle('SeedBot', 'ERR_VIBES_NOT_FOUND. SHUTTING DOWN.');
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ per-frame
  update(dt: number) {
    const { ctx } = this;
    this.t += dt;
    const player = ctx.player as GameContext['player'] | null;
    if (!player) { this.updateAmbient(dt); return; }
    const p = player.position;
    const feet2 = new THREE.Vector2(p.x, p.z);

    this.playerInside = this.houseBox.containsPoint(p.clone().setY(this.houseBox.min.y + 1));
    this.playerInYard = this.yardBox.containsPoint(p.clone().setY(this.yardBox.min.y + 1));
    this.b.roof.visible = true; // first person: the roof stays (interior is lit by lamps + your torch)

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
      const a = new THREE.Vector2(tw.a.x, tw.a.z), b = new THREE.Vector2(tw.b.x, tw.b.z);
      if (segIntersect(this.prevFeet, feet2, a, b) && player.grounded) {
        if (player.crouching) {
          if (!this.shownCrouchHint) { this.shownCrouchHint = true; this.s.events.emit('toast', { text: 'Carefully stepped over a tripwire.', kind: 'info' }); }
        } else {
          this.twCooldown[tw.id] = 4;
          ctx.audio.play('cans', { pos: tw.a.clone().lerp(tw.b, 0.5) });
          this.triggerAlarm(tw.a.clone().lerp(tw.b, 0.5), 'You tripped a wire! Tin cans everywhere.');
        }
      } else if (!this.shownCrouchHint && feet2.distanceTo(a.clone().lerp(b, 0.5)) < 4.5) {
        this.shownCrouchHint = true;
        this.s.events.emit('toast', { text: 'Tripwire ahead — crouch [C] to step over it.', kind: 'info' });
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
    const stealthMult = (ctx.state.archetype.id === 'infiltrator' ? 0.6 : 1) * (this.s.skill('electronics') >= 3 ? 0.8 : 1);
    this.drone.update(dt, {
      playerChest: p.clone().add(new THREE.Vector3(0, player.crouching ? 0.7 : 1.2, 0)),
      playerFeet: p.clone(),
      noise: player.noise,
      stealthMult,
      playerCollider: player.collider,
      night,
      insideHouse: this.playerInside,
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
    void dt;
    for (const f of this.b.floodlights) {
      const on = night > 0.3 ? 1 : 0;
      f.light.intensity = on * 90;
      f.cone.intensity.value = on * (this.alarm > 0 ? 0.7 : 0.35);
      if (this.alarm > 0) f.light.color.setHSL(0.0, 1, 0.5 + 0.5 * Math.max(0, Math.sin(this.t * 10)));
      else f.light.color.set(0xffe6c0);
    }
    for (const bulb of this.b.floodBulbs) bulb.value = night > 0.3 ? 8 : 0.3;
    const n = Math.sin(this.t * 13) * Math.sin(this.t * 2.7 + 1);
    this.b.neonFlicker.value = n > 0.93 ? 0.1 : 1;
    this.b.interiorLight.intensity = (this.alarm > 0 ? 6 + Math.max(0, Math.sin(this.t * 10)) * 20 : 14) * (Math.sin(this.t * 31) > 0.97 ? 0.4 : 1);
    this.b.interiorLight.color.set(this.alarm > 0 ? 0xff3020 : 0xffb070);
    for (const bl of this.b.blinkers) {
      const ph = ((this.t + bl.offset) % bl.period) / bl.period;
      bl.u.value = ph < 0.5 ? bl.on : bl.on * 0.08;
    }
  }

  /** Context-sensitive objective text. */
  objective(): string {
    const s = this.s;
    if (s.has(F.complete)) return 'Bunker busted! Head back to the campfire to rest & save.';
    if (s.has(F.vault)) return 'Loot the Runway Room.';
    if (this.playerInside) return s.has(F.lasers) ? 'Get into the vault.' : 'Get past the lasers (jump low beams, crouch under high ones) — or find the fuse box.';
    if (s.has(F.side)) return 'Get inside the building.';
    if (this.playerInYard) return 'Break into the building — the side door is on the east wall.';
    if (s.has(F.gate) || s.has(F.gap)) return 'Slip into the yard. Mind the drone.';
    if (d2(this.ctx.player.position, this.b.origin) < 60 * 60) return 'Get past the fence: pick the gate padlock' + (s.has(F.intelGap) ? ' or use the NE fence gap.' : '.');
    return '';
  }

  /** Respawn point just outside the gate. */
  get outsidePoint() {
    return this.b.w(2, 0, YARD.z1 + 7);
  }
}

function d2(a: THREE.Vector3, b: THREE.Vector3) {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}
