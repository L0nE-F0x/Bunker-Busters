import * as THREE from 'three/webgpu';
import { paint, F_DISPLAY, F_UI, F_MONO, weather, rng } from './jetKit';
import { canvasTexture, grime } from '@/game/world/kit';

/**
 * Painted details for the Starlite Drive-In, the weathered screen print, the marquee letter board,
 * and the animated keynote the projector throws (Hunter Vale launching EXIT, then the hot mic).
 */

// ------------------------------------------------------------------ atlas entries
paint('menu', 512, 320, (c, w, h, r) => {
  c.fillStyle = '#16120e';
  c.fillRect(0, 0, w, h);
  c.strokeStyle = '#e8d6a0';
  c.lineWidth = 6;
  c.strokeRect(10, 10, w - 20, h - 20);
  c.fillStyle = '#ffcf5a';
  c.font = `900 50px ${F_DISPLAY}`;
  c.textAlign = 'center';
  c.fillText('SNACK BAR', w / 2, 64);
  c.textAlign = 'left';
  c.font = `600 24px ${F_UI}`;
  const rows: [string, string][] = [
    ['POPCORN', '$∞'], ['HOT DOG (PLANT-ADJACENT)', '$12'], ['SODA · ASK ABOUT TIERS', 'SUBSCRIBE'],
    ['NACHOS (SERIES A)', '$40'], ['CANDY (VESTED)', '4 YRS'], ['WATER', 'SOLD OUT'],
  ];
  rows.forEach(([a, b], i) => {
    c.fillStyle = '#f2ead6';
    c.fillText(a, 30, 112 + i * 34);
    c.fillStyle = '#ffcf5a';
    c.textAlign = 'right';
    c.fillText(b, w - 30, 112 + i * 34);
    c.textAlign = 'left';
  });
  weather(c, w, h, 0.25, Math.floor(r() * 99));
});

paint('posterKeynote', 320, 448, (c, w, h, r) => {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0d1b2a');
  g.addColorStop(1, '#3a1c0c');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.fillStyle = 'rgba(255,200,90,0.25)';
  c.beginPath(); c.moveTo(w / 2, 0); c.lineTo(w * 0.85, h * 0.75); c.lineTo(w * 0.15, h * 0.75); c.closePath(); c.fill();
  c.fillStyle = '#111';
  c.beginPath(); c.ellipse(w / 2, 200, 34, 40, 0, 0, Math.PI * 2); c.fill();
  c.fillRect(w / 2 - 48, 236, 96, 130);
  c.fillStyle = '#ffcf5a';
  c.font = `900 56px ${F_DISPLAY}`;
  c.textAlign = 'center';
  c.fillText('THE', w / 2, 60);
  c.fillText('KEYNOTE', w / 2, 112);
  c.fillStyle = '#f2ead6';
  c.font = `600 18px ${F_UI}`;
  c.fillText('ONE NIGHT ONLY · STARLITE', w / 2, 398);
  c.font = `500 14px ${F_UI}`;
  c.fillText('"He changed everything. Again." — Hunter Vale', w / 2, 426);
  weather(c, w, h, 0.6, Math.floor(r() * 99));
});

paint('posterSeats', 320, 448, (c, w, h, r) => {
  c.fillStyle = '#c9a24a';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#1a140a';
  c.font = `900 70px ${F_DISPLAY}`;
  c.textAlign = 'center';
  c.fillText('EXIT™', w / 2, 100);
  c.font = `700 26px ${F_UI}`;
  c.fillText('SEATS REMAINING', w / 2, 200);
  c.font = `900 140px ${F_DISPLAY}`;
  c.fillText('0', w / 2, 340);
  c.font = `500 16px ${F_UI}`;
  c.fillText('(join the waitlist)', w / 2, 400);
  weather(c, w, h, 0.7, Math.floor(r() * 99));
});

paint('tickets', 384, 112, (c, w, h, r) => {
  c.fillStyle = '#b3201a';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#f6efd8';
  c.font = `900 72px ${F_DISPLAY}`;
  c.textAlign = 'center';
  c.fillText('TICKETS', w / 2, 82);
  weather(c, w, h, 0.5, Math.floor(r() * 99));
});

paint('snackSign', 768, 160, (c, w, h, r) => {
  c.fillStyle = '#e8dcc0';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#b3201a';
  c.font = `900 104px ${F_DISPLAY}`;
  c.textAlign = 'center';
  c.fillText('SNACK BAR', w / 2, 112);
  c.fillStyle = '#2a4c6a';
  c.font = `600 22px ${F_UI}`;
  c.fillText('★ REFRESHMENTS · INTERMISSION · ALSO THE APOCALYPSE ★', w / 2, 146);
  weather(c, w, h, 0.9, Math.floor(r() * 99));
});

paint('staffOnly', 256, 96, (c, w, h, r) => {
  c.fillStyle = '#e6dfcf';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#1a1a1a';
  c.font = `700 26px ${F_MONO}`;
  c.textAlign = 'center';
  c.fillText('PROJECTION', w / 2, 40);
  c.font = `500 18px ${F_MONO}`;
  c.fillText('STAFF ONLY · NO EXITS', w / 2, 74);
  weather(c, w, h, 0.4, Math.floor(r() * 99));
});

paint('founders', 160, 64, (c, w, h) => { c.fillStyle = '#1f3a5a'; c.fillRect(0, 0, w, h); c.fillStyle = '#f2ead6'; c.font = `700 26px ${F_UI}`; c.textAlign = 'center'; c.fillText('FOUNDERS', w / 2, 42); });
paint('everyone', 192, 64, (c, w, h) => { c.fillStyle = '#5a2a1f'; c.fillRect(0, 0, w, h); c.fillStyle = '#f2ead6'; c.font = `700 22px ${F_UI}`; c.textAlign = 'center'; c.fillText('EVERYONE ELSE', w / 2, 40); });

paint('speakerPlate', 256, 96, (c, w, h, r) => {
  c.fillStyle = '#d8d0b8';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#1a1a1a';
  c.font = `700 17px ${F_MONO}`;
  c.textAlign = 'center';
  c.fillText('PLEASE REPLACE SPEAKER', w / 2, 34);
  c.fillText('BEFORE YOU EXIT', w / 2, 58);
  c.font = `500 13px ${F_MONO}`;
  c.fillText('(you will not exit)', w / 2, 82);
  weather(c, w, h, 0.6, Math.floor(r() * 99));
});

paint('rowSign', 128, 128, (c, w, h, r) => {
  c.fillStyle = '#e8b818';
  c.beginPath(); c.arc(w / 2, h / 2, 58, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#1a1a1a';
  c.font = `900 78px ${F_DISPLAY}`;
  c.textAlign = 'center';
  c.fillText('★', w / 2, 92);
  weather(c, w, h, 0.4, Math.floor(r() * 99));
});

paint('projNote', 192, 224, (c, w, h) => {
  c.fillStyle = '#f2ecd8';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#c0281e';
  c.font = `700 22px ${F_UI}`;
  c.fillText('DO NOT SCREEN', 16, 34);
  c.fillStyle = '#1b2a6b';
  c.font = `500 15px ${F_UI}`;
  ['the uncut reel.', 'theatrical cut is', 'threaded. uncut is', 'in the can.', 'mic was hot.', 'he knows.', '  — D.'].forEach((l, i) => c.fillText(l, 16, 64 + i * 22));
});

paint('canLabel', 128, 64, (c, w, h) => {
  c.fillStyle = '#e8e0c8';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#c0281e';
  c.font = `700 18px ${F_MONO}`;
  c.fillText('UNCUT', 10, 26);
  c.fillStyle = '#1a1a1a';
  c.font = `500 12px ${F_MONO}`;
  c.fillText('KEYNOTE · R2/2', 10, 48);
});

paint('popcornSign', 256, 64, (c, w, h) => {
  c.fillStyle = '#b3201a';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#ffe28a';
  c.font = `900 44px ${F_DISPLAY}`;
  c.textAlign = 'center';
  c.fillText('POPCORN', w / 2, 50);
});

paint('starburst', 512, 512, (c, w, h, r) => {
  c.clearRect(0, 0, w, h);
  c.translate(w / 2, h / 2);
  for (let i = 0; i < 24; i++) {
    c.rotate((Math.PI * 2) / 24);
    c.fillStyle = i % 2 ? 'rgba(232,184,24,0.55)' : 'rgba(200,60,40,0.45)';
    c.beginPath(); c.moveTo(0, 0); c.lineTo(30, -230); c.lineTo(-30, -230); c.closePath(); c.fill();
  }
  c.fillStyle = 'rgba(240,230,200,0.85)';
  c.beginPath(); c.arc(0, 0, 90, 0, Math.PI * 2); c.fill();
  c.fillStyle = 'rgba(30,58,90,0.9)';
  c.font = `900 52px ${F_DISPLAY}`;
  c.textAlign = 'center';
  c.fillText('STAR', 0, -2);
  c.fillText('LITE', 0, 46);
  c.setTransform(1, 0, 0, 1, 0, 0);
  weather(c, w, h, 0.9, Math.floor(r() * 99));
});

paint('letters', 256, 64, (c, w, h) => {
  // loose marquee letters on the ground
  c.clearRect(0, 0, w, h);
  c.fillStyle = '#f2ead6';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#111';
  c.font = `900 50px ${F_DISPLAY}`;
  c.fillText('E', 14, 50);
  c.fillText('I', 70, 50);
  c.fillText('X', 112, 50);
  c.fillText('T', 176, 50);
});

// ------------------------------------------------------------------ the screen print
/** The faded launch banner, panel seams, rust runs and sun-bleach. Drawn once. */
export function screenTexture() {
  return canvasTexture(1024, 480, (c, w, h) => {
    const r = rng(41);
    c.fillStyle = '#d9d0bc';
    c.fillRect(0, 0, w, h);
    // the old print, sun-bleached to ghosts
    c.globalAlpha = 0.32;
    const g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#0d1b2a');
    g.addColorStop(1, '#2a1b3a');
    c.fillStyle = g;
    c.fillRect(30, 30, w - 60, h - 60);
    c.globalAlpha = 0.5;
    c.fillStyle = '#c9a24a';
    c.beginPath();
    const cx = w / 2, cy = 190;
    c.moveTo(cx, cy - 110); c.lineTo(cx + 150, cy + 40); c.lineTo(cx + 95, cy + 40); c.lineTo(cx, cy - 50); c.lineTo(cx - 95, cy + 40); c.lineTo(cx - 150, cy + 40); c.closePath();
    c.fill();
    c.font = `900 70px ${F_DISPLAY}`;
    c.textAlign = 'center';
    c.fillText('ASCEND', cx, 320);
    c.globalAlpha = 0.42;
    c.fillStyle = '#f2ead6';
    c.font = `700 34px ${F_UI}`;
    c.fillText('THE FUTURE IS PRIVATE', cx, 380);
    c.globalAlpha = 1;
    // bleach + dirt
    for (let i = 0; i < 40; i++) {
      c.fillStyle = `rgba(235,228,210,${0.1 + r() * 0.25})`;
      c.beginPath();
      c.ellipse(r() * w, r() * h, 30 + r() * 120, 20 + r() * 60, r() * 3, 0, Math.PI * 2);
      c.fill();
    }
    grime(c, w, h, 1.3, 17);
    // rust runs from the top girt
    for (let i = 0; i < 60; i++) {
      const x = r() * w, len = 20 + r() * 220;
      const gg = c.createLinearGradient(0, 0, 0, len);
      gg.addColorStop(0, `rgba(120,60,25,${0.2 + r() * 0.4})`);
      gg.addColorStop(1, 'rgba(120,60,25,0)');
      c.fillStyle = gg;
      c.fillRect(x, 0, 2 + r() * 5, len);
    }
    // panel seams
    c.strokeStyle = 'rgba(70,60,48,0.55)';
    c.lineWidth = 3;
    for (let i = 1; i < 8; i++) { c.beginPath(); c.moveTo((i * w) / 8, 0); c.lineTo((i * w) / 8, h); c.stroke(); }
    for (let j = 1; j < 4; j++) { c.beginPath(); c.moveTo(0, (j * h) / 4); c.lineTo(w, (j * h) / 4); c.stroke(); }
  });
}

/** The marquee letter board, letters missing. Both faces. */
export function marqueeTexture() {
  return canvasTexture(1024, 640, (c, w, h) => {
    const draw = (y0: number, lines: string[]) => {
      c.fillStyle = '#efe6cc';
      c.fillRect(0, y0, w, h / 2);
      c.strokeStyle = 'rgba(80,70,50,0.35)';
      c.lineWidth = 2;
      for (let i = 1; i < 3; i++) { c.beginPath(); c.moveTo(0, y0 + (i * h) / 6); c.lineTo(w, y0 + (i * h) / 6); c.stroke(); }
      c.fillStyle = '#121212';
      c.font = `900 78px ${F_DISPLAY}`;
      c.textAlign = 'center';
      lines.forEach((l, i) => c.fillText(l, w / 2, y0 + 82 + i * 106, w - 40));
      grime(c, w, h / 2, 0.5, y0 + 3);
    };
    draw(0, ['TON GHT  ON  NIGHT ONLY', 'THE K YNOTE', 'NO REF NDS · NO  XITS']);
    draw(h / 2, ['THANK Y U FOR', 'DRIV NG SAFE', 'THE FUTU E IS P IVATE']);
  });
}

/** The STARLITE neon header (white strokes on transparent; tinted in the shader). */
export function neonTexture() {
  return canvasTexture(1024, 256, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.textAlign = 'center';
    c.font = `italic 700 170px ${F_UI}`;
    c.lineWidth = 7;
    c.lineJoin = 'round';
    c.strokeStyle = '#fff';
    c.strokeText('STARLITE', w / 2, 180);
    c.font = `700 44px ${F_UI}`;
    c.lineWidth = 3;
    c.strokeText('D R I V E · I N', w / 2, 238);
  });
}

// ------------------------------------------------------------------ the keynote
export interface Cue { at: number; speaker: string; text: string }
export const KEYNOTE_LEN = 62;
/** Spoken lines (shown as subtitles near the lot) and when they land. */
export const CUES: Cue[] = [
  { at: 8.5, speaker: 'HUNTER VALE', text: 'The world is ending. And I want to say, as a founder: that is a market.' },
  { at: 16, speaker: 'HUNTER VALE', text: 'Addressable market: everyone. Retention: one hundred percent, until it isn\'t.' },
  { at: 23, speaker: 'HUNTER VALE', text: 'Introducing EXIT. Evacuation, as a service. Leave before the planet leaves you.' },
  { at: 30, speaker: 'HUNTER VALE', text: 'Basic is the waitlist. Plus is a better waitlist. Platinum is a seat.' },
  { at: 36, speaker: 'HUNTER VALE', text: 'One more thing. We\'re already gone.' },
  { at: 39.5, speaker: 'AUDIENCE', text: '(applause, on a loop, from every speaker post)' },
  { at: 43, speaker: 'HUNTER VALE', text: 'No questions? Great. Great energy. Thank you.' },
  { at: 48, speaker: 'HUNTER VALE', text: '(hot mic) Is the jet fueled?' },
  { at: 50.5, speaker: 'ASSISTANT', text: 'Wheels up at eleven, from the lot. North-west, like you said.' },
  { at: 53, speaker: 'HUNTER VALE', text: 'Just me. Seats were always zero. It\'s a waitlist. Kill the—' },
];
/** When the hot mic has said enough. */
export const REVEAL_AT = 55;

/** Average colour of each beat (tints the beam and the light on the cars). */
export function keynoteTint(t: number, out: THREE.Color) {
  if (t < 3) return out.setRGB(0.75, 0.72, 0.65);
  if (t < 8) return out.setRGB(0.55, 0.45, 0.25);
  if (t < 15) return out.setRGB(0.35, 0.45, 0.85);
  if (t < 22) return out.setRGB(0.4, 0.75, 0.6);
  if (t < 29) return out.setRGB(0.95, 0.75, 0.4);
  if (t < 35) return out.setRGB(0.8, 0.7, 0.55);
  if (t < 42) return out.setRGB(1.0, 0.55, 0.35);
  if (t < 47) return out.setRGB(0.5, 0.55, 0.9);
  if (t < 55) return out.setRGB(0.55, 0.6, 0.55);
  return out.setRGB(0.9, 0.88, 0.8);
}

/** Draws frame `t` (seconds into the loop) of the keynote onto a 2D canvas. */
export function drawKeynote(c: CanvasRenderingContext2D, w: number, h: number, t: number, frame: number) {
  const r = rng(frame * 7 + 3);
  const weave = (r() - 0.5) * 3;
  c.save();
  c.translate(0, weave);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const bg = (a: string, b: string) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, a); g.addColorStop(1, b); c.fillStyle = g; c.fillRect(0, -4, w, h + 8); };
  const title = (txt: string, y: number, size: number, col: string, font = F_DISPLAY, weight = 900) => {
    c.fillStyle = col;
    c.font = `${weight} ${size}px ${font}`;
    c.fillText(txt, w / 2, y);
  };
  const founder = (x: number, y: number, s: number) => {
    c.fillStyle = '#050505';
    c.beginPath(); c.ellipse(x, y - 52 * s, 13 * s, 16 * s, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(x - 24 * s, y - 34 * s); c.lineTo(x + 24 * s, y - 34 * s); c.lineTo(x + 20 * s, y + 30 * s); c.lineTo(x - 20 * s, y + 30 * s); c.closePath(); c.fill();
    c.fillRect(x - 15 * s, y + 30 * s, 11 * s, 40 * s);
    c.fillRect(x + 4 * s, y + 30 * s, 11 * s, 40 * s);
    c.fillStyle = 'rgba(255,255,255,0.12)';
    c.fillRect(x - 3 * s, y - 36 * s, 6 * s, 4 * s); // the mic
  };
  const stage = (slide: () => void, fx = 110) => {
    bg('#0b1022', '#05060c');
    c.fillStyle = 'rgba(255,230,170,0.10)';
    c.beginPath(); c.moveTo(fx, -10); c.lineTo(fx + 70, h); c.lineTo(fx - 70, h); c.closePath(); c.fill();
    c.fillStyle = '#0e1630';
    c.fillRect(200, 26, 290, 168);
    c.save();
    c.beginPath(); c.rect(200, 26, 290, 168); c.clip();
    slide();
    c.restore();
    founder(fx, 182, 1.05);
    c.fillStyle = '#1a1a22';
    c.fillRect(0, 222, w, 30);
  };
  if (t < 3) {
    // countdown leader
    bg('#5a5a55', '#3a3a36');
    c.strokeStyle = 'rgba(20,20,20,0.8)';
    c.lineWidth = 3;
    c.beginPath(); c.arc(w / 2, h / 2, 92, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(w / 2, h / 2, 70, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.moveTo(w / 2, 0); c.lineTo(w / 2, h); c.stroke();
    c.fillStyle = 'rgba(20,20,20,0.35)';
    c.beginPath(); c.moveTo(w / 2, h / 2); c.arc(w / 2, h / 2, 92, -Math.PI / 2, -Math.PI / 2 + (t % 1) * Math.PI * 2); c.closePath(); c.fill();
    title(String(3 - Math.floor(t)), h / 2 + 4, 110, '#141414');
  } else if (t < 8) {
    bg('#050505', '#0a0805');
    const a = Math.min(1, (t - 3) / 1.2);
    c.globalAlpha = a;
    c.fillStyle = '#c9a24a';
    c.beginPath();
    const cx = w / 2, cy = 82;
    c.moveTo(cx, cy - 46); c.lineTo(cx + 64, cy + 18); c.lineTo(cx + 40, cy + 18); c.lineTo(cx, cy - 20); c.lineTo(cx - 40, cy + 18); c.lineTo(cx - 64, cy + 18); c.closePath(); c.fill();
    title('ASCEND  presents', 136, 22, '#c9a24a', F_UI, 600);
    if (t > 5) { c.globalAlpha = Math.min(1, (t - 5) / 0.8); title('THE KEYNOTE', 186, 54, '#f2ead6'); }
    c.globalAlpha = 1;
  } else if (t < 15) {
    stage(() => {
      title('THE WORLD IS ENDING', 90, 30, '#f2ead6');
      if (t > 11.5) title('(that\'s a market)', 140, 22, '#ffcf5a', F_UI, 600);
    });
  } else if (t < 22) {
    stage(() => {
      c.fillStyle = '#123a2e';
      c.fillRect(200, 26, 290, 168);
      title('ADDRESSABLE MARKET: EVERYONE', 46, 15, '#bfffe0', F_UI, 700);
      c.strokeStyle = '#7dffc0';
      c.lineWidth = 3;
      c.beginPath(); c.moveTo(220, 180); c.lineTo(470, 180); c.moveTo(220, 180); c.lineTo(220, 60); c.stroke();
      const k = Math.min(1, (t - 15) / 4);
      c.strokeStyle = '#ffcf5a';
      c.lineWidth = 4;
      c.beginPath(); c.moveTo(225, 172);
      const xEnd = 225 + 230 * k;
      for (let x = 225; x <= xEnd; x += 8) c.lineTo(x, 172 - Math.pow((x - 225) / 230, 2) * 100);
      if (t > 19.5) c.lineTo(xEnd + 10, 200);
      c.stroke();
      if (t > 19.5) title('TIME', 470, 10, '#7dffc0', F_MONO, 700), title('(cliff)', 455, 190, '#ff8a6a', F_MONO, 700);
    });
  } else if (t < 29) {
    stage(() => {
      c.fillStyle = '#2a1e0c';
      c.fillRect(200, 26, 290, 168);
      title('INTRODUCING', 50, 16, '#ffcf5a', F_UI, 700);
      title('EXIT™', 96, 50, '#f4d98a');
      title('EVACUATION AS A SERVICE', 140, 15, '#f2ead6', F_UI, 600);
      // the jet climbs across the slide
      const k = ((t - 22) / 7) * 1.2;
      const jx = 200 + k * 300, jy = 185 - k * 120;
      c.fillStyle = '#f2ead6';
      c.save(); c.translate(jx, jy); c.rotate(-0.38);
      c.fillRect(-22, -3, 44, 6); c.fillRect(-4, -14, 10, 28); c.fillRect(-22, -9, 6, 8);
      c.restore();
    }, 90);
  } else if (t < 35) {
    stage(() => {
      c.fillStyle = '#1c1a16';
      c.fillRect(200, 26, 290, 168);
      title('PRICING', 46, 18, '#ffcf5a', F_UI, 700);
      c.textAlign = 'left';
      const rows = ['BASIC · the waitlist', 'PLUS · a better waitlist', 'PLATINUM · a seat*'];
      rows.forEach((l, i) => { if (t > 29.5 + i * 1.2) { c.fillStyle = i === 2 ? '#f4d98a' : '#f2ead6'; c.font = `600 17px ${F_UI}`; c.fillText(l, 222, 86 + i * 30); } });
      if (t > 33) { c.fillStyle = 'rgba(242,234,214,0.7)'; c.font = `500 11px ${F_UI}`; c.fillText('*one (1) seat. it is taken.', 222, 178); }
      c.textAlign = 'center';
    });
  } else if (t < 42) {
    stage(() => {
      c.fillStyle = '#000';
      c.fillRect(200, 26, 290, 168);
      title(t < 37.5 ? 'ONE MORE THING…' : 'WE\'RE ALREADY GONE.', 110, t < 37.5 ? 26 : 30, '#f2ead6');
    }, 110 + Math.max(0, t - 38) * 4);
    if (t > 39 && Math.floor(t * 3) % 2 === 0) {
      c.fillStyle = '#b3201a';
      c.fillRect(w / 2 - 90, 200, 180, 34);
      title('APPLAUSE', 218, 24, '#ffe28a');
    }
  } else if (t < 47) {
    stage(() => {
      c.fillStyle = '#0e1630';
      c.fillRect(200, 26, 290, 168);
      title('Q & A', 92, 46, '#f2ead6');
      if (t > 44) title('no questions? great.', 140, 16, '#9fb4ff', F_UI, 600);
    }, 110 - Math.max(0, t - 44.5) * 40);
  } else if (t < 55) {
    // hot mic: the camera kept rolling backstage, tilted and grainy
    c.save();
    c.translate(w / 2, h / 2);
    c.rotate(-0.06 + Math.sin(t * 3) * 0.01);
    c.translate(-w / 2, -h / 2);
    bg('#1d2420', '#0b0e0c');
    c.fillStyle = '#2c3530';
    c.fillRect(-20, 150, w + 40, 120);
    founder(150 + Math.sin(t) * 6, 170, 1.4);
    c.fillStyle = '#060706';
    c.beginPath(); c.ellipse(390, 120, 16, 19, 0, 0, Math.PI * 2); c.fill();
    c.fillRect(366, 140, 48, 100);
    c.fillStyle = 'rgba(255,60,40,0.9)';
    if (Math.floor(t * 2) % 2) { c.beginPath(); c.arc(30, 24, 7, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = '#f2ead6';
    c.font = `600 13px ${F_MONO}`;
    c.textAlign = 'left';
    c.fillText('REC  BACKSTAGE CAM 2', 44, 25);
    c.restore();
    const cue = [...CUES].reverse().find((q) => q.at <= t && q.at >= 47);
    if (cue) {
      c.fillStyle = 'rgba(0,0,0,0.65)';
      c.fillRect(20, h - 52, w - 40, 40);
      c.fillStyle = '#ffe28a';
      c.font = `600 15px ${F_UI}`;
      c.textAlign = 'center';
      c.fillText(`${cue.speaker === 'ASSISTANT' ? 'ASSISTANT' : 'HUNTER'}: ${cue.text.replace('(hot mic) ', '')}`, w / 2, h - 32, w - 60);
    }
  } else {
    bg('#050505', '#050505');
    title('THANK YOU', 100, 44, '#f2ead6');
    title('Ascend · The future is private.', 150, 16, '#c9a24a', F_UI, 600);
    // runout: the film burns through
    if (t > 59) {
      const k = (t - 59) / 3;
      const g = c.createRadialGradient(w * 0.6, h * 0.4, 0, w * 0.6, h * 0.4, 40 + k * 400);
      g.addColorStop(0, 'rgba(255,255,240,1)');
      g.addColorStop(0.5, 'rgba(255,170,60,0.9)');
      g.addColorStop(1, 'rgba(120,40,0,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    }
  }
  c.restore();
  // film: scratches, dust, flicker, vignette
  c.fillStyle = `rgba(255,255,240,${0.02 + r() * 0.05})`;
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 3; i++) {
    if (r() < 0.5) continue;
    c.fillStyle = `rgba(230,230,220,${0.15 + r() * 0.25})`;
    c.fillRect(r() * w, 0, 1 + r() * 1.5, h);
  }
  for (let i = 0; i < 14; i++) {
    c.fillStyle = r() < 0.5 ? 'rgba(10,10,10,0.6)' : 'rgba(240,240,230,0.5)';
    c.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3);
  }
  const v = c.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, w * 0.62);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.55)');
  c.fillStyle = v;
  c.fillRect(0, 0, w, h);
}
