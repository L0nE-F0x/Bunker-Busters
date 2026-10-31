"""A cut's shot list with timecodes, from the edit list edit.py writes next to the video.

    python3 scripts/promo/shotlist.py <cut>.edl.json [captions.json] > shot-list.md

captions.json (optional): {"<clip name>": "what the shot shows", ...}. Cards, labels and subtitles
come from the overlay file names (card-*, label-*, sub-*; the text is in overlays-v1.json and
vo-v1.json).
"""
import json
import sys
from pathlib import Path

edl = json.loads(Path(sys.argv[1]).read_text())
cap = json.loads(Path(sys.argv[2]).read_text()) if len(sys.argv) > 2 else {}


def tc(t):
    return f'{int(t // 60)}:{t % 60:05.2f}'


rows = []
t = 0.0
for s in edl['segs']:
    end = t + s['dur']
    if s['kind'] == 'black':
        what = 'black'
    else:
        clip = Path(s['clip']).stem
        what = f'`{clip}`' + (f": {cap[clip]}" if clip in cap else '')
        if s.get('zoom'):
            what += f" (zoom {s['zoom'][0]}→{s['zoom'][1]})"
    over = [Path(o['png']).stem for o in edl['overlays'] if 'png' in o and o['at'] < end - 0.05 and o['at'] + o['dur'] > t + 0.05]
    rows.append((t, end, what, ', '.join(over)))
    t = end
print(f"| In | Out | Shot | On screen |\n|---|---|---|---|")
for a, b, w, o in rows:
    print(f'| {tc(a)} | {tc(b)} | {w} | {o} |')
print(f"\nLength: {tc(edl['length'])}")
