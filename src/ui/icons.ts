/** Hand-drawn inline SVG icons for items (stroke style, currentColor tinted per category). */
const S = (body: string, color = '#f3e9d8') =>
  `<svg viewBox="0 0 48 48" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS: Record<string, string> = {
  lockpick: S('<path d="M8 40 L30 18"/><path d="M30 18 l4 -6 l4 2 l-2 4 l4 2 l-4 4"/><path d="M12 30 l-6 6 l6 6"/>', '#3ff2e0'),
  emp: S('<circle cx="24" cy="26" r="11"/><path d="M24 15 v-5 M18 10 h12"/><path d="M26 19 l-5 8 h6 l-5 8" stroke="#7fe8ff"/>', '#3ff2e0'),
  ration: S('<rect x="10" y="14" width="28" height="22" rx="3"/><path d="M10 21 h28 M17 14 v-4 h14 v4"/><path d="M18 28 h12" />', '#5dff9a'),
  scrap: S('<path d="M8 34 l10 -14 l8 6 l6 -12 l8 20 z"/><path d="M14 38 h22"/>', '#ffb347'),
  battery: S('<rect x="12" y="12" width="24" height="28" rx="3"/><path d="M20 8 h8 v4 h-8z"/><path d="M26 18 l-5 8 h6 l-5 8"/>', '#ffb347'),
  hoodie: S('<path d="M16 10 c2 6 14 6 16 0 l8 6 l-4 8 l-3 -2 v18 h-18 v-18 l-3 2 l-4 -8 z"/><path d="M20 26 h8"/>', '#ffb347'),
  drive: S('<rect x="10" y="12" width="28" height="24" rx="3"/><circle cx="24" cy="24" r="6"/><circle cx="24" cy="24" r="1.5"/>', '#ffb347'),
  crate: S('<path d="M8 16 l16 -8 l16 8 v18 l-16 8 l-16 -8 z"/><path d="M8 16 l16 8 l16 -8 M24 24 v18"/>', '#5dff9a'),
  water: S('<path d="M20 8 h8 v6 l4 4 v20 a3 3 0 0 1 -3 3 h-10 a3 3 0 0 1 -3 -3 v-20 l4 -4 z"/><path d="M16 26 h16"/>', '#ffb347'),
  intel: S('<path d="M12 8 h18 l8 8 v24 h-26 z"/><path d="M30 8 v8 h8 M17 24 h14 M17 30 h14 M17 36 h8"/>', '#c896ff'),
  charge: S('<circle cx="24" cy="26" r="10"/><path d="M24 16 v-6"/><path d="M24 8 c4 2 5 4 2 6"/><path d="M18 26 h12 M24 20 v12"/>', '#ff8a5a'),
  noise: S('<rect x="16" y="14" width="12" height="20" rx="2"/><path d="M30 18 c4 3 4 9 0 12 M33 15 c6 4 6 14 0 18"/>', '#ffb347'),
  medkit: S('<rect x="10" y="14" width="28" height="22" rx="3"/><path d="M18 14 v-4 h12 v4 M24 20 v12 M18 26 h12"/>', '#5dff9a'),
  manifest: S('<path d="M14 8 h16 v32 h-16 z"/><path d="M18 8 v32 M14 14 h4 M22 16 h6 M22 22 h6 M22 28 h6 M22 34 h4"/>', '#c896ff'),
  crowbar: S('<path d="M12 40 L34 12"/><path d="M34 12 c3 -4 8 -2 7 2 c-1 3 -4 3 -5 2"/><path d="M12 40 l-3 -1 l2 -4"/><path d="M16 35 l4 3" stroke="#ff8a5a"/>', '#ff8a5a'),
  revolver: S('<path d="M8 18 h26 v5 h-20"/><path d="M34 18 h6 v3 h-6"/><rect x="18" y="16" width="9" height="9" rx="2"/><path d="M14 23 l-4 14 h7 l3 -10"/><path d="M20 27 c1 3 4 3 5 1"/>', '#ff8a5a'),
  shotgun: S('<path d="M4 20 h30 v4 h-30z"/><path d="M14 25 h12 v3 h-12z"/><path d="M34 19 h6 l4 5 l-2 8 l-8 -2 l-1 -5"/><path d="M28 26 c0 3 3 4 4 2"/>', '#ff8a5a'),
  rifle: S('<path d="M2 21 h28 v3 h-28z"/><path d="M30 19 h8 l7 6 l-3 7 l-10 -4 l-1 -5"/><path d="M28 25 c-2 5 4 7 6 4" /><path d="M10 24 h12 v3 h-12z"/>', '#ff8a5a'),
  ammo: S('<path d="M14 14 v24 h6 v-24 c0 -5 -6 -5 -6 0z"/><path d="M26 14 v24 h6 v-24 c0 -5 -6 -5 -6 0z"/><path d="M14 32 h6 M26 32 h6"/>', '#ffd27a'),
  shells: S('<rect x="12" y="12" width="9" height="26" rx="2"/><rect x="27" y="12" width="9" height="26" rx="2"/><path d="M12 32 h9 M27 32 h9"/>', '#ff6a5a'),
  antivenom: S('<rect x="12" y="16" width="24" height="20" rx="3"/><path d="M18 16 v-4 h12 v4"/><path d="M19 26 c3 -4 7 4 10 0" stroke="#5dff9a"/>', '#5dff9a'),
  badge: S('<rect x="14" y="16" width="20" height="24" rx="2"/><path d="M20 16 l4 -8 l4 8"/><circle cx="24" cy="25" r="4"/><path d="M18 34 h12"/>', '#ffb347'),
};

export const EYE_ICON = `<svg viewBox="0 0 64 40" fill="none" stroke="currentColor" stroke-width="3"><path d="M4 20 C14 4 50 4 60 20 C50 36 14 36 4 20 Z"/><circle cx="32" cy="20" r="8" fill="currentColor"/></svg>`;
