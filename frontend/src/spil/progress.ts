/** What a run is, what carries between runs, and the skill tree.
 *
 *  Two different lifetimes live in here:
 *
 *    Run  — one fifteen-minute shift. Score, level, skill points and every skill you spent them on.
 *           None of it survives the clock running out; that is the point of a score.
 *    Save — the leaderboard and your chosen bud. localStorage only: the game posts nothing to the
 *           server, and clearing it cannot affect anyone else.
 *
 *  Money is no longer a currency. It is the score. Everything you buy, you buy with skill points,
 *  and skill points come from levelling, and levels come from delivering *fast*.
 */

import { COMBO_MAX, COMBO_STEP, xpToLevel } from "./config";

// Bumped with the shift length, every time: scores from shifts of different lengths are not the
// same achievement, and mixing them on one board is worse than losing the old one.
const SAVE_KEY = "gahk.oelbud.v6";

// ------------------------------------------------------------------------------------- skills
export type SkillId = "sko" | "rulleskoejter" | "dash" | "kasse" | "hop" | "minikort";

export interface Skill {
  id: SkillId;
  name: string;
  /** What one point does, phrased per level. */
  note: string;
  max: number;
  /** Another skill that must be at this level first. */
  needs?: { id: SkillId; level: number };
  /** Atlas frame shown on the card. */
  icon: string;
  /** Which row of the færdigheder screen it belongs to. */
  track: "mobilitet" | "last" | "andet";
  /** The key that uses it, if it is bound to one. */
  key?: string;
}

export const SKILLS: Skill[] = [
  { id: "sko", name: "Løbesko", note: "Hurtigere når du løber", max: 4, icon: "ic_sko", track: "mobilitet", key: "Shift" },
  {
    id: "rulleskoejter",
    name: "Rulleskøjter",
    note: "+10 % fart hele tiden",
    max: 4,
    needs: { id: "sko", level: 1 },
    icon: "ic_skate",
    track: "mobilitet",
  },
  { id: "dash", name: "Spurt", note: "Kort spurt fremad", max: 2, icon: "ic_dash", track: "mobilitet", key: "Q" },
  { id: "kasse", name: "Ølkasse", note: "+2 varer at bære på", max: 4, icon: "ic_kasse", track: "last" },
  { id: "hop", name: "Hop", note: "Spring over ting i vejen", max: 1, icon: "ic_hop", track: "mobilitet", key: "Mellemrum" },
  { id: "minikort", name: "Minikort", note: "Kort over etagen", max: 1, icon: "ic_kort", track: "andet" },
];

/** The three things points buy. The færdigheder screen is laid out one track per row, so a player
 *  can see the shape of a build rather than a grid of six unrelated boxes. */
export const TRACKS = [
  { id: "mobilitet", name: "Mobilitet", note: "Kom hurtigere rundt i huset" },
  { id: "last", name: "Last", note: "Tag flere ordrer med i én tur" },
  { id: "andet", name: "Andet", note: "Resten" },
] as const;

export type SkillLevels = Partial<Record<SkillId, number>>;

export const skillLevel = (s: SkillLevels, id: SkillId): number => s[id] ?? 0;

export function canSpend(s: SkillLevels, skill: Skill): boolean {
  if (skillLevel(s, skill.id) >= skill.max) return false;
  return !skill.needs || skillLevel(s, skill.needs.id) >= skill.needs.level;
}

// ---------------------------------------------------------------------------------------- run
export interface Run {
  /** The score. Kroner earned; nothing spends it. */
  money: number;
  xp: number;
  /** XP banked towards the next level, and what that level costs. */
  xpInLevel: number;
  level: number;
  points: number;
  skills: SkillLevels;
  delivered: number;
  failed: number;
  events: number;
  /** Deliveries in the current streak, and the seconds left to keep it alive. */
  combo: number;
  comboLeft: number;
  /** Seconds left of the fifteen minutes. */
  left: number;
  /** The lift quest. */
  tools: boolean;
  lift: boolean;
  bestCombo: number;
  /** The chosen bud's passive, copied in so every balance helper works off the run alone. */
  perk: Perk;
}

export function newRun(seconds: number, perk: Perk = { blurb: "" }): Run {
  return {
    perk,
    money: 0,
    xp: 0,
    xpInLevel: 0,
    level: 1,
    points: 0,
    skills: { ...(perk.starts ?? {}) },
    delivered: 0,
    failed: 0,
    events: 0,
    combo: 0,
    comboLeft: 0,
    left: seconds,
    tools: false,
    lift: false,
    bestCombo: 0,
  };
}

export const xpNeeded = (run: Run): number => xpToLevel(run.level);
/** 1× at no streak, rising to COMBO_MAX. Multiplies both kroner and experience. */
export const comboMultiplier = (run: Run): number =>
  Math.min(COMBO_MAX, 1 + COMBO_STEP * Math.max(0, run.combo - 1));

export const capacity = (run: Run): number =>
  Math.max(2, 4 + 2 * skillLevel(run.skills, "kasse") + (run.perk.slots ?? 0));

/** Løbesko span the same range they always did — level 1 is +22 %, the top level +132 % — but over
 *  four steps instead of six, so each point is worth noticeably more. */
const SPRINT_FIRST = 0.22;
const SPRINT_TOP = 1.32;
export const sprintFactor = (run: Run): number => {
  const lv = skillLevel(run.skills, "sko");
  if (lv <= 0) return 1;
  const max = SKILLS.find((s) => s.id === "sko")!.max;
  return 1 + SPRINT_FIRST + ((SPRINT_TOP - SPRINT_FIRST) * (lv - 1)) / Math.max(1, max - 1);
};
export const walkFactor = (run: Run): number =>
  (1 + 0.1 * skillLevel(run.skills, "rulleskoejter")) * (run.perk.speed ?? 1);
/** Fredo shrugs off the soft slows — spilt beer and people. Boxes and bikes still stop him. */
export const sureFooted = (run: Run): boolean => run.perk.sureFooted === true;
export const canRun = (run: Run): boolean => skillLevel(run.skills, "sko") > 0;
export const canDash = (run: Run): boolean => skillLevel(run.skills, "dash") > 0;
export const canJump = (run: Run): boolean => skillLevel(run.skills, "hop") > 0;
export const hasMap = (run: Run): boolean => skillLevel(run.skills, "minikort") > 0;
export const dashCooldownFactor = (run: Run): number =>
  skillLevel(run.skills, "dash") >= 2 ? 0.55 : 1;

// --------------------------------------------------------------------------------------- save
export interface ScoreEntry {
  score: number;
  level: number;
  delivered: number;
  /** Epoch millis, so the board can show how long ago. */
  when: number;
}

export interface Save {
  version: 6;
  character: string;
  board: ScoreEntry[];
}

/** What a bud brings to the shift. Perks are deliberately trade-offs, not upgrades: two of them
 *  cost as much as they give, so picking one is a choice rather than a ranking. */
export interface Perk {
  /** Multiplies every movement speed. */
  speed?: number;
  /** Added to (or taken off) the belt. */
  slots?: number;
  /** Skills you start the shift already owning. */
  starts?: Partial<Record<SkillId, number>>;
  /** Walks through spilt beer and through people without slowing. Boxes and bikes still block. */
  sureFooted?: boolean;
  /** One line on the select screen. */
  blurb: string;
}

/** The four buds. `art` is the atlas prefix the generator writes their frames under; `sprite` is
 *  the frame the select screen shows. */
export const CHARACTERS = [
  {
    id: "albergon",
    perk: {
      starts: { minikort: 1 },
      blurb: "Kender huset: starter med minikortet.",
    },
    art: "alb",
    sprite: "alb_idle_down_0",
    name: "Albergon",
    blurb: "Kælderens førstemand. Kender hver en knirkende trappesten på GAHK.",
    unlocked: true,
  },
  {
    id: "markolas",
    perk: {
      speed: 1.2,
      slots: -1,
      blurb: "+20 % fart, men én kasseplads mindre.",
    },
    art: "mar",
    sprite: "mar_idle_down_0",
    name: "Markolas",
    blurb: "Lydløs på gangene, ser en tørstig beboer tre etager væk.",
    unlocked: true,
  },
  {
    id: "boraniel",
    perk: {
      speed: 0.8,
      slots: 2,
      blurb: "−20 % fart, men to kassepladser mere.",
    },
    art: "bor",
    sprite: "bor_idle_down_0",
    name: "Boraniel",
    blurb: "Rødhåret og rapkæftet. Har aldrig tabt et væddemål om en kasse øl.",
    unlocked: true,
  },
  {
    id: "fredo",
    perk: {
      sureFooted: true,
      blurb: "Går gennem øl på gulvet og forbi folk uden at sætte farten ned.",
    },
    art: "fre",
    sprite: "fre_idle_down_0",
    name: "Fredo",
    blurb: "Yngstemand i kælderen. Løber stærkt, spørger ikke om vej.",
    unlocked: true,
  },
] as const;

/** The atlas prefix for a saved character id, falling back to the first bud. */
export const artOf = (id: string): string =>
  CHARACTERS.find((c) => c.id === id)?.art ?? CHARACTERS[0].art;

/** The passive for a saved character id. */
export const perkOf = (id: string): Perk =>
  CHARACTERS.find((c) => c.id === id)?.perk ?? CHARACTERS[0].perk;

export const defaultSave = (): Save => ({ version: 6, character: "albergon", board: [] });

/** Keys from earlier versions, cleared on load so a bumped save does not leave litter behind. */
const STALE_KEYS = ["gahk.oelbud.v4", "gahk.oelbud.v5"];

export function loadSave(): Save {
  try {
    for (const k of STALE_KEYS) localStorage.removeItem(k);
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw) as Partial<Save>;
    if (parsed.version !== 6) return defaultSave();
    return { ...defaultSave(), ...parsed, board: parsed.board ?? [] };
  } catch {
    return defaultSave();
  }
}

export function writeSave(s: Save): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(s));
  } catch {
    /* private mode / quota — the run still plays, it just is not remembered. */
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

/** Add a finished run to the board and return its placing (1-based), or 0 if it did not make it. */
export function record(save: Save, run: Run): number {
  const entry: ScoreEntry = {
    score: run.money,
    level: run.level,
    delivered: run.delivered,
    when: Date.now(),
  };
  save.board.push(entry);
  save.board.sort((a, b) => b.score - a.score || a.when - b.when);
  save.board = save.board.slice(0, 10);
  writeSave(save);
  const at = save.board.indexOf(entry);
  return at < 0 ? 0 : at + 1;
}
