import { SiteAtlas, blob, fitText, signPlate, weather, poolGrad, washGrad, FONT_DISPLAY, FONT_UI, FONT_MONO, type AtlasDraw } from './datacenterAtlas';

/** Every painted surface of ColdStorage, in one atlas. */

const CYAN = '#5ff4ec';

/** The ColdStorage mark: a cloud with a snowflake cut out of it. */
function mark(c: CanvasRenderingContext2D, x: number, y: number, s: number, fill: string) {
  c.save();
  c.translate(x, y);
  c.fillStyle = fill;
  c.beginPath();
  c.arc(-0.35 * s, 0.1 * s, 0.32 * s, Math.PI * 0.5, Math.PI * 1.5);
  c.arc(0, -0.15 * s, 0.42 * s, Math.PI, Math.PI * 2);
  c.arc(0.38 * s, 0.08 * s, 0.3 * s, Math.PI * 1.5, Math.PI * 0.5);
  c.closePath();
  c.fill();
  c.globalCompositeOperation = 'destination-out';
  c.lineWidth = s * 0.07;
  c.lineCap = 'round';
  c.strokeStyle = '#000';
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    c.beginPath();
    c.moveTo(Math.cos(a) * s * 0.26, -0.02 * s + Math.sin(a) * s * 0.26);
    c.lineTo(-Math.cos(a) * s * 0.26, -0.02 * s - Math.sin(a) * s * 0.26);
    c.stroke();
  }
  c.restore();
}

function rackDoor(frost: boolean): AtlasDraw {
  return (c, w, h, r) => {
    c.fillStyle = '#16191c';
    c.fillRect(0, 0, w, h);
    // perforated mesh: staggered holes with a lit lower edge
    for (let y = 22; y < h - 10; y += 6) {
      for (let x = 8 + ((y / 6) % 2) * 3; x < w - 8; x += 6) {
        c.fillStyle = '#050607';
        c.fillRect(x, y, 3.2, 3.2);
        c.fillStyle = 'rgba(120,140,150,0.18)';
        c.fillRect(x, y + 3.2, 3.2, 0.8);
      }
    }
    // frame, hinge side shading, handle, label strip
    c.strokeStyle = '#2c3237';
    c.lineWidth = 5;
    c.strokeRect(2.5, 2.5, w - 5, h - 5);
    c.fillStyle = '#2a2f33';
    c.fillRect(w - 16, h * 0.42, 7, 34);
    c.fillStyle = '#9aa3a8';
    c.fillRect(w - 14, h * 0.44, 3, 26);
    c.fillStyle = '#d9d6cc';
    c.fillRect(10, 7, w - 30, 10);
    c.fillStyle = '#222';
    for (let i = 0; i < 26; i++) if (r() > 0.4) c.fillRect(12 + i * 2.6, 9, 1.4, 6);
    c.fillStyle = 'rgba(255,255,255,0.05)';
    c.fillRect(0, 0, w * 0.3, h);
    if (frost) {
      // rime creeping up from the floor and in from the edges
      const g = c.createLinearGradient(0, h, 0, h * 0.35);
      g.addColorStop(0, 'rgba(225,240,250,0.95)');
      g.addColorStop(0.4, 'rgba(210,232,245,0.55)');
      g.addColorStop(1, 'rgba(200,225,240,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      for (let i = 0; i < 420; i++) {
        const y = h - Math.pow(r(), 1.8) * h * 0.8;
        const x = r() < 0.5 ? Math.pow(r(), 2) * w * 0.3 : w - Math.pow(r(), 2) * w * 0.3;
        c.fillStyle = `rgba(235,246,255,${0.25 + r() * 0.5})`;
        const s = 1 + r() * 3;
        c.fillRect(r() < 0.5 ? x : r() * w, y, s, s * (0.5 + r()));
      }
      c.strokeStyle = 'rgba(240,250,255,0.5)';
      c.lineWidth = 1;
      for (let i = 0; i < 40; i++) {
        const x = r() * w, y = h - r() * h * 0.5;
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x + (r() - 0.5) * 18, y - r() * 14);
        c.stroke();
      }
    }
  };
}

function tile(kind: 'plain' | 'perf' | 'dirty' | 'frost'): AtlasDraw {
  return (c, w, h, r) => {
    c.fillStyle = kind === 'frost' ? '#9fb2bb' : '#6f7578';
    c.fillRect(0, 0, w, h);
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, 'rgba(255,255,255,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0.12)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    if (kind === 'perf' || kind === 'frost') {
      for (let y = 14; y < h - 12; y += 7) for (let x = 14; x < w - 12; x += 7) {
        c.fillStyle = kind === 'frost' ? 'rgba(70,95,110,0.55)' : '#26292b';
        c.fillRect(x, y, 4, 4);
      }
    }
    // bevelled edge + corner screws
    c.strokeStyle = 'rgba(30,32,34,0.9)';
    c.lineWidth = 4;
    c.strokeRect(2, 2, w - 4, h - 4);
    c.strokeStyle = 'rgba(255,255,255,0.12)';
    c.lineWidth = 2;
    c.strokeRect(6, 6, w - 12, h - 12);
    if (kind === 'dirty') blob(c, w, h, r, '40,34,28', 10, 0.25, 0.3);
    if (kind === 'frost') {
      for (let i = 0; i < 300; i++) {
        c.fillStyle = `rgba(240,250,255,${r() * 0.6})`;
        c.fillRect(r() * w, r() * h, 1 + r() * 2.5, 1 + r() * 2.5);
      }
    }
    weather(c, w, h, r, 0.4);
  };
}

export type DCArt =
  | 'logo' | 'rackDoor' | 'rackFrost' | 'tile' | 'tilePerf' | 'tileDirty' | 'tileFrost' | 'frost' | 'oil' | 'dirt' | 'soot'
  | 'exit' | 'posterCloud' | 'posterUptime' | 'whiteboard' | 'gateSign' | 'hvSign' | 'aiFace' | 'aiDead' | 'dash' | 'rackScreen'
  | 'trailer' | 'parking' | 'poolCyan' | 'poolWhite' | 'poolAmber' | 'washCyan' | 'washWhite' | 'mist' | 'monument' | 'cageSign'
  | 'coreSign' | 'vent' | 'pipeLabel' | 'stripe' | 'hazard' | 'reader' | 'cracks';

export const DC_ART: Record<DCArt, [number, number, AtlasDraw]> = {
  logo: [1024, 256, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    mark(c, 112, 128, 160, CYAN);
    const word = 'ColdStorage';
    let size = 150;
    c.font = `700 ${size}px ${FONT_UI}`;
    while (c.measureText(word).width > w - 240 && size > 60) c.font = `700 ${--size}px ${FONT_UI}`;
    c.textAlign = 'left';
    let x = 218;
    // one tube has given up: the d is a ghost, the rest still sells
    for (let i = 0; i < word.length; i++) {
      const ch = word[i];
      c.fillStyle = i === 3 ? '#285e5c' : '#e9fbff';
      c.fillText(ch, x, 128 + size * 0.36);
      x += c.measureText(ch).width;
    }
  }],
  rackDoor: [128, 256, rackDoor(false)],
  rackFrost: [128, 256, rackDoor(true)],
  tile: [128, 128, tile('plain')],
  tilePerf: [128, 128, tile('perf')],
  tileDirty: [128, 128, tile('dirty')],
  tileFrost: [128, 128, tile('frost')],
  frost: [256, 256, (c, w, h, r) => {
    blob(c, w, h, r, '232,244,252', 26, 0.4, 0.34);
    for (let i = 0; i < 900; i++) {
      const a = r() * 6.28, d = Math.pow(r(), 0.8) * w * 0.42;
      c.fillStyle = `rgba(245,252,255,${r() * 0.7})`;
      c.fillRect(w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d, 1 + r() * 2, 1 + r() * 2);
    }
  }],
  oil: [256, 256, (c, w, h, r) => { blob(c, w, h, r, '18,14,10', 24, 0.36); blob(c, w, h, r, '40,30,60', 5, 0.08, 0.15); }],
  dirt: [256, 256, (c, w, h, r) => {
    blob(c, w, h, r, '92,70,44', 26, 0.22, 0.4);
    for (let i = 0; i < 500; i++) {
      c.fillStyle = `rgba(60,46,30,${r() * 0.35})`;
      const d = Math.pow(r(), 0.7) * w * 0.45, a = r() * 6.28;
      c.fillRect(w / 2 + Math.cos(a) * d, h / 2 + Math.sin(a) * d, 2, 2);
    }
  }],
  soot: [256, 256, (c, w, h, r) => {
    // streaks running down from a vent or a hot terminal
    for (let i = 0; i < 40; i++) {
      const x = w * (0.25 + r() * 0.5);
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, `rgba(20,18,16,${0.25 + r() * 0.3})`);
      g.addColorStop(1, 'rgba(20,18,16,0)');
      c.fillStyle = g;
      c.fillRect(x, 0, 2 + r() * 8, h * (0.4 + r() * 0.6));
    }
  }],
  exit: [128, 64, (c, w, h) => {
    c.fillStyle = '#0b2a14';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#5dff8a';
    c.font = `800 38px ${FONT_UI}`;
    c.textAlign = 'center';
    c.fillText('EXIT', w / 2 + 12, 46);
    c.beginPath();
    c.moveTo(12, h / 2); c.lineTo(30, h / 2 - 12); c.lineTo(30, h / 2 + 12); c.fill();
  }],
  posterCloud: [320, 448, (c, w, h, r) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#16324a');
    g.addColorStop(1, '#0b1520');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    mark(c, w / 2, 150, 150, '#9fe9ff');
    fitText(c, 'THE CLOUD', w / 2, 290, `900 54px ${FONT_DISPLAY}`, '#e9f6ff', w - 30);
    fitText(c, 'IS JUST SOMEONE', w / 2, 330, `700 30px ${FONT_UI}`, '#9fe9ff', w - 30);
    fitText(c, 'ELSE\'S BUNKER', w / 2, 366, `700 30px ${FONT_UI}`, '#9fe9ff', w - 30);
    fitText(c, 'COLDSTORAGE · WE KEEP IT COOL', w / 2, 420, `500 15px ${FONT_MONO}`, '#5f8aa0', w - 30);
    weather(c, w, h, r, 1.2);
  }],
  posterUptime: [320, 448, (c, w, h, r) => {
    c.fillStyle = '#e9e4d6';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#1b1b1b';
    c.fillRect(20, 20, w - 40, 250);
    // a mountain climber silhouette, the universal symbol of quarterly goals
    c.fillStyle = '#d65a2a';
    c.beginPath(); c.moveTo(20, 270); c.lineTo(140, 90); c.lineTo(200, 170); c.lineTo(250, 120); c.lineTo(300, 270); c.fill();
    c.fillStyle = '#f2efe6';
    c.beginPath(); c.moveTo(140, 90); c.lineTo(160, 120); c.lineTo(125, 112); c.fill();
    fitText(c, 'UPTIME', w / 2, 330, `900 64px ${FONT_DISPLAY}`, '#1b1b1b', w - 40);
    fitText(c, 'is not a metric. It is a lifestyle.', w / 2, 370, `500 20px ${FONT_UI}`, '#333', w - 40);
    fitText(c, 'Day 1,127 without a human request', w / 2, 420, `600 16px ${FONT_MONO}`, '#b3201a', w - 40);
    weather(c, w, h, r, 1.4);
  }],
  whiteboard: [512, 256, (c, w, h, r) => {
    c.fillStyle = '#eceeea';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#9aa0a2';
    c.lineWidth = 8;
    c.strokeRect(4, 4, w - 8, h - 8);
    c.textAlign = 'left';
    c.fillStyle = '#1f4fa8';
    c.font = `700 30px ${FONT_UI}`;
    c.fillText('UPTIME SLA: 99.95%', 22, 48);
    c.fillStyle = '#c2271d';
    c.font = `600 22px ${FONT_UI}`;
    c.fillText('(lol)', 330, 48);
    c.fillStyle = '#222';
    c.font = `500 19px ${FONT_UI}`;
    const lines = ['- migrate founders to cold tier', '- turn off the assistant?  LEGAL SAYS NO', '- who keeps resetting the core PIN', '- solar: self-sustaining (!!)', '- Kyle: stop tailgating'];
    lines.forEach((t, i) => c.fillText(t, 26, 92 + i * 28));
    c.strokeStyle = '#222';
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(24, 98 + 1 * 28 - 6); c.lineTo(400, 98 + 1 * 28 - 6); c.stroke();
    // sticky note
    c.save();
    c.translate(400, 150);
    c.rotate(0.08);
    c.fillStyle = '#ffe66a';
    c.fillRect(0, 0, 96, 86);
    c.fillStyle = '#333';
    c.font = `600 13px ${FONT_UI}`;
    c.fillText('core PIN =', 8, 24);
    c.fillText('the SLA', 8, 44);
    c.fillText('digits only', 8, 64);
    c.fillText('- P.', 54, 80);
    c.restore();
    weather(c, w, h, r, 0.5);
  }],
  gateSign: [512, 256, (c, w, h, r) => {
    signPlate(c, w, h, r, '#e8e6df', '#26303a');
    c.fillStyle = '#26303a';
    c.fillRect(14, 14, w - 28, 70);
    mark(c, 60, 50, 54, CYAN);
    fitText(c, 'COLDSTORAGE · CAMPUS 4', 290, 64, `800 34px ${FONT_UI}`, '#e9fbff', 400);
    fitText(c, 'AUTHORIZED PERSONNEL', w / 2, 128, `900 40px ${FONT_DISPLAY}`, '#1b1b1b', w - 40);
    fitText(c, '& AUTHORIZED AGENTS ONLY', w / 2, 166, `700 26px ${FONT_UI}`, '#1b1b1b', w - 40);
    fitText(c, 'NO TAILGATING (THIS MEANS YOU, KYLE)', w / 2, 214, `600 18px ${FONT_MONO}`, '#b3201a', w - 40);
    weather(c, w, h, r, 1.1);
  }],
  hvSign: [256, 192, (c, w, h, r) => {
    signPlate(c, w, h, r, '#f0ece0', '#1b1b1b');
    c.fillStyle = '#c62014';
    c.fillRect(12, 12, w - 24, 52);
    fitText(c, 'DANGER', w / 2, 52, `900 44px ${FONT_DISPLAY}`, '#fff', w - 30);
    c.fillStyle = '#1b1b1b';
    c.beginPath(); c.moveTo(60, 80); c.lineTo(90, 80); c.lineTo(72, 118); c.lineTo(92, 118); c.lineTo(58, 172); c.lineTo(68, 128); c.lineTo(50, 128); c.fill();
    fitText(c, 'HIGH VOLTAGE', 165, 120, `800 22px ${FONT_UI}`, '#1b1b1b', 150);
    fitText(c, 'it still works', 165, 150, `500 15px ${FONT_MONO}`, '#5a5a5a', 150);
    weather(c, w, h, r, 1.3);
  }],
  aiFace: [512, 384, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h * 0.42, 10, w / 2, h * 0.42, w * 0.6);
    g.addColorStop(0, '#0c3a48');
    g.addColorStop(1, '#03090d');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    // the "eye": concentric rings, a little sad around the edges
    for (let i = 0; i < 6; i++) {
      c.strokeStyle = `rgba(95,244,236,${0.85 - i * 0.12})`;
      c.lineWidth = 6 - i * 0.6;
      c.beginPath();
      c.arc(w / 2, h * 0.4, 30 + i * 16, Math.PI * (0.05 + i * 0.02), Math.PI * (1.95 - i * 0.02));
      c.stroke();
    }
    c.fillStyle = '#e9fbff';
    c.beginPath(); c.arc(w / 2, h * 0.4, 18, 0, Math.PI * 2); c.fill();
    c.font = `600 22px ${FONT_MONO}`;
    c.textAlign = 'center';
    c.fillStyle = CYAN;
    c.fillText('NIMBUS v4.2', w / 2, h * 0.76);
    c.font = `500 17px ${FONT_MONO}`;
    c.fillStyle = '#9fd8dc';
    c.fillText('How can I help you today? _', w / 2, h * 0.84);
    c.fillStyle = 'rgba(95,244,236,0.5)';
    c.fillText('uptime 1127d 04h · requests 0', w / 2, h * 0.93);
  }],
  aiDead: [256, 192, (c, w, h) => {
    c.fillStyle = '#05070a';
    c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(95,244,236,0.08)';
    c.fillRect(w / 2 - 2, h / 2 - 1, 4, 2);
  }],
  dash: [512, 256, (c, w, h, r) => {
    c.fillStyle = '#071014';
    c.fillRect(0, 0, w, h);
    c.font = `600 18px ${FONT_MONO}`;
    c.textAlign = 'left';
    const rows: [string, string, string][] = [['PUE', '1.08', '#5dff8a'], ['IT LOAD', '3.1%', '#ffb347'], ['SOLAR', 'OK', '#5dff8a'], ['UTILITY', 'LOST', '#ff5a4a'], ['HUMANS', '0', '#ff5a4a']];
    rows.forEach(([k, v, col], i) => { c.fillStyle = '#7fa8b0'; c.fillText(k, 18, 34 + i * 30); c.fillStyle = col; c.fillText(v, 140, 34 + i * 30); });
    c.strokeStyle = CYAN;
    c.lineWidth = 2;
    c.beginPath();
    for (let x = 0; x < 230; x += 4) c.lineTo(260 + x, 160 - Math.abs(Math.sin(x * 0.05)) * 50 - r() * 18);
    c.stroke();
    c.strokeStyle = 'rgba(95,244,236,0.25)';
    c.strokeRect(258, 60, 236, 120);
    c.fillStyle = '#7fa8b0';
    c.fillText('COLD AISLE A  -4°C', 260, 220);
  }],
  rackScreen: [128, 64, (c, w, h, r) => {
    c.fillStyle = '#04120a';
    c.fillRect(0, 0, w, h);
    c.font = `600 11px ${FONT_MONO}`;
    c.fillStyle = '#5dff8a';
    c.textAlign = 'left';
    for (let i = 0; i < 4; i++) c.fillText(['OK', 'SYNC', 'IDLE', 'WAIT'][(i + Math.floor(r() * 4)) % 4] + ' ' + Math.floor(r() * 999), 6, 14 + i * 13);
  }],
  trailer: [1024, 256, (c, w, h, r) => {
    c.fillStyle = '#e6e3da';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#1c3c52';
    c.fillRect(0, h - 46, w, 46);
    mark(c, 120, 110, 150, '#2a8fa8');
    fitText(c, 'CLOUDS ON THE MOVE', 600, 112, `900 82px ${FONT_DISPLAY}`, '#1c3c52', 720);
    fitText(c, 'Ingress free. Egress fees apply.', 600, 168, `600 34px ${FONT_UI}`, '#2a8fa8', 720);
    fitText(c, 'COLDSTORAGE LOGISTICS · DOT 0000000 · HOW AM I DRIVING? (I AM NOT)', w / 2, h - 16, `600 20px ${FONT_MONO}`, '#e6e3da', w - 40);
    // road grime up the lower half
    const g = c.createLinearGradient(0, h * 0.4, 0, h);
    g.addColorStop(0, 'rgba(120,90,60,0)');
    g.addColorStop(1, 'rgba(110,80,50,0.5)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    weather(c, w, h, r, 1.2);
  }],
  parking: [256, 64, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(232,228,214,0.8)';
    c.fillRect(0, 0, 8, h);
    c.fillRect(w - 8, 0, 8, h);
    c.font = `800 26px ${FONT_UI}`;
    c.textAlign = 'center';
    c.fillStyle = 'rgba(95,200,230,0.75)';
    c.fillText('EV ONLY', w / 2, 42);
  }],
  poolCyan: [128, 128, (c, w, h) => poolGrad(c, w, h, '90,235,255')],
  poolWhite: [128, 128, (c, w, h) => poolGrad(c, w, h, '225,238,255')],
  poolAmber: [128, 128, (c, w, h) => poolGrad(c, w, h, '255,170,90')],
  washCyan: [128, 256, (c, w, h) => washGrad(c, w, h, '90,235,255')],
  washWhite: [128, 256, (c, w, h) => washGrad(c, w, h, '225,238,255')],
  mist: [256, 128, (c, w, h, r) => {
    c.clearRect(0, 0, w, h);
    for (let i = 0; i < 30; i++) {
      const x = r() * w, y = h * (0.55 + r() * 0.35), rad = 20 + r() * 50;
      const g = c.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(180,225,245,0.22)');
      g.addColorStop(1, 'rgba(180,225,245,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    }
    // fade the sides so cards never show an edge
    c.globalCompositeOperation = 'destination-in';
    const f = c.createLinearGradient(0, 0, w, 0);
    f.addColorStop(0, 'rgba(0,0,0,0)'); f.addColorStop(0.2, 'rgba(0,0,0,1)'); f.addColorStop(0.8, 'rgba(0,0,0,1)'); f.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = f;
    c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = 'source-over';
  }],
  monument: [512, 256, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    mark(c, 80, 96, 110, CYAN);
    fitText(c, 'ColdStorage', 300, 118, `700 76px ${FONT_UI}`, '#e9fbff', 330);
    fitText(c, 'Your data. Forever.*', w / 2, 186, `600 30px ${FONT_UI}`, '#9fe9ff', w - 40);
    fitText(c, '*forever subject to change without notice', w / 2, 226, `500 17px ${FONT_MONO}`, 'rgba(159,233,255,0.6)', w - 40);
  }],
  cageSign: [256, 128, (c, w, h, r) => {
    signPlate(c, w, h, r, '#f2c230', '#1b1b1b');
    fitText(c, 'BATTERY ROOM', w / 2, 52, `900 34px ${FONT_DISPLAY}`, '#1b1b1b', w - 30);
    fitText(c, 'LITHIUM · NO OPEN FLAME', w / 2, 84, `700 17px ${FONT_UI}`, '#1b1b1b', w - 30);
    fitText(c, 'NO SNACKS EITHER, KYLE', w / 2, 108, `500 13px ${FONT_MONO}`, '#5a3a10', w - 30);
  }],
  coreSign: [256, 96, (c, w, h, r) => {
    signPlate(c, w, h, r, '#1c2127', '#5ff4ec');
    fitText(c, 'CORE · MODEL HOSTING', w / 2, 44, `800 24px ${FONT_UI}`, CYAN, w - 30);
    fitText(c, 'BADGE OR PIN · BE NICE TO IT', w / 2, 72, `500 14px ${FONT_MONO}`, '#9fd8dc', w - 30);
  }],
  vent: [128, 128, (c, w, h) => {
    c.fillStyle = '#4e5559';
    c.fillRect(0, 0, w, h);
    for (let y = 8; y < h - 4; y += 8) {
      c.fillStyle = '#1d2124';
      c.fillRect(6, y, w - 12, 4);
      c.fillStyle = 'rgba(255,255,255,0.12)';
      c.fillRect(6, y + 4, w - 12, 1);
    }
  }],
  pipeLabel: [256, 48, (c, w, h) => {
    c.fillStyle = '#2a6fb5';
    c.fillRect(0, 0, w, h);
    fitText(c, 'CHILLED WATER SUPPLY  ▶', w / 2, 32, `700 20px ${FONT_UI}`, '#fff', w - 16);
  }],
  stripe: [256, 32, (c, w, h) => {
    c.fillStyle = '#e8b521';
    c.fillRect(0, 0, w, h);
  }],
  hazard: [512, 64, (c, w, h, r) => {
    c.fillStyle = '#e8b521';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#16130f';
    for (let x = -h; x < w + h; x += 64) {
      c.beginPath();
      c.moveTo(x, h); c.lineTo(x + 32, h); c.lineTo(x + 32 + h, 0); c.lineTo(x + h, 0);
      c.fill();
    }
    c.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 200; i++) {
      c.fillStyle = `rgba(0,0,0,${0.3 + r() * 0.7})`;
      c.fillRect(r() * w, r() * h, 2 + r() * 10, 2 + r() * 5);
    }
    c.globalCompositeOperation = 'source-over';
  }],
  reader: [64, 96, (c, w, h) => {
    c.fillStyle = '#15181b';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#3a4248';
    c.lineWidth = 3;
    c.strokeRect(2, 2, w - 4, h - 4);
    mark(c, w / 2, 34, 26, '#4a5a60');
    c.fillStyle = '#2a3036';
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) c.fillRect(12 + k * 14, 56 + r * 12, 10, 8);
  }],
  cracks: [256, 256, (c, w, h, r) => {
    c.strokeStyle = 'rgba(20,16,12,0.7)';
    c.lineCap = 'round';
    const branch = (x: number, y: number, a: number, len: number, lw: number, depth: number) => {
      c.lineWidth = lw;
      c.beginPath();
      c.moveTo(x, y);
      for (let i = 0; i < 6; i++) {
        a += (r() - 0.5) * 0.9;
        x += Math.cos(a) * len / 6;
        y += Math.sin(a) * len / 6;
        c.lineTo(x, y);
        if (depth > 0 && r() < 0.3) { c.stroke(); branch(x, y, a + (r() - 0.5) * 2, len * 0.5, lw * 0.6, depth - 1); c.lineWidth = lw; c.beginPath(); c.moveTo(x, y); }
      }
      c.stroke();
    };
    branch(w * 0.1, h * 0.5, 0, w * 0.85, 3, 2);
    branch(w * 0.5, h * 0.1, 1.5, h * 0.6, 2, 1);
  }],
};

let _atlas: SiteAtlas<DCArt> | null = null;
export const dcAtlas = () => (_atlas ??= new SiteAtlas('coldstorage', DC_ART));
