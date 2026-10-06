import * as THREE from 'three/webgpu';
import type { GameContext, TalkChoiceView } from '../context';
import type { Landmarks } from '../world/Landmarks';
import type { GameState } from '../State';
import { Sparks } from '../world/effects';
import { ITEMS } from '@/content/items';
import { XP_REWARDS } from '@/content/progression';
import { Site } from './Site';
import { TubeBuild, CH, DECK, TZ, STATION, INNER, AIRLOCK, EAST_END, WEST_END, POD } from './tubeBuild';

/** Story flags (see Site.ts). */
const F = {
  found: 'site.tube.found',
  done: 'site.tube.done',
  power: 'site.tube.power',
  airlock: 'site.tube.airlock',
  bag: 'site.tube.bag',
  cabinet: 'site.tube.cabinet',
  locker: 'site.tube.locker',
  terminus: 'site.tube.terminus',
  blackbox: 'site.tube.blackbox',
  ride: 'site.tube.ride',
} as const;

/**
 * Near/far switch measured from the nearest point of a line (the track) instead of a centre, so a
 * 300 m structure keeps its detail wherever you stand along it and costs nothing past `hide`.
 */
class LineLod {
  private farOn = false;
  constructor(
    private a: THREE.Vector3, private b: THREE.Vector3,
    private near: THREE.Object3D, private far: THREE.Object3D, private always: THREE.Object3D,
    private swap = 140, private hide = 650,
  ) {
    far.visible = false;
  }

  dist(p: THREE.Vector3) {
    const dx = this.b.x - this.a.x, dz = this.b.z - this.a.z;
    const t = THREE.MathUtils.clamp(((p.x - this.a.x) * dx + (p.z - this.a.z) * dz) / (dx * dx + dz * dz), 0, 1);
    return Math.hypot(p.x - (this.a.x + dx * t), p.z - (this.a.z + dz * t));
  }

  update(cam: THREE.Vector3) {
    const d = this.dist(cam);
    const band = this.swap * 0.08;
    if (this.farOn ? d < this.swap - band : d > this.swap + band) this.farOn = !this.farOn;
    this.near.visible = !this.farOn;
    this.far.visible = this.farOn && d < this.hide;
    this.always.visible = d < this.hide;
  }
}

/**
 * The Tube: LOOPR's hyperloop test track. A station on stilts, a pod that has never been anywhere,
 * 300 m of sealed tube on pylons between two hills, and a broken span you can climb into. Power the
 * station and the running lights race away down the line into the dark.
 */
export class TubeSite extends Site {
  private b: TubeBuild;
  private line: LineLod;
  private sparks = new Sparks();
  private synced: GameState | null = null;
  private inv = new THREE.Matrix4();
  private local = new THREE.Vector3();
  private t = 0;
  /** Seconds since the station powered up (-1: dark). */
  private powerT = -1;
  private podX = 0;
  private podV = 0;
  private ride: { t: number; done: boolean } | null = null;

  constructor(ctx: GameContext, landmarks: Landmarks) {
    super('tube', ctx, landmarks);
    this.b = new TubeBuild(ctx.physics, ctx.hf, this.frame);
    this.group.add(this.b.root);
    this.b.root.add(this.sparks.sprite);
    this.line = new LineLod(this.frame.p(WEST_END - 28, 0, TZ), this.frame.p(EAST_END + 18, 0, TZ), this.b.near, this.b.far, this.b.lights);
    this.inv.copy(this.frame.m).invert();

    const P = this.b.pts;
    this.spot('heart', 0, DECK, -3.5);
    this.spot('stairs', P.stairBase.x, P.stairBase.y, P.stairBase.z);
    this.spot('approach', 6, 0, -40);
    this.spot('pod', P.podIn.x, P.podIn.y, P.podIn.z);
    this.spot('control', P.console.x, P.console.y, P.console.z);
    this.spot('airlock', P.airlock.x, P.airlock.y, P.airlock.z);
    this.spot('inner', P.inner.x, P.inner.y, P.inner.z);
    this.spot('break', P.breakIn.x, P.breakIn.y, P.breakIn.z);
    this.spot('cabinet', P.cabinet.x, P.cabinet.y, P.cabinet.z);
    this.spot('locker', P.locker.x, P.locker.y, P.locker.z);
    this.spot('westEnd', P.westEnd.x, P.westEnd.y, P.westEnd.z);

    const L = this.landmarks.audioSpots;
    L.push({ kind: 'hum', pos: this.frame.p(0, DECK + 1.5, 0) });
    L.push({ kind: 'wind-hollow', pos: this.frame.p(-58, 2, TZ) });
    L.push({ kind: 'wind-hollow', pos: this.frame.p(WEST_END, 10, TZ) });

    this.addInteractions();
  }

  private at(p: THREE.Vector3, dy = 1.1) {
    return this.frame.p(p.x, p.y + dy, p.z);
  }

  private toast(text: string, kind: 'info' | 'good' | 'bad' = 'info') {
    this.s.events.emit('toast', { text, kind });
  }

  private loot(items: { id: string; qty: number }[]) {
    const got: string[] = [];
    for (const it of items) {
      const n = this.s.addItem(it.id, it.qty);
      if (n) got.push(`${n}× ${ITEMS[it.id]?.name ?? it.id}`);
    }
    return got.join(', ');
  }

  // ------------------------------------------------------------------ interactions
  private addInteractions() {
    const P = this.b.pts;
    this.interactables.push({
      id: 'tube.control',
      pos: this.at(P.console, 1.0),
      radius: 2.0,
      primary: {
        label: 'Wake Station Zero',
        available: () => (this.s.has(F.power) ? 'Station Zero is awake. It will not stop telling you.' : true),
        run: () => this.powerPanel(),
      },
    });
    const airlock = {
      label: 'Open the pressure door',
      available: () => true as const,
      run: () => this.openAirlock(),
    };
    this.interactables.push({ id: 'tube.airlock', pos: this.at(P.airlock, 1.2), radius: 2.2, visible: () => !this.s?.has(F.airlock), primary: airlock });
    this.interactables.push({
      id: 'tube.airlockIn',
      pos: this.frame.p((AIRLOCK.x0 + AIRLOCK.x1) / 2, AIRLOCK.floor + 1.1, TZ + 0.2),
      radius: 1.8,
      visible: () => !this.s?.has(F.airlock),
      primary: airlock,
    });
    this.interactables.push({
      id: 'tube.screen',
      pos: this.at(P.podScreen, 1.1),
      radius: 1.6,
      primary: { label: 'The pod screen', available: () => true, run: () => this.screen() },
    });
    this.interactables.push({
      id: 'tube.bin',
      pos: this.at(P.podBin, 1.3),
      radius: 1.5,
      visible: () => !this.s?.has(F.bag),
      primary: { label: 'Open the overhead bin', available: () => true, run: () => this.bin() },
    });
    this.interactables.push({
      id: 'tube.cabinet',
      pos: this.at(P.cabinet, 1.0),
      radius: 1.8,
      visible: () => !this.s?.has(F.cabinet),
      primary: {
        label: 'Pick the maintenance cabinet · 4 pins',
        available: () => {
          if (this.s.skill('lockpicking') < 1) return 'Requires Lockpicking 1';
          if (this.s.count('lockpick') < 1) return 'Need a lockpick';
          return true;
        },
        run: () => this.pickCabinet(),
      },
    });
    this.interactables.push({
      id: 'tube.locker',
      pos: this.at(P.locker, 1.0),
      radius: 2.0,
      visible: () => !this.s?.has(F.locker),
      primary: {
        label: 'Breach the founders\' locker',
        available: () => {
          if (this.s.skill('demolition') < 2) return 'Requires Demolition 2. The padlock is rated for founders.';
          if (this.s.count('charge') < 1) return 'Need a breach charge';
          return true;
        },
        run: () => this.blowLocker(),
      },
    });
  }

  private async powerPanel() {
    if (this.s.has(F.power)) return;
    const elec = this.s.skill('electronics');
    const cells = this.s.count('battery');
    const pick = await this.ctx.ui.choose({
      speaker: 'Station Zero · control',
      text: 'A console of dead screens and one big red button labelled LAUNCH (DEMO ONLY). The main breaker is tripped and the UPS is empty: a slot for a single lithium cell, and a note taped over it: "do NOT use the founder\'s vape battery again".',
      choices: [
        { id: 'bridge', label: 'Bridge the main breaker', disabled: elec >= 1 ? undefined : 'Requires Electronics 1' },
        { id: 'cell', label: 'Slot a lithium cell into the UPS', disabled: cells > 0 ? undefined : 'Need a Lithium Cell' },
        { id: 'leave', label: 'Leave it dark' },
      ],
    });
    if (pick === 'bridge') {
      if (elec < 5) {
        const ok = await this.ctx.ui.circuit({ title: 'MAIN BREAKER · STATION ZERO', difficulty: 2 });
        if (!ok) { this.ctx.audio.play('deny'); return; }
      }
      this.powerUp(45);
    } else if (pick === 'cell') {
      if (!this.s.removeItem('battery', 1)) return;
      this.powerUp(30);
    }
  }

  private powerUp(xp: number) {
    if (!this.s.set(F.power)) return;
    this.powerT = 0;
    this.ctx.audio.play('zap', { pos: this.ctx.player.position });
    const p = this.b.pts.console.clone().setY(DECK + 1.0);
    this.sparks.emit(p, 18, 1.6, { up: 0.8, floorY: DECK + 0.02, electric: true, size: 0.02 });
    this.s.addXP(xp, 'Station Zero powered');
    this.toast('Breakers clack down the line. Station Zero hums, and something in the pod bay lurches.', 'good');
  }

  private openAirlock() {
    if (!this.s.set(F.airlock)) return;
    this.b.airlock.target = 1;
    this.ctx.audio.play('door', { pos: this.ctx.player.position });
    this.ctx.cam.addTrauma(0.12);
    this.ctx.puffs?.emit(this.frame.p((AIRLOCK.x0 + AIRLOCK.x1) / 2, AIRLOCK.floor + 1, TZ - 1.4), 8, 0.6, 0.3, 0.5);
    if (this.s.has(F.power)) this.toast('The door equalises with a sigh and swings out. The tube breathes stale air at you.', 'info');
    else this.toast('You spin the wheel. The tube inhales; sand rattles somewhere far down the line.', 'info');
    this.s.addXP(15, 'Airlock');
  }

  private bin() {
    if (!this.s.set(F.bag)) return;
    const got = this.loot([{ id: 'ration', qty: 1 }, { id: 'water', qty: 1 }, { id: 'boarding_pass', qty: 1 }]);
    this.ctx.audio.play('pickup');
    this.toast(got ? `An inaugural gift bag: ${got}. The tag says "for our first rider".` : 'Your pack is full.', got ? 'good' : 'bad');
    this.s.addXP(XP_REWARDS.cache, 'Gift bag');
  }

  private async pickCabinet() {
    const res = await this.ctx.ui.lockpick({
      pins: 4,
      title: 'MAINTENANCE CABINET',
      onBreak: () => {
        this.s.removeItem('lockpick', 1);
        this.toast(`Lockpick snapped (${this.s.count('lockpick')} left)`, 'bad');
        return this.s.count('lockpick') > 0;
      },
    });
    if (res !== 'success' || !this.s.set(F.cabinet)) return;
    this.s.data.stats.picks++;
    this.ctx.audio.play('unlock', { pos: this.ctx.player.position });
    const got = this.loot([{ id: 'lockpick', qty: 2 }, { id: 'battery', qty: 1 }, { id: 'scrap', qty: 2 }]);
    this.toast(got ? `Track maintenance kit: ${got}.` : 'Your pack is full.', got ? 'good' : 'bad');
    this.s.addXP(XP_REWARDS.lockPicked + 20, 'Maintenance cabinet');
  }

  private blowLocker() {
    if (this.s.has(F.locker) || !this.s.removeItem('charge', 1)) return;
    this.s.set(F.locker);
    this.s.set(F.terminus);
    const B = this.b;
    B.locker.target = 1;
    B.lockerLoot.visible = true;
    const quiet = this.s.focus('demolition') === 'shaped';
    this.ctx.audio.play('thud', { pos: this.ctx.player.position, intensity: 0.9 });
    this.ctx.cam.addTrauma(quiet ? 0.15 : 0.45);
    const p = B.pts.locker.clone().add(new THREE.Vector3(1.1, 1.0, 0));
    this.sparks.emit(p, 40, 3.5, { up: 1.2, floorY: B.pts.locker.y + 0.02, size: 0.03 });
    this.ctx.puffs?.emit(this.frame.p(p.x, p.y, p.z), 14, 1.5, 0.6, 0.8);
    const got = this.loot([{ id: 'medkit', qty: 1 }, { id: 'water', qty: 2 }, { id: 'ration', qty: 2 }, { id: 'charge', qty: 1 }]);
    this.s.addXP(XP_REWARDS.breach + 25, 'Founders\' locker');
    this.toast(got ? `The founder's go-bag: ${got}. A laminated card: "TERMINUS · PRIVATE. Leave deliveries at the blast door."` : 'Your pack is full.', got ? 'good' : 'bad');
  }

  // ------------------------------------------------------------------ the pod screen
  private async screen() {
    if (!this.s.has(F.power)) {
      await this.ctx.ui.choose({
        speaker: 'POD-01 "MOMENTUM"',
        text: 'The screen is black. Under the front seat, a bright orange box ticks quietly to itself. Everything in here is waiting for the station to wake up.',
        choices: [{ id: 'ok', label: 'Leave it' }],
      });
      return;
    }
    let ride = false;
    await this.ctx.ui.converse({
      start: 'hello',
      node: (id) => this.node(id),
      onChoice: (_n, c) => {
        if (c === 'blackbox' && this.s.set(F.blackbox)) {
          this.s.addXP(60, 'Flight recorder');
          if (this.s.set(F.done)) this.toast('The Tube was never going to San Francisco. It goes into the hill, to somebody\'s door.', 'good');
        }
        if (c === 'go') ride = true;
      },
    });
    if (ride) this.startRide();
  }

  private node(id: string): { speaker: string; text: string; choices: TalkChoiceView[] } | null {
    const sp = 'POD-01 "MOMENTUM"';
    const back: TalkChoiceView = { id: 'back', label: 'Back to the menu.', next: 'hello' };
    switch (id) {
      case 'hello':
        return {
          speaker: sp,
          text: 'Welcome aboard! You are our first rider in 1,094 days. Please remain seated while we disrupt transportation. Your journey is carbon neutral*. (*Offsets pending.)',
          choices: [
            { id: 'safety', label: 'Play the safety video.', next: 'safety' },
            { id: 'blackbox', label: 'Read the flight recorder under the seat.', next: 'blackbox' },
            { id: 'ride', label: 'Book Run 002.', next: 'ride', disabled: this.ride ? 'Already departing.' : undefined },
            { id: 'bye', label: 'Step off.' },
          ],
        };
      case 'safety':
        return {
          speaker: sp,
          text: 'In the unlikely event of a loss of vacuum, the tube will fill with Nevada. Oxygen masks will not drop, because we cut them in the Series A. Please brace by thinking about our valuation.',
          choices: [back],
        };
      case 'blackbox':
        return {
          speaker: 'Flight recorder · Run 001',
          text: 'Launch 09:00. Target speed 1,100 km/h. Peak speed 41 km/h. Track ends at 0.3 km; pod stops; founder exits and walks back. 09:40: press release, "LOOPR completes historic first passenger run." 10:15: Series B closes. Appended later, founder voice note: "Phase two is the private extension. Station Zero to the Terminus, through the hill. Not on the investor map. The door\'s on my side."',
          choices: [back, { id: 'bye', label: 'Pocket the recorder\'s card.' }],
        };
      case 'ride':
        return {
          speaker: sp,
          text: 'Run 002 is ready to board! Destination: the end of the finished track. Estimated top speed: 41 km/h. Please note: the return trip has not been funded.',
          choices: [{ id: 'go', label: 'Ride it.' }, back],
        };
    }
    return null;
  }

  /** Run 002: a fade, a rumble, and you are standing at the end of the line. The pod goes home alone. */
  private startRide() {
    if (this.ride) return;
    this.ride = { t: 0, done: false };
    this.ctx.audio.play('door', { pos: this.ctx.player.position });
    this.ctx.cam.addTrauma(0.3);
  }

  private stepRide(dt: number) {
    const r = this.ride!;
    r.t += dt;
    const post = this.ctx.post;
    if (r.t < 0.9) post.fade.value = Math.min(1, r.t / 0.9);
    else if (!r.done) {
      r.done = true;
      post.fade.value = 1;
      const p = this.b.pts.westEnd;
      this.ctx.player.teleport(this.frame.p(p.x, p.y + 0.1, p.z));
      this.ctx.audio.play('thud', { pos: this.ctx.player.position, intensity: 0.6 });
      this.ctx.cam.addTrauma(0.5);
    } else if (r.t > 2.2) {
      post.fade.value = Math.max(0, 1 - (r.t - 2.2) / 1.0);
      if (r.t > 3.2) {
        post.fade.value = 0;
        this.ride = null;
        if (this.s?.set(F.ride)) this.s.addXP(30, 'Run 002');
        this.s?.events.emit('toast', { text: 'Run 002 complete. Top speed: 41 km/h. The pod asks for five stars, then goes home without you.', kind: 'info' });
      }
    }
  }

  // ------------------------------------------------------------------ frame
  private sync(s: GameState) {
    this.synced = s;
    const B = this.b;
    B.airlock.target = B.airlock.open = s.has(F.airlock) ? 1 : 0;
    const lk = s.has(F.locker);
    B.locker.target = B.locker.open = lk ? 1 : 0;
    B.lockerLoot.visible = lk;
    this.powerT = s.has(F.power) ? 999 : -1;
    this.podX = this.podV = 0;
    B.setPod(0);
  }

  override update(dt: number, cam: THREE.Vector3) {
    super.update(dt, cam);
    this.line.update(cam);
    const s = this.ctx.state;
    if (s && s !== this.synced) this.sync(s);
    this.t += dt;
    const B = this.b;
    const t = this.t;
    const night = THREE.MathUtils.smoothstep(this.ctx.atmo.uNight.value as number, 0.2, 0.45);
    const ch = B.halos.channels;
    const S = B.slots;
    const blink = (t % 2.0) / 2.0 < 0.14 ? 1 : 0.04;
    S.red.intensity.value = blink * 14;
    ch[CH.RED] = blink;

    // power-up sequence
    let lit = 0, screens = 0;
    if (this.powerT >= 0) {
      const pt = (this.powerT += dt);
      const flick = pt < 1.4 ? (Math.sin(pt * 47) > 0.2 ? 1 : 0.15) : 1;
      lit = Math.min(1, pt / 1.0) * flick;
      screens = THREE.MathUtils.clamp((pt - 0.8) / 0.6, 0, 1);
      B.chase.power.value = THREE.MathUtils.clamp((pt - 1.3) / 0.3, 0, 1);
      B.chase.front.value = Math.min(1.1, Math.max(0, (pt - 1.5) / 5.0) * 1.1);
      if (pt > 1.2 && pt - dt <= 1.2) {
        // the lurch: a shove forward against the dock clamps
        this.podV = 7.5;
        this.ctx.audio.play('thud', { pos: this.frame.p(0, DECK + 1, TZ), intensity: 0.7 });
        if (this.ctx.player && cam.distanceTo(this.frame.p(0, DECK, 0)) < 30) this.ctx.cam.addTrauma(0.3);
      }
    } else {
      B.chase.power.value = 0;
      B.chase.front.value = 0;
    }
    // pod spring back to its dock
    if (Math.abs(this.podV) > 1e-3 || Math.abs(this.podX) > 1e-3) {
      const k = 9, c = 2.2;
      this.podV += (-k * this.podX - c * this.podV) * dt;
      this.podX += this.podV * dt;
      if (Math.abs(this.podV) < 0.01 && Math.abs(this.podX) < 0.005) { this.podX = 0; this.podV = 0; }
      B.setPod(this.podX);
    }
    // lights and screens
    const flick = Math.sin(t * 29) > 0.95 ? 0.35 : 1;
    S.strip.intensity.value = 0.1 + lit * 5;
    S.emerg.intensity.value = (lit > 0.5 ? 3 : 2.0) * flick;
    S.cove.intensity.value = 0.1 + lit * 4;
    S.console.intensity.value = 0.4 + lit * 3;
    ch[CH.POWER] = lit;
    ch[CH.EMERG] = flick;
    ch[CH.CONSOLE] = 0.15 + lit * 0.85;
    ch[CH.COVE] = lit;
    B.screenPower.k.value = 0.04 + screens * 1.0;
    B.poolPower.k.value = lit * 0.7;
    B.vl.platform.intensity = 1.5 + lit * 9;
    B.vl.control.intensity = 1.0 + lit * 4;
    B.vl.pod.intensity = lit * 4;
    B.vl.inner.intensity = B.chase.power.value * 3;
    // exterior lamps at night; the loops glow on their own little panel, brighter with the station
    S.night.intensity.value = night * 5;
    S.loop.intensity.value = night * (3 + lit * 3);
    ch[CH.NIGHT] = 0.04 + night * 0.96;
    B.poolNight.k.value = night * 0.8;
    B.vl.billboard.intensity = night * 9;
    B.vl.portal.intensity = night * 4;
    S.locker.intensity.value = s?.has(F.locker) ? 0 : (t % 1.6 < 0.8 ? 2.4 : 0.3);
    this.sparks.update(dt);

    // found: on the deck, in the tube, or down at the break
    if (s && this.ctx.player && !s.has(F.found)) {
      this.local.copy(this.ctx.player.position).applyMatrix4(this.inv);
      const L = this.local;
      const onDeck = L.y > DECK - 0.4 && L.x > STATION.x0 && L.x < STATION.x1 && L.z > STATION.z0 && L.z < STATION.z1;
      const inTube = L.x > INNER.x0 - 13 && L.x < INNER.x1 && Math.abs(L.z - TZ) < 1.4 && L.y > 0;
      if ((onDeck || inTube) && s.set(F.found)) this.toast('Station Zero. Departures: none. The future is a long dark tube with a view.', 'info');
    }

    // doors
    const a = B.airlock;
    a.open += (a.target - a.open) * Math.min(1, dt * 2.5);
    a.obj.rotation.y = -a.open * 1.55;
    const solid = a.target < 0.5 && a.open < 0.3;
    if (solid !== a.solid) { a.solid = solid; a.col.setEnabled(solid); }
    const l = B.locker;
    if (l.target > 0.5 && l.solid) {
      l.solid = false;
      l.col.setEnabled(false);
      // blown clean off its hinges, lying face down in the sand
      l.obj.rotation.set(0.1, 0.8, Math.PI / 2 - 0.08);
      l.obj.position.add(new THREE.Vector3(-1.9, 0.07, 0.8));
    } else if (l.target < 0.5 && !l.solid) {
      l.solid = true;
      l.col.setEnabled(true);
      l.obj.rotation.set(0, 0, 0);
      l.obj.position.copy(B.lockerHome);
    }
    if (this.ride) this.stepRide(dt);
    void POD;
  }
}
