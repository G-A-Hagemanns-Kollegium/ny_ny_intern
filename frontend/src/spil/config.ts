/** Lords of the ØK — geometry and balance constants, all in one place so the game can be tuned without
 *  reading the simulation code. Nothing here is imported by the site bundle. */

export const TILE = 16;

/** Logical (pre-scale) viewport. The canvas element is exactly 2× this. */
export const VIEW_W = 448;
export const VIEW_H = 288;
export const HUD_H = 34;

/** How tall a wall stands in the oblique projection, in pixels. Walls have no thickness in the
 *  plan — the face is painted inside the space it belongs to — so this is purely how much of each
 *  room you trade for being able to see its walls. */
export const WALL_FACE_H = 15;
/** The wall *opposite* the door. You barely see it in this projection, so it is a skirting rather
 *  than a full face — which is what gives a room enough floor for a bed to fit in it. */
export const WALL_BACK_H = 7;
/** Thickness of the walls running north-south, seen almost edge-on. */
export const WALL_SIDE = 3;

export const KIOSK_FLOOR = 0;
export const FLOOR_COUNT = 6;

// --------------------------------------------------------------------------------------- a run
/** A run is fifteen minutes. When it ends the score goes on the board and that is that. */
export const RUN_SECONDS = 10 * 60;
/** The same number, for the copy that quotes it. Derived so the two cannot drift apart. */
export const RUN_MINUTES = Math.round(RUN_SECONDS / 60);

// ------------------------------------------------------------------------------------ movement
/** Base walking pace. Six levels of Løbesko take a sprint to 2.3× this, and four of
 *  Rulleskøjter take the walk to 1.4× — a fully invested bud crosses the Gang in about 3 seconds. */
export const BASE_SPEED = 104; // px/s
export const HAZARD_SLOW = 0.45;
export const BUMP_SECONDS = 0.7;
export const BUMP_SLOW = 0.4;
export const NPC_SPEED = 34;
export const STAIR_SECONDS = 1.1;
export const LIFT_BOARD_SECONDS = 0.9;
export const LIFT_PER_FLOOR_SECONDS = 0.45;

/** Dash: a short burst, on a cooldown. */
export const DASH_SPEED = 320;
export const DASH_SECONDS = 0.22;
export const DASH_COOLDOWN = 2.6;

/** Jump: while airborne you clear obstacles and puddles. */
export const JUMP_SECONDS = 0.52;
export const JUMP_HEIGHT = 13; // px the sprite rises at the top of the arc

/** Speed lost per carried item. A full crate is worth slowing down for. */
export const CARRY_PENALTY_PER_ITEM = 0.022;
export const CARRY_PENALTY_MAX = 0.24;

/** The bud's feet box — what actually has to fit inside the walkable area. */
export const BODY_W = 10;
export const BODY_H = 8;

// -------------------------------------------------------------------------------------- orders
export const ORDER_MIN_ITEMS = 1;
export const ORDER_MAX_ITEMS = 4;
export const MAX_PENDING = 5;
/** How many orders you may have on the go at once. The order strip in the top bar is sized to show
 *  exactly this many, so the two numbers have to move together. */
export const MAX_ACCEPTED = 5;
export const SPAWN_SECONDS = 9;

/** The delivery clock: starts when you take an order at the door, stops when you hand it over. */
export const DEADLINE_BASE = 55;
export const DEADLINE_PER_ITEM = 7;
export const DEADLINE_PER_FLOOR = 15;
export const URGENT_FRACTION = 0.3;

/** Payment, in kroner — the score. A fee plus per item and per floor, jittered, plus speed. */
export const PAY_BASE = 12;
export const PAY_PER_ITEM = 5;
export const PAY_PER_FLOOR = 4;
export const PAY_JITTER = 0.2;
export const SPEED_BONUS_MAX = 0.5;

// ----------------------------------------------------------------------------- experience
/** Experience is almost entirely about *speed*: the flat part is small and the part that scales
 *  with the deadline you had left is large. Long climbs and big orders top it up. */
export const XP_BASE = 12;
export const XP_SPEED = 46;
export const XP_PER_FLOOR = 5;
export const XP_PER_ITEM = 3;

/** Experience needed to reach level L+1 from level L. */
export const xpToLevel = (level: number): number => 90 + 55 * (level - 1);

/** Deliver again within this many seconds and the streak keeps going. */
export const COMBO_WINDOW = 26;
export const COMBO_STEP = 0.15;
export const COMBO_MAX = 2;

// -------------------------------------------------------------------------------------- events
export const EVENT_COOLDOWN = 55;
export const EVENT_COOLDOWN_JITTER = 40;
export const EVENT_MIN_DELIVERIES = 3;

// ------------------------------------------------------------------------------------- effects
/** How long the fireworks get before the skill panel interrupts. */
export const LEVEL_FX_SECONDS = 1.5;
export const SPARKS_PER_BURST = 26;

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
