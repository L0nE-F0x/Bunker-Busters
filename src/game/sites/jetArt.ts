import { paint, F_DISPLAY, F_UI, F_MONO, weather } from './jetKit';

/**
 * Painted details for The Exit Strategy (registered into the shared site atlas at module load).
 * Ascend is Hunter Vale's company; EXIT™ is its "evacuation as a service". The Starlite keynote
 * (drivein.ts) is the launch of the same product.
 */

paint('livery', 1024, 160, (c, w, h) => {
  c.clearRect(0, 0, w, h);
  c.fillStyle = '#c9a24a';
  c.font = `italic 700 118px ${F_UI}`;
  c.textBaseline = 'middle';
  c.fillText('The Exit Strategy', 20, h / 2 + 6);
  c.fillStyle = 'rgba(40,30,10,0.55)';
  c.font = `500 30px ${F_UI}`;
  c.fillText('an Ascend aircraft', 760, h - 22);
});

paint('reg', 512, 128, (c, w, h) => {
  c.clearRect(0, 0, w, h);
  c.fillStyle = '#20242a';
  c.font = `700 104px ${F_UI}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('N3X1T', w / 2, h / 2 + 4);
});

paint('tailLogo', 384, 384, (c, w, h) => {
  c.clearRect(0, 0, w, h);
  // gold chevron (Ascend) over the word
  c.fillStyle = '#c9a24a';
  c.beginPath();
  c.moveTo(w / 2, 40);
  c.lineTo(w - 70, 230);
  c.lineTo(w - 130, 230);
  c.lineTo(w / 2, 120);
  c.lineTo(130, 230);
  c.lineTo(70, 230);
  c.closePath();
  c.fill();
  c.font = `700 64px ${F_UI}`;
  c.textAlign = 'center';
  c.fillText('ASCEND', w / 2, 320);
  weather(c, w, h, 0.25, 31);
});

paint('noStep', 256, 64, (c, w, h) => {
  c.clearRect(0, 0, w, h);
  c.strokeStyle = 'rgba(30,30,30,0.85)';
  c.lineWidth = 4;
  c.strokeRect(6, 6, w - 12, h - 12);
  c.fillStyle = 'rgba(30,30,30,0.85)';
  c.font = `700 36px ${F_MONO}`;
  c.textAlign = 'center';
  c.fillText('NO STEP', w / 2, 46);
});

paint('rescue', 384, 96, (c, w, h) => {
  c.clearRect(0, 0, w, h);
  c.strokeStyle = '#d2461e';
  c.lineWidth = 6;
  c.setLineDash([22, 10]);
  c.strokeRect(8, 8, w - 16, h - 16);
  c.setLineDash([]);
  c.fillStyle = '#d2461e';
  c.font = `700 34px ${F_MONO}`;
  c.textAlign = 'center';
  c.fillText('RESCUE · CUT HERE', w / 2, 60);
});

paint('danger', 256, 256, (c, w, h) => {
  c.clearRect(0, 0, w, h);
  c.fillStyle = '#c42a1c';
  c.beginPath();
  c.moveTo(w / 2, 16); c.lineTo(w - 16, h - 40); c.lineTo(16, h - 40); c.closePath();
  c.fill();
  c.fillStyle = '#f2ede2';
  c.font = `700 44px ${F_MONO}`;
  c.textAlign = 'center';
  c.fillText('DANGER', w / 2, h - 66);
  c.font = `700 22px ${F_MONO}`;
  c.fillText('INTAKE · STAND CLEAR', w / 2, h - 12);
});

paint('parachute', 256, 160, (c, w, h, r) => {
  c.fillStyle = '#e6dfcf';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#b3201a';
  c.fillRect(0, 0, w, 36);
  c.fillStyle = '#fff';
  c.font = `700 24px ${F_MONO}`;
  c.textAlign = 'center';
  c.fillText('PARACHUTE (1)', w / 2, 27);
  c.fillStyle = '#222';
  c.font = `700 30px ${F_UI}`;
  c.fillText('FOUNDER ONLY', w / 2, 82);
  c.font = `500 17px ${F_UI}`;
  c.fillText('crew: see "vision"', w / 2, 116);
  c.fillText('passengers: see "waitlist"', w / 2, 140);
  weather(c, w, h, 0.35, Math.floor(r() * 99));
});

paint('baggage', 256, 128, (c, w, h, r) => {
  c.fillStyle = '#d9d2c2';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#20242a';
  c.font = `700 30px ${F_MONO}`;
  c.textAlign = 'center';
  c.fillText('BAGGAGE', w / 2, 40);
  c.font = `500 18px ${F_MONO}`;
  c.fillText('PRIVATE · DO NOT OPEN', w / 2, 72);
  c.fillText('(this means you, Pilot)', w / 2, 100);
  weather(c, w, h, 0.3, Math.floor(r() * 99));
});

paint('occupied', 160, 64, (c, w, h) => {
  c.fillStyle = '#12100e';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#ff5a3a';
  c.font = `700 28px ${F_MONO}`;
  c.textAlign = 'center';
  c.fillText('OCCUPIED', w / 2, 42);
});

paint('napkin', 128, 128, (c, w, h) => {
  c.fillStyle = '#f2efe8';
  c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(0,0,0,0.08)';
  for (let i = 8; i < w; i += 12) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, h); c.stroke(); }
  c.fillStyle = '#b08a2a';
  c.font = `italic 600 14px ${F_UI}`;
  ['Gone ahead', 'to scout.', 'Plane is', 'yours, Pilot.', 'DO NOT open', 'the hold.', '   — H.'].forEach((l, i) => c.fillText(l, 10, 20 + i * 15));
});

paint('cvr', 256, 128, (c, w, h) => {
  c.fillStyle = '#e0661c';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#f4efe4';
  for (let i = 0; i < 6; i++) c.fillRect(i * 46, 0, 20, 14);
  c.font = `700 22px ${F_MONO}`;
  c.textAlign = 'center';
  c.fillText('FLIGHT RECORDER', w / 2, 56);
  c.fillText('DO NOT OPEN', w / 2, 86);
  c.font = `500 15px ${F_MONO}`;
  c.fillText('ENREGISTREUR DE VOL', w / 2, 112);
});

paint('brochure', 256, 352, (c, w, h, r) => {
  const g = c.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#f4d98a');
  g.addColorStop(0.45, '#c9a24a');
  g.addColorStop(1, '#8a6a24');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#1a140a';
  c.font = `900 66px ${F_DISPLAY}`;
  c.textAlign = 'center';
  c.fillText('EXIT™', w / 2, 96);
  c.font = `600 20px ${F_UI}`;
  c.fillText('PLATINUM', w / 2, 128);
  // the pod
  c.fillStyle = 'rgba(30,22,10,0.85)';
  c.beginPath();
  c.ellipse(w / 2, 210, 44, 62, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#f4d98a';
  c.beginPath();
  c.ellipse(w / 2, 196, 18, 22, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#1a140a';
  c.font = `500 17px ${F_UI}`;
  c.fillText('Leave before the planet', w / 2, 302);
  c.fillText('leaves you.', w / 2, 324);
  weather(c, w, h, 0.4, Math.floor(r() * 99));
});

paint('crate', 256, 192, (c, w, h, r) => {
  c.fillStyle = '#9a7448';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 6; i++) { c.fillStyle = `rgba(60,40,20,${0.15 + r() * 0.2})`; c.fillRect(0, i * 32 + 30, w, 2); }
  c.fillStyle = 'rgba(30,18,8,0.85)';
  c.font = `900 50px ${F_DISPLAY}`;
  c.textAlign = 'center';
  c.fillText('DOM PIVOTON', w / 2, 80);
  c.font = `700 22px ${F_MONO}`;
  c.fillText('BRUT · 1 OF 1 OF 6', w / 2, 118);
  c.font = `500 18px ${F_MONO}`;
  c.fillText('THIS SIDE UP (UP = VALUE)', w / 2, 160);
  weather(c, w, h, 0.6, Math.floor(r() * 99));
});

paint('photo', 256, 320, (c, w, h, r) => {
  c.fillStyle = '#b1271d';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#f2ede2';
  c.fillRect(14, 14, w - 28, h - 28);
  c.fillStyle = '#b1271d';
  c.font = `900 80px ${F_DISPLAY}`;
  c.textAlign = 'center';
  c.fillText('TIME', w / 2, 92);
  c.fillStyle = '#2a2a2a';
  c.beginPath();
  c.ellipse(w / 2, 186, 58, 70, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#111';
  c.fillRect(w / 2 - 70, 236, 140, 60);
  c.fillStyle = '#b1271d';
  c.font = `700 20px ${F_UI}`;
  c.fillText('PERSON OF THE YEAR', w / 2, 278);
  c.font = `italic 500 15px ${F_UI}`;
  c.fillStyle = '#f2ede2';
  c.fillText('(mockup — not approved)', w / 2, 300);
  weather(c, w, h, 0.3, Math.floor(r() * 99));
});

paint('pfd', 256, 192, (c, w, h, r) => {
  c.fillStyle = '#000';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#ffb02e';
  c.font = `700 40px ${F_MONO}`;
  c.textAlign = 'center';
  c.fillText('TERRAIN', w / 2, 84);
  c.font = `700 28px ${F_MONO}`;
  c.fillText('PULL UP', w / 2, 128);
  c.fillStyle = 'rgba(255,176,46,0.35)';
  c.fillRect(20, 150, w - 40, 3);
  c.font = `500 15px ${F_MONO}`;
  c.fillText('EXITPILOT: MISSION COMPLETE', w / 2, 178);
  // crack
  c.strokeStyle = 'rgba(180,200,210,0.5)';
  c.lineWidth = 1.5;
  for (let k = 0; k < 7; k++) {
    c.beginPath();
    let x = w * 0.7, y = h * 0.3;
    c.moveTo(x, y);
    for (let s = 0; s < 6; s++) { x += (r() - 0.4) * 40; y += (r() - 0.3) * 30; c.lineTo(x, y); }
    c.stroke();
  }
});

paint('mfd', 256, 192, (c, w, h, r) => {
  c.fillStyle = '#030607';
  c.fillRect(0, 0, w, h);
  c.strokeStyle = 'rgba(60,220,200,0.55)';
  c.lineWidth = 2;
  c.beginPath();
  c.arc(w / 2, h + 40, 150, Math.PI * 1.15, Math.PI * 1.85);
  c.stroke();
  c.fillStyle = 'rgba(60,220,200,0.7)';
  c.font = `500 14px ${F_MONO}`;
  c.fillText('DEST: AHEAD', 12, 22);
  c.fillText('ETA: --:--', 12, 40);
  c.fillText('FUEL 0%', w - 90, 22);
  c.fillStyle = 'rgba(255,90,60,0.8)';
  c.fillText('PAX 0 · CREW 0', w - 128, 40);
  for (let i = 0; i < 30; i++) { c.fillStyle = `rgba(60,220,200,${r() * 0.2})`; c.fillRect(r() * w, r() * h, 2, 2); }
});

paint('seatbelt', 192, 64, (c, w, h) => {
  c.fillStyle = '#0c0c0c';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#e8e2d0';
  c.font = `700 22px ${F_MONO}`;
  c.textAlign = 'center';
  c.fillText('FASTEN · VISION', w / 2, 40);
});

paint('raft', 256, 128, (c, w, h, r) => {
  c.fillStyle = '#e8b818';
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#2a2010';
  c.font = `900 44px ${F_DISPLAY}`;
  c.textAlign = 'center';
  c.fillText('LIFE RAFT 8P', w / 2, 56);
  c.font = `600 18px ${F_MONO}`;
  c.fillText('SURVIVAL KIT INSIDE', w / 2, 88);
  c.fillText('PULL RED TAB', w / 2, 112);
  weather(c, w, h, 0.35, Math.floor(r() * 99));
});

paint('passTag', 192, 96, (c, w, h) => {
  const g = c.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#f4d98a');
  g.addColorStop(1, '#a8842e');
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  c.fillStyle = '#1a140a';
  c.font = `700 26px ${F_UI}`;
  c.fillText('EXIT · 1A', 14, 40);
  c.font = `500 14px ${F_MONO}`;
  c.fillText('PLATINUM · NON-TRANSFERABLE', 14, 70);
});
