import { ITEMS } from './items';

/**
 * Inez Quill's Till, Dry Creek: the one shop in the valley. Barter on her slate: what you sell goes
 * on it at her offer, what you buy comes off it at her price. The slate, the day's stock and what's
 * left of it live in `data.marks` (`till.*`), so saves need nothing new. Stock turns over at midnight.
 */

export interface TillLine { id: string; qty: [number, number]; p: number }

/** Always on the shelf (in some quantity), then the day's luck. */
export const TILL_STOCK: TillLine[] = [
  { id: 'ration', qty: [2, 4], p: 1 },
  { id: 'ammo38', qty: [12, 24], p: 1 },
  { id: 'ammo22', qty: [20, 50], p: 1 },
  { id: 'bandage', qty: [2, 5], p: 1 },
  { id: 'lockpick', qty: [3, 6], p: 1 },
  { id: 'shells', qty: [5, 10], p: 0.8 },
  { id: 'ammo3030', qty: [6, 14], p: 0.7 },
  { id: 'medkit', qty: [1, 2], p: 0.6 },
  { id: 'antivenom', qty: [1, 2], p: 0.6 },
  { id: 'battery', qty: [1, 3], p: 0.6 },
  { id: 'molotov', qty: [1, 3], p: 0.5 },
  { id: 'nootropics', qty: [1, 3], p: 0.45 },
  { id: 'kombucha', qty: [2, 4], p: 0.45 },
  { id: 'canteen', qty: [1, 1], p: 0.4 },
  { id: 'spike', qty: [1, 2], p: 0.35 },
  { id: 'binoculars', qty: [1, 1], p: 0.35 },
  { id: 'pistol22', qty: [1, 1], p: 0.3 },
  { id: 'vest', qty: [1, 1], p: 0.25 },
  { id: 'seed_plate', qty: [1, 2], p: 0.3 },
  { id: 'emp', qty: [1, 1], p: 0.15 },
];

/** What she says when you walk up, by mood. */
export const TILL_LINES = {
  stranger: 'Browse. Don\'t palm. Prices are for people I don\'t know yet. Everyone starts as people I don\'t know yet.',
  owner: 'My Till, my slate, my pencil. You get the good number. Don\'t make me regret the pencil.',
  town: 'Town prices. The town voted. I counted the votes. Funny how that works.',
};

/** What Inez says when a particular thing crosses the counter (sold to her: `sell`, bought: `buy`). */
export const TILL_QUIPS: Record<string, { sell?: string; buy?: string }> = {
  gpu: { sell: 'She holds it up to the light. "It agrees with me already."' },
  nft_drive: { sell: '"Monkeys. Again." She pays you a bean. She has a jar of beans for this.' },
  mug: { sell: '"Move fast." She puts it on the shelf very, very slowly.' },
  hoodie: { sell: '"Seed stage." She folds it like a flag at a funeral.' },
  visor: { sell: 'She looks through it at you. "No. Still you."' },
  smart_ring: { sell: '"It says I slept badly." She drops it in the jar with the others.' },
  asic: { sell: 'She weighs it in both hands. "It paid for itself. On a chart."' },
  speaker_badge: { sell: '"Disrupting the Apocalypse." She files it under fiction.' },
  seed_plate: { sell: 'She reads all twenty-four words, out loud, slowly, as if one of them might be water.' },
  smart_lock: { sell: '"The most secure object on Earth." She uses it as a paperweight.' },
  kombucha: { sell: '"It\'s still alive." She sets it apart from the other bottles. For their sake.' },
  mezcal: { sell: '"Four hundred dollars." She sniffs it. "Fuel."' },
  fleece: { sell: 'She checks the fund\'s logo. "Liquidated. Like everyone who wore it."' },
  scooter_cell: { sell: '"Please park responsibly." She parks it under the counter.' },
  kade_badge: { sell: 'She turns the photo face down. "They smile at you otherwise."' },
  exit_pass: { sell: '"Seat 1A." She tucks it in the till. "Somebody\'ll want a seat."' },
  pistol22: { buy: '"Quiet one." She wipes it down. "Don\'t tell me what for."' },
  binoculars: { buy: '"Survey issue. Kade wants those back." She smiles. "Kade can ask."' },
  vest: { buy: '"One size fits most stakeholders." She holds it against you. "You\'re a stakeholder."' },
  molotov: { buy: 'She wraps it in yesterday\'s news and does not light anything.' },
  nootropics: { buy: '"Founder Focus." She shakes the bottle. "Rattles like a pitch."' },
  canteen: { buy: '"It used to glow." She sounds a little sad about it.' },
};

/** Things she won't take: the town's own paper, your story, and anything nobody could price. */
export function sellable(id: string) {
  const d = ITEMS[id];
  // water: she sells it by the bottle for scrap (her own line), and buys none back
  return !!d && d.value > 0 && d.category !== 'intel' && id !== 'sol_roll' && id !== 'deed' && id !== 'water';
}

/** Her offer for one, as a share of `value` (she likes cards that agree with people). */
export function sellPrice(id: string, k: number) {
  const d = ITEMS[id];
  if (!d) return 0;
  const special = id === 'gpu' ? 1.5 : d.category === 'ammo' ? 0.6 : 1;
  // loose ammo goes for what it weighs (no floor of one: the camp loads .22 from scrap by the dozen)
  return d.category === 'ammo' ? Math.floor(d.value * k * special) : Math.max(1, Math.floor(d.value * k * special));
}

/** Her price for one. */
export function buyPrice(id: string, k: number) {
  const d = ITEMS[id];
  return d ? Math.max(1, Math.ceil(d.value * k)) : 0;
}

/** Deterministic day stock: a small seeded roll (same day, same shelf, however often you look). */
export function rollStock(day: number): { id: string; qty: number }[] {
  let x = (day * 2654435761 + 1013904223) >>> 0;
  const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  const out: { id: string; qty: number }[] = [];
  for (const l of TILL_STOCK) {
    if (rnd() > l.p) continue;
    out.push({ id: l.id, qty: l.qty[0] + Math.floor(rnd() * (l.qty[1] - l.qty[0] + 1)) });
  }
  return out;
}
