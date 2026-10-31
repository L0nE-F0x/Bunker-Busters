"""Where the bars fall in a score stem. The music engine plays at a fixed 72 BPM but is generative
(Math.random), so every recording of a stem lands its bars somewhere new: this finds the beat grid's
phase from the onsets, then lists the bar downbeats with the strongest hits (a crash or a cue's
first chord: the places to cut a trailer on).

    ~/.local/share/bb-tts/venv/bin/python scripts/promo/beats.py <stem.wav> [more.wav ...]
"""
import sys
import wave

import numpy as np

BPM = 72
BEAT = 60 / BPM


def load(p):
    with wave.open(p) as w:
        sr, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
        a = np.frombuffer(w.readframes(n), '<i2').astype(np.float32) / 32768
    return a.reshape(-1, ch).mean(1), sr


def onsets(a, sr, hop=256, win=1024):
    """Spectral flux (positive log-magnitude change), one value per hop."""
    n = (len(a) - win) // hop
    fr = np.lib.stride_tricks.sliding_window_view(a, win)[::hop][:n] * np.hanning(win)
    mag = np.log1p(np.abs(np.fft.rfft(fr, axis=1)) * 10)
    flux = np.maximum(0, np.diff(mag, axis=0)).sum(1)
    return np.concatenate([[0], flux]), hop / sr


for p in sys.argv[1:]:
    a, sr = load(p)
    f, dt = onsets(a, sr)
    t = np.arange(len(f)) * dt
    # the beat grid's phase: the offset whose beat ticks collect the most onset energy
    best, phase = -1, 0.0
    for ph in np.arange(0, BEAT, 0.005):
        ticks = np.round((np.arange(ph, t[-1], BEAT)) / dt).astype(int)
        s = f[ticks[ticks < len(f)]].sum()
        if s > best:
            best, phase = s, ph
    beats = np.arange(phase, t[-1], BEAT)
    # which of the four beats is the downbeat: the one whose ticks are strongest on average
    strength = [f[np.round(beats[k::4] / dt).astype(int).clip(0, len(f) - 1)].mean() for k in range(4)]
    k0 = int(np.argmax(strength))
    downs = beats[k0::4]
    hits = [(d, f[max(0, int(d / dt) - 2):int(d / dt) + 3].max()) for d in downs]
    top = sorted(hits, key=lambda x: -x[1])[:8]
    print(f'{p}: {len(a) / sr:.1f} s, beat phase {phase:.3f} s, downbeat = beat {k0}, first downbeat {downs[0]:.3f} s')
    print('  strongest downbeats:', ', '.join(f'{d:.3f}' for d, _ in sorted(top)))
