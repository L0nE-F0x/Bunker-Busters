"""Trailer sound design, synthesised (no samples): impacts, sub drops, braams, risers, whooshes,
glitch stingers and a low drone, tuned to the score (D minor). 48 kHz stereo WAVs.

    ~/.local/share/bb-tts/venv/bin/python scripts/promo/sfx.py <outdir>
"""
import sys
import wave
from pathlib import Path

import numpy as np

SR = 48000
rng = np.random.default_rng(7)
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
OUT.mkdir(parents=True, exist_ok=True)

D1, D2, A1, A2, D3, F2 = 36.71, 73.42, 55.0, 110.0, 146.83, 87.31


def t_(dur):
    return np.arange(int(dur * SR)) / SR


def noise(n):
    return rng.standard_normal(n)


def onepole_lp(x, fc):
    """One-pole lowpass; fc may be an array (per sample)."""
    fc = np.broadcast_to(np.asarray(fc, dtype=float), x.shape)
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x)
    s = 0.0
    for i in range(len(x)):
        s = (1 - a[i]) * x[i] + a[i] * s
        y[i] = s
    return y


def biquad(x, kind, fc, q=0.707):
    """RBJ biquad with a per-sample cutoff (array or scalar)."""
    n = len(x)
    fc = np.broadcast_to(np.asarray(fc, dtype=float), (n,))
    y = np.zeros(n)
    x1 = x2 = y1 = y2 = 0.0
    for i in range(n):
        w = 2 * np.pi * min(fc[i], SR * 0.45) / SR
        cw, sw = np.cos(w), np.sin(w)
        al = sw / (2 * q)
        if kind == 'lp':
            b0, b1, b2 = (1 - cw) / 2, 1 - cw, (1 - cw) / 2
        elif kind == 'hp':
            b0, b1, b2 = (1 + cw) / 2, -(1 + cw), (1 + cw) / 2
        else:  # band-pass (constant peak)
            b0, b1, b2 = al, 0.0, -al
        a0, a1, a2 = 1 + al, -2 * cw, 1 - al
        v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0
        x2, x1, y2, y1 = x1, x[i], y1, v
        y[i] = v
    return y


def fft_conv(x, ir):
    n = len(x) + len(ir) - 1
    N = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, N) * np.fft.rfft(ir, N), N)[:n]


def reverb(st, seconds=2.5, wet=0.3, damp=4000):
    """Stereo reverb: decorrelated decaying-noise impulse per channel."""
    n = int(seconds * SR)
    env = np.exp(-np.arange(n) / SR * (6.9 / seconds))
    out = []
    for ch in range(2):
        ir = onepole_lp(noise(n), damp) * env
        ir[: int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
        ir /= np.sqrt(np.sum(ir ** 2)) + 1e-9
        out.append(fft_conv(st[ch], ir))
    L = max(len(o) for o in out)
    wetsig = np.stack([np.pad(o, (0, L - len(o))) for o in out])
    dry = np.pad(st, ((0, 0), (0, L - st.shape[1])))
    return dry * (1 - wet) + wetsig * wet * 1.6


def stereo(m, width=0.0):
    if width <= 0:
        return np.stack([m, m])
    d = int(width * SR)
    return np.stack([m, np.concatenate([np.zeros(d), m[:-d]])])


def norm(st, peak=0.89):
    return st * (peak / (np.max(np.abs(st)) + 1e-9))


def save(name, st, peak=0.89):
    st = norm(np.asarray(st), peak)
    fade = int(0.02 * SR)
    st[:, -fade:] *= np.linspace(1, 0, fade)
    pcm = (np.clip(st, -1, 1) * 32767).astype('<i2').T.copy()
    with wave.open(str(OUT / f'{name}.wav'), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print('wrote', name, f'{st.shape[1] / SR:.2f}s')


def osc_sine(f, dur):
    f = np.broadcast_to(np.asarray(f, dtype=float), (int(dur * SR),))
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def osc_saw(f, dur):
    f = np.broadcast_to(np.asarray(f, dtype=float), (int(dur * SR),))
    ph = np.cumsum(f) / SR
    return 2 * (ph - np.floor(ph + 0.5))


# ---------------------------------------------------------------- impacts
def impact(dur=3.6, low=46.0, drop=70.0, metal=0.18, crack=0.5, room=0.32):
    t = t_(dur)
    sub = osc_sine(low + drop * np.exp(-t * 16), dur) * np.exp(-t * 1.9)
    body = biquad(noise(len(t)), 'lp', 380.0 + 2600 * np.exp(-t * 25)) * np.exp(-t * 11) * 1.4
    snap = biquad(noise(len(t)), 'hp', 2500.0) * np.exp(-t * 70) * crack
    parts = [117.0, 181.0, 263.0, 377.0, 512.0, 701.0, 1033.0]
    ring = sum(np.sin(2 * np.pi * p * t + rng.uniform(0, 6)) * np.exp(-t * (2.0 + i * 0.7)) / (1 + i * 0.6) for i, p in enumerate(parts))
    m = np.tanh(1.6 * (sub * 1.2 + body + snap + ring * metal))
    return reverb(stereo(m, 0.0007), seconds=3.2, wet=room, damp=3500)


def subdrop(dur=4.5):
    t = t_(dur)
    f = 28 + 72 * np.exp(-t * 2.4)
    m = np.tanh(2.2 * osc_sine(f, dur) * np.exp(-t * 0.9))
    m += biquad(noise(len(t)), 'lp', 120.0) * np.exp(-t * 6) * 0.6
    return reverb(stereo(m), seconds=2.0, wet=0.15, damp=900)


def braam(dur=4.2, root=D1):
    t = t_(dur)
    voices = []
    for mult, g in [(1, 1.0), (2, 0.8), (3, 0.45), (4, 0.4), (6, 0.2)]:
        for det in (-0.004, 0.0, 0.0045):
            voices.append(osc_saw(root * mult * (1 + det), dur) * g)
    m = sum(voices) / len(voices) * 3
    env = np.minimum(1, t / 0.06) * np.exp(-np.maximum(0, t - 0.35) * 0.9)
    cut = 180 + 2400 * np.exp(-t * 1.6) * np.minimum(1, t / 0.12)
    m = biquad(m * env, 'lp', cut, q=1.4)
    m = np.tanh(2.4 * m)
    m += osc_sine(root, dur) * env * 0.5  # sub weight
    return reverb(stereo(m, 0.0011), seconds=3.5, wet=0.33, damp=2800)


# ---------------------------------------------------------------- movement
def riser(dur=3.0, f0=300.0, f1=7000.0):
    t = t_(dur)
    k = t / dur
    cut = f0 * (f1 / f0) ** (k ** 1.6)
    n = biquad(noise(len(t)), 'bp', cut, q=2.2) * 3
    glide = osc_sine(90 * (8 ** (k ** 1.5)), dur) * 0.35
    trem = 0.75 + 0.25 * np.sin(2 * np.pi * np.cumsum(4 + 22 * k ** 2) / SR)
    m = (n + glide) * (k ** 2.2) * trem
    m[-int(0.004 * SR):] *= np.linspace(1, 0, int(0.004 * SR))
    st = reverb(stereo(m, 0.0009), seconds=1.6, wet=0.25, damp=6000)
    return st[:, : len(t)]  # ends hard on the cut


def whoosh(dur=0.9):
    t = t_(dur)
    k = t / dur
    env = np.sin(np.pi * np.minimum(1, k * 1.15)) ** 2
    m = biquad(noise(len(t)), 'bp', 400 * (12 ** np.sin(np.pi * k)), q=1.3) * env * 2
    pan = np.clip(k * 1.4 - 0.2, 0, 1)
    st = np.stack([m * np.cos(pan * np.pi / 2), m * np.sin(pan * np.pi / 2)])
    return reverb(st, seconds=1.2, wet=0.2, damp=5000)


def reverse_swell(dur=1.6):
    hit = impact(dur=2.4, metal=0.25, room=0.6)
    st = hit[:, : int(dur * SR)][:, ::-1].copy()
    k = np.linspace(0, 1, st.shape[1]) ** 1.5
    return st * k


# ---------------------------------------------------------------- texture
def glitch(dur=0.42):
    n = int(dur * SR)
    m = np.zeros(n)
    i = 0
    while i < n:
        seg = int(rng.uniform(0.008, 0.045) * SR)
        kind = rng.integers(0, 4)
        tt = np.arange(seg) / SR
        if kind == 0:
            s = np.sign(np.sin(2 * np.pi * rng.uniform(300, 2400) * tt))
        elif kind == 1:
            s = noise(seg)
            s = np.round(s * 3) / 3
        elif kind == 2:
            s = np.sin(2 * np.pi * rng.uniform(80, 200) * tt) * (np.sin(2 * np.pi * 60 * tt) > 0)
        else:
            s = np.zeros(seg)
        hold = int(rng.integers(1, 8))
        s = np.repeat(s[::hold], hold)[:seg]
        m[i:i + seg] = s[: n - i] * rng.uniform(0.4, 1)
        i += seg
    m = biquad(m, 'hp', 160.0) * np.exp(-np.arange(n) / SR * 4)
    return reverb(stereo(m, 0.0004), seconds=0.9, wet=0.18, damp=7000)


def drone(dur=24.0):
    t = t_(dur)
    m = np.zeros(len(t))
    for f, g, lfo in [(D1, 1.0, 0.07), (A1, 0.55, 0.11), (D2, 0.5, 0.05), (F2, 0.22, 0.13), (A2, 0.2, 0.09)]:
        m += osc_sine(f * (1 + 0.002 * np.sin(2 * np.pi * lfo * t)), dur) * g * (0.75 + 0.25 * np.sin(2 * np.pi * lfo * 0.7 * t + f))
    air = biquad(noise(len(t)), 'bp', 700 + 400 * np.sin(2 * np.pi * 0.05 * t), q=0.8) * 0.25
    m = np.tanh(0.9 * (m * 0.5 + air))
    env = np.minimum(1, t / 3.0) * np.minimum(1, (dur - t) / 2.0)
    return reverb(stereo(m * env, 0.0013), seconds=4, wet=0.35, damp=1500)


def tick(dur=0.25):
    t = t_(dur)
    m = biquad(noise(len(t)), 'bp', 3200.0, q=6) * np.exp(-t * 90) * 2 + osc_sine(1800.0, dur) * np.exp(-t * 120) * 0.4
    return reverb(stereo(m), seconds=0.8, wet=0.25, damp=7000)


def heartbeat_kick(dur=0.6):
    t = t_(dur)
    m = np.tanh(2 * osc_sine(42 + 60 * np.exp(-t * 30), dur) * np.exp(-t * 7))
    return stereo(m)


if __name__ == '__main__':
    save('impact', impact())
    save('impact-metal', impact(low=52, drop=90, metal=0.45, crack=0.8, room=0.38))
    save('impact-soft', impact(dur=3.0, low=40, drop=40, metal=0.08, crack=0.15, room=0.45), peak=0.7)
    save('subdrop', subdrop())
    save('braam', braam())
    save('braam-a', braam(root=A1 / 2 * 1.0 + 0.0))
    for d in (1.5, 2.5, 4.0):
        save(f'riser-{d}', riser(d))
    save('whoosh', whoosh())
    save('reverse-swell', reverse_swell())
    save('glitch', glitch())
    save('glitch-long', glitch(0.8))
    save('drone', drone())
    save('tick', tick())
    save('heartbeat', heartbeat_kick())
