"""Voice lines for the cuts, lifted from the game's own clips (public/voice: Kokoro renders with the PA /
megaphone / radio / bot treatment already baked in). Each spec names a speaker and a line; the clip is
found in scripts/voice/lines.json and written as 48 kHz stereo WAV to <out>/vo/<name>.wav, and its
subtitle card spec to <out>/vo-subs.json (for overlays.mjs).

    ~/.local/share/bb-tts/venv/bin/python scripts/promo/vo.py <out> <specs.json>

specs: [{ name, speaker, text, who, bot?, variant? }]
  text may be a run of whole sentences from inside a longer line ("Oh! A visitor. Hold on, I'm going
  live." out of Vesper's five). The clip is cut at the sentence breaks: the quietest point of the
  loudness envelope near where each break should fall (by the sentences' share of the text), which
  works through the echo of the PA and radio treatments where a silence detector finds nothing.
  variant: which of several voices has the same line (Kade's crews have four).
  cut: [start, end] seconds into the whole clip, for when the envelope picks the wrong break. Check
  every cut by ear or with whisper-cli (NOTES 2026-10-31 has the command).
"""
import json
import re
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SR = 48000
OUT, SPECS = Path(sys.argv[1]), Path(sys.argv[2])
LINES = json.loads((ROOT / 'scripts/voice/lines.json').read_text())


def norm(s):
    return re.sub(r'[^a-z0-9]+', ' ', s.lower()).strip()


def sentences(s):
    return [x.strip() for x in re.findall(r'[^.!?]+[.!?]+["\')\]]*(?:\s+|$)|[^.!?]+$', s) if x.strip()]


def decode(p):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(p), '-f', 's16le', '-ac', '1', '-ar', str(SR), '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, '<i2').astype(np.float32) / 32768


def write(p, mono):
    st = np.repeat(mono[:, None], 2, axis=1)
    pcm = (np.clip(st, -1, 1) * 32767).astype('<i2')
    with wave.open(str(p), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def breaks(a, parts):
    """Sample positions of the sentence breaks: the quietest point of a smoothed envelope near where
    each break should fall, given each sentence's share of the characters."""
    hop = int(0.01 * SR)
    n = len(a) // hop
    rms = np.sqrt(np.convolve(a[:n * hop].reshape(n, hop).__pow__(2).mean(1), np.ones(5) / 5, mode='same') + 1e-9)
    # speech spans the loud part (lead-in and tail trimmed)
    loud = np.where(rms > rms.max() * 0.05)[0]
    s0, s1 = loud[0], loud[-1]
    chars = np.array([len(p) for p in parts], float)
    cum = np.cumsum(chars)[:-1] / chars.sum()
    out = []
    lo = s0
    for k, c in enumerate(cum):
        exp = s0 + c * (s1 - s0)
        w = 0.22 * (s1 - s0)
        a_ = int(max(lo + 15, exp - w))
        b_ = int(min(s1 - 15, exp + w))
        i = a_ + int(np.argmin(rms[a_:b_])) if b_ > a_ else int(exp)
        out.append(i)
        lo = i
    return [i * hop for i in out], rms, hop


specs = json.loads(SPECS.read_text())
(OUT / 'vo').mkdir(parents=True, exist_ok=True)
subs = []
for s in specs:
    want = norm(s['text'])
    mine = [l for l in LINES if l['speaker'].lower() == s['speaker'].lower()]
    hits = [l for l in mine if norm(l['words']) == want]
    part = None
    if not hits:
        hits = [l for l in mine if want in norm(l['words'])]
        if hits:
            ss = [norm(x) for x in sentences(hits[0]['words'])]
            ws = [norm(x) for x in sentences(s['text'])]
            frm = next((i for i in range(len(ss)) if ss[i:i + len(ws)] == ws), -1)
            if frm < 0:
                print(f"NOT WHOLE SENTENCES  {s['name']}: {s['text']}")
                continue
            part = (frm, frm + len(ws), sentences(hits[0]['words']))
    if not hits:
        print(f"MISSING  {s['name']}: {s['speaker']}: {s['text']}")
        continue
    l = hits[min(s.get('variant', 0), len(hits) - 1)]
    a = decode(ROOT / 'public/voice' / f"{l['key']}.mp3")
    note = ''
    if part and s.get('cut'):
        i0, i1 = int(s['cut'][0] * SR), int(s['cut'][1] * SR)
        seg = a[i0:i1].copy()
        f = int(0.012 * SR)
        seg[:f] *= np.linspace(0, 1, f)
        seg[-int(0.06 * SR):] *= np.linspace(1, 0, int(0.06 * SR))
        a = seg
        note = f"  [cut by hand: {s['cut'][0]:.2f}-{s['cut'][1]:.2f} s]"
    elif part:
        frm, to, all_ = part
        b, rms, hop = breaks(a, all_)
        i0 = 0 if frm == 0 else b[frm - 1]
        i1 = len(a) if to == len(all_) else b[to - 1]
        # breathe: a hair before the first word, the echo's tail after the last
        i0 = max(0, i0 - int(0.03 * SR))
        i1 = min(len(a), i1 + int(0.10 * SR))
        seg = a[i0:i1].copy()
        f = int(0.012 * SR)
        seg[:f] *= np.linspace(0, 1, f)
        seg[-int(0.06 * SR):] *= np.linspace(1, 0, int(0.06 * SR))
        a = seg
        note = f"  [sentences {frm}..{to - 1} of {len(all_)}, {i0 / SR:.2f}-{i1 / SR:.2f} s]"
    write(OUT / 'vo' / f"{s['name']}.wav", a)
    print(f"{len(a) / SR:5.2f} s  {s['name']:<20} {l['key']} {l['fx']:<9} {s['text']}{note}")
    sub = {'name': f"sub-{s['name']}", 'kind': 'sub', 'who': s['who'], 'text': s['text']}
    if s.get('bot'):
        sub['bot'] = True
    subs.append(sub)
(OUT / 'vo-subs.json').write_text(json.dumps(subs, indent=1))
