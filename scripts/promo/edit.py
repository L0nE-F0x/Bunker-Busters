"""A small non-linear editor for the promo cuts: a timeline of shots (captured clips with their own
game audio), black, overlays (cards, subtitles, labels) and sounds (score stems, voice, sound
design), rendered with one ffmpeg graph for the picture and numpy for the mix (music ducked under
voices, a peak limiter, loudness-normalised to -14 LUFS for social).

Used by scripts/promo/cuts.py; run with the Kokoro venv's python (it has numpy):
    ~/.local/share/bb-tts/venv/bin/python scripts/promo/cuts.py <media dir> <out dir> [cut...]
"""
import json
import subprocess
import wave
from pathlib import Path

import numpy as np

SR = 48000
FPS = 60
W, H = 1920, 1080


def read_wav(p):
    with wave.open(str(p)) as w:
        n, ch, sr = w.getnframes(), w.getnchannels(), w.getframerate()
        a = np.frombuffer(w.readframes(n), dtype='<i2').astype(np.float32) / 32768
    a = a.reshape(-1, ch).T
    if ch == 1:
        a = np.vstack([a, a])
    assert sr == SR, f'{p}: {sr} Hz'
    return a


def write_wav(p, a):
    pcm = (np.clip(a, -1, 1) * 32767).astype('<i2').T.copy()
    with wave.open(str(p), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def db(x):
    return 10 ** (x / 20)


class Cut:
    def __init__(self, name, media, footage_dirs, overlays, audio):
        self.name = name
        self.media = Path(media)
        self.footage = [Path(d) for d in footage_dirs]
        self.ov_dir = Path(overlays)
        self.audio_dir = Path(audio)
        self.segs = []      # sequential picture
        self.overlays = []  # absolute-time PNG overlays
        self.sounds = []    # absolute-time audio events
        self.t = 0.0
        self.marks = {}

    # ------------------------------------------------------------------ picture
    def clip_path(self, name):
        for d in self.footage:
            p = d / f'{name}.mp4'
            if p.exists():
                return p
        raise FileNotFoundError(name)

    def shot(self, clip, dur, src=0.0, gain=0.0, fade_in=0.0, fade_out=0.0, mark=None, audio=True, afade=0.04, speed=1.0, zoom=None, look=None):
        """A piece of a captured clip; its game audio comes along at `gain` dB."""
        at = self.t
        self.segs.append(dict(kind='clip', clip=str(self.clip_path(clip)), src=src, dur=dur, fade_in=fade_in, fade_out=fade_out, speed=speed, zoom=zoom, look=look))
        wavp = self.clip_path(clip).with_suffix('.wav')
        if audio and wavp.exists():
            self.sounds.append(dict(wav=str(wavp), at=at, src=src, dur=dur * speed, gain=gain, fade_in=max(afade, fade_in), fade_out=max(afade, fade_out), bus='fx', speed=speed))
        if mark:
            self.marks[mark] = at
        self.t += dur
        return at

    def black(self, dur, mark=None):
        at = self.t
        self.segs.append(dict(kind='black', dur=dur))
        if mark:
            self.marks[mark] = at
        self.t += dur
        return at

    def overlay(self, png, at, dur, fade_in=0.2, fade_out=0.3, push=0.0, flicker=0.0, full=False):
        """A transparent PNG over the picture from `at` for `dur` s. push: scale from 1+push down to 1."""
        p = png if str(png).startswith('/') else self.ov_dir / f'{png}.png'
        self.overlays.append(dict(png=str(p), at=at, dur=dur, fade_in=fade_in, fade_out=fade_out, push=push, flicker=flicker))

    def flash(self, at, dur=0.35, color='white'):
        self.overlays.append(dict(color=color, at=at, dur=dur))

    # ------------------------------------------------------------------ sound
    def sound(self, wav, at, gain=0.0, src=0.0, dur=None, fade_in=0.0, fade_out=0.0, bus='fx'):
        p = wav if str(wav).startswith('/') else self.audio_dir / f'{wav}.wav'
        self.sounds.append(dict(wav=str(p), at=at, src=src, dur=dur, gain=gain, fade_in=fade_in, fade_out=fade_out, bus=bus, speed=1.0))

    def vo(self, name, at, gain=0.0, src=0.0, dur=None, sub=None, sub_pad=0.35):
        """A voice line (ducks the music), with its subtitle card for as long as it plays."""
        p = self.audio_dir / 'vo' / f'{name}.wav'
        a = read_wav(p)
        length = (a.shape[1] / SR - src) if dur is None else dur
        self.sounds.append(dict(wav=str(p), at=at, src=src, dur=length, gain=gain, fade_in=0.01, fade_out=0.05, bus='vo', speed=1.0))
        if sub:
            self.overlay(sub, at - 0.05, length + sub_pad, fade_in=0.12, fade_out=0.2)
        return at + length

    # ------------------------------------------------------------------ render
    def mix(self, out):
        total = int(self.t * SR) + SR
        buses = {k: np.zeros((2, total), np.float32) for k in ('fx', 'music', 'vo', 'sfx')}
        for s in self.sounds:
            a = read_wav(s['wav'])
            i0 = int(s['src'] * SR)
            n = a.shape[1] - i0 if s['dur'] is None else int(s['dur'] * SR)
            seg = a[:, i0:i0 + n].copy()
            if s.get('speed', 1.0) != 1.0:  # slow motion: resample (pitch drops, like tape)
                k = s['speed']
                idx = np.arange(0, seg.shape[1], k)
                seg = np.stack([np.interp(idx, np.arange(seg.shape[1]), seg[c]) for c in range(2)]).astype(np.float32)
            n = seg.shape[1]
            if n <= 0:
                continue
            env = np.ones(n, np.float32)
            fi, fo = int(s['fade_in'] * SR), int(s['fade_out'] * SR)
            if fi:
                env[:min(fi, n)] = np.linspace(0, 1, min(fi, n))
            if fo:
                env[-min(fo, n):] *= np.linspace(1, 0, min(fo, n))
            seg *= env * db(s['gain'])
            j = int(s['at'] * SR)
            if j < 0:
                seg, j = seg[:, -j:], 0
            m = min(seg.shape[1], total - j)
            buses[s['bus']][:, j:j + m] += seg[:, :m]
        # duck the score (and a little of the world) under speech
        v = np.abs(buses['vo']).max(0)
        k = int(0.05 * SR)
        talk = np.convolve((v > 0.01).astype(np.float32), np.ones(k) / k, mode='same') > 0
        g = np.where(talk, db(-7), 1.0).astype(np.float32)
        a_, r_ = np.exp(-1 / (0.06 * SR)), np.exp(-1 / (0.45 * SR))
        sm = np.empty_like(g)
        s_ = 1.0
        for i in range(len(g)):  # one-pole smoothing, fast down, slow up
            c = a_ if g[i] < s_ else r_
            s_ = c * s_ + (1 - c) * g[i]
            sm[i] = s_
        fxg = 1 - (1 - sm) * 0.45
        # the game's own sound: a gentle compressor (3:1 over -24 dBFS RMS) so gunfire doesn't bury the lines
        fx = buses['fx']
        win = int(0.03 * SR)
        rms = np.sqrt(np.convolve((fx ** 2).mean(0), np.ones(win) / win, mode='same') + 1e-12)
        over = np.maximum(0, 20 * np.log10(rms) + 24)
        comp = db(-over * (1 - 1 / 3)).astype(np.float32)
        mix = buses['music'] * sm + fx * comp * fxg * db(-1.5) + buses['vo'] * db(4.5) + buses['sfx']
        # loudness to -14 LUFS (measured by ffmpeg), then a look-ahead peak limiter at -1 dBFS
        tmp = Path(out).with_suffix('.pre.wav')
        write_wav(tmp, mix / max(1e-6, np.abs(mix).max()) * 0.5)
        r = subprocess.run(['ffmpeg', '-nostats', '-i', str(tmp), '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
        I = float([l for l in r.splitlines() if l.strip().startswith('I:')][-1].split()[1])
        mix = mix / max(1e-6, np.abs(mix).max()) * 0.5 * db(-14.0 - I)
        ceil = db(-1.0)
        peak = np.abs(mix).max(0)
        la = int(0.004 * SR)
        from numpy.lib.stride_tricks import sliding_window_view
        pk = np.concatenate([sliding_window_view(np.concatenate([peak, np.zeros(la)]), la + 1).max(1)])[:len(peak)]
        need = np.minimum(1.0, ceil / np.maximum(pk, 1e-9))
        gr = np.empty_like(need)
        s_ = 1.0
        rel = np.exp(-1 / (0.12 * SR))
        for i in range(len(need)):
            s_ = need[i] if need[i] < s_ else rel * s_ + (1 - rel) * need[i]
            gr[i] = s_
        mix = mix * gr
        tmp.unlink()
        write_wav(out, mix[:, :int(self.t * SR)])
        print(f'  mix: integrated before {I:.1f} LUFS, limiter max reduction {20 * np.log10(gr.min() + 1e-9):.1f} dB')

    def render(self, out_dir, grade=True, crf=17):
        out_dir = Path(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        wav = out_dir / f'{self.name}.wav'
        self.mix(wav)
        args = ['ffmpeg', '-y', '-loglevel', 'error']
        fc = []
        n_in = 0
        labels = []
        for i, s in enumerate(self.segs):
            if s['kind'] == 'black':
                fc.append(f'color=c=black:s={W}x{H}:r={FPS}:d={s["dur"]:.4f},format=yuv420p,setsar=1[s{i}]')
            else:
                need = s['dur'] * s['speed']
                args += ['-ss', f'{s["src"]:.4f}', '-t', f'{need + 0.1:.4f}', '-i', s['clip']]
                chain = f'[{n_in}:v]setpts=PTS-STARTPTS'
                if s['speed'] != 1.0:
                    chain += f',setpts=PTS/{s["speed"]}'
                chain += f',fps={FPS},trim=duration={s["dur"]:.4f},setpts=PTS-STARTPTS'
                if s.get('zoom'):
                    z0, z1 = s['zoom']
                    chain += (f",scale=w='trunc({W}*({z0}+({z1}-{z0})*t/{s['dur']:.4f})/2)*2':h=-2:eval=frame,crop={W}:{H}")
                chain += f',scale={W}:{H},setsar=1'
                if s.get('look'):
                    chain += ',' + s['look']
                chain += ',format=yuv420p'
                if s['fade_in']:
                    chain += f',fade=t=in:st=0:d={s["fade_in"]}'
                if s['fade_out']:
                    chain += f',fade=t=out:st={s["dur"] - s["fade_out"]:.4f}:d={s["fade_out"]}'
                fc.append(chain + f'[s{i}]')
                n_in += 1
            labels.append(f'[s{i}]')
        fc.append(''.join(labels) + f'concat=n={len(labels)}:v=1:a=0[base]')
        cur = 'base'
        for j, o in enumerate(self.overlays):
            if 'color' in o:
                d = o['dur']
                fc.append(f'color=c={o["color"]}:s={W}x{H}:r={FPS}:d={d:.4f},format=rgba,'
                          f"colorchannelmixer=aa=1,fade=t=out:st=0:d={d:.4f}:alpha=1,setpts=PTS-STARTPTS+{o['at']:.4f}/TB[o{j}]")
            else:
                args += ['-loop', '1', '-framerate', str(FPS), '-t', f'{o["dur"]:.4f}', '-i', o['png']]
                chain = f'[{n_in}:v]format=rgba'
                if o['push']:
                    p = o['push']
                    chain += f",scale=w='trunc({W}*(1+{p}*(1-min(t/{o['dur']:.3f},1)))/2)*2':h=-2:eval=frame"
                if o['fade_in']:
                    chain += f',fade=t=in:st=0:d={o["fade_in"]}:alpha=1'
                if o['fade_out']:
                    chain += f',fade=t=out:st={max(0, o["dur"] - o["fade_out"]):.4f}:d={o["fade_out"]}:alpha=1'
                if o['flicker']:
                    f = o['flicker']
                    chain += f",geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*if(lt(T,{f}),gt(mod(N,4),1),1)'"
                chain += f",setpts=PTS-STARTPTS+{o['at']:.4f}/TB[o{j}]"
                fc.append(chain)
                n_in += 1
            fc.append(f"[{cur}][o{j}]overlay=x='(W-w)/2':y='(H-h)/2':eof_action=pass:format=auto[v{j}]")
            cur = f'v{j}'
        post = 'format=yuv420p'
        if grade:
            # a light finishing grade: a touch of contrast and warmth, the blacks kept off zero
            post = "eq=contrast=1.06:saturation=1.08:gamma=1.04,colorbalance=rs=0.015:bs=-0.02:rh=0.01:bh=-0.015,format=yuv420p"
        fc.append(f'[{cur}]{post}[vout]')
        graph = out_dir / f'{self.name}.graph.txt'
        graph.write_text(';\n'.join(fc))
        args += ['-i', str(wav), '-/filter_complex', str(graph), '-map', '[vout]', '-map', f'{n_in}:a',
                 '-c:v', 'libx264', '-preset', 'slow', '-crf', str(crf), '-maxrate', '22M', '-bufsize', '44M', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
                 '-r', str(FPS), '-g', str(FPS * 2), '-bf', '2', '-movflags', '+faststart',
                 '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-t', f'{self.t:.4f}', str(out_dir / f'{self.name}.mp4')]
        print(f'  rendering {self.name}: {self.t:.2f} s, {len(self.segs)} segments, {len(self.overlays)} overlays')
        subprocess.run(args, check=True)
        (out_dir / f'{self.name}.edl.json').write_text(json.dumps(dict(marks=self.marks, length=self.t, segs=self.segs, overlays=self.overlays, sounds=self.sounds), indent=1))
        return out_dir / f'{self.name}.mp4'
