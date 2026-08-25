/** Ølbuddet — geometry and balance constants, all in one place so the game can be tuned without
 *  reading the simulation code. Nothing here is imported by the site bundle. */

export const TILE = 16;

/** Logical (pre-scale) viewport. The canvas element is exactly 2× this. */
export const VIEW_W = 448;
export const VIEW_H = 288;
export const HUD_H = 26;

export const KIOSK_FLOOR = 0;
export const FLOOR_COUNT = 6;

// ------------------------------------------------------------------------------------ movement
export const BASE_SPEED = 96; // px/s
/** How much a puddle of spilt beer costs you while you are in it. */
export const HAZARD_SLOW = 0.45;
/** Bumping a resident in the Gang: a stumble, not a stop. */
export const BUMP_SECONDS = 0.7;
export const BUMP_SLOW = 0.4;
export const NPC_SPEED = 34;
export const STAIR_SECONDS = 1.1;
export const LIFT_BOARD_SECONDS = 0.9;
export const LIFT_PER_FLOOR_SECONDS = 0.45;
/** Speed lost per carried item, unless the Sækkevogn is owned. */
export const CARRY_PENALTY_PER_ITEM = 0.022;
export const CARRY_PENALTY_MAX = 0.24;

/** The bud's feet box — what actually has to fit inside the walkable area. */
export const BODY_W = 10;
export const BODY_H = 8;

// -------------------------------------------------------------------------------------- orders
export const ORDER_MIN_ITEMS = 1;
export const ORDER_MAX_ITEMS = 4;
/** How many requests may be waiting at once. Nothing else in the game is on a clock. */
export const MAX_PENDING = 6;
export const SPAWN_SECONDS = 9;

/** The one timer in the game: it starts when you take an order at the door and runs until you have
 *  delivered it. Generous enough to walk it, tight enough that the lift and the Løbesko matter. */
export const DEADLINE_BASE = 55;
export const DEADLINE_PER_ITEM = 7;
export const DEADLINE_PER_FLOOR = 15;
/** Below this fraction of the deadline the order goes red. */
export const URGENT_FRACTION = 0.3;

/** Payment, in kroner: a fee plus per item and per floor climbed, jittered, plus a speed bonus. */
export const PAY_BASE = 12;
export const PAY_PER_ITEM = 5;
export const PAY_PER_FLOOR = 4;
export const PAY_JITTER = 0.2;
export const SPEED_BONUS_MAX = 0.5;

// ------------------------------------------------------------------------------------ rendering
export const PALETTE = {
  void: "#15111c",
  corridor: "#8a6a4a",
  corridorAlt: "#7d5f42",
  runner: "#4d7256",
  runnerEdge: "#365a3e",
  roomFloor: "#a98a63",
  roomFloorAlt: "#9c7d58",
  tileFloor: "#8d97a0",
  concrete: "#77746d",
  ink: "#241b16",
  paper: "#f3efe6",
  brass: "#d9b566",
  green: "#4b7f5c",
  greenLight: "#6aa87c",
  red: "#d06a5c",
  lamp: "#ffd9a0",
  shadow: "rgba(20,14,26,0.35)",
} as const;

// -------------------------------------------------------------------------------------- events
/** Seconds of quiet between one event ending and the next being offered. */
export const EVENT_COOLDOWN = 55;
export const EVENT_COOLDOWN_JITTER = 40;
/** No events until the player has found their feet. */
export const EVENT_MIN_DELIVERIES = 3;
