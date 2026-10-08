import type { Vector3 } from 'three/webgpu';
import { castFor, clipsFor, voiceFor } from '@/content/voices';
import CLIPS from '@/content/voiceClips.json';

/**
 * Spoken lines: pre-rendered clips (scripts/voice/) played under the subtitles and dialogue cards.
 * One conversation voice at a time (a new card cuts the old one off); barks are positional and
 * overlap it. Text the clips don't cover (a name, a count) is simply not spoken; the subtitle has it.
 */
const HAVE = new Set<string>(CLIPS as string[]);
const BASE = `${import.meta.env.BASE_URL}voice/`;
const GAP = 0.14;
const TRACE = typeof location !== 'undefined' && new URLSearchParams(location.search).has('trace');

export class VoicePlayer {
  enabled = true;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private talk: AudioBufferSourceNode[] = [];
  private token = 0;
  private barks = 0;
  private talking = false;
  private ducked = 1;

  constructor(
    private ctx: AudioContext,
    private out: AudioNode,
    private panner: (pos: Vector3) => PannerNode,
    /** The score's level under speech: 0.45 in a conversation, 0.7 under a bark, 1 otherwise. */
    private duck: (k: number) => void,
  ) {}

  /**
   * Speak `text` as `speaker`. With `pos` it's a positional bark that doesn't interrupt anything.
   * Resolves to the spoken length in seconds (0 when nothing was voiced).
   */
  async say(speaker: string, text: string, opts: { pos?: Vector3; variant?: number } = {}): Promise<number> {
    const c = castFor(speaker);
    if (!this.enabled || !c) { if (!opts.pos) this.hush(); return 0; }
    const keys = clipsFor(voiceFor(c, opts.variant), text, (k) => HAVE.has(k));
    if (!opts.pos) this.hush();
    if (!keys.length) return 0;
    if (opts.pos && this.barks >= 2) return 0;
    const token = opts.pos ? -1 : this.token;
    const bufs = await Promise.all(keys.map((k) => this.load(k)));
    if (token >= 0 && token !== this.token) return 0; // a newer line took over while these loaded
    let t = this.ctx.currentTime + 0.03;
    const t0 = t;
    let dest: AudioNode = this.out;
    if (opts.pos) {
      dest = this.panner(opts.pos);
      dest.connect(this.out);
      this.barks++;
    } else this.talking = true;
    this.mix();
    const srcs: AudioBufferSourceNode[] = [];
    for (const b of bufs) {
      if (!b) continue;
      const s = this.ctx.createBufferSource();
      s.buffer = b;
      s.connect(dest);
      s.start(t);
      t += b.duration + GAP;
      srcs.push(s);
    }
    const last = srcs[srcs.length - 1];
    if (!last) { if (opts.pos) this.barks--; else this.talking = false; this.mix(); return 0; }
    last.onended = () => {
      if (opts.pos) { this.barks--; dest.disconnect(); }
      else if (this.talk === srcs) { this.talk = []; this.talking = false; }
      this.mix();
    };
    if (!opts.pos) this.talk = srcs;
    if (TRACE) console.log(`[voice] ${speaker}: ${srcs.length} clip(s), ${(t - t0).toFixed(1)} s`);
    return t - t0;
  }

  /** True if `say` would voice something for this line right now. */
  covers(speaker: string, text: string, variant = 0) {
    const c = castFor(speaker);
    return this.enabled && !!c && clipsFor(voiceFor(c, variant), text, (k) => HAVE.has(k)).length > 0;
  }

  /** Stop the conversation voice (a card closed, the next page). Barks play out. */
  hush() {
    this.token++;
    if (!this.talk.length) return;
    const now = this.ctx.currentTime;
    for (const s of this.talk) { s.onended = null; try { s.stop(now + 0.02); } catch { /* not started */ } }
    this.talk = [];
    this.talking = false;
    this.mix();
  }

  /** Duck the score for whoever is talking: deep for a conversation, a little for a bark. */
  private mix() {
    const k = this.talking ? 0.45 : this.barks > 0 ? 0.7 : 1;
    if (k !== this.ducked) { this.ducked = k; this.duck(k); }
  }

  private load(key: string) {
    let p = this.buffers.get(key);
    if (!p) {
      p = fetch(`${BASE}${key}.mp3?v=${__VOICE_REV__}`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((a) => this.ctx.decodeAudioData(a))
        .catch((e) => { console.warn('[voice] clip', key, e); this.buffers.delete(key); return null; });
      this.buffers.set(key, p);
      // decoded clips are big (float, context rate): keep the recent ones only
      if (this.buffers.size > 48) this.buffers.delete(this.buffers.keys().next().value!);
    }
    return p;
  }
}
