import * as THREE from 'three/webgpu';
import type { Input } from '@/engine/input';
import type { AudioEngine } from '@/engine/audio';
import type { GameState } from '../State';
import type { Hands } from './Hands';
import type { FirstPersonCamera } from './FirstPersonCamera';
import type { Player } from './Player';
import type { Combat, Hostile, HurtKind } from '../combat/Combat';
import type { Throwables } from '../combat/Throwables';
import type { MapMarker } from '@/ui/Minimap';
import { CANTEEN_SIPS, VEST_PLATES, canteenSips, vestPlates } from '@/content/items';
import { actionKey } from '@/engine/bindings';
import { MODS } from '@/content/weapons';

/**
 * The tools that change how you play (overnight swarm 2), each wired into a system that already exists:
 *  - Survey Binoculars (B): a real zoom; whatever hostile you hold in the middle for a moment is tagged,
 *    and tags show through walls (screen markers) and on the minimap for 90 s. The spec's Recon step.
 *  - Recovery Plate Carrier: worn while carried; takes 40% of bullets, blasts, bites and blows until its
 *    plates are spent (`data.marks['gear.vest']`), then it's dead weight until you re-plate it at camp.
 *  - Fleece Bandage: a quick wrap (a reach, not a meal): some health now, more over ten seconds.
 *  - Canteen: three drinks, refilled by resting at the fire (State.restAtFire) or at Inez's Till.
 *  - Founder Focus: two minutes of steady hands (no aim sway, softer recoil, quicker reloads).
 *  - Raw Kombucha: a drink with opinions. Reserve Molotov: thrown with G (Throwables).
 */

const TAG_S = 90;
const DWELL = 0.4;
const VEST_SHARE = 0.4;
const FOCUS_S = 120;
const TAGGABLE = new Set(['human', 'wolf', 'drone', 'turret', 'mine']);

const _fwd = new THREE.Vector3(), _to = new THREE.Vector3(), _p = new THREE.Vector3(), _r = new THREE.Vector3();

/** Screen markers + the binocular mask: built once, shared by every run. */
interface GearDom { scope: HTMLDivElement; binos: HTMLDivElement; range: HTMLElement; tagged: HTMLElement; layer: HTMLDivElement; marks: HTMLElement[]; dist: HTMLElement[] }
let dom: GearDom | null = null;
function ensureDom(root: HTMLElement): GearDom {
  if (dom && dom.binos.isConnected) return dom;
  const binos = document.createElement('div');
  binos.className = 'binos';
  // two eyepieces: a static SVG mask (rasterised once; the overlay only fades), soft at the rims
  binos.innerHTML = `<svg class="mask" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice"><defs>
      <radialGradient id="bbEye"><stop offset="0.82" stop-color="#000"/><stop offset="1" stop-color="#fff"/></radialGradient>
      <mask id="bbMask"><rect x="-80" y="-40" width="320" height="170" fill="#fff"/><circle cx="62" cy="45" r="38" fill="url(#bbEye)"/><circle cx="98" cy="45" r="38" fill="url(#bbEye)"/></mask>
    </defs><rect x="-80" y="-40" width="320" height="170" fill="#030303" mask="url(#bbMask)"/></svg>
    <div class="binos-reticle"><i class="h"></i><i class="v"></i><b class="t1"></b><b class="t2"></b><b class="t3"></b></div>
    <div class="binos-read"><span class="range">— m</span><span class="tagged">0 tagged</span></div>
    <div class="binos-label">KADE SURVEY · 10×50 · <span class="kbd">B</span> lower</div>`;
  const layer = document.createElement('div');
  layer.className = 'tagmarks';
  const marks: HTMLElement[] = [], dist: HTMLElement[] = [];
  for (let i = 0; i < 16; i++) {
    const m = document.createElement('div');
    m.className = 'tagmark';
    m.innerHTML = '<i></i><span></span>';
    m.style.display = 'none';
    layer.appendChild(m);
    marks.push(m);
    dist.push(m.querySelector('span')!);
  }
  // the rifle's scope: one eyepiece, a duplex reticle (heavy posts, fine centre) and holdover ticks
  const scope = document.createElement('div');
  scope.className = 'binos scopeview';
  scope.innerHTML = `<svg class="mask" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice"><defs>
      <radialGradient id="bbScope"><stop offset="0.9" stop-color="#000"/><stop offset="1" stop-color="#fff"/></radialGradient>
      <mask id="bbScopeMask"><rect x="-80" y="-40" width="320" height="170" fill="#fff"/><circle cx="80" cy="45" r="41" fill="url(#bbScope)"/></mask>
    </defs><rect x="-80" y="-40" width="320" height="170" fill="#030303" mask="url(#bbScopeMask)"/>
    <g fill="#0b0b0b"><rect x="39" y="44.55" width="33" height="0.9"/><rect x="88" y="44.55" width="33" height="0.9"/><rect x="79.55" y="53" width="0.9" height="33"/><rect x="79.55" y="4" width="0.9" height="33"/></g>
    <g stroke="#0b0b0b" stroke-width="0.14"><path d="M72 45 H88 M80 37 V53"/><path d="M78.6 48 H81.4 M79 51 H81 M78.6 47 H81.4" stroke-width="0.12"/></g></svg>
    <div class="binos-label">SURVEY SCOPE · 4× · HOLD STILL</div>`;
  root.prepend(scope);
  root.prepend(binos);
  root.prepend(layer);
  dom = { scope, binos, range: binos.querySelector('.range')!, tagged: binos.querySelector('.tagged')!, layer, marks, dist };
  return dom;
}

export class Gear {
  /** Binoculars up (0..1 eased; `viewing` is the switch). */
  viewing = false;
  private binoK = 0;
  private tags = new Map<Hostile, number>();
  private dwell = new Map<Hostile, number>();
  private regen = 0;
  private regenAcc = 0;
  private focusT = 0;
  private t = 0;
  private markT = 0;
  private shownDist: number[] = [];
  private dom: GearDom;
  private plateWarned = false;
  private scopeOn = false;
  private pillT = 0;
  private pills: { plates: HTMLElement; focus: HTMLElement; tagged: HTMLElement } | null = null;
  private pillText = ['', '', ''];
  private uiRoot: HTMLElement;
  private swayX = 0;
  private swayY = 0;

  constructor(
    private state: GameState,
    private hands: Hands,
    private cam: FirstPersonCamera,
    private camera: THREE.PerspectiveCamera,
    private input: Input,
    private combat: Combat,
    private audio: AudioEngine,
    private player: Player,
    private throwables: Throwables,
    uiRoot: HTMLElement,
    private toast: (text: string, kind?: 'info' | 'good' | 'bad') => void,
  ) {
    this.uiRoot = uiRoot;
    this.dom = ensureDom(uiRoot);
    this.dom.binos.classList.remove('on');
    this.dom.binos.querySelector('.binos-label .kbd')!.textContent = actionKey('binoculars');
    // first pickups: say which key does what (the keys are rebindable, so ask the binds)
    state.events.on('item', ({ id }) => {
      const hint: Record<string, string> = {
        binoculars: `Binoculars: ${actionKey('binoculars')} to raise them. Hold a hostile in the middle to tag it.`,
        molotov: `Molotov: ${actionKey('throw')} to light and throw one.`,
        vest: 'Plate carrier: worn while it\'s in your pack. It takes a share of every hit until the plates are spent.',
        pistol22: 'The Hush .22: quiet enough that the desert mostly doesn\'t notice. Aim for heads.',
      };
      if (hint[id] && state.set(`tut.item.${id}`)) setTimeout(() => this.toast(hint[id], 'info'), 600);
    });
  }

  /** Steady hands (Founder Focus): Hands' `steady` and PlayerArms' recoil/reload scale. */
  get focused() {
    return this.focusT > 0;
  }
  steadyK() {
    return this.focusT > 0 ? 0.6 : 1;
  }

  /** Inventory / hotbar use. True when this module handled it. */
  use(id: string): boolean {
    const s = this.state;
    switch (id) {
      case 'binoculars': this.toggleBinos(); return true;
      case 'molotov': this.throwMolotov(); return true;
      case 'bandage': {
        if (this.hands.busy) return true;
        s.removeItem('bandage', 1);
        this.hands.reach(() => {
          s.heal(12);
          this.regen += 20;
          this.audio.play('pickup');
          this.toast('Bandage. Wrapped tight. It\'ll hold while you move.', 'good');
        });
        return true;
      }
      case 'canteen': {
        const n = canteenSips(s);
        if (n <= 0) { this.audio.play('deny'); this.toast('The canteen is empty. Rest at the fire, or Inez fills it for a scrap.', 'bad'); return true; }
        if (this.hands.busy) return true;
        s.data.marks['gear.canteen'] = n - 1;
        this.hands.eat(() => {
          s.satisfy(0, 34, 2);
          this.audio.play('eat');
          this.toast(`Canteen. Less thirsty. ${n - 1 ? `${n - 1} of ${CANTEEN_SIPS} left.` : 'That was the last of it.'}`, 'good');
        });
        return true;
      }
      case 'kombucha': {
        if (this.hands.busy) return true;
        s.removeItem('kombucha', 1);
        this.hands.eat(() => {
          s.satisfy(6, 30, 3);
          this.audio.play('eat');
          this.toast('Raw kombucha. Less thirsty. Your stomach has opened a ticket.', 'good');
        });
        return true;
      }
      case 'nootropics': {
        if (this.hands.busy) return true;
        s.removeItem('nootropics', 1);
        this.hands.eat(() => {
          this.focusT = FOCUS_S;
          s.data.thirst = Math.max(0, s.data.thirst - 6);
          this.audio.play('eat');
          this.toast('Founder Focus. Your hands go still. Your thoughts go fast. Two minutes.', 'good');
        });
        return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------------ the vest

  /** Damage reaching you: the vest takes its share while the plates last. Returns what gets through. */
  absorb(amount: number, kind: HurtKind) {
    const s = this.state;
    if (kind === 'poison' || kind === 'zap' || !s.count('vest')) return amount;
    const plates = vestPlates(s);
    if (plates <= 0) return amount;
    const took = Math.min(plates, amount * VEST_SHARE);
    const left = plates - took;
    s.data.marks['gear.vest'] = left;
    if (kind === 'bullet') this.audio.combat?.impact('metal', this.combat.target.chest, 0.5);
    if (left <= 0) this.toast('The plates are spent. The vest is just a heavy vest now. Re-plate it at the fire.', 'bad');
    else if (left < VEST_PLATES * 0.3 && !this.plateWarned) { this.plateWarned = true; this.toast('The vest\'s plates are cracking.', 'bad'); }
    if (left >= VEST_PLATES * 0.3) this.plateWarned = false;
    return amount - took;
  }

  // ------------------------------------------------------------------ binoculars

  toggleBinos(on = !this.viewing) {
    if (on && !this.state.count('binoculars')) { this.audio.play('deny'); this.toast('No binoculars. Kade\'s survey crews carry them. So does Inez, for a price.', 'bad'); return; }
    if (on === this.viewing) return;
    this.viewing = on;
    this.dwell.clear();
    this.hands.setBase(on ? 'binos' : 'idle');
    this.audio.play(on ? 'ui' : 'ui');
    this.audio.combat?.foley(on ? 'draw' : 'holster', 0.6);
  }

  private throwMolotov() {
    const s = this.state;
    if (!s.count('molotov')) { this.audio.play('deny'); this.toast('No molotovs. Mezcal and a bandage, at the fire.', 'bad'); return; }
    if (this.hands.busy) return;
    if (this.viewing) this.toggleBinos(false);
    this.audio.combat?.foley('draw', 0.5);
    this.hands.throwMolotov(() => {
      if (!s.removeItem('molotov', 1)) return;
      const eye = this.camera.getWorldPosition(_p);
      this.camera.getWorldDirection(_fwd);
      _r.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
      this.throwables.throwMolotov(eye, _fwd, _r, this.player.velocity);
      this.audio.play('throw');
    });
  }

  /** Tag markers for the minimap / map. */
  tagMarkers(): MapMarker[] {
    const out: MapMarker[] = [];
    for (const [h] of this.tags) out.push({ id: 'tag', x: h.center.x, z: h.center.z, label: 'Tagged', color: '#ff4a3a', kind: 'drone' });
    return out;
  }

  /** How many hostiles are tagged right now (tests, HUD). */
  get tagged() {
    return this.tags.size;
  }

  /** Every frame after the weapons. `blocked`: a menu or minigame owns the input. */
  update(dt: number, blocked: boolean) {
    const s = this.state;
    const input = this.input;
    this.t += dt;
    if (this.focusT > 0) {
      this.focusT -= dt;
      if (this.focusT <= 0) this.toast('Founder Focus wears off. You are very thirsty and slightly less of a genius.', 'info');
    }
    if (this.regen > 0) {
      // a point at a time, so the vitals bar isn't rewritten every frame
      const k = Math.min(this.regen, dt * 2);
      this.regen -= k;
      this.regenAcc += k;
      if (this.regenAcc >= 1 || this.regen <= 0) { s.heal(Math.round(this.regenAcc)); this.regenAcc = 0; }
    }
    if (!blocked && input.actPressed('binoculars')) this.toggleBinos();
    if (!blocked && input.actPressed('throw')) this.throwMolotov();
    // binoculars come down for anything urgent (a menu over them doesn't count: the Kit's Use raises them)
    if (this.viewing && !blocked && (this.player.sprinting || !this.player.grounded || input.actPressed('fire') || input.actPressed('aim') || input.actPressed('interact') || !s.count('binoculars'))) {
      this.toggleBinos(false);
    }
    this.binoK += ((this.viewing ? 1 : 0) - this.binoK) * (1 - Math.exp(-dt * (this.viewing ? 9 : 14)));
    if (this.binoK > 0.002) {
      this.cam.aimFov = 11;
      this.cam.aimK = Math.max(this.cam.aimK, this.binoK);
    }
    this.dom.binos.classList.toggle('on', this.binoK > 0.5);
    this.scopeView(dt);
    if (this.viewing && !blocked && this.binoK > 0.85) this.scan(dt);
    // expire tags
    for (const [h, until] of this.tags) if (!h.alive || until < this.t) this.tags.delete(h);
    this.markT -= dt;
    if (this.markT <= 0) { this.markT = 1 / 30; this.drawMarks(); }
    this.pillT -= dt;
    if (this.pillT <= 0) { this.pillT = 0.25; this.drawPills(); }
  }

  /**
   * A scoped .30-30 aimed: the scope's eyepiece instead of the gun (the model and the hands are hidden
   * so they can't block the view), and a slow drift of the reticle that breath, Marksman, Founder
   * Focus and crouching all calm.
   */
  private scopeView(dt: number) {
    const a = this.hands.arms;
    const on = a.current === 'rifle' && a.ads > 0.9 && this.state.has(MODS.scope.flag) && !this.viewing;
    if (on !== this.scopeOn) {
      this.scopeOn = on;
      this.dom.scope.classList.toggle('on', on);
      this.hands.root.visible = !on;
    }
    const steady = this.focused || this.state.focus('firearms') === 'marksman';
    const k = on ? (steady ? 0.15 : 1) * (this.player.crouching ? 0.6 : 1) : 0;
    const sx = Math.sin(this.t * 0.83) * 0.0017 * k + Math.sin(this.t * 2.1) * 0.0004 * k;
    const sy = Math.sin(this.t * 1.61) * 0.0012 * k;
    const ex = sx - this.swayX, ey = sy - this.swayY;
    const r = Math.min(1, dt * 10);
    this.cam.yaw += ex * r;
    this.cam.pitch += ey * r;
    this.swayX += ex * r;
    this.swayY += ey * r;
  }

  /** Dwell on a hostile near the middle of the view to tag it. */
  private scan(dt: number) {
    const eye = this.camera.getWorldPosition(_p);
    this.camera.getWorldDirection(_fwd);
    let near = 0;
    const seen = new Set<Hostile>();
    for (const pr of this.combat.providers) {
      for (const h of pr.hostiles()) {
        if (!h.alive || !TAGGABLE.has(h.kind)) continue;
        _to.subVectors(h.center, eye);
        const d = _to.length();
        if (d > 320 || d < 1) continue;
        const ang = Math.acos(Math.min(1, _to.dot(_fwd) / d));
        // a little wider than the target itself: you're looking through glass, not a scope
        if (ang > 0.045 + Math.atan2(h.radius, d)) continue;
        if (!this.combat.clearLine(eye, h.center, this.combat.target.collider)) continue;
        seen.add(h);
        const w = (this.dwell.get(h) ?? 0) + dt;
        this.dwell.set(h, w);
        if (w >= DWELL && !this.tags.has(h)) {
          this.tags.set(h, this.t + TAG_S);
          this.audio.play('ui');
          this.state.events.emit('toast', { text: `Tagged: ${label(h)}, ${Math.round(d)} m.`, kind: 'info' });
        } else if (this.tags.has(h)) this.tags.set(h, this.t + TAG_S);
        near = near || Math.round(d);
      }
    }
    for (const h of [...this.dwell.keys()]) if (!seen.has(h)) this.dwell.delete(h);
    // range to whatever's under the reticle
    const hit = this.combat.worldRay(eye, _fwd, 600, this.combat.target.collider);
    const range = near || (hit ? Math.round(hit.t) : 0);
    this.dom.range.textContent = range ? `${range} m` : '— m';
    this.dom.tagged.textContent = `${this.tags.size} tagged`;
  }

  /** Through-the-wall markers over tagged hostiles (DOM, 30 Hz, transforms only). */
  private drawMarks() {
    const d = this.dom;
    let i = 0;
    if (this.tags.size) {
      const w = innerWidth, h = innerHeight;
      const eye = this.camera.position;
      for (const [host] of this.tags) {
        if (i >= d.marks.length) break;
        _p.copy(host.center);
        _p.y += host.kind === 'human' ? 0.55 : host.radius + 0.25;
        const dist = Math.round(_p.distanceTo(eye));
        _p.project(this.camera);
        if (_p.z > 1 || Math.abs(_p.x) > 1.05 || Math.abs(_p.y) > 1.05) continue;
        const el = d.marks[i];
        el.style.display = '';
        el.style.transform = `translate(${((_p.x + 1) * 0.5 * w).toFixed(1)}px, ${((1 - _p.y) * 0.5 * h).toFixed(1)}px)`;
        if (this.shownDist[i] !== dist) { this.shownDist[i] = dist; d.dist[i].textContent = `${dist}`; }
        i++;
      }
    }
    for (let j = i; j < d.marks.length; j++) if (d.marks[j].style.display !== 'none') d.marks[j].style.display = 'none';
  }

  /** Status pills beside Crouch/Sprint: the vest's plates, Founder Focus, live tags. 4 Hz, text only on change. */
  private drawPills() {
    if (!this.pills || !this.pills.plates.isConnected) {
      const stance = this.uiRoot.querySelector('#hud .stance');
      if (!stance) return;
      const mk = (c: string) => { const e = document.createElement('span'); e.className = `pill gearp ${c}`; e.style.display = 'none'; stance.prepend(e); return e; };
      this.pills = { tagged: mk('tagp'), focus: mk('focusp'), plates: mk('platesp') };
      this.pillText = ['', '', ''];
    }
    const s = this.state;
    const p = s.count('vest') ? Math.round(vestPlates(s)) : -1;
    const f = Math.ceil(this.focusT);
    const texts = [
      p < 0 ? '' : p > 0 ? `Plates ${p}` : 'Plates spent',
      f > 0 ? `Focus ${Math.floor(f / 60)}:${String(f % 60).padStart(2, '0')}` : '',
      this.tags.size ? `Tagged ${this.tags.size}` : '',
    ];
    const els = [this.pills.plates, this.pills.focus, this.pills.tagged];
    texts.forEach((t, i) => {
      if (t === this.pillText[i]) return;
      this.pillText[i] = t;
      els[i].textContent = t;
      els[i].style.display = t ? '' : 'none';
      if (i === 0) els[i].classList.toggle('low', p >= 0 && p < VEST_PLATES * 0.3);
    });
  }

  /** Run over (death, quit): put everything down. */
  dispose() {
    if (this.viewing) this.toggleBinos(false);
    this.dom.binos.classList.remove('on');
    this.dom.scope.classList.remove('on');
    this.hands.root.visible = true;
    for (const m of this.dom.marks) m.style.display = 'none';
    if (this.pills) for (const e of Object.values(this.pills)) e.remove();
    this.pills = null;
  }
}

function label(h: Hostile) {
  return h.kind === 'human' ? 'contractor' : h.kind === 'mine' ? 'mine' : h.kind === 'turret' ? 'sentry' : h.kind;
}
