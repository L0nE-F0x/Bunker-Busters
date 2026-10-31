"""The v1.0 launch cuts (NOTES 2026-10-31): the launch trailer (1080p60 to upload, and a 2560×1440
master), teasers of 15 s and 30 s in 16:9 and 9:16, and the short loops. Times are seconds; the
fight act is cut on the fight stem's 72 BPM grid (bars measured with beats.py, since every
recording of the generative score lands its bars somewhere new).

    ~/.local/share/bb-tts/venv/bin/python scripts/promo/cuts-v1.py <work dir> <out dir> [cut...]
      cuts: trailer trailer-1440 teaser15 teaser30 teaser15-v teaser30-v loops (default: all but loops)

<work dir> holds footage/ (1440p takes + game audio), footage-v/ (native 9:16 takes, preferred for
9:16 cuts), overlays/ (1080p), overlays-1440/, overlays-v/ (9:16), audio/ (music-*.wav, vo/, sfx/).
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from edit import Cut  # noqa: E402

WORK = Path(sys.argv[1])
OUT = Path(sys.argv[2])
WANT = set(sys.argv[3:]) or {'trailer', 'trailer-1440', 'teaser15', 'teaser30', 'teaser15-v', 'teaser30-v'}
BEAT = 60 / 72
# bar downbeats in this recording of the stems (beats.py; see music.json written next to them)
MUSIC = json.loads((WORK / 'audio' / 'music.json').read_text()) if (WORK / 'audio' / 'music.json').exists() else {}
TITLE_DOWN = MUSIC.get('title', 0.0)
FIGHT_DOWN = MUSIC.get('fight', 0.0)
TENSION_DOWN = MUSIC.get('tension', 0.0)
CAMP_DOWN = MUSIC.get('camp', 0.0)
WOLF = 'eq=gamma=1.3:contrast=1.05:saturation=1.1'  # the dusk wolf shots run dark
DUSK = 'eq=gamma=1.18:saturation=1.06'  # the Fortress under the range at dusk, a little lift
FMT = {
    '1080': ((1920, 1080), 'overlays', ['footage']),
    '1440': ((2560, 1440), 'overlays-1440', ['footage']),
    'v': ((1080, 1920), 'overlays-v', ['footage-v', 'footage']),
}


def new(name, fmt='1080'):
    size, ov, dirs = FMT[fmt]
    c = Cut(name, WORK, [WORK / d for d in dirs], WORK / ov, WORK / 'audio', size=size)
    c.fmt = fmt
    return c


# Takes whose game audio has someone talking (the free camera's stand-in body sets off the owners'
# greetings, and whisper found them): their sound would talk over the cut's own subtitled lines, so
# they run silent on a bed of wind from a take with nobody in it.
SPEECH = {'pan-sweep', 'garage-night', 'dome-night', 'dome-inside', 'cath-tower2', 'fort-bridge-down',
          'h-lockpick', 'h-splice', 'h-sentinel', 'p-ezra', 'blast-tp', 'shotgun'}  # (h-swarm, rifle-c and
# contractor-close only talk early on: their windows start after)
NIGHT_BED, DAY_BED = 'pan-valley', 'apex-crane'
NIGHT_TAKES = {'pan-sweep', 'garage-night', 'dome-night', 'dome-inside', 'h-lockpick', 'h-splice', 'p-ezra'}


def S(c, clip, dur, src=0.0, cx=0.5, zoom=None, zv=None, **kw):
    """A shot; `cx` places the 9:16 window (ignored at 16:9), `zv` is the zoom for 9:16 cuts."""
    quiet = clip in SPEECH
    if quiet:
        kw['audio'] = False
    if c.fmt == 'v':
        at = c.shot(clip, dur, src=src, cx=cx, zoom=zv, **kw)
    else:
        at = c.shot(clip, dur, src=src, zoom=zoom, **kw)
    if quiet:
        bed = NIGHT_BED if clip in NIGHT_TAKES else DAY_BED
        c.sound(str(WORK / 'footage' / f'{bed}.wav'), at, src=0.5, dur=dur, gain=kw.get('gain', -6), fade_in=0.05, fade_out=0.05)
    return at


def card(c, png, dur, hit='impact', gain=-3.0):
    """A title card on black, slammed in with an impact and a glitch."""
    at = c.black(dur)
    c.overlay(png, at, dur, fade_in=0.06, fade_out=0.18, push=0.07, flicker=0.14)
    c.sound(f'sfx/{hit}', at, gain=gain)
    c.sound('sfx/glitch', at, gain=-9)
    return at


def label(c, name, at, dur=2.4):
    c.overlay(f'label-{name}', at + 0.2, dur, fade_in=0.25, fade_out=0.4)


def endcard(c, clip='nightsky', src=0.4, dur=6.5):
    t = S(c, clip, dur, src=src, gain=-8, fade_in=0.4, fade_out=0.5, cx=0.5)
    c.overlay('end', t + 0.3, dur - 0.3, fade_in=0.35, fade_out=0.01, push=0.04)
    c.sound('sfx/braam', t + 0.25, gain=-3)
    c.sound('sfx/impact', t + 0.25, gain=-6)
    return t


def trailer(fmt='1080'):
    c = new('trailer' if fmt == '1080' else f'trailer-{fmt}', fmt)
    # ---- cold open: the Panopticon's lamp comes round onto you; Ezra on the PA
    c.sound('sfx/drone', 0.0, gain=-11, fade_in=1.5, dur=24, fade_out=3)
    t = S(c, 'pan-sweep', 5.0, src=1.2, gain=-5, fade_in=0.5)
    c.vo('ezra-cameras', t + 0.25, sub='sub-ezra-cameras')
    card(c, 'card-built', 1.6)
    # ---- the world, under the main theme
    t = S(c, 'apex-rocket', 4.2, src=0.6, gain=-6)
    c.sound('music-title', t, src=TITLE_DOWN, dur=19.0, gain=-1, fade_in=0.4, fade_out=1.2, bus='music')
    c.vo('hunter-market', t + 0.3, sub='sub-hunter-market')
    S(c, 'vista', 3.0, src=2.2, gain=-7)
    card(c, 'card-water', 1.6)
    t = S(c, 'camp-gold', 3.6, src=1.0, gain=-6, cx=0.72)
    label(c, 'camp', t, 2.8)
    t = S(c, 'creek-dusk', 3.0, src=1.4, gain=-6, cx=0.45)
    label(c, 'creek', t, 2.4)
    t = card(c, 'card-lockpicks', 1.6, hit='impact-metal')
    # ---- the bunkers, under the tension pulse; each owner on the PA
    c.sound('music-tension', c.t, src=TENSION_DOWN, dur=36.0, gain=-3, fade_in=0.6, fade_out=0.8, bus='music')
    t = S(c, 'garage-night', 3.0, src=2.0, gain=-6)
    label(c, 'garage', t, 2.6)
    c.vo('tanner-runway', t + 0.1, sub='sub-tanner-runway')
    S(c, 'h-lockpick', 2.4, src=2.6, gain=-3, zoom=(1.72, 1.8))
    t = S(c, 'apex-crane', 2.8, src=2.6, gain=-6, cx=0.62)
    label(c, 'apex', t, 2.5)
    c.vo('vesper-live', t + 0.1, sub='sub-vesper-live')
    t = S(c, 'pan-valley', 2.8, src=3.0, gain=-6)
    label(c, 'panopticon', t, 2.5)
    S(c, 'p-ezra', 2.2, src=2.0, gain=-6, cx=0.5)
    t = S(c, 'spire-court', 2.8, src=2.0, gain=-6)
    label(c, 'spire', t, 2.5)
    t = S(c, 'h-sentinel', 2.8, src=1.6, gain=-2, cx=0.52, look=DUSK)
    c.vo('sentinel-apology', t, sub='sub-sentinel-apology')
    t = S(c, 'dome-night', 2.8, src=2.4, gain=-6)
    label(c, 'dome', t, 2.5)
    t = S(c, 'dome-inside', 2.6, src=3.0, gain=-5)
    c.vo('beta-fix', t + 0.1, sub='sub-beta-fix')
    S(c, 'h-splice', 2.3, src=2.0, gain=-3, zoom=(1.58, 1.66))
    t = S(c, 'cath-tower2', 2.8, src=2.5, gain=-6, cx=0.45)
    label(c, 'cathedral', t, 2.5)
    t = S(c, 'h-swarm', 3.2, src=3.6, gain=-2)
    c.vo('drone-hold', t, sub='sub-drone-hold')
    t = S(c, 'fort-crane', 2.6, src=2.0, gain=-6)
    label(c, 'fortress', t, 2.4)
    c.vo('kit-queue', t + 0.1, sub='sub-kit-queue')
    S(c, 'fort-bridge-down', 2.6, src=0.0, gain=-4, cx=0.6, look=DUSK)
    c.sound('sfx/riser-2.5', c.t - 2.5, gain=-6)
    # ---- the fight, on the fight stem's beat
    T = c.t
    card(c, 'card-rifle', 2 * BEAT, hit='braam', gain=-1)
    c.sound('sfx/subdrop', T, gain=-6)
    c.sound('music-fight', T, src=FIGHT_DOWN, dur=14 * BEAT + 0.05, gain=0, fade_out=0.05, bus='music')
    # (each window starts after the take's own bark: whisper's word timings)
    t = S(c, 'contractor-close', 2 * BEAT, src=5.05, gain=-2)
    c.vo('kade-asset', t + 0.1, sub='sub-kade-asset')
    t = S(c, 'rifle-c', 4 * BEAT, src=3.0, gain=0)
    c.vo('kade-waiver', t + 1.0, sub='sub-kade-waiver')
    S(c, 'wolves-charge', 3 * BEAT, src=1.1, gain=0, look=WOLF, cx=0.62)
    t = S(c, 'blast-tp', 3 * BEAT, src=0.0, gain=-4)  # (its bark covers the blast: silent, a boom instead)
    c.vo('kade-fire', t + 0.0, sub='sub-kade-fire')
    c.sound('sfx/impact', t + 0.95, gain=-2)
    c.sound('sfx/subdrop', t + 0.95, gain=-6)
    # ---- the cut to black, then Bunker Zero: the tease
    # Agnes starts over the black ("It isn't locked."); the showroom comes up under "It never was.";
    # "It's just heavy." lands as Model Zero starts to swing (4.3 s into the take), and we cut
    # before the hall behind it shows (it's wide open by 4.6 s)
    t = c.black(1.1)
    c.sound('sfx/impact', t, gain=0)
    c.sound('sfx/subdrop', t, gain=-4)
    c.vo('agnes-heavy', t + 0.5, sub='sub-agnes-heavy', sub_pad=0.05)
    t = S(c, 'zero-door', 3.15, src=1.25, gain=-4, fade_in=0.4)
    label(c, 'zero', t, 2.6)
    c.sound('sfx/drone', t - 0.6, gain=-12, fade_in=1.0, dur=4.0, fade_out=0.3)
    t = c.black(0.6)
    c.sound('sfx/impact-metal', t, gain=-5)
    # ---- the end card
    t = endcard(c)
    c.sound('music-title', t + 0.25, src=TITLE_DOWN + 16 * BEAT, dur=6.2, gain=-3, fade_in=0.3, fade_out=1.6, bus='music')
    return c


def teaser15(fmt='1080'):
    c = new('teaser-15s-16x9' if fmt != 'v' else 'teaser-15s-9x16', fmt)
    c.sound('sfx/drone', 0, gain=-12, fade_in=0.8, dur=15, fade_out=1.5)
    c.sound('music-tension', 0.2, src=TENSION_DOWN, dur=10.4, gain=-3, fade_in=0.6, fade_out=0.4, bus='music')
    t = S(c, 'h-lockpick', 2.7, src=1.8, gain=-3, zoom=(1.72, 1.8), zv=None)
    c.vo('tanner-hold', t + 0.1, sub='sub-tanner-hold-top' if fmt == 'v' else 'sub-tanner-hold')  # (9:16: the lock fills the middle)
    t = S(c, 'apex-rocket', 2.6, src=1.0, gain=-6, cx=0.55)
    c.vo('vesper-live', t + 0.05, sub='sub-vesper-live')
    S(c, 'h-swarm', 1.6, src=4.2, gain=-2, cx=0.5)
    S(c, 'dome-inside', 1.4, src=3.6, gain=-5, cx=0.5)
    S(c, 'pan-valley', 1.3, src=3.4, gain=-6, cx=0.52)
    t = S(c, 'blast-tp', 1.4, src=0.5, gain=-4, cx=0.3)
    c.sound('sfx/riser-1.5', t - 0.1, gain=-7)
    c.sound('sfx/impact-soft', t + 0.45, gain=-4)  # the charge (the take's own sound has a bark over it)
    t = c.black(4.0)
    c.sound('sfx/impact', t, gain=-1)
    c.sound('sfx/subdrop', t, gain=-6)
    c.overlay('end', t + 0.1, 3.9, fade_in=0.12, fade_out=0.01, push=0.04, flicker=0.1)
    c.sound('sfx/glitch', t + 0.1, gain=-9)
    return c


def teaser30(fmt='1080'):
    c = new('teaser-30s-16x9' if fmt != 'v' else 'teaser-30s-9x16', fmt)
    c.sound('sfx/drone', 0, gain=-11, fade_in=1.0, dur=12, fade_out=2)
    t = S(c, 'pan-sweep', 5.0, src=1.2, gain=-5, fade_in=0.4, cx=0.5)
    c.vo('ezra-cameras', t + 0.2, sub='sub-ezra-cameras')
    card(c, 'card-built', 1.4)
    c.sound('music-tension', c.t, src=TENSION_DOWN, dur=17.2, gain=-3, fade_in=0.4, fade_out=0.6, bus='music')
    t = S(c, 'apex-rocket', 2.7, src=1.0, gain=-6, cx=0.55)
    c.vo('vesper-live', t + 0.05, sub='sub-vesper-live')
    S(c, 'h-lockpick', 2.0, src=3.0, gain=-3, zoom=(1.72, 1.8))
    t = S(c, 'spire-court', 2.2, src=2.0, gain=-6, cx=0.5)
    t = S(c, 'h-sentinel', 2.8, src=1.6, gain=-2, cx=0.52, look=DUSK)
    c.vo('sentinel-apology', t - 0.2, sub='sub-sentinel-apology')
    S(c, 'dome-inside', 1.8, src=3.2, gain=-5, cx=0.5)
    t = S(c, 'h-swarm', 2.6, src=3.4, gain=-2, cx=0.5)
    c.vo('drone-hold', t, sub='sub-drone-hold')
    S(c, 'fort-bridge-down', 1.8, src=0.0, gain=-4, cx=0.6, look=DUSK)
    t = S(c, 'rifle-c', 1.7, src=3.0, gain=0, cx=0.5)
    t = S(c, 'blast-tp', 1.5, src=0.5, gain=-4, cx=0.3)
    c.sound('sfx/impact-soft', t + 0.45, gain=-4)  # the charge
    c.sound('sfx/riser-1.5', c.t - 1.5, gain=-7)
    t = c.black(0.6)
    c.sound('sfx/impact', t, gain=-2)
    t = S(c, 'zero-door', 2.4, src=1.95, gain=-4, cx=0.5)
    c.overlay('label-zero', t + 0.1, 2.2, fade_in=0.2, fade_out=0.3)
    t = c.black(4.0)
    c.sound('sfx/braam', t, gain=-3)
    c.overlay('end', t + 0.1, 3.9, fade_in=0.15, fade_out=0.01, push=0.04)
    return c


# the loops: single moments for replies (≤ 10 s; loops.py squeezes them under 8 MB afterwards)
# name: (clip, src, dur, zoom, voice line, voice at, look)
LOOPS = {
    'loop-lockpick': ('h-lockpick', 0.5, 7.5, (1.66, 1.74), None, 0, None),
    'loop-splice': ('h-splice', 1.0, 6.8, (1.52, 1.56), None, 0, None),
    'loop-swarm': ('h-swarm', 2.7, 5.2, None, 'drone-hold', 0.4, None),
    'loop-wolves-dusk': ('wolves-charge', 0.5, 5.0, None, None, 0, WOLF),
    'loop-camp': ('camp-gold', 0.3, 6.5, None, None, 0, None),
    'loop-garage-night': ('garage-night', 2.0, 4.9, None, 'tanner-runway', 0.5, None),
    'loop-apex-rocket': ('apex-rocket', 0.8, 5.0, None, 'vesper-live', 0.8, None),
    'loop-panopticon-lamp': ('pan-sweep', 0.6, 6.2, None, 'ezra-cameras', 0.6, None),
    'loop-dome-hologram': ('dome-inside', 1.3, 5.5, None, 'beta-ship', 0.8, None),
    'loop-sentinel': ('h-sentinel', 0.6, 5.5, None, 'sentinel-apology', 0.9, DUSK),
    'loop-fortress-bridge': ('fort-bridge-down', 0.0, 6.6, None, 'kit-bridge', 0.5, DUSK),
    'loop-zero-door': ('zero-door', 0.15, 4.25, None, 'agnes-heavy', 0.0, None),
}


def loop(name):
    clip, src, dur, zoom, vo, at, look = LOOPS[name]
    c = new(name, '1080')
    S(c, clip, dur, src=src, gain=-3, zoom=zoom, look=look, fade_in=0.15, fade_out=0.2)
    if vo:
        c.vo(vo, at, sub=f'sub-{vo}')
    return c


CUTS = {
    **{n: (lambda n=n: loop(n)) for n in LOOPS},
    'trailer': lambda: trailer('1080'),
    'trailer-1440': lambda: trailer('1440'),
    'teaser15': lambda: teaser15('1080'),
    'teaser30': lambda: teaser30('1080'),
    'teaser15-v': lambda: teaser15('v'),
    'teaser30-v': lambda: teaser30('v'),
}

if 'loops' in WANT:
    WANT |= set(LOOPS)
for name, fn in CUTS.items():
    if name in WANT:
        c = fn()
        if name == 'trailer-1440':
            c.render(OUT, crf=14, maxrate='60M')
        else:
            c.render(OUT)
