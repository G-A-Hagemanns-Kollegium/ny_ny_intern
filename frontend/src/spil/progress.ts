/** Career progress: money, kit, and the one thing money cannot buy.
 *
 *  Stored in localStorage only — the game posts nothing to the server, and clearing a save cannot
 *  affect anyone else's account.
 *
 *  Everything in the kiosk is bought with kroner. The **lift** is the exception: it is broken, and
 *  no amount of money fixes it. You have to walk up to Værkstedet on 4. sal, pick up the toolbox,
 *  and repair a shaft yourself.
 */

const SAVE_KEY = "gahk.oelbud.v3";

export interface Progress {
  version: 3;
  character: string;
  money: number;
  crate: number; // index into CRATE_TIERS
  shoes: number; // index into SHOE_TIERS; 0 = cannot run at all
  phone: boolean;
  cart: boolean;
  /** The lift quest: pick the toolbox up in Værkstedet, then repair a shaft. */
  tools: boolean;
  lift: boolean;
  delivered: number;
  failed: number;
  earned: number;
  /** Bonus events completed — the only "score" the game keeps. */
  events: number;
}

export const CHARACTERS = [
  {
    id: "albergon",
    name: "Albergon",
    blurb: "Kælderens førstemand. Kender hver en knirkende trappesten på GAHK.",
    unlocked: true,
  },
  { id: "locked-1", name: "???", blurb: "Låst op senere.", unlocked: false },
  { id: "locked-2", name: "???", blurb: "Låst op senere.", unlocked: false },
] as const;

export function defaultProgress(): Progress {
  return {
    version: 3,
    character: "albergon",
    money: 0,
    crate: 0,
    shoes: 0,
    phone: false,
    cart: false,
    tools: false,
    lift: false,
    delivered: 0,
    failed: 0,
    earned: 0,
    events: 0,
  };
}

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultProgress();
    const parsed = JSON.parse(raw) as Partial<Progress>;
    if (parsed.version !== 3) return defaultProgress();
    return { ...defaultProgress(), ...parsed };
  } catch {
    return defaultProgress();
  }
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(p));
  } catch {
    /* private mode / quota — the game still plays, it just is not remembered. */
  }
}

export function clearProgress(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------------------------------- the shop
export interface Tier {
  name: string;
  value: number;
  price: number;
  note: string;
}

/** Inventory: how many single goods you can carry up from the kiosk in one trip. */
export const CRATE_TIERS: Tier[] = [
  { name: "Bare hænderne", value: 4, price: 0, note: "Plads til 4 varer" },
  { name: "Ølkasse", value: 6, price: 150, note: "Plads til 6 varer" },
  { name: "Rygsæk", value: 9, price: 380, note: "Plads til 9 varer" },
  { name: "Bæresele + kasse", value: 12, price: 800, note: "Plads til 12 varer" },
];

/** Footwear. `value` is the sprint multiplier while Shift is held; tier 0 cannot run at all.
 *  The first pair is deliberately cheap — one or two deliveries — because being able to run is
 *  what makes the game feel good, and nobody should have to grind for that. */
export const SHOE_TIERS: Tier[] = [
  { name: "Hjemmesko", value: 1, price: 0, note: "Kan ikke løbe" },
  { name: "Klipklapper", value: 1.35, price: 60, note: "Hold Shift for at løbe" },
  { name: "Kondisko", value: 1.6, price: 260, note: "Mærkbart hurtigere løb" },
  { name: "Hagemanns Hurtigløbere", value: 1.85, price: 640, note: "Trappeløberens valg" },
  { name: "Vingesko", value: 2.15, price: 1450, note: "Nattens hurtigste bud" },
];

export const PRICES = {
  phone: 400,
  cart: 240,
} as const;

export const capacity = (p: Progress): number => CRATE_TIERS[p.crate].value;
export const sprintFactor = (p: Progress): number => SHOE_TIERS[p.shoes].value;
export const canRun = (p: Progress): boolean => p.shoes > 0;
