"""The v0.5.6 promo cuts: the launch trailer and two teasers. Times are seconds; the fight act is
cut on the fight stem's beat grid (72 BPM; crash on a phrase downbeat at 10.41 s in music-fight).

    ~/.local/share/bb-tts/venv/bin/python scripts/promo/cuts.py <work dir> <out dir> [trailer|teaser|teaser2 ...]

<work dir> holds footage*/ (clips + game audio), overlays/ (PNGs), audio/ (music-*.wav, vo/, sfx/).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from edit import Cut  # noqa: E402

WORK = Path(sys.argv[1])
OUT = Path(sys.argv[2])
WANT = set(sys.argv[3:]) or {'trailer', 'teaser', 'teaser2'}
BEAT = 60 / 72
FIGHT_CRASH = 10.41     # a phrase downbeat (crash + brass) in music-fight.wav
TITLE_DOWN = 2.745      # a downbeat in music-title.wav
TENSION_DOWN = 0.0
WOLF = 'eq=gamma=1.32:contrast=1.05:saturation=1.12'  # the dusk wolf shots run dark


def new(name):
    return Cut(name, WORK, [WORK / 'footage5', WORK / 'footage4', WORK / 'footage2', WORK / 'footage3', WORK / 'footage'], WORK / 'overlays', WORK / 'audio')


def card(c, png, dur, hit='impact', gain=-3.0):
    """A title card on black, slammed in with an impact and a glitch."""
    at = c.black(dur)
    c.overlay(png, at, dur, fade_in=0.06, fade_out=0.18, push=0.07, flicker=0.14)
    c.sound(f'sfx/{hit}', at, gain=gain)
    c.sound('sfx/glitch', at, gain=-9)
    return at


def trailer():
    c = new('trailer')
    # ---- cold open: black, wind, a keynote
    c.black(4.3)
    c.sound('sfx/drone', 0.0, gain=-10, fade_in=2.5, dur=26, fade_out=4)
    c.sound(str(WORK / 'footage/vista.wav'), 0.0, gain=-4, fade_in=1.5, dur=4.3)
    c.vo('hunter-market', 0.4, sub='sub-hunter-market')
    # ---- act 1: the world (the main theme)
    t = c.shot('vista', 4.3, src=0.4, gain=-4, fade_in=0.9)
    c.sound('sfx/impact-soft', t, gain=-8)
    c.sound('music-title', t, src=TITLE_DOWN, dur=21.2, gain=-1, fade_in=0.3, fade_out=1.4, bus='music')
    t = c.shot('skyline', 3.2, src=1.2, gain=-6)
    c.vo('hunter-exit', t + 2.3, sub='sub-hunter-exit')
    t = c.shot('jet', 4.6, src=0.4, gain=-6)
    c.overlay('label-jet', t + 0.3, 3.4, fade_in=0.25, fade_out=0.4)
    card(c, 'card-built', 1.7)
    t = c.shot('coldstorage', 3.0, src=0.8, gain=-6)
    c.overlay('label-coldstorage', t + 0.25, 2.5, fade_in=0.25, fade_out=0.4)
    t = c.shot('garage-crane', 4.5, src=0.4, gain=-6)
    c.overlay('label-garage', t + 0.25, 2.6, fade_in=0.25, fade_out=0.4)
    c.vo('tanner-runway', t + 0.4, sub='sub-tanner-runway')
    t = card(c, 'card-lockpicks', 1.7, hit='impact-metal')
    # ---- act 2: the heist, at night (the suspicion pulse)
    c.sound('music-tension', t + 1.0, src=6.0, dur=17.5, gain=-2, fade_in=0.8, fade_out=0.6, bus='music')
    c.shot('garage-night', 2.6, src=0.6, gain=-5)
    c.shot('approach2', 1.8, src=1.6, gain=-3)
    t = c.shot('seedbot-tp', 2.6, src=0.2, gain=-3)
    c.vo('seedbot-firmware', t - 0.6, sub='sub-seedbot-firmware')
    c.shot('lockpick', 3.0, src=1.4, gain=-3, zoom=(1.42, 1.5))
    c.shot('splice', 3.0, src=2.4, gain=-3, zoom=(1.45, 1.52))
    t = c.shot('lasers', 2.3, src=0.1, gain=-4)
    c.vo('tanner-hold', t + 0.1, sub='sub-tanner-hold')
    t = c.shot('seedbot-fp', 1.5, src=1.7, gain=0)
    c.sound('sfx/riser-2.5', c.t - 2.5, gain=-6)
    # ---- act 3: the fight (the fight stem, cut on the beat)
    T3 = c.t
    card(c, 'card-rifle', 2 * BEAT, hit='braam', gain=-1)
    c.sound('sfx/subdrop', T3, gain=-6)
    c.sound('music-fight', T3, src=FIGHT_CRASH, dur=24 * BEAT + 0.05, gain=0, fade_out=0.05, bus='music')
    t = c.shot('contractor-close', 4 * BEAT, src=1.0, gain=-2)
    c.vo('kade-asset-a', t + 0.25, sub='sub-kade-asset')
    t = c.shot('rifle-c', 4 * BEAT, src=1.0, gain=0)
    c.vo('kade-mandown-a', t + 1.4, sub='sub-kade-mandown')
    c.shot('wolves-charge', 3 * BEAT, src=2.6, gain=0, look=WOLF)
    c.shot('wolves-tp2', 2 * BEAT, src=6.1, gain=-2, look=WOLF)
    t = c.shot('shotgun', 2 * BEAT, src=0.0, gain=0)
    c.vo('kade-fire-a', t + 0.2, sub='sub-kade-fire')
    c.shot('blast-tp', 3 * BEAT, src=0.7, gain=0)
    c.shot('seedbot-fp', 2 * BEAT, src=6.2, gain=-1)
    c.shot('storm-city', BEAT, src=2.0, gain=-3)
    c.shot('lightning', 0.5 * BEAT, src=0.75, gain=-2)
    c.shot('blast-fp', 0.5 * BEAT, src=1.2, gain=0)
    # ---- the cut to black
    t = c.black(1.3)
    c.sound('sfx/impact', t, gain=0)
    c.sound('sfx/subdrop', t, gain=-4)
    # ---- the fire, the end card
    t = c.shot('camp', 5.0, src=0.6, gain=-5, fade_in=0.7)
    c.sound('music-camp', t, src=4.0, dur=5.2, gain=-3, fade_in=1.0, fade_out=0.8, bus='music')
    c.vo('mara-together', t + 0.9, src=1.15, sub='sub-mara-together')
    t = c.shot('nightsky', 7.2, src=0.6, gain=-6, fade_in=0.3, fade_out=0.6)
    c.overlay('logo-end', t + 0.35, 6.6, fade_in=0.35, fade_out=0.5, push=0.05)
    c.sound('sfx/braam', t + 0.3, gain=-2)
    c.sound('sfx/impact', t + 0.3, gain=-5)
    c.sound('music-title', t + 0.3, src=TITLE_DOWN + 8 * 4 * BEAT / 2, dur=7.0, gain=-3, fade_in=0.5, fade_out=1.5, bus='music')
    # ---- stinger
    c.black(0.4)
    t = c.shot('garage-front', 4.2, src=0.8, gain=-6, fade_out=0.25)
    c.vo('tanner-garage', t + 0.3, sub='sub-tanner-garage')
    t = c.black(3.6)
    c.overlay('logo-teaser2', t + 0.1, 3.4, fade_in=0.3, fade_out=0.01)
    c.sound('sfx/impact-soft', t + 0.1, gain=-8)
    return c


def teaser():
    """Post 2: the heist side, ending on FULL TRAILER TONIGHT."""
    c = new('teaser')
    t = c.shot('garage-night', 4.4, src=0.2, gain=-4, fade_in=1.0)
    c.sound('sfx/drone', 0, gain=-12, fade_in=1.5, dur=15, fade_out=2)
    c.sound('music-tension', 0.6, src=6.0, dur=14.6, gain=-3, fade_in=1.2, fade_out=0.3, bus='music')
    c.vo('tanner-prerev', 0.5, sub='sub-tanner-prerev')
    c.shot('approach2', 1.6, src=1.6, gain=-3)
    c.shot('seedbot-tp', 1.8, src=0.4, gain=-2)
    c.shot('lockpick', 1.5, src=2.6, gain=-3, zoom=(1.42, 1.48))
    c.shot('splice', 1.4, src=3.4, gain=-3, zoom=(1.45, 1.5))
    c.shot('shotgun', 1.4, src=0.0, gain=0)
    c.shot('wolves-charge', 1.5, src=2.9, gain=-1, look=WOLF)
    t = c.shot('blast-tp', 1.5, src=1.0, gain=0)
    c.sound('sfx/riser-2.5', t + 1.5 - 2.5, gain=-6)
    t = c.black(5.6)
    c.sound('sfx/impact', t, gain=-1)
    c.sound('sfx/subdrop', t, gain=-6)
    c.overlay('logo-teaser', t + 0.15, 5.4, fade_in=0.15, fade_out=0.01, push=0.05, flicker=0.12)
    c.sound('sfx/glitch', t + 0.15, gain=-9)
    c.vo('tanner-hold', t + 1.3, sub='sub-tanner-hold')
    return c


def teaser2():
    """A spare: the fight side, ending on FREE · OUT NOW."""
    c = new('teaser2')
    c.sound('music-fight', 0, src=FIGHT_CRASH, dur=16 * BEAT, gain=0, fade_in=0.05, fade_out=0.05, bus='music')
    t = c.shot('contractor-close', 4 * BEAT, src=0.6, gain=-2, fade_in=0.3)
    c.vo('kade-asset-b', t + 0.3, sub='sub-kade-asset')
    c.shot('rifle-c', 3 * BEAT, src=1.0, gain=0)
    t = c.shot('shotgun', 2 * BEAT, src=0.0, gain=0)
    c.vo('kade-contact-a', t + 0.1, sub='sub-kade-contact')
    c.shot('wolves-charge', 2 * BEAT, src=2.9, gain=0, look=WOLF)
    t = c.shot('blast-tp', 3 * BEAT, src=0.7, gain=0)
    c.vo('kade-dale', t + 0.95, sub='sub-kade-dale')
    c.shot('seedbot-tp', 2 * BEAT, src=0.4, gain=-1)
    t = c.black(4.6)
    c.sound('sfx/impact', t, gain=-1)
    c.sound('sfx/braam', t, gain=-4)
    c.overlay('logo-teaser2', t + 0.1, 4.5, fade_in=0.12, fade_out=0.01, push=0.05, flicker=0.1)
    return c


for name, fn in (('trailer', trailer), ('teaser', teaser), ('teaser2', teaser2)):
    if name in WANT:
        fn().render(OUT)
