import * as THREE from 'three/webgpu';
import { Fn, vec4, vec3, uv, length, smoothstep, time, sin, float, color } from 'three/tsl';
import type { QualitySettings } from '@/engine/renderer';
import { makeQuality, fitCanvas } from '@/engine/renderer';
import { isTouch } from '@/engine/device';
import { TouchControls } from '@/ui/TouchControls';
import { PostFX } from '@/engine/postfx';
import { Physics } from '@/engine/physics';
import { Input } from '@/engine/input';
import { AudioEngine, type LoopHandle } from '@/engine/audio';
import { Acoustics, isSoft } from '@/engine/surface';
import { Atmosphere } from './world/Atmosphere';
import { Heightfield } from './world/Heightfield';
import { Terrain } from './world/Terrain';
import { Props } from './world/Props';
import { Landmarks } from './world/Landmarks';
import { Scrub } from './world/Scrub';
import { DustMotes, GroundHaze, DustPuffs, SandStreaks, DustDevils, Shockwave, heightTexture } from './world/effects';
import { Weather } from './world/Weather';
import { VirtualLight, lightPool } from './world/lights';
import { updateRim, glow } from './world/materials';
import { Garage } from './bunker/Garage';
import { Settlement } from './town/Settlement';
import { buildSites, type Site } from './sites';
import { Player } from './player/Player';
import { FirstPersonCamera } from './player/FirstPersonCamera';
import { Hands, HAND_LOOKS } from './player/Hands';
import { GameState, saveGame, loadGame, loadSettings, saveSettings, clearSave, type Settings } from './State';
import type { GameContext, Interactable, UIBridge } from './context';
import { UI, type HudFrame } from '@/ui/UI';
import { MapData, LANDMARK_MARKERS, type MapMarker } from '@/ui/Minimap';
import { SPAWN, WORLD_INTEL, LANDMARKS } from '@/content/world';
import { WORLD_CACHES, briefingFor, debriefFor, campRadio, epilogueFor, DEBRIEF_CHOICE, type DebriefChoice } from '@/content/story';
import { CAMP, type CampView } from '@/content/camp';
import { Story } from './Story';
import { RECIPES, type Recipe } from '@/content/craft';
import { SKILLS } from '@/content/skills';
import { GARAGE } from '@/content/bunkers/garage';
import { ITEMS, HOTBAR_ITEMS } from '@/content/items';
import { XP_REWARDS, fallFactor } from '@/content/progression';
import { damp } from '@/engine/noise';

/** Debug: ?skip=props,landmarks,scrub,dust,haze,env,post,garage,sites disables subsystems (for GPU bisecting). */
const SKIP = new Set((new URLSearchParams(location.search).get('skip') ?? '').split(',').filter(Boolean));

/**
 * Real point lights lent out by the light pool. Fixed for the session: changing it recompiles every
 * lit material, and each one is paid for by every lit pixel on screen.
 */
const POINT_LIGHTS: Record<string, number> = { low: 2, medium: 3, high: 4, ultra: 5 };

/** Debug: ?bench logs frame-rate stats to the console every 2s (read by the desktop test runs). */
const BENCH = new URLSearchParams(location.search).has('bench');

/** Only two hand looks exist. Work gloves for the Brute and the Scout, thin ones for the Fixer and the Defector. */
function handArchetype(id: string) {
  if (id === 'brute' || id === 'scout') return 'engineer';
  if (id === 'fixer' || id === 'defector') return 'infiltrator';
  return id;
}

type Mode = 'loading' | 'title' | 'charselect' | 'playing';

interface Grenade { mesh: THREE.Object3D; body: RigidBody; fuse: number; lastVel: THREE.Vector3; clink: number }
type RigidBody = ReturnType<Physics['world']['createRigidBody']>;

/** Owns the scene, world, player and the top-level state machine (title → select → play). */
export class Game {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 6000);
  physics = new Physics();
  audio = new AudioEngine();
  /** Footstep surfaces and room enclosure from a few physics rays (audio only). */
  acoustics: Acoustics | null = null;
  input: Input;
  ui: UI;
  /** On-screen controls (phones/tablets only). */
  touch: TouchControls | null = null;
  settings: Settings = loadSettings();
  quality: QualitySettings;
  post!: PostFX;
  atmo!: Atmosphere;
  hf!: Heightfield;
  terrain!: Terrain;
  props!: Props;
  landmarks!: Landmarks;
  scrub!: Scrub;
  dust!: DustMotes;
  haze!: GroundHaze;
  puffs!: DustPuffs;
  streaks!: SandStreaks;
  devils!: DustDevils;
  weather!: Weather;
  garage!: Garage;
  settlement!: Settlement;
  sites: Site[] = [];
  map!: MapData;
  player: Player | null = null;
  cam!: FirstPersonCamera;
  hands: Hands | null = null;
  state: GameState | null = null;
  /** Quest log, corner objective and exploring banter for the current run. */
  story: Story | null = null;
  mode: Mode = 'loading';
  private interactables: Interactable[] = [];
  private focus: Interactable | null = null;
  private grenades: Grenade[] = [];
  private shockwaves: Shockwave[] = [];
  private flash: VirtualLight;
  private intelMeshes = new Map<string, THREE.Object3D>();
  private intelGems: THREE.Object3D[] = [];
  private markerCache: MapMarker[] | null = null;
  private markerAt = 0;
  private readonly _fwd = new THREE.Vector3();
  private readonly _to = new THREE.Vector3();
  private loops: LoopHandle[] = [];
  private loopsStarted = false;
  private t = 0;
  private revealTimer = 0;
  private autosaveTimer = 60;
  private titleT = 0;
  private busy = false; // minigame/modal in progress
  private cubeRT: THREE.CubeRenderTarget | null = null;
  private cubeCam: THREE.CubeCamera | null = null;
  private envScene = new THREE.Scene();
  private envTimer = 0;
  private landmarkSeen = new Set<string>();
  private windedHint = false;
  private ctx!: GameContext;
  private last = performance.now();
  frames = 0;
  private benchT = 0;
  private benchFrames = 0;
  private benchUpd = 0;
  private benchPhys = 0;
  private benchRen = 0;
  backendLabel = 'WebGL2';

  constructor(private renderer: THREE.WebGPURenderer, public isWebGPU: boolean, private canvas: HTMLCanvasElement) {
    this.input = new Input(canvas);
    this.ui = new UI(this.audio);
    if (isTouch) this.touch = new TouchControls(this.input);
    const qOverride = new URLSearchParams(location.search).get('q') as Settings['quality'] | null;
    this.quality = makeQuality(qOverride ?? this.settings.quality);
    // WebGL: skip the GTAO pre-pass — it renders the whole scene a second time and draw calls are
    // the bottleneck there (especially in WebKitGTK). WebGPU keeps it.
    if (!isWebGPU) this.quality.ao = false;
    this.flash = new VirtualLight(0x7fe8ff, 0, 18, 2);
    this.flash.priority = 10;
    // every point light in the world is virtual; these few real ones are lent to what's near
    lightPool.attach(this.scene, POINT_LIGHTS[this.quality.level] ?? 4);
    this.applyAudioSettings();
  }

  // ------------------------------------------------------------------ boot
  async build() {
    const step = async (p: number, msg: string) => {
      this.ui.progress(p, msg);
      await new Promise((r) => setTimeout(r, 16));
    };
    await step(0.05, 'Warming up the apocalypse');
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]);
    await Promise.all(['900 64px "Big Shoulders Stencil Display"', '700 40px "Chakra Petch"', '600 20px "JetBrains Mono"'].map((f) => document.fonts.load(f).catch(() => null)));
    await step(0.1, 'Initialising physics');
    await this.physics.init();
    await step(0.2, 'Eroding terrain');
    this.atmo = new Atmosphere(this.scene);
    this.atmo.setShadowMapSize(this.quality.shadowMapSize);
    this.hf = new Heightfield();
    this.terrain = new Terrain(this.hf, this.atmo);
    this.terrain.addToPhysics(this.physics);
    this.acoustics = new Acoustics(this.physics, this.hf);
    this.scene.add(this.terrain.mesh, this.terrain.far);
    await step(0.4, 'Scattering debris of a failed civilisation');
    this.props = new Props(this.hf, this.physics, this.atmo);
    if (!SKIP.has('props')) this.scene.add(this.props.group);
    this.landmarks = new Landmarks(this.hf, this.physics);
    if (!SKIP.has('landmarks')) this.scene.add(this.landmarks.group);
    this.scrub = new Scrub(this.hf, this.quality.grassDensity);
    if (!SKIP.has('scrub')) this.scene.add(this.scrub.mesh);
    await step(0.55, 'Kicking up dust');
    const ht = heightTexture(this.hf);
    this.dust = new DustMotes(this.atmo, this.quality.dustCount);
    this.haze = new GroundHaze(this.atmo, this.hf, ht, 150);
    if (!SKIP.has('dust')) this.scene.add(this.dust.sprite);
    if (!SKIP.has('haze')) this.scene.add(this.haze.sprite);
    this.puffs = new DustPuffs(this.atmo);
    if (!SKIP.has('dust')) this.scene.add(this.puffs.sprite);
    this.streaks = new SandStreaks(this.atmo, this.hf, ht, Math.round(this.quality.dustCount * 0.3));
    if (!SKIP.has('dust')) this.scene.add(this.streaks.sprite);
    this.devils = new DustDevils(this.atmo, this.hf, ht);
    if (!SKIP.has('haze')) this.scene.add(this.devils.sprite);
    this.weather = new Weather(this.atmo);
    this.weather.onPhase = (p) => {
      if (this.mode !== 'playing') return;
      if (p === 'front') this.ui.toast('A dust storm is rolling in. Low visibility will blind SeedBot\'s optics.', 'info');
      else if (p === 'clearing') this.ui.toast('The dust storm is passing.', 'info');
    };
    this.weather.onLightning = (k) => this.audio.thunder(k);
    await step(0.62, 'Charting the wasteland');
    this.map = new MapData(this.hf);
    this.cam = new FirstPersonCamera(this.camera);
    this.camera.near = 0.05;
    this.camera.fov = this.cam.baseFov;
    this.camera.updateProjectionMatrix();
    this.scene.add(this.camera); // viewmodel hands + flashlight are children of the camera
    // the third-person body is rendered into the sun's shadow map only (layer 1)
    this.atmo.sun.shadow.camera.layers.enable(1);
    this.ctx = this.makeContext();
    await step(0.7, 'Building a doomsday bunker (pre-revenue)');
    this.garage = new Garage(this.ctx);
    this.settlement = new Settlement(this.ctx, this.landmarks);
    if (!SKIP.has('sites')) this.sites = buildSites(this.ctx, this.landmarks);
    this.buildIntel();
    if (!SKIP.has('env')) this.buildEnvironment();
    if (SKIP.has('garage')) this.scene.remove(this.garage.b.group, this.garage.drone.group);
    if (SKIP.has('ui')) document.getElementById('ui')!.style.display = 'none';
    if (SKIP.has('terrain')) this.scene.remove(this.terrain.mesh, this.terrain.far);
    if (SKIP.has('sky')) this.scene.remove(this.atmo.sky);
    if (SKIP.has('shadows')) this.renderer.shadowMap.enabled = false;
    if (SKIP.has('fog')) this.scene.fogNode = null;
    await step(0.8, 'Compiling shaders');
    this.post = new PostFX(this.renderer, this.scene, this.camera, this.atmo.sun, this.quality);
    this.resize();
    this.physics.step();
    this.setTitleCamera(0);
    this.atmo.update(0, this.camera.position);
    // best-effort precompile; can stall in background tabs, so cap it
    await Promise.race([this.renderer.compileAsync(this.scene, this.camera).catch(() => null), new Promise((r) => setTimeout(r, 5000))]);
    await step(0.95, 'Polishing neon');
    this.renderer.setAnimationLoop(() => this.frame());
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('bb-lockchange', () => this.onLockChange());
    // the grab can fail (WebKitGTK/XWayland, now and then): say so, and the next click on the view retries
    document.addEventListener('bb-lockerror', () => {
      if (this.mode === 'playing' && !this.ui.modalOpen && !this.ui.minigameOpen) this.ui.resumeHint(true);
    });
    this.canvas.addEventListener('click', () => {
      if (this.mode === 'playing' && !this.ui.modalOpen && !this.ui.minigameOpen) this.input.requestLock();
    });
    await new Promise((r) => setTimeout(r, 400));
    this.ui.hideLoading();
    this.toTitle();
  }

  private makeContext(): GameContext {
    const self = this;
    const ui: UIBridge = {
      // Focuses and capstones that change the minigames live here, so every lock and board in the
      // world (Garage, Dry Creek, the sites) gets them without knowing about them.
      lockpick: async (o) => {
        const s = self.state!;
        let pins = o.pins;
        let onBreak = o.onBreak;
        if (s.focus('lockpicking') === 'feeler') pins = Math.max(2, pins - 1);
        if (s.focus('lockpicking') === 'saver') {
          onBreak = () => {
            if (Math.random() < 0.5 && s.count('lockpick') > 0) {
              s.events.emit('toast', { text: 'The pick held. Barely.', kind: 'good' });
              return true;
            }
            return o.onBreak();
          };
        }
        if (s.capstone('lockpicking') === 'bump' && pins <= 3) {
          s.events.emit('toast', { text: 'Bump key. Three pins never stood a chance.', kind: 'good' });
          return 'success';
        }
        const res = await self.withMinigame('lockpick', () => self.ui.lockpick({ ...o, pins, onBreak }));
        if (res === 'success' && s.capstone('lockpicking') === 'master') s.addItem('lockpick', 1, true);
        return res;
      },
      keypad: (o) => self.withMinigame('keypad', () => self.ui.keypad(o)),
      circuit: async (o) => {
        const s = self.state!;
        let difficulty = o.difficulty;
        if (s.focus('electronics') === 'hotline') difficulty = Math.max(0, difficulty - 1);
        if (s.capstone('electronics') === 'overclock') difficulty = Math.max(0, difficulty - 1);
        const ok = await self.withMinigame('keypad', () => self.ui.circuit({ ...o, difficulty }));
        if (ok && s.capstone('electronics') === 'salvage' && s.addItem('battery', 1, true)) {
          s.events.emit('toast', { text: 'Salvage: you pocket a lithium cell from the board.', kind: 'good' });
        }
        return ok;
      },
      choose: (o) => self.withMinigame('idle', () => self.ui.choose(o)),
      converse: (o) => self.withMinigame('idle', () => self.ui.converse(o)),
      banner: (a, b, k) => self.ui.banner(a, b, k),
      subtitle: (a, b) => self.ui.subtitle(a, b),
    };
    return {
      get state() { return self.state!; },
      audio: this.audio,
      physics: this.physics,
      ui,
      get player() { return self.player!; },
      cam: this.cam,
      get post() { return self.post; },
      atmo: this.atmo,
      hf: this.hf,
      scene: this.scene,
      get puffs() { return self.puffs; },
      caught: (reason: string) => this.caught(reason),
    } as unknown as GameContext;
  }

  private async withMinigame<T>(pose: string, fn: () => Promise<T>): Promise<T> {
    this.busy = true;
    this.input.exitLock();
    if (this.player) { this.player.frozen = true; this.player.interactPose = 1; }
    this.hands?.setBase(pose);
    this.ui.setHudVisible(false);
    try {
      return await fn();
    } finally {
      this.busy = false;
      if (this.player) { this.player.frozen = false; this.player.interactPose = 0; }
      this.hands?.setBase('idle');
      this.ui.setHudVisible(true);
      this.input.requestLock();
    }
  }

  /** Cube-camera environment from the sky so PBR metals pick up the dusk light. */
  private buildEnvironment() {
    try {
      const sky = new THREE.Mesh(this.atmo.sky.geometry, this.atmo.sky.material);
      this.envScene.add(sky);
      const groundMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
      groundMat.colorNode = this.atmo.uHaze.mul(0.35);
      const ground = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 8, 0, Math.PI * 2, Math.PI / 2 + 0.02, Math.PI / 2), groundMat);
      this.envScene.add(ground);
      this.cubeRT = new THREE.CubeRenderTarget(128, { type: THREE.HalfFloatType });
      this.cubeCam = new THREE.CubeCamera(1, 5000, this.cubeRT);
      this.envScene.add(this.cubeCam);
      this.scene.environment = this.cubeRT.texture;
    } catch (e) {
      console.warn('env map disabled', e);
    }
  }

  private updateEnvironment(dt: number) {
    if (!this.cubeCam || !this.cubeRT) return;
    this.envTimer -= dt;
    if (this.envTimer > 0) return;
    this.envTimer = 2.5;
    try {
      this.cubeCam.update(this.renderer, this.envScene);
      this.cubeRT.texture.needsPMREMUpdate = true;
    } catch (e) {
      console.warn('env update failed', e);
      this.cubeCam = null;
    }
  }

  private buildIntel() {
    for (const it of WORLD_INTEL) {
      const g = new THREE.Group();
      const x = it.position[0], z = it.position[2];
      g.position.set(x, this.hf.heightAt(x, z) + 1.1, z);
      const holo = glow('#c896ff', 5);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), holo.material);
      gem.name = 'gem';
      g.add(gem);
      this.intelGems.push(gem);
      const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.42), new THREE.MeshStandardNodeMaterial({ color: '#e8dcc0', roughness: 0.8, side: THREE.DoubleSide }));
      paper.position.y = -0.5;
      paper.rotation.x = -1.2;
      g.add(paper);
      // vertical light beam
      // additive, so one pass over both faces matches the default two-pass DoubleSide transparency
      const beamMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, forceSinglePass: true });
      beamMat.colorNode = Fn(() => {
        const v = uv();
        const edge = smoothstep(0.5, 0.0, length(v.x.sub(0.5)));
        const fade = smoothstep(1.0, 0.0, v.y).mul(sin(time.mul(3)).mul(0.2).add(0.8));
        return vec4(color('#c896ff').mul(edge.mul(fade).mul(1.4)), float(1));
      })();
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 12, 1, true), beamMat);
      beam.position.y = 2.2;
      g.add(beam);
      this.scene.add(g);
      this.intelMeshes.set(it.id, g);
      this.interactables.push({
        id: it.id,
        pos: g.position.clone().setY(g.position.y - 0.8),
        radius: 2.4,
        visible: () => !this.state?.has(`intel:${it.id}`),
        primary: {
          label: `Read: ${it.title.split('—')[0].trim()}`,
          available: () => true,
          run: () => this.collectIntel(it.id),
        },
      });
    }
    // campfire: rest is partial unless Survival 5, and the radio is the story
    const camp = this.landmarks.campPosition;
    this.interactables.push({
      id: 'camp',
      pos: camp.clone(),
      radius: 3.2,
      primary: { label: 'The camp', available: () => true, run: () => this.openCamp() },
      secondary: {
        label: 'Wait until ' + 'night/day',
        available: () => true,
        run: () => this.waitTime(),
      },
    });
    for (const c of WORLD_CACHES) {
      const y = this.hf.heightAt(c.x, c.z) + 0.5;
      this.interactables.push({
        id: c.id,
        pos: new THREE.Vector3(c.x, y, c.z),
        radius: 2.3,
        visible: () => !this.state?.has(c.id),
        primary: { label: c.label, available: () => true, run: () => this.takeCache(c.id) },
      });
    }
    this.interactables.push(...this.garage.interactables, ...this.settlement.interactables, ...this.sites.flatMap((s) => s.interactables));
  }

  private collectIntel(id: string) {
    const s = this.state!;
    const it = WORLD_INTEL.find((i) => i.id === id)!;
    s.set(`intel:${id}`);
    for (const r of it.reveals ?? []) s.set(r);
    const lines = [...(it.revealLines ?? [])];
    for (const loot of it.loot ?? []) {
      const n = s.addItem(loot.id, loot.qty);
      if (n) lines.push(`Salvaged ${n}× ${ITEMS[loot.id]?.name ?? loot.id}.`);
    }
    const mesh = this.intelMeshes.get(id);
    if (mesh) mesh.visible = false;
    this.ui.showIntel(it.title, it.body, lines.join('<br>'), () => this.afterModal());
    this.input.exitLock();
    s.addXP(it.xp, 'Intel recovered');
  }

  private takeCache(id: string) {
    const c = WORLD_CACHES.find((x) => x.id === id);
    const s = this.state;
    if (!c || !s || !s.set(c.id)) return;
    if (c.shockWithoutElectronics && s.skill('electronics') < 1) {
      s.damage(8);
      this.audio.play('zap');
      this.ui.toast('The mast bit you. Electronics would have made it polite.', 'bad');
    }
    const got: string[] = [];
    for (const it of c.items) {
      const n = s.addItem(it.id, it.qty);
      if (n) got.push(`${n}× ${ITEMS[it.id]?.name ?? it.id}`);
    }
    s.addXP(c.xp, 'Scavenged');
    this.audio.play('pickup');
    this.ui.toast(got.join(' · ') || 'Nothing you could carry.', got.length ? 'good' : 'info');
  }

  private recipeBlock(r: Recipe): string | undefined {
    const s = this.state!;
    if (r.skill && s.skill(r.skill.id) < r.skill.level) return `Needs ${SKILLS[r.skill.id].name} ${r.skill.level}`;
    for (const n of r.need) if (s.count(n.id) < n.qty) return `Need ${n.qty}× ${ITEMS[n.id]?.name ?? n.id}`;
    return undefined;
  }

  /** The fire, the scrap, the people around it, and Mara. One panel, because the camp is one place. */
  private openCamp() {
    const s = this.state!;
    const debrief = s.has('garage.complete') && !s.has('debriefed');
    const recipeRow = (r: Recipe) => {
      const n = s.craftYield(r);
      const detail = n === r.out.qty ? r.detail : r.detail.replace(/→ \d+/, `→ ${n}`);
      return { id: r.id, name: r.name, detail, disabled: this.recipeBlock(r) };
    };
    const recipes = RECIPES.map(recipeRow);
    const refreshRecipes = () => recipes.splice(0, recipes.length, ...RECIPES.map(recipeRow));
    const campView = (): CampView => ({ has: (f) => s.has(f), count: (id) => s.count(id), rep: (id) => s.rep(id), name: s.archetype.name });
    void this.withMinigame('idle', async () => {
      for (;;) {
        const why = await this.ui.camp({
          radioLabel: debrief ? 'Radio Mara · read the names' : 'Raise Mara on the radio',
          people: CAMP.filter((m) => m.present(campView())).map((m) => ({ id: m.id, name: m.name, role: m.role })),
          onRest: () => {
            const full = s.skill('survival') >= 5;
            s.restAtFire();
            this.save(true);
            this.audio.play('uiConfirm');
            this.ui.toast(full ? 'You sleep like someone who learned how. Saved.' : 'Rested. Not new. Saved.', 'good');
          },
          onCraft: (id) => {
            const err = s.craft(id);
            refreshRecipes();
            return err;
          },
          recipes,
        });
        if (why === 'closed') return;
        if (why === 'radio') {
          if (debrief) await this.runDebrief();
          else {
            const call = campRadio({ has: (f) => s.has(f), archetype: s.archetype });
            await this.ui.pages(call.pages, 'Back to the fire');
            for (const f of call.flags) s.set(f);
          }
          return;
        }
        // a person by the fire: talk, then come back to the panel
        const member = CAMP.find((m) => m.id === why);
        if (member) await this.campTalk(member.id);
      }
    });
  }

  /** One conversation with someone at the fire. Effects are the camp's own (content/camp.ts). */
  private async campTalk(id: string) {
    const s = this.state!;
    const member = CAMP.find((m) => m.id === id);
    if (!member) return;
    const view = (): CampView => ({ has: (f) => s.has(f), count: (i) => s.count(i), rep: (p) => s.rep(p), name: s.archetype.name });
    await this.ui.converse({
      start: 'hello',
      node: (n) => member.node(n, view()),
      onChoice: (_n, choice) => {
        if (choice === 'gift' && s.set('camp.hollis.gift')) {
          s.addItem('noisemaker', 1);
          this.ui.toast('Hollis presses a can and a bolt into your hand. "Throw it where you aren\'t."', 'good');
        }
        if (choice === 'donate' && s.count('water') >= 2 && !s.has('q.pip.2')) {
          s.removeItem('water', 2);
          s.set(s.has('q.pip.1') ? 'q.pip.2' : 'q.pip.1');
          s.addXP(15, 'Into the ledger');
          this.audio.play('uiConfirm');
        }
        if (choice === 'emp' && s.count('battery') >= 1 && s.count('scrap') >= 2) {
          s.removeItem('battery', 1);
          s.removeItem('scrap', 2);
          s.addItem('emp', 1);
        }
      },
    });
  }

  /** Mara reads the names, Vesper cuts in, and you decide what the ledger is for. Escape defers it. */
  private async runDebrief() {
    const s = this.state!;
    await this.ui.pages(debriefFor(s.archetype, { has: (f) => s.has(f), archetype: s.archetype }), 'Decide');
    const pick = (await this.ui.choose(DEBRIEF_CHOICE)) as DebriefChoice | null;
    if (!pick) {
      this.ui.toast('Mara: "Take a minute. The ledger isn\'t going anywhere. Neither is she."', 'info');
      return;
    }
    if (pick === 'deal') s.removeItem('seed_manifest', 1);
    s.set(`act1.${pick}`);
    await this.ui.pages(epilogueFor(s.archetype, pick), 'Close the radio');
    if (s.set('debriefed')) {
      s.data.thirst = 100;
      s.data.hunger = Math.min(100, s.data.hunger + 35);
      s.heal(30);
      s.addXP(XP_REWARDS.debrief, 'The names, read out loud');
      // the quest log closes Act I with its own banner and opens Act II
      this.story?.sync();
      this.save(true);
    }
  }

  private async waitTime() {
    const night = this.atmo.isNight;
    this.ui.fade(true, night ? 'You doze off by the fire…' : 'You wait for the cover of darkness…');
    await new Promise((r) => setTimeout(r, 900));
    this.atmo.hour = night ? 7.2 : 21.5;
    this.envTimer = 0;
    await new Promise((r) => setTimeout(r, 500));
    this.ui.fade(false);
  }

  // ------------------------------------------------------------------ modes
  private setTitleCamera(t: number) {
    const o = this.garage?.b.origin ?? new THREE.Vector3(96, 0, -150);
    // orbit on the sunset side so the bunker is back-lit, framed to the right of the logo
    const a = 5.55 + Math.sin(t * 0.04) * 0.3;
    const r = 40 + Math.sin(t * 0.13) * 4;
    this.camera.position.set(o.x + Math.sin(a) * r, o.y + 7 + Math.sin(t * 0.2) * 1.2, o.z + Math.cos(a) * r);
    const fwd = new THREE.Vector3(o.x - this.camera.position.x, 0, o.z - this.camera.position.z).normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    this.camera.lookAt(o.x - right.x * 13, o.y + 6, o.z - right.z * 13);
  }

  toTitle() {
    this.mode = 'title';
    this.titleT = 0;
    this.atmo.hour = 17.45;
    this.atmo.paused = false;
    this.atmo.dayLengthMinutes = 240;
    this.removePlayer();
    this.ui.hud?.remove();
    this.input.exitLock();
    const save = loadGame();
    if (new URLSearchParams(location.search).has('autostart')) {
      // debug: skip menus straight into a fresh Infiltrator run (used by automated benchmarks)
      setTimeout(() => this.startGame(GameState.fresh('infiltrator', SPAWN)), 50);
      return;
    }
    // debug: ?open=controls|settings opens a menu over the title (desktop perf testing)
    const open = new URLSearchParams(location.search).get('open');
    if (open) setTimeout(() => (open === 'settings' ? this.ui.openSettings(this.settings, (s) => this.applySettings(s)) : this.ui.showControls()), 1500);
    this.ui.showTitle({
      canContinue: !!save,
      backend: this.backendLabel,
      onContinue: () => this.startGame(new GameState(save!)),
      onNew: () => this.toCharSelect(),
      onSettings: () => this.ui.openSettings(this.settings, (s) => this.applySettings(s)),
    });
  }

  private toCharSelect() {
    this.mode = 'charselect';
    this.atmo.hour = 18.55;
    this.atmo.paused = true;
    const show = (id: string) => {
      this.hands?.dispose();
      const look = handArchetype(id);
      this.hands = new Hands(HAND_LOOKS[look] ?? HAND_LOOKS.infiltrator);
      this.hands.attach(this.camera);
      this.hands.setBase(look === 'engineer' ? 'showcaseEmp' : 'showcase');
    };
    const leave = () => { this.hands?.dispose(); this.hands = null; };
    // (hands are re-created fresh in startGame, so the showcase offset never leaks into play)
    this.ui.showCharSelect(
      (id) => {
        leave();
        clearSave();
        this.startGame(GameState.fresh(id, SPAWN));
      },
      show,
      () => { leave(); this.toTitle(); },
    );
  }

  private startGame(state: GameState) {
    this.state = state;
    this.mode = 'playing';
    this.atmo.paused = false;
    this.atmo.dayLengthMinutes = 26;
    this.atmo.hour = state.data.hour;
    const hourOverride = Number(new URLSearchParams(location.search).get('hour')); // debug: ?hour=18.6
    if (hourOverride) this.atmo.hour = hourOverride;
    this.map.deserialize(state.data.discovered);
    const [x, , z] = state.data.position;
    const spawn = new THREE.Vector3(x, this.hf.heightAt(x, z) + 0.1, z);
    this.player = new Player(this.physics, state.data.archetype, spawn);
    this.player.yaw = state.data.yaw;
    this.player.speedMult = state.archetype.stats.speed;
    this.scene.add(this.player.model.root);
    // shadow-only body in first person (layer 1): one merged caster per animated joint
    this.player.model.bakeShadowProxy(0.07);
    this.hands?.dispose();
    this.hands = new Hands(HAND_LOOKS[handArchetype(state.data.archetype)] ?? HAND_LOOKS.infiltrator);
    this.hands.attach(this.camera);
    // footsteps follow the first-person stride (the shadow body's gait runs on its own clock)
    this.player.model.onFootstep = null;
    this.cam.onStep = (k) => {
      const pl = this.player;
      if (!pl) return;
      const surf = this.acoustics?.surfaceAt(pl.position) ?? 'sand';
      this.audio.footstep(surf, k, { crouch: pl.crouching, sprint: pl.sprinting });
      // sprinting on sand kicks up a little dust behind each footfall
      if (isSoft(surf) && pl.sprinting && pl.grounded) {
        const back = pl.velocity.clone().setY(0).multiplyScalar(-0.15);
        this.puffs.emit(pl.position.clone().addScaledVector(pl.velocity, 0.05), 2, 0.35, 0.35, 0.35, back);
      }
    };
    this.player.onLand = (k, speed) => this.landed(k, speed);
    this.player.onTuck = (dy) => this.cam.shiftEye(dy);
    this.player.onJump = () => {
      if (this.player) this.audio.footstep(this.acoustics?.surfaceAt(this.player.position) ?? 'sand', 0.6, { kind: 'jump' });
    };
    this.cam.snap(state.data.yaw + Math.PI, -0.05);
    this.garage.applyFlags(true);
    for (const it of WORLD_INTEL) {
      const m = this.intelMeshes.get(it.id);
      if (m) m.visible = !state.has(`intel:${it.id}`);
    }
    this.garage.voiceEnabled = this.settings.voice;
    this.ui.mountHUD(state, this.map);
    this.story?.dispose();
    this.story = new Story(state, this.ui, this.audio);
    this.ui.fade(true);
    setTimeout(() => this.ui.fade(false), 300);
    // Harness runs and old saves skip the radio. A new game hears why the radio exists.
    const skipBrief = new URLSearchParams(location.search).has('autostart') || state.has('briefed');
    if (skipBrief) {
      if (!state.has('briefed')) { state.set('briefed'); state.set('intro'); }
      this.input.requestLock();
    } else if (this.player) {
      this.player.frozen = true;
      this.busy = true;
      void this.ui.pages(briefingFor(state.archetype)).then(() => {
        state.set('briefed');
        state.set('intro');
        if (this.player) this.player.frozen = false;
        this.busy = false;
        this.input.requestLock();
        this.ui.banner('LAST CHANCE', `${state.archetype.name} · Day 1,284`, 'info');
      });
    }
    this.startLoops();
  }

  /** Touchdown. Above ~3 m (7.7 m/s) a fall starts to hurt; ~11 m will put you down. */
  private landed(k: number, speed: number) {
    if (this.player) this.audio.land(this.acoustics?.surfaceAt(this.player.position) ?? 'sand', k);
    this.cam.land(speed);
    this.hands?.jolt(k * 0.5);
    if (this.player && !this.garage.playerInside && speed > 3.5) {
      this.puffs.emit(this.player.position, Math.round(6 + k * 10), 0.8 + k * 2.2, 0.25 + k * 0.5, 0.45 + k * 0.5, this.player.velocity.clone().multiplyScalar(0.4));
    }
    if (speed > 7.7 && this.state) {
      const trail = this.state.archetype.perk === 'trail' ? 0.75 : 1; // the Scout's Long Walk
      const dmg = Math.round((speed - 7.7) * 11 * fallFactor(this.state.skill('survival')) * trail);
      this.state.damage(dmg);
      this.audio.play('thud', { intensity: Math.min(1, (speed - 7.7) / 6 + 0.4) });
      this.post.damage.value = Math.min(1, 0.4 + dmg / 60);
      if (dmg >= 8) this.ui.toast(dmg >= 40 ? 'That fall nearly broke your legs.' : 'Hard landing. Your knees disagree with that decision.', 'bad');
    }
  }

  private removePlayer() {
    this.story?.dispose();
    this.story = null;
    if (this.player) {
      this.scene.remove(this.player.model.root);
      this.physics.world.removeCollider(this.player.collider, false);
      this.player = null;
    }
    this.state = null;
  }

  private startLoops() {
    if (this.loopsStarted || !this.audio.ready) return;
    this.loopsStarted = true;
    for (const spot of this.landmarks.audioSpots) {
      const l = this.audio.loop(spot.kind, spot.pos);
      if (l) this.loops.push(l);
    }
    this.garage.startAudio();
  }

  save(silent = false) {
    if (!this.state || !this.player) return;
    const d = this.state.data;
    d.position = [this.player.position.x, this.player.position.y, this.player.position.z];
    d.yaw = this.player.yaw;
    d.hour = this.atmo.hour;
    d.discovered = this.map.serialize();
    const ok = saveGame(this.state);
    if (!silent) this.ui.toast(ok ? 'Game saved.' : 'Save failed (storage blocked?)', ok ? 'good' : 'bad');
  }

  private caught(reason: string) {
    this.audio.sting('caught');
    if (!this.state || !this.player) return;
    const s = this.state;
    s.data.stats.caught++;
    // Exit Plan (Stealth capstone): you planned for this. Nothing lost but the walk back.
    const exit = s.capstone('stealth') === 'exit';
    if (!exit) {
      s.data.thirst = Math.max(0, s.data.thirst - 12);
      s.data.hunger = Math.max(0, s.data.hunger - 6);
    }
    this.hands?.jolt(1);
    this.busy = true;
    this.player.frozen = true;
    setTimeout(() => this.ui.fade(true, reason), 350);
    setTimeout(() => {
      if (!exit) {
        s.removeItem('lockpick', 1);
        if (s.data.health > 25) s.damage(20);
      }
      const p = this.garage.outsidePoint;
      p.y = this.hf.heightAt(p.x, p.z) + 0.2;
      this.player!.teleport(p);
      this.cam.snap(0, 0);
      this.garage.alarm = 0.01;
      this.garage.drone.detection = 0;
      this.garage.drone.state = 'patrol';
      this.audio.setAlarm(false);
    }, 1500);
    setTimeout(() => {
      this.ui.fade(false);
      this.player!.frozen = false;
      this.busy = false;
      if (exit) this.ui.toast('Exit Plan. You kept the pick, and you kept your dignity. Mostly the pick.', 'good');
      else if (s.set('tut.caught')) this.ui.subtitle('Mara Voss', 'SeedBot graduates people. Crouch, or don\'t let it look at you. The pick was the expensive part.');
    }, 3600);
  }

  private onLockChange() {
    if (this.mode !== 'playing') return;
    // a lock that lands late (the close of the previous menu) must not grab the mouse out of this one
    if (this.input.locked && (this.ui.modalOpen || this.ui.minigameOpen || this.busy)) {
      this.input.exitLock();
      return;
    }
    if (!this.input.locked && !this.ui.modalOpen && !this.ui.minigameOpen && !this.busy) this.openPause();
    this.ui.resumeHint(false);
  }

  private openPause() {
    this.ui.openPause({
      onResume: () => this.afterModal(),
      onSave: () => this.save(),
      onSettings: () => this.ui.openSettings(this.settings, (s) => this.applySettings(s)),
      onQuit: () => { this.save(true); this.toTitle(); },
    });
  }

  private afterModal() {
    if (this.mode !== 'playing') return;
    this.input.requestLock();
    setTimeout(() => { if (!this.input.locked && !this.ui.modalOpen) this.ui.resumeHint(true); }, 200);
  }

  applySettings(s: Settings) {
    this.settings = s;
    saveSettings(s);
    this.applyAudioSettings();
    this.input.sensitivity = s.sensitivity;
    if (this.garage) this.garage.voiceEnabled = s.voice;
    if (s.quality !== this.quality.level && this.post) {
      this.quality = makeQuality(s.quality);
      if (!this.isWebGPU) this.quality.ao = false;
      this.resize();
      this.atmo.setShadowMapSize(this.quality.shadowMapSize);
      this.post.setQuality(this.quality);
      this.dust.sprite.count = this.quality.dustCount;
      this.streaks.sprite.count = Math.round(this.quality.dustCount * 0.3);
    }
  }

  private applyAudioSettings() {
    this.audio.setVolumes({ master: this.settings.master, music: this.settings.music, sfx: this.settings.sfx });
    this.input.sensitivity = this.settings.sensitivity;
  }

  private resize() {
    this.fitW = innerWidth;
    this.fitH = innerHeight;
    const { aspect } = fitCanvas(this.renderer, this.canvas, this.quality.pixelRatio, this.isWebGPU);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ gameplay helpers
  private useItem(id: string) {
    const s = this.state!;
    if (!s.count(id)) { this.audio.play('deny'); return; }
    if (this.hands?.busy) return;
    if (id === 'emp') {
      if (this.hands && this.mode === 'playing' && !this.ui.modalOpen) this.hands.throwEmp(() => this.throwEmp());
      else this.throwEmp();
      return;
    }
    if (id === 'noisemaker') { this.popNoisemaker(); return; }
    if (id === 'sol_roll') {
      // keeping Sol's roll is a choice in his quest: five picks now, a locksmith who remembers
      s.removeItem('sol_roll', 1);
      s.addItem('lockpick', 5, false, true);
      s.set('q.sol.kept');
      this.audio.play('pickup');
      this.ui.toast('You unroll Sol\'s picks into your kit. Somewhere by a fire, a locksmith feels it.', 'info');
      return;
    }
    const meal = id === 'ration' ? [45, 0, 18] : id === 'water' ? [0, 42, 4] : id === 'soylent' ? [30, 12, 12] : null;
    if (meal) {
      s.removeItem(id, 1);
      const apply = () => {
        const hp = s.satisfy(meal[0], meal[1], meal[2]);
        this.audio.play('eat');
        const bits = [hp ? `+${hp} health` : '', meal[0] ? 'less hungry' : '', meal[1] ? 'less thirsty' : ''].filter(Boolean);
        this.ui.toast(`${ITEMS[id].name}. ${bits.join(', ')}.`, 'good');
      };
      if (this.hands && !this.ui.modalOpen) this.hands.eat(apply); else apply();
      return;
    }
    if (id === 'medkit') {
      s.removeItem(id, 1);
      const apply = () => {
        s.heal(55);
        s.data.thirst = Math.max(0, s.data.thirst - 4);
        this.audio.play('eat');
        this.ui.toast('Medkit. The hole closes. Your mouth is a little drier.', 'good');
      };
      if (this.hands && !this.ui.modalOpen) this.hands.eat(apply); else apply();
    }
  }

  private popNoisemaker() {
    const s = this.state!;
    if (!this.player || !s.removeItem('noisemaker', 1)) return;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    const pos = this.player.position.clone().addScaledVector(fwd, 16);
    pos.y = this.hf.heightAt(pos.x, pos.z) + 0.4;
    this.audio.play('cans', { pos });
    const near = this.player.position.distanceTo(this.garage.b.origin) < 90;
    const drone = this.garage.drone;
    if (near && drone.state !== 'disabled' && drone.state !== 'alert') {
      drone.investigate(pos);
      this.ui.toast('The can lands somewhere you are not. SeedBot goes to look.', 'info');
    } else if (near && drone.state === 'alert') this.ui.toast('Too late for a rattle. It already likes you.', 'bad');
    else this.ui.toast('A can rattles in the dust. Nothing out here is paid to care.', 'info');
  }

  private throwEmp() {
    const s = this.state!;
    if (!this.player || !s.removeItem('emp', 1)) { this.audio.play('deny'); return; }
    // a real canister: dark knurled body with a glowing arming band (matches the one in your hand)
    const m = new THREE.Group();
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.12, 16), new THREE.MeshStandardNodeMaterial({ color: '#3a4248', roughness: 0.35, metalness: 0.7 }));
    can.castShadow = true;
    const ring = glow('#7fe8ff', 6);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0415, 0.0415, 0.014, 16, 1, true), ring.material);
    band.position.y = 0.015;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.04, 0.02, 16), new THREE.MeshStandardNodeMaterial({ color: '#c8ccd0', roughness: 0.3, metalness: 1 }));
    cap.position.y = 0.07;
    m.add(can, band, cap);
    // released from the right hand, just below and right of the eye
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const start = this.camera.position.clone().addScaledVector(right, 0.18).add(new THREE.Vector3(0, -0.1, 0));
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    fwd.y = Math.max(fwd.y + 0.3, 0.12);
    fwd.normalize();
    start.addScaledVector(fwd, 0.4);
    m.position.copy(start);
    this.scene.add(m);
    // rigid body: ~0.5 kg steel can, bounces and rolls on the real colliders (CCD so it can't tunnel)
    const R = this.physics.R;
    const vel = fwd.multiplyScalar(12.5).add(this.player.velocity.clone().setY(Math.max(0, this.player.velocity.y)));
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 0.5, Math.random() * 6.28, Math.PI / 2 + (Math.random() - 0.5) * 0.4));
    const body = this.physics.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(start.x, start.y, start.z)
        .setRotation(q)
        .setLinvel(vel.x, vel.y, vel.z)
        .setAngvel({ x: right.x * -9 + (Math.random() - 0.5) * 4, y: (Math.random() - 0.5) * 6, z: right.z * -9 })
        .setLinearDamping(0.02)
        .setAngularDamping(0.35)
        .setCcdEnabled(true),
    );
    this.physics.world.createCollider(R.ColliderDesc.cylinder(0.06, 0.04).setDensity(830).setRestitution(0.32).setFriction(0.6), body);
    this.grenades.push({ mesh: m, body, fuse: 1.6, lastVel: vel.clone(), clink: 0 });
    this.audio.play('throw');
  }

  private updateGrenades(dt: number) {
    for (const g of [...this.grenades]) {
      g.fuse -= dt;
      g.clink = Math.max(0, g.clink - dt);
      const t = g.body.translation(), r = g.body.rotation(), v = g.body.linvel();
      g.mesh.position.set(t.x, t.y, t.z);
      g.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      // impacts: a sudden change in velocity = it hit something
      const jolt = Math.hypot(v.x - g.lastVel.x, v.y - g.lastVel.y, v.z - g.lastVel.z);
      if (jolt > 1.6 && g.clink <= 0) {
        g.clink = 0.07;
        this.audio.play('bounce', { pos: g.mesh.position, intensity: Math.min(1, jolt / 9) });
        if (jolt > 3) this.puffs.emit(g.mesh.position, 3, 0.5, 0.2, 0.18);
      }
      g.lastVel.set(v.x, v.y, v.z);
      // fell out of the world (shouldn't happen, but never leak a body)
      if (t.y < -200) g.fuse = Math.min(g.fuse, 0);
      if (g.fuse <= 0) {
        this.scene.remove(g.mesh);
        this.physics.world.removeRigidBody(g.body);
        this.grenades.splice(this.grenades.indexOf(g), 1);
        const sw = new Shockwave(g.mesh.position, 8, this.garage.sparks);
        this.scene.add(sw.mesh);
        this.shockwaves.push(sw);
        this.flash.position.copy(g.mesh.position).y += 0.3;
        this.flash.intensity = 80;
        this.audio.play('emp', { pos: g.mesh.position });
        const near = this.player ? this.player.position.distanceTo(g.mesh.position) : 99;
        this.post.emp.value = Math.max(0, 1 - near / 14);
        this.cam.addTrauma(Math.max(0, 0.6 - near / 20));
        this.hands?.jolt(Math.max(0, 0.8 - near / 15));
        if (!this.garage.emp(g.mesh.position, 8.5)) this.ui.toast('EMP fizzled — nothing electronic nearby.', 'info');
        void XP_REWARDS;
      }
    }
    for (const sw of [...this.shockwaves]) {
      sw.update(dt, this.camera.position);
      if (sw.done) { this.scene.remove(sw.mesh); this.shockwaves.splice(this.shockwaves.indexOf(sw), 1); }
    }
    this.flash.intensity = damp(this.flash.intensity, 0, 6, dt);
  }

  /** First-person targeting: whatever interactable sits closest to the centre of view, within reach. */
  private pickFocus(): Interactable | null {
    if (!this.player) return null;
    const p = this.player.position;
    const eye = this.camera.position;
    const fwd = this._fwd.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    let best: Interactable | null = null, bestScore = Infinity;
    const to = this._to;
    for (const it of this.interactables) {
      if (it.visible && !it.visible()) continue;
      const flat = Math.hypot(it.pos.x - p.x, it.pos.z - p.z);
      if (flat > it.radius || Math.abs(it.pos.y - (p.y + 1)) > 2.6) continue;
      to.copy(it.pos).sub(eye);
      const dist = to.length();
      const cos = to.normalize().dot(fwd);
      // generous cone when very close (you're basically standing on it), tighter further out
      const minCos = flat < 1.1 ? 0.35 : 0.8;
      if (cos < minCos) continue;
      const score = (1 - cos) * 6 + dist * 0.25;
      if (score < bestScore) { bestScore = score; best = it; }
    }
    return best;
  }

  /** HUD markers, rebuilt at most every 50 ms: only the 20 Hz minimap reads them per frame. */
  private hudMarkers(now: number) {
    if (!this.markerCache || now - this.markerAt >= 50) { this.markerCache = this.markers(); this.markerAt = now; }
    return this.markerCache;
  }

  private markers(): MapMarker[] {
    const s = this.state!;
    const out: MapMarker[] = LANDMARK_MARKERS.filter((m) => m.id !== 'cave' || s.has('cave.known') || s.has('seen:cave'));
    const [gx, , gz] = GARAGE.location.position;
    const nearGarage = this.player ? Math.hypot(this.player.position.x - gx, this.player.position.z - gz) < 90 : false;
    if (s.has('garage.marker') || nearGarage || s.has('garage.complete')) {
      out.push({ id: 'garage', x: gx, z: gz, label: s.has('garage.complete') ? 'The Garage (busted)' : 'The Garage · Tier 1', color: s.has('garage.complete') ? '#7d725f' : '#ff3a6e', kind: 'bunker' });
    }
    for (const it of WORLD_INTEL) {
      if (s.has(`intel:${it.id}`)) continue;
      const known = it.id === 'intel.gas.note' || this.map.revealedAt(it.position[0], it.position[2]) > 100;
      if (known) out.push({ id: it.id, x: it.position[0], z: it.position[2], label: 'Intel', color: '#c896ff', kind: 'intel' });
    }
    for (const c of WORLD_CACHES) {
      if (s.has(c.id)) continue;
      if (!s.has(`approach:${c.id}`) && this.map.revealedAt(c.x, c.z) < 30) continue;
      out.push({ id: c.id, x: c.x, z: c.z, label: c.id === 'cache.cooler' ? 'Cooler' : 'Mast cells', color: '#7ec8d4', kind: 'intel' });
    }
    const goal = this.story?.target();
    if (goal) out.push({ id: 'quest', x: goal.x, z: goal.z, label: goal.label, color: '#ffd27a', kind: 'intel' });
    if (this.player && this.garage.drone.position.distanceTo(this.player.position) < 70 && this.garage.drone.state !== 'disabled') {
      out.push({ id: 'drone', x: this.garage.drone.position.x, z: this.garage.drone.position.z, label: 'SeedBot', color: this.garage.drone.state === 'alert' ? '#ff3b3b' : '#ffb347', kind: 'drone' });
    }
    return out;
  }

  /** The tracked quest (or the main story) speaks unless you're standing at the Garage. */
  private objective(): string {
    return this.story ? this.story.objective(this.garage.objective()).text : this.garage.objective();
  }

  private bench(now: number) {
    this.benchFrames++;
    if (!this.benchT) this.benchT = now;
    if (now - this.benchT >= 2000) {
      const info = this.renderer.info.render;
      console.log(`[BENCH] mode=${this.mode} backend=${this.backendLabel} fps=${((this.benchFrames * 1000) / (now - this.benchT)).toFixed(1)} buffer=${this.renderer.domElement.width}x${this.renderer.domElement.height} q=${this.quality.level} tris=${info.triangles} ms[update=${(this.benchUpd / this.benchFrames).toFixed(1)} physics=${(this.benchPhys / this.benchFrames).toFixed(1)} render=${(this.benchRen / this.benchFrames).toFixed(1)}]`);
      this.benchUpd = this.benchPhys = this.benchRen = 0;
      this.benchT = now;
      this.benchFrames = 0;
    }
  }

  // ------------------------------------------------------------------ frame
  private fitW = 0;
  private fitH = 0;

  private frame() {
    const now = performance.now();
    // Re-fit the canvas whenever the window size changes. The 'resize' event alone isn't enough: the
    // desktop app's window gets tiled/resized while we're still loading, before the listener exists.
    if (innerWidth !== this.fitW || innerHeight !== this.fitH) this.resize();
    const dt = Math.min(1 / 20, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    this.frames++;

    const focusPos = this.player ? this.player.position : this.camera.position;
    this.weather.update(dt, this.mode === 'playing' && !this.ui.modalOpen);
    this.atmo.update(dt, focusPos);
    updateRim(this.atmo.sunColor, 0.35 + (1 - Math.min(1, Math.max(0, this.atmo.sunElevation * 3))) * 0.5);
    (this.post.godrayColor.value as THREE.Color).copy(this.atmo.sunColor).multiplyScalar(this.atmo.isNight ? 0.25 : 1);
    // eye adaptation follows the sun; a storm's murk opens the eye a little and adds grit
    const st = this.weather.intensity;
    this.post.exposure.value = this.atmo.exposure * (1 + st * 0.25);
    this.post.grain.value = 0.045 + st * 0.025;

    if (this.mode === 'title') {
      this.titleT += dt;
      this.setTitleCamera(this.titleT);
    } else if (this.mode === 'charselect') {
      const fire = this.landmarks.campPosition;
      const eye = fire.clone().add(new THREE.Vector3(1.9, 0, 1.4));
      eye.y = this.hf.heightAt(eye.x, eye.z) + 1.05 + Math.sin(this.t * 0.9) * 0.01; // kneeling
      this.camera.position.copy(eye);
      // frame the fire right of centre so the side panel doesn't cover it; hands follow
      const toFire = fire.clone().sub(eye).setY(0).normalize();
      const leftOf = new THREE.Vector3(toFire.z, 0, -toFire.x);
      this.camera.lookAt(fire.x + leftOf.x * 0.9 + Math.sin(this.t * 0.2) * 0.15, fire.y + 0.25, fire.z + leftOf.z * 0.9);
      if (this.hands) this.hands.root.position.set(0.045, 0.004, 0);
      if (this.camera.fov !== this.cam.baseFov) { this.camera.fov = this.cam.baseFov; this.camera.updateProjectionMatrix(); }
      this.hands?.update(dt, { speed: 0, grounded: true, crouch: false, sprint: false, bobPhase: 0, lookDX: Math.sin(this.t * 0.7) * 4, lookDY: Math.cos(this.t * 0.5) * 3 });
    } else if (this.mode === 'playing' && this.player && this.state) {
      this.playFrame(dt);
    }

    this.touch?.setActive(this.mode === 'playing' && this.input.locked && !this.ui.modalOpen && !this.ui.minigameOpen && !this.busy);

    // world systems
    this.atmo.follow(this.camera);
    this.landmarks.update(dt, this.t, this.camera.position);
    this.settlement?.update(dt, this.camera.position);
    for (const site of this.sites) site.update(dt, this.camera.position);
    if (this.mode !== 'playing') this.garage.update(dt);
    this.garage.cull(this.camera.position);
    this.props.update(dt, focusPos, this.atmo.wind);
    this.scrub.update(focusPos, this.atmo.wind);
    this.dust.update(dt);
    this.haze.update(dt);
    this.puffs.update(dt);
    this.streaks.update(dt);
    this.devils.update();
    this.updateGrenades(dt);
    this.updateEnvironment(dt);
    for (const gem of this.intelGems) {
      if (!gem.parent?.visible) continue;
      gem.rotation.y += dt * 1.5;
      gem.position.y = Math.sin(this.t * 2) * 0.08;
    }
    // gameplay-driven post
    this.post.damage.value = damp(this.post.damage.value as number, 0, 2.5, dt);
    this.post.menuShade.value = damp(this.post.menuShade.value as number, this.mode === 'title' || this.mode === 'charselect' ? 1 : 0, 3, dt);
    this.post.emp.value = damp(this.post.emp.value as number, 0, 1.2, dt);
    const alertTarget = this.mode === 'playing' && this.garage.drone.state === 'alert' ? 0.8 : this.mode === 'playing' ? this.garage.drone.detection * 0.4 : 0;
    this.post.alert.value = damp(this.post.alert.value as number, alertTarget, 4, dt);
    const tension = this.mode === 'playing' ? Math.max(this.garage.drone.detection, this.garage.alarm > 0 ? 1 : 0) : 0;
    const playing = this.mode === 'playing';
    if (playing && this.acoustics && this.player) this.acoustics.update(dt, this.player.position);
    this.audio.update(dt, this.camera, this.atmo.windStrength, tension, this.weather.intensity, {
      mood: this.mode === 'title' ? 'title' : this.mode === 'charselect' ? 'camp' : playing ? 'play' : 'off',
      night: this.atmo.isNight,
      hour: this.atmo.hour,
      inside: playing && this.garage.playerInside,
      alarm: playing && this.garage.alarm > 0,
      room: playing ? this.acoustics?.room : undefined,
      floor: this.acoustics?.surface,
      front: this.weather.front,
      windDir: this.atmo.windDir,
    });
    if (!this.loopsStarted && this.audio.ready && this.mode !== 'loading') this.startLoops();

    if (BENCH) this.bench(now);
    const tPhys = performance.now();
    // step by the real frame time (the world default of 1/60 per frame ran physics 2.4× fast at 144 Hz)
    this.physics.world.timestep = Math.max(1 / 240, dt);
    this.physics.step();
    lightPool.update(this.camera.position, dt);
    const tRender = performance.now();
    if (SKIP.has('post')) this.renderer.render(this.scene, this.camera); else this.post.render();
    if (BENCH) { this.benchUpd += tPhys - now; this.benchPhys += tRender - tPhys; this.benchRen += performance.now() - tRender; }
    this.input.endFrame();
  }

  private playFrame(dt: number) {
    this.input.pollRaw();
    const player = this.player!;
    const s = this.state!;
    const input = this.input;
    const blocked = this.ui.modalOpen || this.ui.minigameOpen || this.busy;
    input.enabled = !blocked;
    this.cam.enabled = !blocked && input.locked;

    // The body keeps the build honest: quiet feet, a heavy pack, a dry mouth.
    if (!blocked) s.tickNeeds(dt);
    let sp = s.archetype.stats.speed;
    const worst = Math.min(s.data.hunger, s.data.thirst);
    if (worst < 30) sp *= 0.86;
    if (worst < 12) sp *= 0.8;
    if (s.weight > s.carryLimit + 0.05) sp *= 0.72;
    player.speedMult = sp;
    player.stealthRank = s.skill('stealth');
    player.stealthFocus = s.focus('stealth');
    if (!blocked) {
      if (s.data.thirst < 55 && s.set('tut.thirst')) this.ui.toast('Water is dropping. The blue bar. A ration will not fix it.', 'info');
      if (s.data.thirst < 28 && s.set('tut.dry')) this.ui.toast('You are drying out. Drink, or walk slower and bleed.', 'bad');
      if (s.data.hunger < 28 && s.set('tut.hungry')) this.ui.toast('Hunger. A ration off the hotbar. The fire helps a little.', 'bad');
      if (s.weight > s.carryLimit + 0.05 && s.set('tut.heavy')) this.ui.toast('Overburdened. Drop something from the kit, or walk it at seventy percent.', 'bad');
    }

    // UI hotkeys
    if (!blocked) {
      const tab = input.pressed('Tab') || input.pressed('KeyI') ? 'kit' : input.pressed('KeyK') ? 'skills' : input.pressed('KeyJ') ? 'journal' : null;
      if (tab) {
        this.input.exitLock();
        const firstKit = !s.has('tut.kit');
        this.ui.openInventory((id) => this.useItem(id), () => {
          if (firstKit && s.set('tut.kit')) this.ui.toast('Skills live on their own tab (K). Each one branches twice: a focus at rank 2, a capstone at rank 4.', 'info');
          this.afterModal();
        }, tab, this.story);
      } else if (input.pressed('KeyM')) {
        this.input.exitLock();
        const intel = WORLD_INTEL.filter((i) => s.has(`intel:${i.id}`)).map((i) => ({ title: i.title, body: i.body }));
        this.ui.openMap(player.position.x, player.position.z, player.yaw, this.markers(), intel, () => this.afterModal());
      } else if (input.pressed('Escape')) {
        this.input.exitLock();
      }
      HOTBAR_ITEMS.forEach((id, i) => {
        if (input.pressed(`Digit${i + 1}`)) this.useItem(id);
      });
    }

    if (!blocked && input.pressed('KeyL') && this.hands) {
      this.hands.flashlightOn = !this.hands.flashlightOn;
      player.flashlight = this.hands.flashlightOn;
      this.audio.play('click');
    }
    player.update(dt, input, this.cam.yaw, true);
    this.garage.update(dt);
    const strafe = blocked ? 0 : (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0) + input.moveX;
    const hs = Math.hypot(player.velocity.x, player.velocity.z);
    this.cam.update(dt, input, { feet: player.position, crouch: player.crouching, sprint: player.sprinting, speed: hs, grounded: player.grounded, strafe, exertion: player.exertion });
    this.audio.breathe(dt, player.exertion);
    if (player.winded && !this.windedHint) {
      this.windedHint = true;
      this.ui.toast('Winded. Catch your breath before sprinting again.', 'info');
    }
    this.hands?.update(dt, { speed: hs, grounded: player.grounded, crouch: player.crouching, sprint: player.sprinting, bobPhase: this.cam.bobPhase, lookDX: input.mouseDX, lookDY: input.mouseDY, vy: player.velocity.y });

    // interaction
    this.focus = blocked ? null : this.pickFocus();
    const prompt: HudFrame['prompt'] = [];
    if (this.focus) {
      const f = this.focus;
      const pa = f.primary.available();
      let primary = f.primary.label;
      if (f.id === 'camp') {
        primary = s.has('garage.complete') && !s.has('debriefed')
          ? 'Radio Mara — you have the names'
          : 'The camp — rest, craft, radio';
      }
      prompt.push({ key: 'E', label: primary, na: pa === true ? undefined : pa });
      if (f.secondary) {
        const sa = f.secondary.available();
        let label = f.secondary.label;
        if (f.id === 'camp') label = this.atmo.isNight ? 'Sleep until dawn' : 'Wait until nightfall (stealthier)';
        prompt.push({ key: 'F', label, na: sa === true ? undefined : sa });
      }
      // the action lands when the hand gets there, not on the keypress
      if (this.hands?.busy) {
        // hands already doing something: wait for them
      } else if (input.pressed('KeyE')) {
        if (pa === true) { if (this.hands) this.hands.reach(() => void f.primary.run()); else void f.primary.run(); } else this.audio.play('deny');
      } else if (input.pressed('KeyF') && f.secondary) {
        const sec = f.secondary;
        if (sec.available() === true) { if (this.hands) this.hands.press(() => void sec.run()); else void sec.run(); } else this.audio.play('deny');
      }
    }

    if (this.touch) {
      const f = this.focus;
      this.touch.update({
        use: !!f, useNA: !!f && f.primary.available() !== true,
        alt: f?.secondary ? f.secondary.label : null,
        crouch: player.crouching, torch: !!this.hands?.flashlightOn,
      });
    }

    // fog of war + landmark discovery. The radio briefing is not a walk.
    if (!blocked) this.revealTimer -= dt;
    if (!blocked && this.revealTimer <= 0) {
      this.revealTimer = 0.4;
      this.map.reveal(player.position.x, player.position.z, 60);
      for (const lm of LANDMARKS) {
        if (this.landmarkSeen.has(lm.id) || s.has(`seen:${lm.id}`)) continue;
        const reach = lm.kind === 'cave' ? 24 : lm.kind === 'town' ? 50 : 40;
        if (Math.hypot(player.position.x - lm.position[0], player.position.z - lm.position[2]) < reach) {
          this.landmarkSeen.add(lm.id);
          s.set(`seen:${lm.id}`);
          if (lm.id === 'cave') s.set('cave.known');
          this.ui.banner(lm.name.toUpperCase(), lm.blurb, 'info');
          s.addXP(XP_REWARDS.landmarkDiscovered, `Discovered ${lm.name}`);
        }
      }
      const [gx, , gz] = GARAGE.location.position;
      if (!s.has('seen:garage') && Math.hypot(player.position.x - gx, player.position.z - gz) < 70) {
        s.set('seen:garage');
        s.set('garage.marker');
        this.ui.banner('THE GARAGE', 'The camp\'s water is in his cistern. The names are in the vault. He is still inside.', 'info');
      }
      for (const c of WORLD_CACHES) {
        if (s.has(c.id) || s.has(`approach:${c.id}`)) continue;
        if (Math.hypot(player.position.x - c.x, player.position.z - c.z) < 22) {
          if (s.set(`approach:${c.id}`)) this.ui.toast(c.approach, 'info');
        }
      }
    }

    // death is a debt, not a nap
    if (s.data.health <= 0 && !this.busy) {
      this.busy = true;
      player.frozen = true;
      this.ui.fade(true, 'You go down in the dust. Mara had someone drag you back. The job did not.');
      setTimeout(() => {
        s.heal(50);
        s.data.hunger = Math.max(s.data.hunger, 48);
        s.data.thirst = Math.max(s.data.thirst, 48);
        const c = this.landmarks.campPosition.clone().add(new THREE.Vector3(2, 0, 2));
        c.y = this.hf.heightAt(c.x, c.z) + 0.2;
        player.teleport(c);
        this.ui.fade(false);
        player.frozen = false;
        this.busy = false;
      }, 2200);
    }

    // quests (on flag changes) and the occasional line of banter (throttled inside)
    this.story?.update(dt, {
      blocked: blocked || this.busy,
      px: player.position.x,
      pz: player.position.z,
      night: this.atmo.isNight,
      storm: this.weather.intensity,
      alarm: this.garage.alarm > 0 || this.garage.drone.state === 'alert',
    });

    // autosave
    s.data.stats.playTime += dt;
    this.autosaveTimer -= dt;
    if (this.autosaveTimer <= 0 && this.garage.alarm <= 0) {
      this.autosaveTimer = 60;
      this.save(true);
    }

    this.ui.updateHUD(dt, {
      objective: this.objective(),
      detection: this.garage.drone.detection,
      droneState: this.garage.drone.state,
      canSee: this.garage.drone.canSee,
      crouch: player.crouching,
      sprint: player.sprinting,
      prompt,
      hour: this.atmo.hour,
      heading: this.cam.yaw,
      playerYaw: player.yaw,
      px: player.position.x,
      pz: player.position.z,
      markers: this.hudMarkers(performance.now()),
      hunger: s.data.hunger,
      thirst: s.data.thirst,
    });
    void vec3;
  }
}
