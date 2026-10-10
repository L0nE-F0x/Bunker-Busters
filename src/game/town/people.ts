import type { NpcLook } from '@/game/world/npc';

/** The people of Dry Creek and the Cut. Colours are sRGB; the crowd bakes them linear. */
export const LOOKS: Record<string, NpcLook> = {
  // diner cook: short sleeves rolled, an apron that has seen things, hair up under a bandana
  nia: {
    skin: '#8a5e44', hair: '#1c1410', hairStyle: 'bun', fem: true, build: 1.04, height: 0.97,
    shirt: '#b8a07a', pants: '#3a3430', apron: '#e2dac6', sleeves: 'rolled', boots: '#2a1f18', scarf: '#9a2f24',
  },
  // the doctor: greying, glasses, a long coat that used to be white
  doc: {
    skin: '#c79a7e', hair: '#8f8a84', hairStyle: 'bald', beard: 'full', build: 1.08, height: 1.02,
    shirt: '#3f6670', pants: '#4a4640', coat: '#c8c2b2', coatLen: 0.72, glasses: true, boots: '#2a2420',
  },
  // the Till: a shawl over a vest, a long braid, nothing for free
  inez: {
    skin: '#a87458', hair: '#2a1a12', hairStyle: 'braid', fem: true, build: 0.98, height: 0.98,
    shirt: '#d9ccb0', pants: '#4a3a2c', vest: '#3e4a36', shawl: '#9a4a30', belt: '#2a1a10', boots: '#3a2a1c',
  },
  // Sol: duster, wide brim, a beard grown out of necessity
  sol: {
    skin: '#b07a58', hair: '#4a3a2c', hairStyle: 'short', beard: 'full', build: 1.12, height: 1.04,
    shirt: '#6a5a46', pants: '#3c362e', coat: '#5c4632', coatLen: 0.9, scarf: '#a8452c', hat: 'brim', hatColor: '#3e3024', boots: '#2a1e16',
  },
  // Ren: young, hooded, holding a mug like it is the only warm thing left
  ren: {
    skin: '#d2a684', hair: '#3a2a1c', hairStyle: 'crop', build: 0.92, height: 0.96,
    shirt: '#7a7a6a', pants: '#34383a', coat: '#4a5a52', coatLen: 0.35, hat: 'hood', hatColor: '#4a5a52', scarf: '#c9b48a', boots: '#2c2620',
  },
  // Ada Ivers, Doc's sister, out of the Panopticon: grey crop, a faded staff polo, khakis
  ada: {
    skin: '#c99c80', hair: '#a8a29a', hairStyle: 'crop', fem: true, build: 0.96, height: 0.95,
    shirt: '#9fc0dc', pants: '#a89a78', boots: '#4a3424',
  },
  // Wick: the hermit; beanie, a beard to the sternum, a blanket for a coat
  wick: {
    skin: '#a87a5c', hair: '#b4aca0', hairStyle: 'long', beard: 'long', build: 1.0, height: 1.0,
    shirt: '#5a5040', pants: '#4a4234', coat: '#6e5638', coatLen: 0.6, shawl: '#7a4a32', hat: 'beanie', hatColor: '#5a6a5a', gloves: '#3a2e24', boots: '#2a2018',
  },
};
