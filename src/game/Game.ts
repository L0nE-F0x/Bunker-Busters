import * as THREE from 'three/webgpu';
import { Fn, vec4, vec3, uv, length, smoothstep, time, sin, float, color } from 'three/tsl';
import type { QualitySettings } from '@/engine/renderer';
import { makeQuality, fitCanvas, compileInParallel, canCompileInParallel } from '@/engine/renderer';
import { isTouch, isWebKit } from '@/engine/device';
import { TouchControls } from '@/ui/TouchControls';
import { PostFX } from '@/engine/postfx';
import { Physics } from '@/engine/physics';
import { modelProgress } from '@/engine/models';
import { Input } from '@/engine/input';
import { pad } from '@/engine/gamepad';
import { binds } from '@/engine/bindings';
import { PadNav } from '@/ui/PadNav';
import { AudioEngine, type LoopHandle } from '@/engine/audio';
import { Acoustics, isSoft } from '@/engine/surface';
import { Atmosphere } from './world/Atmosphere';
import { Heightfield } from './world/Heightfield';
import { Terrain } from './world/Terrain';
import { Props, rockGeometry } from './world/Props';
import { Landmarks } from './world/Landmarks';
import { Scrub, Pebbles } from './world/Scrub';
import { Shrubs } from './world/Shrubs';
import { Fauna } from './world/Fauna';
import { Interior, hideExcept } from './world/interiors';
import { DustMotes, GroundHaze, DustPuffs, SandStreaks, DustDevils, Shockwave, StormLightning, StormWall, heightTexture } from './world/effects';
import { Weather } from './world/Weather';
import { VirtualLight, lightPool } from './world/lights';
import { updateRim, glow, desertRock } from './world/materials';
import { buildIntelProp, type IntelProp } from './world/intelProps';
import { Scavenge } from './world/Scavenge';
import { NpcModels } from './world/npcSkin';
import { updateShownMatrices, viewCull } from './world/kit';
import { NpcCrowd } from './world/npc';
import { HumanSkins } from './combat/humanSkin';
import { Garage } from './bunker/Garage';
import { Settlement } from './town/Settlement';
import { buildSites, Errands, type Site } from './sites';
import { Player } from './player/Player';
import { FirstPersonCamera } from './player/FirstPersonCamera';
import { Hands, HAND_LOOKS, torchLight } from './player/Hands';
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
import { ITEMS, HOTBAR_ITEMS, KEEP_ON_DEATH } from '@/content/items';
import { KadeTerminals } from './combat/terminals';
import { OUTPOSTS } from '@/content/recovery';
import { XP_REWARDS, fallFactor, empRadius } from '@/content/progression';
import { damp } from '@/engine/noise';
import { Combat, sphereRay, type HurtKind, type Hostile } from './combat/Combat';
import { PlayerArms } from './combat/PlayerArms';
import { Recovery } from './combat/Recovery';
import { Machines } from './combat/Machines';
import { MenuDirector } from './MenuDirector';

/** Debug: ?interior=off draws the exterior even from inside sealed interiors (A/B for interior mode). */
const NO_INTERIOR = typeof location !== 'undefined' && new URLSearchParams(location.search).get('interior') === 'off';
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
  return HAND_LOOKS[id] ? id : 'infiltrator';
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
  /** Controller menu navigation (the Pad drives it whenever you aren't playing). */
  private padNav: PadNav;
  settings: Settings = loadSettings();
  quality: QualitySettings;
  post!: PostFX;
  atmo!: Atmosphere;
  hf!: Heightfield;
  terrain!: Terrain;
  props!: Props;
  landmarks!: Landmarks;
  scrub!: Scrub;
  shrubs!: Shrubs;
  pebbles!: Pebbles;
  fauna!: Fauna;
  dust!: DustMotes;
  haze!: GroundHaze;
  puffs!: DustPuffs;
  streaks!: SandStreaks;
  devils!: DustDevils;
  lightning = new StormLightning();
  stormWall!: StormWall;
  weather!: Weather;
  garage!: Garage;
  settlement!: Settlement;
  /** Hostiles hunting the player (last frame's `combat.awareness()`; the music's fight stem). */
  private huntedBy = 0;
  scavenge!: Scavenge;
  /** Props and camp effects for the road favours (sites/errands.ts). */
  errands!: Errands;
  private humanSkins: HumanSkins | null = null;
  sites: Site[] = [];
  map!: MapData;
  player: Player | null = null;
  cam!: FirstPersonCamera;
  hands: Hands | null = null;
  state: GameState | null = null;
  /** Quest log, corner objective and exploring banter for the current run. */
  story: Story | null = null;
  /** Bullets, blasts, hostiles and the effects that sell them. */
  combat!: Combat;
  /** The player's weapons (per run). */
  arms: PlayerArms | null = null;
  /** Kade Recovery: outposts, crews, road patrols. */
  recovery!: Recovery;
  /** Sentries, Hornet drones and mines at the outposts. */
  machines!: Machines;
  /** The Kade field terminals (one per outpost): hack targets. */
  terminals!: KadeTerminals;
  private wantAds = false;
  /** The dropped pack in the world: a duffel and a beacon. */
  private packMesh!: THREE.Group;
  private dying = 0;
  private venomHurt = 0;
  /** Low-health pulse: phase through the current heartbeat (0..1). */
  private hbPhase = 0;
  private venomHint = false;
  mode: Mode = 'loading';
  private interactables: Interactable[] = [];
  private focus: Interactable | null = null;
  private grenades: Grenade[] = [];
  private shockwaves: Shockwave[] = [];
  private flash: VirtualLight;
  private intelMeshes = new Map<string, THREE.Object3D>();
  private intelProps: { g: THREE.Object3D; prop: IntelProp; phase: number }[] = [];
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
  private director!: MenuDirector;
  private busy = false; // minigame/modal in progress
  /** Smoothed 0..1 point light (fires, floodlights) on the player: the stealth model's night term. */
  private pointLit = 0;
  /** Warm these on the next frame's render (see warmShaders), staging anything not yet in the scene. */
  private warmNext: { roots: THREE.Object3D[]; stage?: () => (() => void) | undefined } | null = null;
  private cubeRT: THREE.CubeRenderTarget | null = null;
  private cubeCam: THREE.CubeCamera | null = null;
  private envScene = new THREE.Scene();
  private envTimer = 0;
  /** The clock last frame, to count midnights (`SaveData.days`). */
  private lastHour = 0;
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
  /** ?bench: frame intervals (rAF to rAF) of the current window, for the p50/p90 the log prints */
  private benchInt = new Float32Array(1024);
  private frameGap = 0;
  backendLabel = 'WebGL2';

  constructor(private renderer: THREE.WebGPURenderer, public isWebGPU: boolean, private canvas: HTMLCanvasElement) {
    this.input = new Input(canvas);
    this.ui = new UI(this.audio);
    // controls: the saved bindings, persisted whenever the Controls screen changes them
    binds.set(this.settings.binds);
    binds.onChange = (m) => { this.settings.binds = m; saveSettings(this.settings); };
    pad.attach(this.input);
    this.padNav = new PadNav(this.ui.root);
    pad.nav = (f) => this.padNav.handle(f);
    // nothing on screen while playing (the grab failed, "click to resume"): A or Start picks it back up
    this.padNav.onIdle = (f) => {
      if (this.mode === 'playing' && (f.a || f.start) && !this.ui.modalOpen && !this.ui.minigameOpen && !this.busy) this.input.requestLock();
    };
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
    // waiting on model downloads (prefetched since boot, see bootModels): the bar runs p0 → p1 with the bytes
    const models = async <T>(task: Promise<T>, p0: number, p1: number, msg: string, names?: readonly string[]) => {
      const tick = () => {
        const m = modelProgress(names), all = modelProgress();
        if (m.fraction < 1) this.ui.progress(p0 + (p1 - p0) * m.fraction, `${msg} · ${(all.loaded / 1e6).toFixed(1)} / ${(all.total / 1e6).toFixed(1)} MB`);
      };
      tick();
      const id = setInterval(tick, 100);
      try { return await task; } finally { clearInterval(id); }
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
    this.shrubs = new Shrubs(this.hf, Math.min(1, 0.5 + this.quality.grassDensity * 0.5));
    if (!SKIP.has('scrub')) this.scene.add(this.shrubs.group);
    this.fauna = new Fauna(this.hf, this.props.perches, this.props.wrecks);
    if (!SKIP.has('fauna')) {
      this.scene.add(this.fauna.mesh);
      this.scene.add(await models(this.fauna.loadModels(), 0.4, 0.5, 'Scattering debris of a failed civilisation', ['wolf', 'rattlesnake', 'scorpion']));
    }
    this.pebbles = new Pebbles(this.hf, rockGeometry(5, 0), desertRock(), Math.round(4000 * Math.min(1, this.quality.grassDensity)));
    if (!SKIP.has('scrub')) this.scene.add(this.pebbles.mesh);
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
    this.weather.onLightning = (k) => { this.audio.thunder(k); this.lightning.strike(this.camera.position, k); };
    this.stormWall = new StormWall(this.atmo);
    if (!SKIP.has('sky')) this.scene.add(this.lightning.mesh, this.stormWall.mesh);
    this.combat = new Combat(this.physics, this.hf, this.atmo, this.audio);
    this.combat.difficulty = this.settings.difficulty ?? 'normal';
    this.combat.puffs = this.puffs;
    this.combat.acoustics = this.acoustics;
    this.scene.add(this.combat.group);
    this.combat.register(this.fauna.pack);
    this.combat.register(this.fauna.critters);
    this.fauna.combat = this.combat;
    this.fauna.camFwd = new THREE.Vector3();
    await step(0.62, 'Charting the wasteland');
    this.map = new MapData(this.hf);
    this.cam = new FirstPersonCamera(this.camera);
    this.applyView();
    this.camera.near = 0.05;
    this.camera.fov = this.cam.baseFov;
    this.camera.updateProjectionMatrix();
    this.scene.add(this.camera); // viewmodel hands + flashlight are children of the camera
    const torch = torchLight(); // on the camera from boot, so the light set never changes (see torchLight)
    this.camera.add(torch, torch.target);
    // the third-person body is rendered into the sun's shadow map only (layer 1)
    this.atmo.sun.shadow.camera.layers.enable(1);
    this.ctx = this.makeContext();
    await step(0.7, 'Building a doomsday bunker (pre-revenue)');
    this.garage = new Garage(this.ctx);
    this.combat.sparks = this.garage.sparks;
    // wolves won't follow you to the fire or into a town
    this.fauna.safe = [{ p: this.landmarks.campPosition.clone(), r: 30 }];
    for (const lm of LANDMARKS) if (lm.kind === 'town') this.fauna.safe.push({ p: new THREE.Vector3(lm.position[0], 0, lm.position[2]), r: 75 });
    // the Meshy townsfolk (before the warm-up; ?procnpc keeps the procedural figures)
    const bunkerMsg = 'Building a doomsday bunker (pre-revenue)';
    NpcCrowd.models = await models(NpcModels.load(), 0.7, 0.78, bunkerMsg);
    this.landmarks.addCampPeople();
    this.settlement = new Settlement(this.ctx, this.landmarks);
    if (!SKIP.has('sites')) this.sites = buildSites(this.ctx, this.landmarks);
    // the Meshy contractors (before the warm-up; ?prochuman keeps the procedural bodies)
    this.humanSkins = new URLSearchParams(location.search).has('prochuman') ? null : await models(HumanSkins.load(10, [0]), 0.7, 0.78, bunkerMsg);
    this.buildRecovery();
    this.buildIntel();
    // stashes and searchable wrecks (not quests: just the desert being generous)
    this.scavenge = new Scavenge({
      hf: this.hf,
      state: () => this.state ?? null,
      place: (x, z) => this.clearSpot(x, z),
      toast: (t, k) => this.ui.toast(t, k),
      sound: (n) => this.audio.play(n),
    }, this.props.wreckBoxes);
    this.scene.add(this.scavenge.group);
    this.interactables.push(...this.scavenge.interactables);
    this.errands = new Errands(this.ctx, this.landmarks, (x, z) => this.clearSpot(x, z));
    this.interactables.push(...this.errands.interactables);
    if (!SKIP.has('env')) this.buildEnvironment();
    if (SKIP.has('garage')) this.scene.remove(this.garage.b.group, this.garage.drone.group);
    if (SKIP.has('ui')) document.getElementById('ui')!.style.display = 'none';
    if (SKIP.has('terrain')) this.scene.remove(this.terrain.mesh, this.terrain.far);
    if (SKIP.has('sky')) this.scene.remove(this.atmo.sky);
    if (SKIP.has('shadows')) this.renderer.shadowMap.enabled = false;
    if (SKIP.has('fog')) this.scene.fogNode = null;
    await step(0.8, 'Compiling shaders');
    this.post = new PostFX(this.renderer, this.scene, this.camera, this.atmo.sun, this.quality);
    // Three walks the whole graph (~1,600 objects, ~600 of them bones, over half of it hidden) on
    // every render of the scene, and a frame renders it twice (sun shadow map + scene pass). The game
    // does it once per frame instead, right before rendering, skipping hidden subtrees (frame,
    // warmShaders; kit.ts updateShownMatrices).
    this.scene.matrixWorldAutoUpdate = false;
    this.resize();
    this.physics.step();
    this.director = new MenuDirector(this.camera, this.landmarks, () => this.garage?.b.origin ?? new THREE.Vector3(96, 0, -150));
    this.atmo.hour = this.director.startTitle();
    this.atmo.update(0, this.camera.position);
    // streamed scatter must hold something before the warm-up, or its programs compile mid-play
    this.scrub.update(this.camera.position, this.atmo.wind);
    this.shrubs.update(this.camera.position);
    this.pebbles.update(this.camera.position);
    // character select's hands and everything they hold compile now too, not on the glide down to
    // the fire (hand materials are shared per kind, so one pair covers every look)
    const menuHands = new Hands(HAND_LOOKS.engineer);
    menuHands.attach(this.camera);
    const unstageMenuHands = menuHands.stageItems();
    // in batches, a frame each, so the loading bar keeps moving through a cold start (~20 s in WebKit)
    const drawn: THREE.Object3D[] = [];
    this.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh || (o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || (o as THREE.Line).isLine) drawn.push(o); });
    const batches = 10, per = Math.ceil(drawn.length / batches);
    let warmMs = 0;
    const tWarm = performance.now();
    // First pass (WebGL with KHR_parallel_shader_compile): each batch builds its node graphs and
    // starts its links in the background, so the driver links one batch while the next one builds;
    // nothing waits on a link status until they're all in. Chromium links in parallel for real
    // (headless: 10.1 -> 6.7 s); WebKitGTK doesn't, and the second pass only cost it (13-20 s ->
    // 15-33 s in the desktop app), so it keeps the single pass. ?serialwarm / ?parallelwarm A/B it.
    const qw = new URLSearchParams(location.search);
    const parallel = canCompileInParallel(this.renderer) && !qw.has('serialwarm') && (!isWebKit || qw.has('parallelwarm'));
    if (parallel) {
      const linking: Promise<void>[] = [];
      for (let i = 0; i < batches; i++) {
        linking.push(compileInParallel(this.renderer, () => { warmMs += this.warmShaders(...drawn.slice(i * per, (i + 1) * per)); }));
        this.ui.progress(0.8 + (0.1 * (i + 1)) / batches, 'Compiling shaders');
        for (let f = 0; f < 2; f++) await new Promise((r) => requestAnimationFrame(r)); // a fresh frame for the scene pass
      }
      await Promise.all(linking);
    }
    // the real frames: everything drawn once through the post stack (anything the first pass didn't
    // cover compiles here, as before)
    const p0 = parallel ? 0.9 : 0.8;
    for (let i = 0; i < batches; i++) {
      warmMs += this.warmShaders(...drawn.slice(i * per, (i + 1) * per));
      this.ui.progress(p0 + ((0.95 - p0) * (i + 1)) / batches, 'Compiling shaders');
      for (let f = 0; f < 2; f++) await new Promise((r) => requestAnimationFrame(r)); // a fresh frame for the scene pass
    }
    console.log(`[BunkerBusters] shader warm-up: ${drawn.length} objects in ${batches} frames, ${warmMs.toFixed(0)} ms (${(performance.now() - tWarm).toFixed(0)} ms wall${parallel ? ', parallel links' : ''})`);
    unstageMenuHands();
    menuHands.dispose();
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
      hack: (o) => self.withMinigame('keypad', async () => {
        const s = self.state!;
        let difficulty = o.difficulty;
        if (s.focus('electronics') === 'hotline') difficulty = Math.max(0, difficulty - 1);
        if (s.capstone('electronics') === 'overclock') difficulty = Math.max(0, difficulty - 1);
        // a Kade box takes a Kade ID: swipe a lanyard for a bigger buffer and a lazier trace
        let badge = false;
        const badges = s.count('kade_badge');
        if (o.kade && badges > 0) {
          const pick = await self.ui.choose({
            speaker: o.title,
            text: 'The reader under the screen wants a contractor ID. You have a dead man\'s lanyard in your pocket. The photo is smiling.',
            choices: [
              { id: 'badge', label: `Swipe a Recovery Lanyard, then splice in (${badges} left)` },
              { id: 'raw', label: 'Splice in cold' },
              { id: 'leave', label: 'Leave it' },
            ],
          });
          if (pick !== 'badge' && pick !== 'raw') return { done: [], traced: false, aborted: true };
          badge = pick === 'badge' && s.removeItem('kade_badge', 1);
        }
        const res = await self.ui.hack({
          title: o.title, host: o.host, difficulty, daemons: o.daemons,
          bonusBuffer: badge ? 1 : 0, traceMult: badge ? 1.5 : 1,
          spikes: () => s.count('spike'), useSpike: () => s.removeItem('spike', 1),
          // taking a hit pulls you off the keyboard
          interrupt: (bail) => s.events.on('health', (e) => { if (e.delta < 0) bail('You\'re hit. You yank the cable.'); }),
        });
        if (res.done.length && s.capstone('electronics') === 'salvage' && s.addItem('battery', 1, true)) {
          s.events.emit('toast', { text: 'Salvage: you pocket a lithium cell from the box.', kind: 'good' });
        }
        return res;
      }),
      choose: (o) => self.withMinigame('idle', () => self.ui.choose(o)),
      converse: (o) => self.withMinigame('idle', () => self.ui.converse(o)),
      banner: (a, b, k) => self.ui.banner(a, b, k),
      subtitle: (a, b, v) => self.ui.subtitle(a, b, v),
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

  /** The duffel you drop when you go down, with an orange beacon so you can find it again. */
  private buildPack() {
    const g = new THREE.Group();
    const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.45, 4, 10).rotateZ(Math.PI / 2), new THREE.MeshStandardNodeMaterial({ color: '#4a5236', roughness: 0.95 }));
    bag.scale.set(1, 0.75, 0.9);
    bag.position.y = 0.17;
    bag.castShadow = true;
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.02, 6, 16), new THREE.MeshStandardNodeMaterial({ color: '#1e1c18', roughness: 0.8 }));
    strap.position.set(0, 0.3, 0);
    strap.rotation.x = Math.PI / 2;
    const beamMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, forceSinglePass: true });
    beamMat.colorNode = Fn(() => {
      const v = uv();
      const edge = smoothstep(0.5, 0.0, length(v.x.sub(0.5)));
      const fade = smoothstep(1.0, 0.0, v.y).mul(sin(time.mul(2.4)).mul(0.25).add(0.75));
      return vec4(color('#ff8a2a').mul(edge.mul(fade).mul(1.6)), float(1));
    })();
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 14, 12, 1, true), beamMat);
    beam.position.y = 7;
    g.add(bag, strap, beam);
    g.visible = false;
    this.scene.add(g);
    this.packMesh = g;
    this.interactables.push({
      id: 'pack',
      pos: new THREE.Vector3(),
      radius: 2.4,
      visible: () => !!this.state?.data.pack,
      primary: { label: 'Recover your pack', available: () => true, run: () => this.recoverPack() },
    });
  }

  private placePack() {
    const pk = this.state?.data.pack;
    this.packMesh.visible = !!pk;
    const it = this.interactables.find((i) => i.id === 'pack');
    if (!pk || !it) return;
    const [x, , z] = pk.position;
    const y = this.hf.heightAt(x, z);
    this.packMesh.position.set(x, y, z);
    it.pos.set(x, y + 0.4, z);
  }

  private recoverPack() {
    const s = this.state;
    const pk = s?.data.pack;
    if (!s || !pk) return;
    for (const it of pk.items) s.addItem(it.id, it.qty, true, true);
    s.data.pack = null;
    this.placePack();
    this.audio.play('loot');
    this.ui.toast('Your pack. Everything still in it, which is more than you can say for you.', 'good');
    this.arms?.validate();
  }

  /**
   * The nearest spot to (x, z) with flat ground and nothing solid on it (a pump, a wall, a cliff
   * face): rings out to 6 m. Props dropped on authored coordinates ended up inside things.
   */
  private clearSpot(x: number, z: number): [number, number] {
    const down = new THREE.Vector3(0, -1, 0);
    const ok = (px: number, pz: number) => {
      if (this.hf.normalAt(px, pz).y < 0.93) return false;
      const gy = this.hf.heightAt(px, pz);
      // a downward ray from above should only meet the ground (or a slab within a hand's height of it)
      for (const [ox, oz] of [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6], [0.45, 0.45], [-0.45, 0.45], [0.45, -0.45], [-0.45, -0.45]]) {
        const hit = this.combat.worldRay(new THREE.Vector3(px + ox, gy + 2.2, pz + oz), down, 3);
        if (hit && hit.t < 2.0) return false;
      }
      // and nothing standing right beside it at knee height (pillars, posts, walls)
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        if (this.combat.worldRay(new THREE.Vector3(px, gy + 0.5, pz), new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), 0.9)) return false;
      }
      return true;
    };
    if (ok(x, z)) return [x, z];
    for (let r = 0.8; r <= 6; r += 0.6) for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + r;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (ok(px, pz)) return [px, pz];
    }
    return [x, z];
  }

  private buildIntel() {
    this.buildPack();
    for (const it of WORLD_INTEL) {
      // the thing itself, lying where it was left, with a glint now and then (see intelProps)
      let [x, z] = this.clearSpot(it.position[0], it.position[2]);
      let y = this.hf.heightAt(x, z);
      // the gas note lies where Mara says it is: on the pump island, between the dead pumps
      const gas = it.id === 'intel.gas.note' ? LANDMARKS.find((l) => l.id === 'gas') : undefined;
      if (gas) {
        const [cx, , cz] = gas.position, r = gas.rotation;
        // the island nearer the note's old spot, local (±3, 0); its concrete top is 0.45 m up
        const lx = 3, lz = 0.35;
        x = cx + lx * Math.cos(r) + lz * Math.sin(r);
        z = cz - lx * Math.sin(r) + lz * Math.cos(r);
        y = this.hf.heightAt(cx, cz) + 0.45;
      }
      const prop = buildIntelProp(it.id, { crate: !gas });
      const g = prop.group;
      g.position.set(x, y, z);
      g.rotation.y = ((Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1) * Math.PI * 2;
      this.intelProps.push({ g, prop, phase: Math.abs(x * 0.37 + z * 0.11) % 1 });
      this.scene.add(g);
      this.intelMeshes.set(it.id, g);
      this.interactables.push({
        id: it.id,
        pos: g.position.clone().setY(g.position.y + (it.id === 'intel.highway.greg' ? 1.3 : gas ? 0.1 : 0.35)),
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

  private buildRecovery() {
    const self = this;
    this.recovery = new Recovery({
      skins: this.humanSkins,
      physics: this.physics,
      hf: this.hf,
      combat: this.combat,
      audio: this.audio,
      bark: (text, from, who) => {
        if (self.player && from.distanceTo(self.player.position) < 48) self.ui.subtitle('Kade Recovery', text, { pos: from.clone(), variant: who });
      },
      give: (items) => {
        const s = self.state;
        if (!s) return [];
        const lines: string[] = [];
        for (const it of items) {
          const n = s.addItem(it.id, it.qty, true);
          if (n) lines.push(`${n}× ${ITEMS[it.id]?.name ?? it.id}`);
        }
        return lines;
      },
      toast: (t, k) => self.ui.toast(t, k),
      banner: (a, b) => self.ui.banner(a, b, 'good'),
      xp: (n, why) => self.state?.addXP(n, why),
      owns: (id) => (self.state?.count(id) ?? 0) > 0,
      playTime: () => self.state?.data.stats.playTime ?? 0,
      get marks() { return self.state?.data.marks ?? {}; },
      flag: (f) => self.state?.set(f) ?? false,
      has: (f) => self.state?.has(f) ?? false,
      interactables: this.interactables,
    });
    this.scene.add(this.recovery.group);
    this.combat.register(this.recovery);
    this.machines = new Machines({
      physics: this.physics,
      hf: this.hf,
      combat: this.combat,
      audio: this.audio,
      subtitle: (who, text) => self.ui.subtitle(who, text),
      toast: (t, k) => self.ui.toast(t, k),
      xp: (n, why) => self.state?.addXP(n, why),
      skill: (id) => self.state?.skill(id) ?? 0,
      give: (id, n) => { if (n > 0) self.state?.addItem(id, n); },
      alert: (id, at) => self.recovery.alertOutpost(id, at),
      awake: (id) => !!self.player && self.recovery.outpostAwake(id, self.player.position),
      interactables: this.interactables,
    });
    this.recovery.onRespawn = (id) => this.machines.reset(id);
    this.recovery.onPatrol = (at) => { if (this.player) this.errands?.patrol(at, this.player.position); };
    this.terminals = new KadeTerminals({
      recovery: this.recovery, machines: this.machines, ui: this.ctx.ui, audio: this.audio,
      state: () => self.state ?? null,
      toast: (t, k) => self.ui.toast(t, k),
      subtitle: (a, b, v) => self.ui.subtitle(a, b, v),
    }, this.interactables);
    this.recovery.onSpawn = (id) => this.terminals.reapply(id);
    this.recovery.safe = this.fauna.safe;
    // SeedBot can be shot: every hit puts it on full alert; four quick ones knock it out of the sky
    const drone = this.garage.drone;
    let hits = 0, lastHit = -99;
    const seedbot: Hostile = {
      kind: 'drone', surface: 'metal', center: drone.position, radius: 0.8, alive: true,
      raycast: (o, d, max) => {
        if (drone.state === 'disabled') return null;
        const t = sphereRay(o, d, drone.position, 0.6);
        return t !== null && t <= max ? { t, zone: 'body' } : null;
      },
      damage: (d) => {
        const now = this.combat.t;
        drone.hit(d.point);
        hits = now - lastHit < 10 ? hits + 1 : 1;
        lastHit = now;
        drone.detection = Math.max(drone.detection, 0.95);
        if (hits >= 4) {
          hits = 0;
          drone.emp(25);
          this.ui.subtitle('SeedBot', 'HULL BREACH. FILING A CLAIM. GOODBYE.');
          this.state?.addXP(XP_REWARDS.droneEmp, 'SeedBot shot down');
          return true;
        }
        return false;
      },
    };
    this.combat.register({ hostiles: () => [seedbot] });
    this.scene.add(this.machines.group);
    this.combat.register(this.machines);
    // townsfolk: a word in passing, and an opinion about gunfire (src/game/town/barks.ts)
    const barks = this.settlement.barks;
    barks.host = {
      quiet: () => this.busy || this.mode !== 'playing',
      talking: () => this.ui.subtitleBusy,
      armed: () => !!this.arms?.equipped && this.arms.equipped !== 'crowbar',
      night: () => this.atmo.isNight,
      see: (a, b) => this.combat.clearLine(a, b, this.combat.target.collider),
      say: (speaker, text, pos) => this.ui.subtitle(speaker, text, { pos: pos.clone() }),
    };
    this.combat.register({ hostiles: () => [], hear: (p, _r, k) => { if (this.player) barks.hear(p, k, this.player.position); } });
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
      const disabled = this.recipeBlock(r);
      // "… · Electronics 1" over "Needs Electronics 1" said it twice: the reason line carries it
      const shown = disabled && r.skill && disabled.startsWith('Needs') ? detail.replace(` · ${SKILLS[r.skill.id].name} ${r.skill.level}`, '') : detail;
      return { id: r.id, name: r.name, detail: shown, disabled };
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
        this.errands.campChoice(choice);
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
  toTitle() {
    this.mode = 'title';
    this.titleT = 0;
    this.atmo.hour = this.director.startTitle();
    this.envTimer = 0;
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
    if (save && new URLSearchParams(location.search).has('continue')) {
      // debug: skip the title into the saved run (desktop tests can't aim a click at Continue)
      setTimeout(() => this.startGame(new GameState(save)), 50);
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
    this.director.startSelect();
    const show = (id: string) => {
      this.hands?.dispose();
      const look = handArchetype(id);
      this.hands = new Hands(HAND_LOOKS[look] ?? HAND_LOOKS.infiltrator);
      this.hands.attach(this.camera);
      this.hands.setBase(look === 'engineer' ? 'showcaseEmp' : 'showcase');
      this.director.pick();
    };
    const leave = () => { this.hands?.dispose(); this.hands = null; };
    // (hands are re-created fresh in startGame, so the showcase offset never leaks into play)
    this.ui.showCharSelect(
      (id) => {
        // stand up from the fire as it goes dark (the hands drop back to your sides), then the run
        this.director.standUp();
        this.hands?.setBase('idle');
        setTimeout(() => {
          leave();
          clearSave();
          // ...and the run starts where you stood up: at the camp fire, facing the four, the pumps
          // (and the note on them) to your left, at the hour you chose under
          const state = GameState.fresh(id, SPAWN);
          const at = this.landmarks.campPoint(-12.3, 0, 0);
          const fire = this.landmarks.campPosition;
          state.data.position = [at.x, at.y, at.z];
          state.data.yaw = Math.atan2(at.x - fire.x, at.z - fire.z) - Math.PI;
          state.data.hour = this.atmo.hour;
          this.startGame(state);
        }, MenuDirector.STAND * 1000 + 60);
      },
      show,
      () => { leave(); this.toTitle(); },
    );
    this.director.panelEl = document.querySelector<HTMLElement>('#charselect .cs-side');
  }

  private startGame(state: GameState) {
    this.state = state;
    this.mode = 'playing';
    this.cam.snapFov(); // charselect/title leave the lens elsewhere; start the run at the player's FOV
    // out of the menus' dip to black: the picture comes up as the run begins
    const f0 = this.post.fade.value as number;
    if (f0 > 0) {
      const t0 = performance.now();
      const lift = () => {
        const k = (performance.now() - t0) / 1100;
        this.post.fade.value = f0 * Math.max(0, 1 - k * k);
        if (k < 1) requestAnimationFrame(lift);
      };
      requestAnimationFrame(lift);
    }
    this.atmo.paused = false;
    this.atmo.dayLengthMinutes = 26;
    this.atmo.hour = state.data.hour;
    const hourOverride = Number(new URLSearchParams(location.search).get('hour')); // debug: ?hour=18.6
    if (hourOverride) this.atmo.hour = hourOverride;
    this.lastHour = this.atmo.hour;
    this.map.deserialize(state.data.discovered);
    const [x, , z] = state.data.position;
    let spawn = new THREE.Vector3(x, this.hf.heightAt(x, z) + 0.1, z);
    // debug: ?at=garage starts the run inside the Garage (benching interior mode)
    if (new URLSearchParams(location.search).get('at') === 'garage') spawn = this.garage.b.points.interior.clone().setY(this.garage.b.points.interior.y - 0.9);
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
    this.grantArms(state);
    this.arms = new PlayerArms(state, this.hands, this.cam, this.camera, this.input, this.combat, this.audio, this.player);
    this.placePack();
    this.combat.hooks = {
      onVenom: (sec) => {
        state.data.poison = Math.min(70, (state.data.poison ?? 0) + sec);
        if (!this.venomHint) { this.venomHint = true; this.ui.toast('Venom. It burns slowly. A snakebite kit stops it; a medkit only slows it.', 'bad'); }
      },
      onHurt: (amt, from, kind) => this.playerHurt(amt, from, kind),
      onHit: (k) => { this.ui.hitmark(k); this.audio.combat?.hitmark(k); if (k === 'kill') state.data.stats.kills = (state.data.stats.kills ?? 0) + 1; },
      trauma: (k) => { this.cam.addTrauma(k); this.input.rumble(k, k * 0.6, 160 + k * 240); },
    };
    // hands, everything they can hold, and the shadow body compile on the first frame, under the fade
    this.warmNext = { roots: [this.camera, this.player.model.root], stage: () => this.hands?.stageItems() };
    this.garage.applyFlags(true);
    for (const it of WORLD_INTEL) {
      const m = this.intelMeshes.get(it.id);
      if (m) m.visible = !state.has(`intel:${it.id}`);
    }
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
        if (state.set('tut.arms')) setTimeout(() => this.ui.toast(isTouch ? 'Armed: FIRE, AIM, RELOAD and SWAP sit over the jump button.' : 'Armed. LMB fire · RMB aim · R reload · Q / wheel swap · X holster · V melee.', 'info'), 4000);
        if (this.player) this.player.frozen = false;
        this.busy = false;
        this.input.requestLock();
        this.ui.banner('LAST CHANCE', `${state.archetype.name} · ${state.dayLabel}`, 'info');
      });
    }
    this.startLoops();
    // debug: ?fight drops a Recovery squad in front of you (Story difficulty, can't die): desktop benches
    if (new URLSearchParams(location.search).has('fight')) {
      setTimeout(() => {
        this.combat.difficulty = 'story';
        this.recovery.summon(this.player!.position, this.cam.yaw, 22, 4, true);
        setInterval(() => { if (this.state) this.state.data.health = Math.max(this.state.data.health, 50); }, 250);
      }, 6000);
    }
  }

  /**
   * Compile every pipeline under `roots` now, instead of the first time each thing comes into view.
   * WebKitGTK (the desktop app) links shaders on the main thread, so every lazy compile froze the
   * game for 0.3–3 s: on a cold start, walking off felt like being stuck. One real frame through
   * the normal post stack, with everything shown and nothing culled, builds exactly the pipelines
   * play asks for (same targets, same shadow pass); then it's all put back. Lights stay as they are,
   * since they're part of every lit shader's key.
   */
  private warmShaders(...roots: THREE.Object3D[]) {
    // (this renders the frame, so it stands in for a render: the scene pass only runs once per frame)
    const shown: THREE.Object3D[] = [];
    const culled: THREE.Object3D[] = [];
    const empty: THREE.InstancedMesh[] = [];
    const show = (o: THREE.Object3D) => { if (!o.visible) { o.visible = true; shown.push(o); } };
    for (const root of roots) {
      root.traverse((o) => {
        if ((o as THREE.Light).isLight) return;
        show(o);
        if (o.frustumCulled) { o.frustumCulled = false; culled.push(o); }
        // streamed scatter can be empty where the boot camera stands: draw one instance anyway
        const im = o as THREE.InstancedMesh;
        if (im.isInstancedMesh && im.count === 0) { im.count = 1; empty.push(im); }
      });
      for (let a = root.parent; a; a = a.parent) show(a);
    }
    const t0 = performance.now();
    try {
      updateShownMatrices(this.scene);
      if (SKIP.has('post')) this.renderer.render(this.scene, this.camera); else this.post.render();
    } catch (e) {
      console.warn('[BunkerBusters] shader warm-up failed', e);
    } finally {
      for (const o of shown) o.visible = false;
      for (const o of culled) o.frustumCulled = true;
      for (const o of empty) o.count = 0;
    }
    return performance.now() - t0;
  }

  /** Frames drawn in interior mode, and the interior of the last frame (debug). */
  interiorFrames = 0;
  interiorName = '';
  private _hidden: THREE.Object3D[] = [];
  private _exterior: THREE.Object3D[] | null = null;
  private _interiors: Interior[] | null = null;
  /** Everything outdoors: what interior mode skips. */
  private exteriorRoots() {
    if (this._exterior) return this._exterior;
    const inside = (o: THREE.Object3D) => this.garage.houseBox.containsPoint(o.getWorldPosition(new THREE.Vector3()));
    this._exterior = [
      this.atmo.sky, this.terrain.mesh, this.terrain.far, this.props.group, this.landmarks.group, this.garage.b.group,
      this.scrub.mesh, this.shrubs.group, this.pebbles.mesh, this.fauna.mesh, this.fauna.models, this.recovery.group, this.machines.group,
      this.haze.sprite, this.streaks.sprite, this.devils.sprite, this.lightning.mesh, this.stormWall.mesh, this.scavenge?.group,
      ...[...this.intelMeshes.values()].filter((g) => !inside(g)),
    ].filter((o): o is THREE.Object3D => !!o);
    return this._exterior;
  }

  /** The sealed interior the camera is in and can't see out of, if any (interior mode). */
  private activeInterior() {
    if (this.mode !== 'playing' || NO_INTERIOR) return null;
    this._interiors ??= [this.garage.interior, this.settlement.caveInterior, ...this.sites.map((s) => s.interior)].filter((x): x is Interior => !!x);
    for (const it of this._interiors) if (it.hides(this.camera)) return it;
    return null;
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
    this.recovery?.reset();
    this.story?.dispose();
    this.story = null;
    this.arms = null;
    this.combat.hooks = null;
    this.cam.aimK = 0;
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
    this.applyView();
    this.input.sensitivity = s.sensitivity;
    if (this.combat) this.combat.difficulty = s.difficulty ?? 'normal';
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

  /** Field of view, invert look, head bob and the fps readout. */
  private applyView() {
    const s = this.settings;
    if (this.cam) {
      this.cam.baseFov = s.fov;
      this.cam.invertY = s.invertY;
      this.cam.bob = s.bob;
      if (this.mode === 'playing') this.cam.snapFov();
    }
    this.ui.showFps(s.showFps);
  }

  private applyAudioSettings() {
    this.audio.setVolumes({ master: this.settings.master, music: this.settings.music, sfx: this.settings.sfx });
    this.audio.setVoices(this.settings.voice !== false);
    this.input.sensitivity = this.settings.sensitivity;
  }

  private resize() {
    this.fitW = innerWidth;
    this.fitH = innerHeight;
    const { aspect } = fitCanvas(this.renderer, this.canvas, this.quality.pixelRatio, this.isWebGPU);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Down in the dust: the view drops, the pack stays behind, you wake at the camp. */
  private die() {
    const s = this.state!, player = this.player!;
    this.busy = true;
    player.frozen = true;
    this.dying = 0.0001;
    s.data.stats.deaths = (s.data.stats.deaths ?? 0) + 1;
    s.data.poison = 0;
    this.input.exitLock();
    // the pack: everything that isn't a weapon or the story stays where you fell
    const lost = !!s.data.pack;
    const keep: { id: string; qty: number }[] = [];
    const drop: { id: string; qty: number }[] = [];
    for (const it of s.data.inventory) (KEEP_ON_DEATH(it.id) ? keep : drop).push({ ...it });
    s.data.inventory = keep;
    s.events.emit('inventoryChanged', {});
    s.data.pack = drop.length ? { position: [player.position.x, player.position.y, player.position.z], items: drop, day: Math.floor(s.data.stats.playTime / 1560) } : null;
    this.arms?.validate();
    this.audio.combat?.hurt('melee', 1.2);
    setTimeout(() => this.ui.fade(true, 'You go down in the dust.'), 900);
    setTimeout(() => {
      s.heal(45);
      s.data.hunger = Math.max(20, s.data.hunger - 20);
      s.data.thirst = Math.max(20, s.data.thirst - 25);
      const c = this.landmarks.campPosition.clone().add(new THREE.Vector3(2, 0, 2));
      c.y = this.hf.heightAt(c.x, c.z) + 0.2;
      player.teleport(c);
      this.cam.snap(this.cam.yaw, -0.05);
      this.atmo.hour = (this.atmo.hour + 6) % 24;
      this.envTimer = 0;
      this.dying = 0;
      this.ui.fade(true, 'Mara had someone drag you back. Six hours gone. The job didn\'t wait.');
      this.placePack();
    }, 3000);
    setTimeout(() => {
      this.ui.fade(false);
      player.frozen = false;
      this.busy = false;
      this.input.requestLock();
      if (lost) this.ui.toast('Your old pack is gone. Kade got to it first.', 'bad');
      if (s.data.pack) this.ui.toast('Your pack is still where you fell. Orange beacon, marked on the map.', 'info');
      this.save(true);
    }, 6200);
  }

  // ------------------------------------------------------------------ gameplay helpers
  /**
   * v0.5 hands everyone a crowbar and Hollis's revolver (new runs and old saves alike, once). The
   * Brute brings the camp's shotgun, the Scout her ranger rifle.
   */
  private grantArms(s: GameState) {
    if (!s.set('arms.v5')) return;
    const give = (id: string, n: number) => s.addItem(id, n, true, true);
    give('crowbar', 1);
    give('revolver', 1);
    give('ammo38', 12);
    const mags: Record<string, number> = { revolver: 6 };
    if (s.data.archetype === 'brute') { give('shotgun', 1); give('shells', 6); mags.shotgun = 5; }
    if (s.data.archetype === 'scout') { give('rifle', 1); give('ammo3030', 7); mags.rifle = 7; }
    s.data.arms = { equipped: 'revolver', mags };
    if (s.has('briefed')) {
      setTimeout(() => this.ui.subtitle('Mara Voss', 'Hollis left you his revolver and a crowbar in your pack. The road\'s got teeth now: Kade\'s Recovery crews, and the wolves stopped being shy.'), 2500);
    }
  }

  /** Something hurt the player (combat hook): health, the HUD's direction marker, the body's reaction. */
  private playerHurt(amount: number, from: THREE.Vector3 | null, kind: HurtKind) {
    const s = this.state;
    if (!s || !this.player || s.data.health <= 0) return;
    s.damage(amount);
    const k = Math.min(1, amount / 30);
    this.post.damage.value = Math.min(0.9, (this.post.damage.value as number) + 0.22 + k * 0.45);
    this.cam.addTrauma(0.15 + k * 0.45);
    this.hands?.jolt(0.3 + k * 0.6);
    this.audio.combat?.hurt(kind === 'zap' ? 'melee' : kind, 0.6 + k * 0.6);
    this.input.rumble(0.35 + k * 0.6, 0.25 + k * 0.4, 120 + k * 180);
    if (from) {
      // screen-space bearing of the source, for the red arc round the crosshair
      const dx = from.x - this.player.position.x, dz = from.z - this.player.position.z;
      const bearing = Math.atan2(dx, dz) - (this.cam.yaw + Math.PI);
      this.ui.damageFrom(bearing, k);
      // the hit knocks your head (a bite or a blast hardest)
      this.cam.punch(bearing, (kind === 'bite' || kind === 'blast' ? 0.12 : 0.06) + k * 0.1);
    }
  }

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
    if (id === 'antivenom') {
      s.removeItem(id, 1);
      const apply = () => {
        s.data.poison = 0;
        s.heal(10);
        this.audio.play('eat');
        this.ui.toast('Snakebite kit. The burning stops. Mostly.', 'good');
      };
      if (this.hands && !this.ui.modalOpen) this.hands.eat(apply); else apply();
      return;
    }
    if (id === 'medkit') {
      s.removeItem(id, 1);
      const apply = () => {
        s.data.poison = (s.data.poison ?? 0) * 0.5;
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
        const hitGarage = this.garage.emp(g.mesh.position, 8.5);
        const s = this.state;
        const empDur = 12 * ((s?.skill('electronics') ?? 0) >= 2 ? 1.5 : 1) * (s?.focus('electronics') === 'deepcell' ? 1.3 : 1);
        const hitMachines = this.machines.emp(g.mesh.position, empRadius(s?.skill('demolition') ?? 0) * (s?.focus('demolition') === 'wide' ? 1.18 : 1), empDur);
        if (!hitGarage && !hitMachines) this.ui.toast('EMP fizzled — nothing electronic nearby.', 'info');
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
    if (s.data.pack) out.push({ id: 'pack', x: s.data.pack.position[0], z: s.data.pack.position[2], label: 'Your pack', color: '#ff8a2a', kind: 'intel' });
    for (const op of OUTPOSTS) {
      if (!s.has(`seen:${op.id}`) && this.map.revealedAt(op.x, op.z) < 40) continue;
      const cleared = s.has(`outpost.${op.id}.cleared`) && (s.data.marks[`cleared.${op.id}`] ?? -1e9) > s.data.stats.playTime - 30 * 60;
      out.push({ id: `op:${op.id}`, x: op.x, z: op.z, label: cleared ? `${op.name} (cleared)` : op.name, color: cleared ? '#7d725f' : '#ff4a3a', kind: 'bunker' });
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
    if (this.benchFrames < this.benchInt.length) this.benchInt[this.benchFrames] = this.frameGap;
    this.benchFrames++;
    if (!this.benchT) this.benchT = now;
    if (now - this.benchT >= 2000) {
      const info = this.renderer.info.render;
      // frame intervals vs the frame's own JS: the gap is what the webview spends outside our code
      // (style/paint of the HUD, compositing, the swap and its wait for the display)
      const iv = Array.from(this.benchInt.subarray(0, Math.min(this.benchFrames, this.benchInt.length))).sort((a, b) => a - b);
      const q = (k: number) => iv[Math.min(iv.length - 1, Math.floor(iv.length * k))].toFixed(1);
      const js = (this.benchUpd + this.benchPhys + this.benchRen) / this.benchFrames;
      console.log(`[BENCH] mode=${this.mode} backend=${this.backendLabel} fps=${((this.benchFrames * 1000) / (now - this.benchT)).toFixed(1)} buffer=${this.renderer.domElement.width}x${this.renderer.domElement.height} q=${this.quality.level} tris=${info.triangles} ms[update=${(this.benchUpd / this.benchFrames).toFixed(1)} physics=${(this.benchPhys / this.benchFrames).toFixed(1)} render=${(this.benchRen / this.benchFrames).toFixed(1)}] js=${js.toFixed(1)} interval[p10=${q(0.1)} p50=${q(0.5)} p90=${q(0.9)}]`);
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
    this.frameGap = now - this.last;
    const dt = Math.min(1 / 20, this.frameGap / 1000);
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

    // controllers: play input while playing, menu navigation otherwise
    pad.update(dt, this.mode === 'playing' && this.input.locked && !this.ui.modalOpen && !this.ui.minigameOpen && !this.busy);

    if (this.mode === 'title') {
      this.titleT += dt;
      const cut = this.director.title(dt);
      if (cut !== null) { this.atmo.hour = cut; this.envTimer = 0; }
      this.post.fade.value = this.director.fade;
    } else if (this.mode === 'charselect') {
      // the menu director kneels you at the fire (gliding down from the title shot); hands follow
      this.director.select(dt);
      this.atmo.hour = damp(this.atmo.hour, this.director.selectHour, 1.2, dt);
      this.post.fade.value = this.director.fade;
      if (this.hands) this.hands.root.position.set(0.045, -0.012, 0.004);
      this.hands?.update(dt, { speed: 0, grounded: true, crouch: false, sprint: false, bobPhase: 0, lookDX: Math.sin(this.t * 0.7) * 4, lookDY: Math.cos(this.t * 0.5) * 3 });
    } else if (this.mode === 'playing' && this.player && this.state) {
      this.playFrame(dt);
    }

    this.touch?.setActive(this.mode === 'playing' && this.input.locked && !this.ui.modalOpen && !this.ui.minigameOpen && !this.busy);

    // world systems
    viewCull.update(this.camera, this.atmo.sun.shadow.camera); // what characters need posing this frame
    this.atmo.follow(this.camera);
    this.landmarks.update(dt, this.t, this.camera.position);
    this.settlement?.update(dt, this.camera.position);
    if (this.player && this.mode === 'playing') this.scavenge?.update(dt, this.player.position);
    for (const site of this.sites) site.update(dt, this.camera.position);
    this.errands?.update(dt, this.camera.position);
    if (this.mode !== 'playing') this.garage.update(dt);
    this.garage.cull(this.camera.position);
    this.props.update(dt, focusPos, this.atmo.wind);
    this.scrub.update(focusPos, this.atmo.wind);
    this.shrubs.update(focusPos);
    this.pebbles.update(focusPos);
    this.camera.getWorldDirection(this.fauna.camFwd!);
    this.fauna.update(dt, focusPos, this.atmo.hour, this.mode === 'playing' ? this.audio : undefined, !!this.player?.sprinting);
    this.dust.update(dt);
    this.haze.update(dt);
    this.puffs.update(dt);
    this.streaks.update(dt);
    this.devils.update();
    this.lightning.update(this.weather.flash, this.weather.intensity);
    this.stormWall.update(this.camera.position, this.weather.wallDist, this.weather.wallVis, this.atmo.uUpwind.value as THREE.Vector2);
    this.updateGrenades(dt);
    this.recovery.update(dt, focusPos, this.camera.position, this.mode === 'playing' && !!this.player && !this.ui.modalOpen);
    if (this.mode === 'playing' && !this.ui.modalOpen) this.machines.update(dt, this.camera.position);
    this.combat.update(dt);
    this.updateEnvironment(dt);
    // intel: a glint every few seconds (stronger close, gone far away), the call box's light blinks
    for (const ip of this.intelProps) {
      if (!ip.g.visible) continue;
      const d = ip.g.position.distanceTo(this.camera.position);
      ip.prop.glint.t.value = ((this.t / 3.2 + ip.phase) % 1);
      ip.prop.glint.k.value = d > 70 ? 0 : Math.min(1, 1.6 - d / 45) * (this.atmo.isNight ? 1.4 : 1);
      if (ip.prop.blink) ip.prop.blink.value = (this.t % 1.4) < 0.5 ? 8 : 0.2;
    }
    // gameplay-driven post
    this.post.damage.value = damp(this.post.damage.value as number, 0, 2.5, dt);
    this.post.menuShade.value = damp(this.post.menuShade.value as number, this.mode === 'title' || this.mode === 'charselect' ? 1 : 0, 3, dt);
    this.post.emp.value = damp(this.post.emp.value as number, 0, 1.2, dt);
    if (this.mode !== 'playing') this.post.lowHp.value = 0;
    const alertTarget = this.mode === 'playing' && this.garage.drone.state === 'alert' ? 0.8 : this.mode === 'playing' ? this.garage.drone.detection * 0.4 : 0;
    this.post.alert.value = damp(this.post.alert.value as number, alertTarget, 4, dt);
    const tension = this.mode === 'playing' ? Math.max(this.garage.drone.detection, this.garage.alarm > 0 ? 1 : 0, this.combat.heat) : 0;
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
      combat: playing ? Math.max(this.combat.heat, this.huntedBy > 0 ? 0.6 : 0) : 0,
    });
    if (!this.loopsStarted && this.audio.ready && this.mode !== 'loading') this.startLoops();

    if (BENCH) this.bench(now);
    this.ui.tickFps(now);
    // the viewmodel keeps its authored size on screen at any field of view (see viewmodelDepth)
    if (this.hands && this.cam) this.hands.root.scale.z = Hands.VIEW_SCALE * this.cam.viewmodelDepth();
    const tPhys = performance.now();
    // step by the real frame time (the world default of 1/60 per frame ran physics 2.4× fast at 144 Hz)
    this.physics.world.timestep = Math.max(1 / 240, dt);
    this.physics.step();
    lightPool.update(this.camera.position, dt);
    const tRender = performance.now();
    if (this.warmNext) {
      const { roots, stage } = this.warmNext;
      this.warmNext = null;
      const unstage = stage?.();
      const ms = this.warmShaders(...roots);
      unstage?.();
      console.log(`[BunkerBusters] shader warm-up (run start): ${ms.toFixed(0)} ms`);
    } else {
      // interior mode: inside a sealed building that can't see out, the exterior isn't drawn (nor cast
      // into the shadow map). Hidden only around the render, so no system's own visibility is touched.
      updateShownMatrices(this.scene); // once a frame (scene.matrixWorldAutoUpdate is off: see build)
      const inner = this.activeInterior();
      const hidden = inner ? hideExcept(this.exteriorRoots(), inner.keep, this._hidden) : null;
      if (SKIP.has('post')) this.renderer.render(this.scene, this.camera); else this.post.render();
      if (hidden) { for (const o of hidden) o.visible = true; hidden.length = 0; }
      if (inner) this.interiorFrames++;
      this.interiorName = inner?.name ?? '';
    }
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

    // the calendar turns when the clock wraps past midnight. Time only runs forward, so any step back
    // is a wrap: the clock ticking over, sleeping till dawn, or a six-hour blackout
    if (this.atmo.hour < this.lastHour - 1e-4) s.data.days = (s.data.days ?? 0) + 1;
    this.lastHour = this.atmo.hour;

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
      const tab = input.actPressed('kit') ? 'kit' : input.actPressed('skills') ? 'skills' : input.actPressed('journal') ? 'journal' : null;
      if (tab) {
        this.input.exitLock();
        const firstKit = !s.has('tut.kit');
        this.ui.openInventory((id) => this.useItem(id), () => {
          if (firstKit && s.set('tut.kit')) this.ui.toast('Skills live on their own tab (K). Each one branches twice: a focus at rank 2, a capstone at rank 4.', 'info');
          this.afterModal();
        }, tab, this.story);
      } else if (input.actPressed('map')) {
        this.input.exitLock();
        const intel = WORLD_INTEL.filter((i) => s.has(`intel:${i.id}`)).map((i) => ({ title: i.title, body: i.body }));
        this.ui.openMap(player.position.x, player.position.z, player.yaw, this.markers(), intel, () => this.afterModal());
      } else if (input.pressed('Escape')) {
        this.input.exitLock();
      }
      HOTBAR_ITEMS.forEach((id, i) => {
        if (input.actPressed(`hotbar${i + 1}` as 'hotbar1')) this.useItem(id);
      });
    }

    if (!blocked && input.actPressed('torch') && this.hands) {
      this.hands.flashlightOn = !this.hands.flashlightOn;
      player.flashlight = this.hands.flashlightOn;
      this.audio.play('click');
    }
    player.update(dt, input, this.cam.yaw, true);
    this.garage.update(dt);
    // what hostiles can perceive of you this frame
    const tg = this.combat.target;
    tg.feet.copy(player.position);
    tg.chest.copy(player.position).setY(player.position.y + (player.crouching ? 0.75 : 1.25));
    tg.eye.copy(this.camera.position);
    tg.velocity.copy(player.velocity);
    tg.crouch = player.crouching;
    tg.noise = player.noise * s.archetype.stats.stealth;
    tg.torch = !!this.hands?.flashlightOn;
    tg.hidden = this.garage.playerInside;
    tg.night = this.atmo.isNight ? 1 : Math.max(0, Math.min(1, (0.15 - this.atmo.sunElevation) / 0.25));
    tg.visibility = 1 - this.weather.intensity * 0.75;
    // the stealth model: by day everyone's lit; at night it's the fires, the floodlights, the muzzle
    // flashes, and your own torch. Smoothed so a guttering fire doesn't strobe you in and out of sight.
    // SeedBot's spotlight isn't in the point-light pool: standing in its cone (it sees you) is lit too,
    // or the pill reads IN SHADOW while the drone is shouting about you
    const pointLit = this.garage.drone.canSee ? 1 : 1 - Math.exp(-lightPool.illuminance(tg.chest) / 0.6);
    this.pointLit += (pointLit - this.pointLit) * Math.min(1, dt * 4);
    tg.light = tg.torch ? 1 : Math.min(1, 1 - tg.night + tg.night * Math.max(0.08, this.pointLit));
    tg.alive = s.data.health > 0;
    tg.collider = player.collider;
    tg.height = player.height;

    const strafe = blocked ? 0 : (input.act('right') ? 1 : 0) - (input.act('left') ? 1 : 0) + input.moveX + input.padX;
    const hs = Math.hypot(player.velocity.x, player.velocity.z);
    this.cam.update(dt, input, { feet: player.position, crouch: player.crouching, sprint: player.sprinting, speed: hs, grounded: player.grounded, strafe, exertion: player.exertion });
    // going down: the view sags to the ground and rolls
    if (this.dying > 0) {
      this.dying = Math.min(1, this.dying + dt / 1.1);
      const k = this.dying * this.dying * (3 - 2 * this.dying);
      this.camera.position.y -= k * 1.25;
      this.camera.rotation.z += k * 1.1;
      this.camera.rotation.x -= k * 0.25;
      this.post.damage.value = Math.max(this.post.damage.value as number, 0.6 * (1 - k * 0.5));
    }
    // weapons after the camera: a shot goes where you're looking this frame, not last frame
    this.camera.updateMatrixWorld();
    tg.eye.copy(this.camera.position);
    if (this.arms) {
      this.arms.validate();
      this.wantAds = this.arms.update(dt, blocked || this.busy, !!this.hands?.busy).wantAds;
    }
    this.audio.breathe(dt, player.exertion);
    if (player.winded && !this.windedHint) {
      this.windedHint = true;
      this.ui.toast('Winded. Catch your breath before sprinting again.', 'info');
    }
    this.hands?.update(dt, { speed: hs, grounded: player.grounded, crouch: player.crouching, sprint: player.sprinting, bobPhase: this.cam.bobPhase, lookDX: input.mouseDX, lookDY: input.mouseDY, vy: player.velocity.y, ads: this.wantAds, steady: s.focus('firearms') === 'marksman' });

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
      } else if (input.actPressed('interact')) {
        if (pa === true) { if (this.hands) this.hands.reach(() => void f.primary.run()); else void f.primary.run(); } else this.audio.play('deny');
      } else if (input.actPressed('alt') && f.secondary) {
        const sec = f.secondary;
        if (sec.available() === true) { if (this.hands) this.hands.press(() => void sec.run()); else void sec.run(); } else this.audio.play('deny');
      }
    }

    if (this.arms?.takedownTarget && !this.focus && !isTouch) prompt.push({ key: 'LMB', label: 'Takedown' });
    if (this.touch) {
      const f = this.focus;
      this.touch.update({
        use: !!f, useNA: !!f && f.primary.available() !== true,
        alt: f?.secondary ? f.secondary.label : null,
        crouch: player.crouching, torch: !!this.hands?.flashlightOn,
        armed: !!this.arms?.equipped, gun: !!this.arms?.equipped && this.arms.equipped !== 'crowbar',
        ammo: this.arms?.equipped && this.arms.equipped !== 'crowbar' ? `${this.arms.mag(this.arms.equipped)}/${this.arms.reserve(this.arms.equipped)}` : '',
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
      for (const op of OUTPOSTS) {
        if (s.has(`seen:${op.id}`)) continue;
        if (Math.hypot(player.position.x - op.x, player.position.z - op.z) < 70) {
          s.set(`seen:${op.id}`);
          this.ui.banner(op.name.toUpperCase(), op.blurb, 'bad');
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

    // venom: a slow burn until it's treated or runs out
    if (!blocked && (s.data.poison ?? 0) > 0) {
      s.data.poison = Math.max(0, (s.data.poison ?? 0) - dt);
      this.venomHurt += dt * 0.6;
      if (this.venomHurt >= 1) { const n = Math.floor(this.venomHurt); this.venomHurt -= n; s.damage(n); this.post.damage.value = Math.max(this.post.damage.value as number, 0.18); }
    }

    // near death: a heartbeat you can hear, colour draining, the edges throbbing in time with it
    const lowK = !blocked && s.data.health > 0 ? THREE.MathUtils.clamp((40 - s.data.health) / 30, 0, 1) : 0;
    this.hbPhase = Math.min(1, this.hbPhase + dt / (1.05 - lowK * 0.45));
    if (this.audio.combat?.heartbeat(dt, lowK)) this.hbPhase = 0;
    const throb = Math.exp(-this.hbPhase * 7) + 0.6 * Math.exp(-Math.max(0, this.hbPhase - 0.19) * 9) * (this.hbPhase > 0.19 ? 1 : 0);
    this.post.lowHp.value = damp(this.post.lowHp.value as number, lowK * (0.65 + 0.35 * Math.min(1, throb)), 6, dt);

    // death is a debt, not a nap: you wake at the fire hours later, and your pack is where you fell
    if (s.data.health <= 0 && !this.busy) this.die();

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

    const aw = this.combat.awareness();
    this.huntedBy = aw.hunting;
    this.ui.updateHUD(dt, {
      objective: this.objective(),
      detection: Math.max(this.garage.drone.detection, aw.best),
      threat: aw.hunting > 0 ? 'hunted' : aw.best > 0.3 ? 'watched' : null,
      venom: (s.data.poison ?? 0) > 0,
      light: this.combat.target.night < 0.5 ? null : this.combat.target.light > 0.55 ? 'lit' : this.combat.target.light < 0.3 ? 'shadow' : null,
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
      arms: this.arms?.hud() ?? null,
      health: s.data.health,
    });
    void vec3;
  }
}
