import type * as THREE from 'three/webgpu';
import type { Interactable, UIBridge } from '../context';
import type { GameState } from '../State';
import type { AudioEngine } from '@/engine/audio';
import type { Recovery, Outpost } from './Recovery';
import type { Machines } from './Machines';
import { OUTPOSTS } from '@/content/recovery';
import { DAEMONS, REQUISITION, TERMINAL_DIFFICULTY, type DaemonDef } from '@/content/hacks';
import { AMMO_FOR, AMMO_HANDFUL } from '@/content/scavenge';
import { ITEMS } from '@/content/items';
import { actionWord } from '@/engine/bindings';

export interface TerminalHost {
  recovery: Recovery;
  machines: Machines;
  ui: UIBridge;
  audio: AudioEngine;
  state(): GameState | null;
  toast(text: string, kind?: 'info' | 'good' | 'bad'): void;
  subtitle(speaker: string, text: string, voice?: { pos?: THREE.Vector3; variant?: number }): void;
}

/** Daemons whose effect lasts the shift (re-applied when the crew spawns again after a reload). */
const LASTING = ['sentries', 'perimeter'];

/**
 * Kade field terminals: a rugged laptop on a folding table at every outpost, cabled to the generator.
 * Splice in (Electronics 1) and push up to three daemons: stand the sentries down, make the perimeter
 * safe, approve a resupply, dump the roster, print lanyards. Get traced and the crew comes to look.
 * One go per shift: the box locks you out until Kade restaffs the camp.
 */
export class KadeTerminals {
  constructor(private h: TerminalHost, interactables: Interactable[]) {
    for (const op of h.recovery.outposts) {
      interactables.push({
        id: `terminal:${op.def.id}`,
        pos: op.build.terminal,
        radius: 1.7,
        visible: () => !this.used(op.def.id),
        primary: {
          label: 'Splice into the Kade terminal',
          available: () => {
            const s = h.state();
            if (!s) return 'No.';
            if (s.skill('electronics') < 1) return 'Needs Electronics 1';
            if (h.recovery.outpostFighting(op.def.id)) return 'Not with them shooting at you';
            return true;
          },
          run: () => this.hack(op),
        },
      });
    }
  }

  private mark(id: string) {
    return this.h.recovery.respawnCount(id);
  }

  /** Already spliced this shift. */
  used(id: string) {
    const s = this.h.state();
    return !!s && (s.data.marks[`term.${id}`] ?? -1) >= this.mark(id);
  }

  /** Up to three daemons for this camp: its machines first, then the paperwork. */
  daemonsFor(op: Outpost): DaemonDef[] {
    const s = this.h.state();
    const out: DaemonDef[] = [];
    if (op.def.sentries?.length) out.push(DAEMONS.sentries);
    if (op.def.mines || op.def.hornet) out.push(DAEMONS.perimeter);
    const mapped = !!s && OUTPOSTS.every((o) => s.has(`seen:${o.id}`));
    if (out.length < 2) out.push(DAEMONS.requisition);
    if (out.length < 2) out.push(DAEMONS.ids);
    out.push(mapped ? (out.includes(DAEMONS.requisition) ? DAEMONS.ids : DAEMONS.requisition) : DAEMONS.roster);
    return out.slice(0, 3);
  }

  async hack(op: Outpost) {
    const s = this.h.state();
    if (!s || this.used(op.def.id)) return;
    const res = await this.h.ui.hack({
      title: 'KADE FIELD UNIT',
      host: op.def.name.toUpperCase(),
      difficulty: TERMINAL_DIFFICULTY[op.def.tier],
      daemons: this.daemonsFor(op).map((d) => ({ id: d.id, name: d.name, blurb: d.blurb })),
      kade: true,
    });
    if (res.aborted) return;
    s.data.marks[`term.${op.def.id}`] = this.mark(op.def.id);
    for (const id of res.done) this.apply(op, id, true);
    if (res.done.length) s.addXP(12 + 10 * res.done.length, 'Kade terminal spliced');
    if (res.traced) {
      s.damage(6);
      this.h.audio.play('zap');
      this.h.toast('Trace complete. The laptop shocks you, and somewhere a Kade radio starts reading out your description.', 'bad');
      this.h.recovery.alertOutpost(op.def.id, op.build.terminal);
      this.h.subtitle('Kade Recovery', 'Field unit just logged an intrusion. Somebody go check the laptop.', { pos: op.build.terminal.clone(), variant: 1 });
    } else if (!res.done.length) this.h.toast('Nothing went through. The terminal logs you out.', 'info');
  }

  private apply(op: Outpost, id: string, fresh: boolean) {
    const s = this.h.state();
    if (!s) return;
    const at = op.def.id;
    if (LASTING.includes(id)) s.data.marks[`hack.${at}.${id}`] = this.mark(at);
    switch (id) {
      case 'sentries': {
        const n = this.h.machines.standDown(at);
        if (fresh) this.h.toast(n ? `Work order accepted. ${n > 1 ? 'The sentries tilt' : 'The sentry tilts'} down and ${n > 1 ? 'go' : 'goes'} dark.` : 'The sentries here were already off.', 'good');
        break;
      }
      case 'perimeter': {
        const n = this.h.machines.perimeterSafe(at);
        if (fresh) this.h.toast(n ? 'Perimeter safe. The red lights in the dirt go out, and the Hornet drops back to its pad.' : 'Nothing on the perimeter left to switch off.', 'good');
        break;
      }
      case 'requisition': {
        const want = [...REQUISITION];
        const owned = (Object.keys(AMMO_FOR) as (keyof typeof AMMO_FOR)[]).filter((cal) => s.count(AMMO_FOR[cal]) > 0);
        for (const cal of owned.length ? owned : ['ammo38' as const]) {
          const [a, b] = AMMO_HANDFUL[cal];
          want.push({ id: cal, qty: a + Math.floor(Math.random() * (b - a + 1)) });
        }
        const got: string[] = [];
        for (const it of want) {
          const n = s.addItem(it.id, it.qty, true);
          if (n) got.push(`${n}× ${ITEMS[it.id]?.name ?? it.id}`);
        }
        this.h.audio.play('loot');
        this.h.toast(got.length ? `Resupply approved. The footlocker's second tray: ${got.join(' · ')}` : 'Approved, and your pack is too full to take it.', got.length ? 'good' : 'bad');
        break;
      }
      case 'roster': {
        let n = 0;
        for (const o of OUTPOSTS) if (s.set(`seen:${o.id}`)) n++;
        this.h.audio.play('intel');
        this.h.toast(n ? `Roster dumped. ${n} more Kade camp${n > 1 ? 's' : ''} on your map${actionWord('map') ? ` (${actionWord('map')})` : ''}.` : 'Roster dumped. You already had every outpost on it.', 'good');
        break;
      }
      case 'ids': {
        const n = s.addItem('kade_badge', 2, true);
        this.h.toast(n ? `The ID printer whirs: ${n}× Recovery Lanyard. The photo is a stock smile.` : 'The printer jams on a full pack.', n ? 'good' : 'bad');
        break;
      }
    }
  }

  /** The crew spawned (or the game loaded near the camp): this shift's hacks are still in force. */
  reapply(at: string) {
    const s = this.h.state();
    if (!s) return;
    const op = this.h.recovery.outposts.find((o) => o.def.id === at);
    if (!op) return;
    for (const id of LASTING) if ((s.data.marks[`hack.${at}.${id}`] ?? -1) >= this.mark(at)) this.apply(op, id, false);
  }
}
