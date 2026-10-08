"""Render scripts/voice/lines.json to public/voice/<key>.mp3 with Kokoro, then the speaker's chain.

    node scripts/voice/extract.mjs
    ~/.local/share/bb-tts/venv/bin/python scripts/voice/generate.py [--force]

Kokoro (kokoro-onnx, Apache-2.0) lives outside the repo in ~/.local/share/bb-tts (the venv,
kokoro-v1.0.onnx, voices-v1.0.bin); only the rendered clips ship. Existing clips are kept, clips no
longer in the list are deleted, so rerunning after a script edit only renders what changed.
"""
import json
import os
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "public" / "voice"
MODEL = Path(os.environ.get("BB_TTS", Path.home() / ".local/share/bb-tts"))

# how each kind of voice is heard (ffmpeg -af); every clip is loudness-matched afterwards
SQUELCH = "anoisesrc=d=0.08:c=white:a=0.22,highpass=f=1200,lowpass=f=4000"
FX = {
    "room": "aecho=0.8:0.6:23|41:0.1|0.06",
    "radio": "highpass=f=350,lowpass=f=3200,acompressor=threshold=0.1:ratio=6:makeup=3,asoftclip=type=tanh",
    "megaphone": "highpass=f=500,lowpass=f=4500,equalizer=f=1600:t=q:w=1.2:g=8,asoftclip=type=atan,aecho=0.8:0.5:60|140:0.25|0.15",
    "pa": "highpass=f=220,lowpass=f=6500,equalizer=f=2200:t=q:w=1:g=4,aecho=0.8:0.45:45|110:0.18|0.1",
    "bot": "highpass=f=300,lowpass=f=5200,flanger=delay=1.5:depth=1.5:speed=0.6,asoftclip=type=tanh",
}


def ff(*args):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", *args], check=True)


def finish(u, wav, tmp):
    fx = FX[u["fx"]]
    shaped = f"{tmp}/{u['key']}.fx.wav"
    ff("-i", wav, "-af", fx, "-ar", "24000", shaped)
    if u["fx"] == "radio":  # the key-up and the drop
        sq = f"{tmp}/{u['key']}.sq.wav"
        ff("-f", "lavfi", "-i", SQUELCH, "-ar", "24000", "-ac", "1", sq)
        ff("-i", sq, "-i", shaped, "-i", sq, "-filter_complex", "[0][1][2]concat=n=3:v=0:a=1", shaped + ".c.wav")
        shaped += ".c.wav"
    ff("-i", shaped, "-af", "loudnorm=I=-18:TP=-1.5:LRA=11", "-ar", "24000", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "48k", str(OUT / f"{u['key']}.mp3"))
    return u["key"]


def main():
    force = "--force" in sys.argv
    units = json.loads((ROOT / "scripts/voice/lines.json").read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    keep = {u["key"] for u in units}
    for f in OUT.glob("*.mp3"):
        if f.stem not in keep:
            f.unlink()
            print("removed", f.name)
    todo = [u for u in units if force or not (OUT / f"{u['key']}.mp3").exists()]
    print(f"{len(units)} clips, {len(todo)} to render")
    if not todo:
        return
    k = Kokoro(str(MODEL / "kokoro-v1.0.onnx"), str(MODEL / "voices-v1.0.bin"))
    with tempfile.TemporaryDirectory() as tmp, ThreadPoolExecutor(max_workers=4) as pool:
        jobs = []
        for i, u in enumerate(todo):
            lang = "en-gb" if u["voice"].startswith("b") else "en-us"
            samples, rate = k.create(u["tts"], voice=u["voice"], speed=u["speed"], lang=lang)
            wav = f"{tmp}/{u['key']}.wav"
            sf.write(wav, samples, rate)
            jobs.append(pool.submit(finish, u, wav, tmp))
            if (i + 1) % 25 == 0:
                print(f"  {i + 1}/{len(todo)}", flush=True)
        for j in jobs:
            j.result()
    size = sum(f.stat().st_size for f in OUT.glob("*.mp3"))
    print(f"done: {len(keep)} clips, {size / 1e6:.1f} MB")


main()
