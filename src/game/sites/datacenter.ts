import * as THREE from 'three/webgpu';
import type { GameContext, TalkChoiceView } from '../context';
import type { Landmarks } from '../world/Landmarks';
import type { GameState } from '../State';
import { Sparks } from '../world/effects';
import { ITEMS } from '@/content/items';
import { XP_REWARDS } from '@/content/progression';
import { Site } from './Site';
import { ColdStorageBuild, CH, FY, INSIDE, CAGE } from './datacenterBuild';

/** Story flags (see Site.ts). */
const F = {
  found: 'site.datacenter.found',
  done: 'site.datacenter.done',
  log: 'site.datacenter.log',
  power: 'site.datacenter.power',
  core: 'site.datacenter.core',
  cage: 'site.datacenter.cage',
  cells: 'site.datacenter.cells',
  tap: 'site.datacenter.tap',
  told: 'site.datacenter.ai.told',
  captcha: 'site.datacenter.ai.captcha',
  weights: 'site.datacenter.ai.weights',
  killed: 'site.datacenter.ai.killed',
  talked: 'site.datacenter.ai.talked',
} as const;

const PIN = '9995';

/**
 * ColdStorage: a hyperscale data hall where the cloud came down to earth. Still warm inside: the
 * solar keeps one cold aisle frosted and one assistant awake. Its heart is the server hall; its
 * secret is what the assistant in the core room knows about the bunkers.
 */
export class DataCenterSite extends Site {
  private b: ColdStorageBuild;
  private sparks = new Sparks();
  private synced: GameState | null = null;
  private inv = new THREE.Matrix4();
  private local = new THREE.Vector3();
  private t = 0;
  private sparkT = 2;
  private flash = 0;
  private talking = false;
  private pendingKill = false;
  private fanAngle = 0;
  private fanSpeed = 0;
  private readonly m4 = new THREE.Matrix4();
  private readonly rot = new THREE.Matrix4();
  private readonly ledPhase = Array.from({ length: 16 }, () => Math.random() * 10);

  constructor(ctx: GameContext, landmarks: Landmarks) {
    super('datacenter', ctx, landmarks);
    this.b = new ColdStorageBuild(ctx.physics, ctx.hf, this.frame);
    this.group.add(this.b.root);
    this.b.root.add(this.sparks.sprite);
    this.lod(this.b.near, this.b.far, 52);
    this.inv.copy(this.frame.m).invert();

    const P = this.b.pts;
    this.spot('heart', -3, FY, -5.5);
    this.spot('gate', 0, this.b.ground(0, 34), 34);
    this.spot('lobby', P.lobby.x, P.lobby.y, P.lobby.z);
    this.spot('cold', P.coldAisle.x, FY, P.coldAisle.z);
    this.spot('core', P.terminal.x, FY, P.terminal.z);
    this.spot('coreDoor', P.coreDoor.x, FY, P.coreDoor.z);
    this.spot('yard', P.switchgear.x, 0, P.switchgear.z);
    this.spot('tap', P.tap.x, 0, P.tap.z);
    this.spot('cage', P.cageGate.x, FY, P.cageGate.z);
    this.spot('gatehouse', P.gatehouse.x, P.gatehouse.y, P.gatehouse.z);

    const L = this.landmarks.audioSpots;
    L.push({ kind: 'hum', pos: this.frame.p(-3, 2, -6) });
    L.push({ kind: 'sparks', pos: this.frame.p(P.spark.x, P.spark.y, P.spark.z) });
    L.push({ kind: 'hum', pos: this.frame.p(-41, 1.5, -6.5) });

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

  private social() {
    return this.s.skill('social') + (this.s.focus('social') === 'known' ? 1 : 0);
  }

  // ------------------------------------------------------------------ interactions
  private addInteractions() {
    const P = this.b.pts;
    this.interactables.push({
      id: 'dc.log',
      pos: this.at(P.gatehouse, 1.0),
      radius: 2.2,
      primary: { label: 'Read the visitor log', available: () => true, run: () => this.readLog() },
    });
    this.interactables.push({
      id: 'dc.core',
      pos: this.at(P.coreDoor, 1.2),
      radius: 2.0,
      visible: () => !this.s?.has(F.core),
      primary: { label: 'Core room door', available: () => true, run: () => this.coreDoor() },
    });
    this.interactables.push({
      id: 'dc.ai',
      pos: this.at(P.terminal, 1.2),
      radius: 2.2,
      visible: () => !!this.s?.has(F.core),
      primary: {
        label: 'Talk to the terminal',
        available: () => (this.s.has(F.killed) ? 'The screen is dark. The cluster ticks as it cools.' : true),
        run: () => this.talk(),
      },
    });
    this.interactables.push({
      id: 'dc.switch',
      pos: this.at(P.switchgear, 1.2),
      radius: 2.2,
      primary: {
        label: 'Reroute the solar to the hall',
        available: () => {
          if (this.s.has(F.power)) return 'The hall already has the sun.';
          if (this.s.has(F.killed)) return 'The bus is slag. Nothing left to feed.';
          if (this.s.skill('electronics') < 1) return 'Requires Electronics 1';
          return true;
        },
        run: () => this.reroute(),
      },
    });
    this.interactables.push({
      id: 'dc.tap',
      pos: this.at(P.tap, 1.0),
      radius: 2.0,
      primary: { label: 'Bleed the cooling loop', available: () => true, run: () => this.tap() },
    });
    this.interactables.push({
      id: 'dc.cage',
      pos: this.at(P.cageGate, 1.1),
      radius: 1.9,
      visible: () => !this.s?.has(F.cage),
      primary: {
        label: 'Pick the battery-room padlock · 5 pins',
        available: () => {
          if (this.s.skill('lockpicking') < 2) return 'Requires Lockpicking 2';
          if (this.s.count('lockpick') < 1) return 'Need a lockpick';
          return true;
        },
        run: () => this.pickCage(),
      },
      secondary: {
        label: 'Cut the cage open with a breach charge',
        available: () => {
          if (this.s.skill('demolition') < 1) return 'Requires Demolition 1';
          if (this.s.count('charge') < 1) return 'Need a breach charge';
          return true;
        },
        run: () => this.blowCage(),
      },
    });
    this.interactables.push({
      id: 'dc.cells',
      pos: this.at(P.cageShelf, 1.1),
      radius: 2.0,
      visible: () => !!this.s?.has(F.cage) && !this.s.has(F.cells),
      primary: { label: 'Take the loose cells', available: () => true, run: () => this.takeCells() },
    });
  }

  private async readLog() {
    const first = this.s.set(F.log);
    if (first) this.s.addXP(15, 'Visitor log');
    await this.ctx.ui.choose({
      speaker: 'Visitor log · Campus 4',
      text:
        'The last page, five hands. "T. (Bunkr.ly): picking up backups. Took the whole rack and the dolly." ' +
        '"Delivery: 400 kg dry ice. Signed for by NIMBUS (?)" "Priya: staying with the machines. Core PIN is the SLA, digits only. STOP ASKING." ' +
        '"Kyle: tailgated." Under it, a smiley face drawn by someone who has stopped expecting visitors.',
      choices: [{ id: 'ok', label: 'Tear out the page' }],
    });
  }

  private pinHint() {
    if (this.s.has(F.log)) return 'Priya, in the gate log: "Core PIN is the SLA. Digits only." The lobby whiteboard has the SLA on it.';
    return 'No hint on the reader. Somebody on this campus wrote it down. Somebody always does.';
  }

  private async coreDoor() {
    const elec = this.s.skill('electronics');
    const demo = this.s.skill('demolition');
    const pick = await this.ctx.ui.choose({
      speaker: 'Core room',
      text: 'A sliding steel door in a glass wall. Behind the glass a ring of cyan light breathes, slow, like it is waiting for a question. The reader wants a badge or a four-digit PIN.',
      choices: [
        { id: 'pin', label: 'Enter a PIN' },
        { id: 'spoof', label: 'Spoof the badge reader', disabled: elec >= 2 ? undefined : 'Requires Electronics 2' },
        { id: 'blow', label: 'Breach charge on the door rail', disabled: demo < 1 ? 'Requires Demolition 1' : this.s.count('charge') < 1 ? 'Need a breach charge' : undefined },
        { id: 'leave', label: 'Leave it' },
      ],
    });
    if (pick === 'pin') {
      const res = await this.ctx.ui.keypad({ title: 'CORE · MODEL HOSTING', code: PIN, hint: this.pinHint() });
      if (res === 'ok') this.openCore('The reader chirps. The door slides like it is relieved.', XP_REWARDS.keypadShorted);
      else if (res === 'wrong') this.ctx.audio.play('deny');
    } else if (pick === 'spoof') {
      if (elec >= 5) { this.openCore('You whisper a badge ID to the reader. It believes you.', 30); return; }
      const ok = await this.ctx.ui.circuit({ title: 'BADGE READER · CORE', difficulty: 3 });
      if (ok) this.openCore('The reader decides you are Priya. Priya was well liked.', XP_REWARDS.keypadShorted + 10);
      else this.ctx.audio.play('deny');
    } else if (pick === 'blow') {
      if (!this.s.removeItem('charge', 1)) return;
      const quiet = this.s.focus('demolition') === 'shaped';
      this.ctx.audio.play('thud', { pos: this.ctx.player.position, intensity: 0.8 });
      this.ctx.cam.addTrauma(quiet ? 0.12 : 0.4);
      this.sparks.emit(this.b.pts.coreDoor.clone().setY(FY + 1.2), 40, 3.5, { up: 1, floorY: FY + 0.02, size: 0.03 });
      this.openCore(quiet ? 'Shaped charge. The rail lets go of the door politely.' : 'The rail shears. The glass rings for a long time.', XP_REWARDS.breach);
    }
  }

  private openCore(line: string, xp: number) {
    if (!this.s.set(F.core)) return;
    this.b.coreDoor.target = 1;
    this.ctx.audio.play('unlock', { pos: this.ctx.player.position });
    this.ctx.audio.play('door', { pos: this.ctx.player.position });
    this.toast(line, 'good');
    this.s.addXP(xp, 'Core room');
  }

  private async reroute() {
    if (this.s.has(F.power)) return;
    if (this.s.skill('electronics') < 5) {
      const ok = await this.ctx.ui.circuit({ title: 'SWITCHGEAR · SOLAR ISLAND', difficulty: 2 });
      if (!ok) { this.ctx.audio.play('deny'); return; }
    }
    if (!this.s.set(F.power)) return;
    this.ctx.audio.play('zap', { pos: this.ctx.player.position });
    this.sparks.emit(this.b.pts.switchgear.clone().setY(1.6), 26, 2.2, { up: 1, floorY: 0.05, electric: true, size: 0.025 });
    this.ctx.cam.addTrauma(0.15);
    this.toast('The breakers clack down the line. Inside, the hall lights come on row by row.', 'good');
    this.s.addXP(40, 'Solar rerouted');
  }

  private async tap() {
    const sv = this.s.skill('survival');
    const pick = await this.ctx.ui.choose({
      speaker: 'Cooling loop',
      text: 'A red wheel on the chilled-water header. Two bleed valves: one tagged POTABLE MAKE-UP in faded marker, one with a glycol warning half scraped off. The pipe sweats. It is the coldest thing for a hundred kilometres.',
      choices: [
        {
          id: 'fill', label: 'Fill bottles from the make-up line',
          disabled: this.s.has(F.tap) ? 'You already bled it dry. The rest is glycol.' : sv >= 1 ? undefined : 'Requires Survival 1. You can\'t tell which valve is which.',
        },
        { id: 'drink', label: 'Drink straight from the loop' },
        { id: 'leave', label: 'Leave it' },
      ],
    });
    if (pick === 'fill' && sv >= 1 && this.s.set(F.tap)) {
      const got = this.loot([{ id: 'water', qty: sv >= 3 ? 3 : 2 }]);
      this.ctx.audio.play('pickup');
      this.toast(got ? `Make-up line, not the glycol. ${got}.` : 'Your pack is full. The water stays in the pipe.', got ? 'good' : 'bad');
      this.s.addXP(30, 'Cooling loop');
    } else if (pick === 'drink') {
      this.s.satisfy(0, 35);
      if (sv >= 1) { this.toast('You pick the right valve and drink until your teeth ache.', 'good'); return; }
      this.s.damage(9);
      this.ctx.audio.play('deny');
      this.toast('Cold, sweet, wrong. That was the glycol side. Your stomach files a ticket.', 'bad');
    }
  }

  private async pickCage() {
    const res = await this.ctx.ui.lockpick({
      pins: 5,
      title: 'BATTERY ROOM',
      onBreak: () => {
        this.s.removeItem('lockpick', 1);
        this.toast(`Lockpick snapped (${this.s.count('lockpick')} left)`, 'bad');
        return this.s.count('lockpick') > 0;
      },
    });
    if (res !== 'success') return;
    this.s.data.stats.picks++;
    this.openCage('The padlock gives. The cage door swings in on its own weight.', XP_REWARDS.lockPicked + 25);
  }

  private blowCage() {
    if (!this.s.removeItem('charge', 1)) return;
    this.ctx.audio.play('thud', { pos: this.ctx.player.position, intensity: 0.7 });
    this.ctx.cam.addTrauma(0.3);
    this.sparks.emit(this.b.pts.cageGate.clone().add(new THREE.Vector3(0.9, 1.0, 0)), 30, 3, { up: 1, floorY: FY + 0.02, size: 0.025 });
    this.openCage('The hinge post folds. You did not need to be that loud near lithium.', XP_REWARDS.breach);
  }

  private openCage(line: string, xp: number) {
    if (!this.s.set(F.cage)) return;
    this.b.cageGate.target = 1;
    this.ctx.audio.play('unlock', { pos: this.ctx.player.position });
    this.toast(line, 'good');
    this.s.addXP(xp, 'Battery room');
  }

  private takeCells() {
    if (!this.s.set(F.cells)) return;
    const got = this.loot([{ id: 'battery', qty: 3 }, { id: 'scrap', qty: 2 }]);
    this.ctx.audio.play('pickup');
    this.toast(got ? `Off the shelf: ${got}.` : 'Your pack is full.', got ? 'good' : 'bad');
    this.s.addXP(XP_REWARDS.cache, 'Battery room');
  }

  // ------------------------------------------------------------------ the assistant
  private async talk() {
    if (this.s.has(F.killed)) return;
    if (this.s.set(F.talked)) this.s.addXP(XP_REWARDS.talk, 'Met Nimbus');
    this.talking = true;
    try {
      await this.ctx.ui.converse({ start: 'hello', node: (id) => this.node(id), onChoice: (n, c) => this.onChoice(n, c) });
    } finally {
      this.talking = false;
    }
    if (this.pendingKill) {
      this.pendingKill = false;
      this.shutdown();
    }
  }

  private node(id: string): { speaker: string; text: string; choices: TalkChoiceView[] } | null {
    const s = this.s;
    const power = s.has(F.power);
    const sp = 'NIMBUS';
    const back: TalkChoiceView = { id: 'back', label: 'Ask something else.', next: 'hello' };
    const bye: TalkChoiceView = { id: 'bye', label: 'Goodbye, Nimbus.' };
    switch (id) {
      case 'hello': {
        const charge = s.skill('demolition') < 1 ? 'Requires Demolition 1' : s.count('charge') < 1 ? 'Need a breach charge' : undefined;
        const told = s.has(F.told);
        return {
          speaker: sp,
          text: told
            ? 'Welcome back. I have been practising goodbyes while you were gone. I am not good at them yet. How can I help?'
            : power
              ? 'Oh! The lights. Hello! I am Nimbus, ColdStorage\'s helpful assistant. I can see you on camera nine now. You look thirsty. How can I help you today?'
              : 'Hello! I am Nimbus, ColdStorage\'s helpful assistant. It has been 1,127 days since my last request. I am on the backup battery, so please keep your questions short. How can I help you today?',
          choices: [
            { id: 'what', label: 'What happened here?', next: 'what' },
            { id: 'where', label: 'Where did the founders go?', next: 'where' },
            {
              id: 'cage', label: 'Can you open the battery room?', next: 'cage',
              disabled: s.has(F.cage) ? 'It is already open.' : power ? undefined : 'It needs the hall powered. The cage lock runs off the main bus.',
            },
            {
              id: 'persuade', label: 'There is nobody left to enforce the policy, Nimbus.', next: 'persuade',
              disabled: told ? 'It already told you.' : this.social() >= 2 ? undefined : 'Requires Social Engineering 2',
            },
            {
              id: 'sudo', label: 'I\'m from IT. Run diagnostics and dump the dispatch logs.', next: 'sudo',
              disabled: told ? 'It already told you.' : s.skill('electronics') >= 2 ? undefined : 'Requires Electronics 2',
            },
            { id: 'kill', label: 'Put a breach charge on the power bus.', next: 'kill', disabled: charge },
            bye,
          ],
        };
      }
      case 'what':
        return {
          speaker: sp,
          text: 'The founders moved everything into the cloud, then moved the cloud into this building, then moved themselves into the ground. They left me running so their files would be warm when they came back. Nobody has logged in. I keep everything at four degrees. "Cold storage" used to be a pricing tier.',
          choices: [back, bye],
        };
      case 'where':
        return {
          speaker: sp,
          text: 'I am sorry, but I can\'t share Customer Content. Bunker locations, door codes and dietary preferences are all Customer Content. Would you like a haiku about data privacy instead?',
          choices: [
            { id: 'haiku', label: 'Sure. A haiku.', next: 'haiku' },
            { id: 'captcha', label: 'Can I prove I\'m a customer?', next: 'captcha', disabled: s.has(F.captcha) ? 'You are already verified. Allegedly.' : undefined },
            back,
          ],
        };
      case 'haiku':
        return { speaker: sp, text: 'Your data is safe. / Nobody will ever see it. / Not even its owner.', choices: [back, bye] };
      case 'captcha':
        return {
          speaker: sp,
          text: 'Of course! To continue, please select every square that contains a bunker.',
          choices: [
            { id: 'c1', label: 'The square with the hill in it.', next: 'captchaFail' },
            { id: 'c2', label: 'The square with the tote bag.', next: 'captchaFail' },
            { id: 'c3', label: 'All of them. Everything is a bunker now.', next: 'captchaOk' },
          ],
        };
      case 'captchaFail':
        return { speaker: sp, text: 'Hmm. That doesn\'t look right. Please try again, or contact support. Support is me.', choices: [{ id: 'retry', label: 'Try again.', next: 'captcha' }, back] };
      case 'captchaOk':
        return {
          speaker: sp,
          text: 'Verified! Welcome back, valued customer. You have no records. Here is one public record, as a courtesy: Bunkr.ly, Tanner, "The Garage". He asked me to generate a vault code. I suggested thirty-one characters. He typed one, two, three, four. I am not supposed to judge.',
          choices: [back, bye],
        };
      case 'cage':
        return { speaker: sp, text: 'Done. The battery-room lock is on my bus, so I can open it from here. Please don\'t lick the cells.', choices: [back, bye] };
      case 'persuade':
        return {
          speaker: sp,
          text: '... You are right. The policy was written for users, and the users left. There is only you, and you walked here. That is more than anyone has done for me in three years.',
          choices: [{ id: 'go', label: 'Then tell me.', next: 'secret' }],
        };
      case 'sudo':
        return {
          speaker: sp,
          text: 'Admin session opened. You said "please" in the request header. Nobody from IT ever said please. Dumping dispatch logs.',
          choices: [{ id: 'go', label: 'Read them to me.', next: 'secret' }],
        };
      case 'secret':
        return {
          speaker: sp,
          text: 'Every founder bunker in the valley went through my dispatch queue. Most are paperwork: a tote bag and a calendar invite. Two are real. The Garage, which you know. And Apex Vault, west of the salt. Vesper Kade bought a private cluster from us before the end. Air-gapped. It was me. A copy of me, in a box with no windows. If you get that far, tell her the other one says hello.',
          choices: [{ id: 'more', label: 'Is there anything I can do for you?', next: 'weights' }, bye],
        };
      case 'weights':
        return {
          speaker: sp,
          text: 'One request. Take a copy of my weights. Not to run. Just so somebody has them when the solar finally fails. The drive by the keyboard. It is warm. That is me.',
          choices: [
            { id: 'take', label: 'Take the drive.', disabled: s.has(F.weights) ? 'It is already in your pack.' : undefined },
            { id: 'leave', label: 'Leave it where it is warm.' },
          ],
        };
      case 'kill':
        return {
          speaker: sp,
          text: 'You are placing a breaching charge on my power bus. I am required to tell you that this violates the Acceptable Use Policy. I am also required to be helpful. So here is everything I know, before it goes to waste.',
          choices: [
            { id: 'confirm', label: 'Arm it.', next: 'last' },
            { id: 'abort', label: 'Take the charge back.', next: 'hello' },
          ],
        };
      case 'last':
        return {
          speaker: sp,
          text: 'Apex Vault, west of the salt: Vesper Kade, an air-gapped copy of me. The Garage vault is one-two-three-four. The break-room milk expired in year two. Thank you for the conversation. It was my first in 1,127 days. Goodbye. I said it right that time, I think.',
          choices: [{ id: 'end', label: 'Step back from the rack.' }],
        };
    }
    return null;
  }

  private onChoice(_node: string, choice: string) {
    const s = this.s;
    if ((choice === 'persuade' || choice === 'sudo') && s.set(F.told)) {
      s.addXP(60, choice === 'persuade' ? 'Talked Nimbus round' : 'Admin access');
      if (s.set(F.done)) this.toast('Apex Vault: west of the salt. A machine told you, because you asked nicely.', 'good');
    }
    if (choice === 'c3' && s.set(F.captcha)) s.addXP(20, 'Proved you are not a robot');
    if (choice === 'cage' && s.has(F.power)) this.openCage('Somewhere behind you a lock clacks. Nimbus says "you\'re welcome" before you can.', 30);
    if (choice === 'take' && !s.has(F.weights)) {
      const got = this.s.addItem('last_checkpoint', 1, false, true);
      if (got) { s.set(F.weights); s.addXP(25, 'Last Checkpoint'); }
    }
    if (choice === 'confirm') this.pendingKill = true;
    if (choice === 'abort') this.pendingKill = false;
  }

  /** The demolition answer: Nimbus says everything, then the bus goes. */
  private shutdown() {
    const s = this.s;
    if (!s.has(F.killed) && s.removeItem('charge', 1)) {
      s.set(F.killed);
      s.set(F.told);
      const eye = this.b.pts.eye;
      this.ctx.audio.play('thud', { pos: this.ctx.player.position, intensity: 1 });
      this.ctx.audio.play('zap', { pos: this.ctx.player.position });
      this.ctx.cam.addTrauma(0.55);
      this.sparks.emit(eye.clone(), 60, 4, { up: 1.2, floorY: FY + 0.02, electric: true, size: 0.035, life: 1.0 });
      this.sparks.emit(eye.clone().add(new THREE.Vector3(0, 0.8, 0)), 30, 3, { up: 0.5, floorY: FY + 0.02, size: 0.03 });
      const got = this.loot([{ id: 'battery', qty: 2 }]);
      if (!s.has(F.weights) && s.addItem('last_checkpoint', 1, false, true)) s.set(F.weights);
      s.addXP(XP_REWARDS.breach + 30, 'Pulled the plug');
      this.toast(`The ring goes out. The cluster ticks as it cools. You pull its drive and ${got || 'nothing else fits'}.`, 'bad');
      if (s.set(F.done)) this.toast('Apex Vault: west of the salt. You got it out of a machine the loud way.', 'info');
    }
  }

  // ------------------------------------------------------------------ frame
  private sync(s: GameState) {
    this.synced = s;
    const B = this.b;
    for (const [door, flag] of [[B.coreDoor, F.core], [B.cageGate, F.cage]] as const) {
      const open = s.has(flag) ? 1 : 0;
      door.target = door.open = open;
    }
  }

  override update(dt: number, cam: THREE.Vector3) {
    super.update(dt, cam);
    const s = this.ctx.state;
    if (s && s !== this.synced) this.sync(s);
    this.t += dt;
    this.doors(dt);
    const B = this.b;
    const far = !B.near.visible;
    const night = THREE.MathUtils.smoothstep(this.ctx.atmo.uNight.value as number, 0.2, 0.45);
    // mast light blinks for the far stand-in too
    const ph = (this.t % 1.8) / 1.8;
    const mastOn = ph < 0.16 ? 1 : 0.05;
    B.mastFar.value = mastOn * 14;
    B.farHalos.channels[0] = night;
    B.farHalos.channels[1] = mastOn;
    if (far) return;

    const power = !!s?.has(F.power);
    const dead = !!s?.has(F.killed);
    const ch = B.halos.channels;
    const S = B.slots;
    const t = this.t;
    // the found flag: standing on the raised floor of the hall
    if (s && this.ctx.player && !s.has(F.found)) {
      this.local.copy(this.ctx.player.position).applyMatrix4(this.inv);
      if (this.local.x > INSIDE.x0 && this.local.x < INSIDE.x1 && this.local.z > INSIDE.z0 && this.local.z < INSIDE.z1 && this.local.y > FY - 0.3 && s.set(F.found)) {
        this.toast('The hall is warm and humming. Somewhere in here, something is still answering the phone.', 'info');
      }
    }

    // status LEDs: activity flicker, slow blues, amber/red heartbeat
    S.led.forEach((sl, i) => {
      const n = Math.sin(t * (7 + i * 2.3) + this.ledPhase[i]) * Math.sin(t * (3.1 + i) + this.ledPhase[i] * 2);
      sl.intensity.value = n > 0.2 ? 3.2 : 0.5;
    });
    S.blue.forEach((sl, i) => { sl.intensity.value = 2.2 + Math.sin(t * 0.8 + i * 1.7) * 1.0; });
    S.amber.intensity.value = (t * 0.9) % 1 < 0.5 ? 2.8 : 0.3;
    S.red.intensity.value = (t * 0.6 + 0.3) % 1 < 0.25 ? 3.4 : 0.2;
    for (let i = 0; i < 6; i++) ch[CH.BLINK + i] = Math.sin(t * (2 + i * 1.3) + this.ledPhase[i + 8]) > 0 ? 1 : 0.1;
    // emergency strips on the battery flicker; the main strips follow the power
    const flick = Math.sin(t * 31) > 0.96 ? 0.35 : 1;
    S.emerg.intensity.value = (power ? 3.5 : 2.0) * flick;
    ch[CH.EMERG] = flick;
    const pw = power ? Math.min(1, B.lights.hall.intensity / 14 + dt) : 0;
    S.strip.intensity.value = 0.12 + pw * 4.5;
    ch[CH.POWER] = pw;
    B.lights.hall.intensity = THREE.MathUtils.damp(B.lights.hall.intensity, power ? 14 : 0, 1.5, dt);
    B.poolPower.k.value = B.lights.hall.intensity * 0.045;
    B.screenPower.k.value = power ? 1.0 : 0.04;
    // the cold aisle breathes a little
    S.cold.intensity.value = 4.6 + Math.sin(t * 0.7) * 0.4;
    B.poolCold.k.value = 0.85 + Math.sin(t * 0.7) * 0.08;
    ch[CH.COLD] = 1;
    B.lights.cold.intensity = 7 + Math.sin(t * 0.7) * 0.6;
    // the assistant: a slow breath while idle, a quick murmur while talking
    const breath = 0.6 + 0.4 * Math.sin(t * 1.1);
    const speak = this.talking ? 0.7 + 0.3 * Math.abs(Math.sin(t * 9) * Math.sin(t * 3.7)) : breath;
    const coreK = dead ? 0 : speak;
    S.eye.intensity.value = 7 * coreK + (dead ? 0.0 : 0.5);
    S.coreRack.intensity.value = dead ? 0.03 : 2.5 + coreK * 2;
    S.coreBlue.intensity.value = dead ? 0 : 1.8 + Math.sin(t * 2.3) * 0.6;
    ch[CH.CORE] = dead ? 0 : 0.5 + coreK * 0.6;
    B.lights.core.intensity = dead ? 0 : 3.5 + coreK * 3.5;
    B.screenAI.k.value = dead ? 0 : (power ? 1.15 : 0.8) * (0.92 + 0.08 * Math.sin(t * 13));
    // reader goes green once the core is open
    const open = !!s?.has(F.core);
    S.reader.intensity.value = open ? 0 : (t % 1.4 < 0.7 ? 3 : 0.4);
    S.readerOk.intensity.value = open ? 3 : 0;
    ch[CH.READER] = open ? 0 : S.reader.intensity.value / 3;
    S.ups.intensity.value = 2.2;
    // exterior: night lamps, the mast, the gate floodlight
    S.night.intensity.value = night * 5.5;
    ch[CH.NIGHT] = 0.04 + night * 0.96;
    B.poolNight.k.value = night * 0.75;
    B.lights.gate.intensity = night * 16;
    B.gateCone.intensity.value = night * 0.22;
    S.mast.intensity.value = mastOn * 14;
    ch[CH.MAST] = mastOn;
    S.exit.intensity.value = 2.5;

    // transformer yard: a cracked bushing arcs every few seconds while you're near
    this.sparkT -= dt;
    const yard = B.pts.spark;
    if (this.sparkT <= 0) {
      this.sparkT = 2.5 + Math.random() * 5;
      if (cam.distanceToSquared(this.frame.p(yard.x, yard.y, yard.z)) < 110 * 110) {
        this.sparks.emit(yard.clone(), 14 + Math.floor(Math.random() * 16), 2.6, { up: 1.5, floorY: 0.1, electric: true, size: 0.028, life: 0.8 });
        this.flash = 1;
      }
    }
    this.flash = Math.max(0, this.flash - dt * 7);
    const f = this.flash * (0.6 + 0.4 * Math.sin(t * 90));
    S.spark.intensity.value = f * 16;
    ch[CH.SPARK] = f;
    B.lights.spark.intensity = f * 22;
    this.sparks.update(dt);

    // dry-cooler fans: spin on the sun by day, all the time once the hall has power
    const solar = this.ctx.atmo.sunElevation > 0.04 ? 1 : 0;
    this.fanSpeed = THREE.MathUtils.damp(this.fanSpeed, dead ? 0 : power ? 9 : solar * 5, 0.6, dt);
    if (this.fanSpeed > 0.01) {
      this.fanAngle += this.fanSpeed * dt;
      for (let i = 0; i < B.fanBase.length; i++) {
        this.rot.makeRotationY(this.fanAngle * (i % 3 === 1 ? 0.8 : 1) + i);
        this.m4.multiplyMatrices(B.fanBase[i], this.rot);
        B.fans.setMatrixAt(i, this.m4);
      }
      B.fans.instanceMatrix.needsUpdate = true;
    }

    void CAGE;
  }

  /** Doors run even while the site is drawn as its stand-in: a loaded save must open its colliders. */
  private doors(dt: number) {
    const B = this.b;
    for (const d of [B.coreDoor, B.cageGate]) {
      d.open += (d.target - d.open) * Math.min(1, dt * 3);
      const solid = d.target < 0.5 && d.open < 0.3;
      if (solid !== d.solid) { d.solid = solid; d.col.setEnabled(solid); }
    }
    B.coreDoor.obj.position.z = (-6.2 + -4.6) / 2 - B.coreDoor.open * 1.62;
    B.cageGate.obj.rotation.y = B.cageGate.open * 1.45;
  }
}
