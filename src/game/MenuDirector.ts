import * as THREE from 'three/webgpu';
import type { Landmarks } from './world/Landmarks';

/**
 * The menu camera: the title's slow cinematic shots (the camp four round the fire at dusk, a crane
 * over the camp, the Garage at sunset) cut through a dip to black, then New Game glides down into
 * the empty place at the fire for character select. Camp shots are authored in camp space (the fire
 * at (−8, 0, 5), Mara and Pip on the north log, Hollis and Dez on the east log; the south-west is
 * open) and keep their subject right of centre, clear of the logo and the side panel.
 */
interface Pose { eye: [number, number, number]; at: [number, number, number]; fov: number }
interface Shot { dur: number; hour: number; from?: Pose; to?: Pose; garage?: boolean }

const SHOTS: Shot[] = [
  // a slow push in under the canopy: the fire, the four, the string lights, the cliffs going red
  { dur: 17, hour: 17.7, from: { eye: [-16.5, 2.6, -2.5], at: [-4, 1.4, 1], fov: 48 }, to: { eye: [-13.4, 1.8, 0], at: [-4, 1.2, 2.2], fov: 45 } },
  // the crane: high over the camp at blue hour, settling toward the fire
  { dur: 14, hour: 18.3, from: { eye: [-20, 9, -7], at: [0.5, 0.2, 0], fov: 46 }, to: { eye: [-15.5, 4.6, -3.2], at: [0, 0.5, 1], fov: 46 } },
  // the job: the Garage, back-lit by the sunset
  { dur: 15, hour: 17.45, garage: true },
];

/** Where you kneel at the fire for character select (open south-west side, facing the four). */
const SEAT: Pose = { eye: [-11.5, 1.05, 1.0], at: [-6.8, 0.7, 4.7], fov: 64 };

const DIP_OUT = 0.6, DIP_IN = 0.9, GLIDE = 2.8;
const ease = (k: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, k)));
const smooth = (k: number) => { const x = Math.min(1, Math.max(0, k)); return x * x * x * (x * (6 * x - 15) + 10); };

export class MenuDirector {
  static readonly STAND = 0.9;
  /** 0..1 dip to black (Game feeds it to the post stack's fade while a menu is up). */
  fade = 1;
  /** Character select's clock (the glide down eases the sky toward it; the run starts at it, too). */
  selectHour = 17.65;
  private shot = 0;
  private t = 0;
  private glideT = -1;
  private pickT = 9;
  private selT = 0;
  private standT = -1;
  private fromPos = new THREE.Vector3();
  private fromQuat = new THREE.Quaternion();
  private fromFov = 60;
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();

  constructor(private camera: THREE.PerspectiveCamera, private landmarks: Landmarks, private garageOrigin: () => THREE.Vector3) {}

  /** Start (or restart) the title sequence on its first shot. Returns the hour to set. */
  startTitle() {
    this.shot = 0;
    this.t = 0;
    this.fade = 1;
    this.apply(0);
    return SHOTS[0].hour;
  }

  /** Advance the title. Returns an hour when a cut happens (the clock jumps with the shot). */
  title(dt: number): number | null {
    this.t += dt;
    let cut: number | null = null;
    const s = SHOTS[this.shot];
    if (this.t >= s.dur) {
      this.shot = (this.shot + 1) % SHOTS.length;
      this.t = 0;
      cut = SHOTS[this.shot].hour;
    }
    const d = SHOTS[this.shot].dur;
    this.fade = Math.max(this.t < DIP_IN ? 1 - smooth(this.t / DIP_IN) : 0, this.t > d - DIP_OUT ? smooth((this.t - d + DIP_OUT) / DIP_OUT) : 0);
    this.apply(this.t);
    return cut;
  }

  /** Character select starts: glide from wherever the title camera is (cut first if it's far away). */
  startSelect() {
    if (this.camera.position.distanceTo(this.landmarks.campPosition) > 40) {
      this.shot = 0;
      this.apply(SHOTS[0].dur * 0.6);
      this.fade = 1;
    }
    this.fromPos.copy(this.camera.position);
    this.fromQuat.copy(this.camera.quaternion);
    this.fromFov = this.camera.fov;
    this.glideT = 0;
    this.selT = 0;
    this.pickT = 9;
    this.standT = -1;
  }

  /** The pick is made: stand up from the fire as the picture goes to black (STAND seconds). */
  standUp() {
    this.standT = 0;
  }

  /** A different person picked: a small push in toward the fire, like leaning closer. */
  pick() {
    if (this.glideT >= GLIDE) this.pickT = 0;
  }

  /** Character select: kneeling at the fire, breathing, a slow drift; glides in on entry. */
  select(dt: number) {
    this.selT += dt;
    this.pickT += dt;
    const t = this.selT;
    const eye = this.cp(SEAT.eye, this.v1);
    const at = this.cp(SEAT.at, this.v2);
    // breath and a slow drift of the gaze across the four
    eye.y += Math.sin(t * 0.9) * 0.012;
    const side = this.v3.subVectors(at, eye).setY(0).normalize();
    side.set(side.z, 0, -side.x);
    at.addScaledVector(side, Math.sin(t * 0.17) * 0.35).setY(at.y + Math.sin(t * 0.23) * 0.06);
    // the pick: lean in and settle back
    const lean = this.pickT < 1.6 ? Math.sin(Math.PI * Math.min(1, this.pickT / 1.6)) * (1 - this.pickT / 1.6 * 0.4) : 0;
    eye.lerp(at, lean * 0.045);
    if (this.standT >= 0) {
      this.standT += dt;
      const k = smooth(this.standT / MenuDirector.STAND);
      eye.y += k * 0.62;
      at.y += k * 0.35;
    }
    this.camera.position.copy(eye);
    this.camera.lookAt(at);
    let fov = SEAT.fov;
    if (this.glideT >= 0 && this.glideT < GLIDE) {
      this.glideT += dt;
      const k = smooth(this.glideT / GLIDE);
      this.q.copy(this.fromQuat).slerp(this.camera.quaternion, k);
      // a lifted arc: the camera sinks onto its knees rather than sliding along the sand
      this.camera.position.lerpVectors(this.fromPos, eye, k);
      this.camera.position.y += Math.sin(Math.PI * k) * 0.6 * (1 - k);
      this.camera.quaternion.copy(this.q);
      fov = THREE.MathUtils.lerp(this.fromFov, SEAT.fov, k);
    }
    this.fade = this.standT >= 0 ? Math.max(this.fade, smooth(this.standT / MenuDirector.STAND)) : Math.max(0, this.fade - dt / DIP_IN);
    if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }

  /** Is the camera still gliding down to the fire? */
  get gliding() {
    return this.glideT >= 0 && this.glideT < GLIDE;
  }

  private apply(t: number) {
    const s = SHOTS[this.shot];
    const cam = this.camera;
    let fov = 50;
    if (s.garage) {
      // the Garage orbit (the old title shot): back-lit, framed right of the logo
      const o = this.garageOrigin();
      const a = 5.55 + Math.sin(t * 0.04) * 0.3 - t * 0.006;
      const r = 40 + Math.sin(t * 0.13) * 4 - t * 0.25;
      cam.position.set(o.x + Math.sin(a) * r, o.y + 7 + Math.sin(t * 0.2) * 1.2, o.z + Math.cos(a) * r);
      const fwd = this.v1.set(o.x - cam.position.x, 0, o.z - cam.position.z).normalize();
      cam.lookAt(o.x + fwd.z * 13, o.y + 6, o.z - fwd.x * 13);
      fov = 50;
    } else {
      const k = ease(t / s.dur);
      const a = s.from!, b = s.to!;
      const eye = this.cp(a.eye, this.v1).lerp(this.cp(b.eye, this.v3), k);
      const at = this.cp(a.at, this.v2).lerp(this.cp(b.at, this.v3), k);
      cam.position.copy(eye);
      this.m.lookAt(eye, at, cam.up);
      cam.quaternion.setFromRotationMatrix(this.m);
      fov = THREE.MathUtils.lerp(a.fov, b.fov, k);
    }
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }

  private cp(p: [number, number, number], out: THREE.Vector3) {
    return this.landmarks.campPoint(p[0], p[1], p[2], out);
  }
}
