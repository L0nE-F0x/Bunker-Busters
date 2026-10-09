/**
 * Who sounds like whom. Lines are pre-generated offline with Kokoro (scripts/voice/) and shipped as
 * small mp3s in public/voice/, one per (voice, run of sentences). This module is shared by the
 * generator and the game, so both cut text into sentences the same way.
 *
 * Synthesised-at-runtime speech (formant babble, the browser's TTS) was rejected as uncanny; these
 * are neural voices rendered once and treated like any recorded asset.
 */

/** How a voice is heard: in person, over a handheld radio, through Tanner's megaphone, a PA horn, a robot speaker. */
export type VoiceFx = 'room' | 'radio' | 'megaphone' | 'pa' | 'bot';

export interface CastVoice {
  /** Kokoro voice id(s). Several = a crew; the caller picks one per person. */
  voice: string | string[];
  fx: VoiceFx;
  speed?: number;
}

/** Keyed by the speaker's name, lowercased, before any " · channel" suffix. Unlisted speakers (notes, signs, the player) stay silent. */
export const CAST: Record<string, CastVoice> = {
  'mara voss': { voice: 'af_sarah', fx: 'radio', speed: 0.97 },
  'hollis grange': { voice: 'am_onyx', fx: 'radio', speed: 0.94 },
  'pip okafor': { voice: 'af_sky', fx: 'radio', speed: 1.02 },
  'dez marlow': { voice: 'af_river', fx: 'radio' },
  'nia pell': { voice: 'af_heart', fx: 'room', speed: 0.95 },
  'doc ivers': { voice: 'am_adam', fx: 'room', speed: 0.96 },
  'inez quill': { voice: 'af_kore', fx: 'room' },
  'sol varga': { voice: 'am_echo', fx: 'room', speed: 0.94 },
  'ren oka': { voice: 'am_eric', fx: 'room', speed: 0.97 },
  wick: { voice: 'bm_lewis', fx: 'room', speed: 0.92 },
  'tanner pivotson': { voice: 'am_puck', fx: 'megaphone', speed: 1.05 },
  'vesper kade': { voice: 'bf_emma', fx: 'radio', speed: 0.96 },
  'hunter vale': { voice: 'am_liam', fx: 'pa', speed: 1.0 },
  assistant: { voice: 'af_jessica', fx: 'pa' },
  aria: { voice: 'af_aoede', fx: 'pa' },
  nimbus: { voice: 'af_nicole', fx: 'pa', speed: 0.98 },
  'pod-01 "momentum"': { voice: 'af_alloy', fx: 'pa' },
  'compliance sentry': { voice: 'af_nova', fx: 'pa', speed: 1.02 },
  seedbot: { voice: 'am_echo', fx: 'bot', speed: 1.1 },
  everafter: { voice: 'af_bella', fx: 'pa', speed: 1.0 }, // Waitlist City's concierge (sites/waitlist.ts)
  'kade recovery': { voice: ['am_fenrir', 'am_michael', 'bm_george', 'bm_daniel'], fx: 'radio', speed: 1.05 },
  'ezra seymour': { voice: 'bm_fable', fx: 'pa', speed: 1.04 },
};

const ALIAS: Record<string, string> = { mara: 'mara voss' };

/** The cast entry for a speaker label as the UI shows it ("Mara · radio", "ARIA · Ascend Concierge"). */
export function castFor(speaker: string): CastVoice | null {
  const name = speaker.split(' · ')[0].trim().toLowerCase();
  return CAST[ALIAS[name] ?? name] ?? null;
}

/** The concrete Kokoro voice for a speaker; `variant` picks a crew member. */
export function voiceFor(c: CastVoice, variant = 0) {
  return Array.isArray(c.voice) ? c.voice[Math.abs(variant) % c.voice.length] : c.voice;
}

/**
 * What would actually be said: stage directions "(hot mic)" and actions "*bzzt*" dropped, quote marks
 * gone, curly apostrophes straightened, " / " line breaks read as sentence ends.
 */
export function spoken(text: string) {
  // a line that sets a scene before anyone talks ('A chime, then a voice… "Thank you for calling."') voices only the quote
  const q = text.indexOf('"');
  if (q > 0 && /[.!?]\s*$/.test(text.slice(0, q)) && /"\s*$/.test(text)) text = text.slice(q);
  return text
    .replace(/Bunkr\.ly/g, 'Bunkrly')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\*[^*]*\*/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/["“”]/g, '')
    .replace(/\s+\/\s+/g, '. ')
    .replace(/([^.][.!?])\.(\s|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sentences of already-`spoken` text. Abbreviations split too; that's fine, both sides split alike. */
export function sentences(text: string): string[] {
  return (text.match(/[^.!?…]+(?:[.!?…]+|$)/g) ?? []).map((s) => s.trim()).filter((s) => /[A-Za-z0-9]/.test(s));
}

/** File key for one clip: a stable hash of voice and words. */
export function clipKey(voice: string, words: string) {
  let h = 0x811c9dc5;
  const s = `${voice}|${words}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(7, '0');
}

/**
 * Cut `text` into the clips to play: greedily the longest run of sentences that has a clip, skipping
 * sentences that have none (names, counts and other text filled in at runtime).
 */
export function clipsFor(voice: string, text: string, has: (key: string) => boolean): string[] {
  const ss = sentences(spoken(text));
  const out: string[] = [];
  for (let i = 0; i < ss.length;) {
    let hit = 0;
    for (let j = ss.length; j > i; j--) {
      const k = clipKey(voice, ss.slice(i, j).join(' '));
      if (has(k)) { out.push(k); hit = j; break; }
    }
    i = hit || i + 1;
  }
  return out;
}
