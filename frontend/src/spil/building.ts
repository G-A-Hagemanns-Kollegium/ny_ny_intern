/** The GAHK building, top-down, one floor at a time.
 *
 *  A floor is three things:
 *    cells  — rooms and other closed spaces, each with a door on its corridor-facing wall
 *    walk   — the rectangles the bud may actually stand in (the "walkable area" on the plans)
 *    stairs — the two stairwells, each a down flight and an up flight wrapped around a lift shaft
 *
 *  The walkable area is *not* the same on every floor — the cellar's is cut short by the kitchen,
 *  and 4. sal has a room you can walk into — so it is stored per floor rather than derived.
 *
 *  Room numbers and their occupants come from the server (core.Room + the current Residency list).
 *  With an empty database the identical map is rebuilt from the legacy rules, so the game never
 *  depends on seeded data.
 */

import { PROP_SIZE } from "./propsize";
import { TILE, WALL_BACK_H, WALL_FACE_H } from "./config";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type CellKind =
  | "room"
  | "kitchen"
  | "bath"
  | "kiosk"
  | "hall"
  | "utility"
  | "workshop"
  | "lounge"
  | "wardrobe"
  | "stairwell";

export interface Prop {
  sprite: string;
  /** Top-left, in world pixels. */
  x: number;
  y: number;
}

export interface Obstacle {
  /** World pixels — obstacles are placed by eye, not on the tile grid. This is the *drawn* rect. */
  x: number;
  y: number;
  w: number;
  h: number;
  sprite: string;
  /** What you actually bump into, if that is smaller than the sprite: you should be able to brush
   *  past the back of a sofa. Defaults to the whole rect. */
  hit?: Rect;
}

/** Spilt beer. No collision; you just wade. */
export interface Hazard {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Cell extends Rect {
  kind: CellKind;
  /** Open to the Gang: no door, no fourth wall, and you can walk straight in. */
  open: boolean;
  label: string;
  /** Room number for `kind === "room"`, else 0. */
  room: number;
  /** Who lives here — the current Residency list, or "" for anything that is not a room. */
  who: string;
  /** Which wall the door is in. Rooms above the Gang open downwards and vice versa. */
  doorSide: "top" | "bottom";
  /** Centre of the doorway, in world pixels. */
  doorX: number;
  doorY: number;
  props: Prop[];
  seed: number;
}

export interface Stairwell {
  /** The whole block. */
  frame: Rect;
  down: Rect;
  up: Rect;
  lift: Rect;
  /** Where the bud must stand to use each of them, in world pixels. */
  downAt: { x: number; y: number };
  upAt: { x: number; y: number };
  liftAt: { x: number; y: number };
}

export interface Floor {
  index: number;
  name: string;
  cells: Cell[];
  walk: Rect[];
  obstacles: Obstacle[];
  hazards: Hazard[];
  stairs: Stairwell[];
  /** Wall colours for this floor — 2. sal is the red one. `wallLight` is the lit top of a face. */
  wall: string;
  wallDark: string;
  wallLight: string;
}

export interface ServerRoom {
  n: number;
  floor: string;
  side: string;
  note: string;
  who: string;
}

// ------------------------------------------------------------------------------------- geometry
export const FLOOR_TW = 73; // tiles wide
export const FLOOR_TH = 16; // tiles tall
export const WORLD_W = FLOOR_TW * TILE;
export const WORLD_H = FLOOR_TH * TILE;

const STAIR_W = 12;
const TOP_Y = 2;
const TOP_H = 5;
export const CORR_Y = 7;
const CORR_H = 4;
const BOT_Y = 11;
const BOT_H = 5;
const RIGHT_STAIR_X = FLOOR_TW - STAIR_W;

/** Wall thickness in pixels — rooms are drawn as a filled wall rect with the floor inset inside. */
export const WALL = 3;

const px = (t: number): number => t * TILE;
const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

export function hash(n: number, salt = 0): number {
  let h = (n * 2654435761 + salt * 40503) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return h >>> 0;
}

// -------------------------------------------------------------------------------- the room map
const FLOOR_INDEX: Record<string, number> = {
  stuen: 1,
  "1. sal": 2,
  "2. sal": 3,
  "3. sal": 4,
  "4. sal": 5,
};

export const FLOOR_NAMES = ["Kælderen", "Stuen", "1. sal", "2. sal", "3. sal", "4. sal"];

interface RoomRec {
  n: number;
  floor: number;
  north: boolean;
  who: string;
}

/** The legacy delt.php map, rebuilt client-side when the server has no rooms. */
function fallbackRooms(): RoomRec[] {
  const out: RoomRec[] = [];
  const add = (n: number, floor: number, north: boolean): void => {
    out.push({ n, floor, north, who: "" });
  };
  for (let i = 1; i <= 8; i++) add(i, 1, false);
  add(9, 1, true);
  add(10, 1, true);
  for (let f = 2; f <= 4; f++) {
    for (let i = 1; i <= 9; i++) add((f - 1) * 100 + i, f, false);
    for (let i = 10; i <= 14; i++) add((f - 1) * 100 + i, f, true);
  }
  for (let i = 1; i <= 4; i++) add(400 + i, 5, false);
  for (let i = 5; i <= 9; i++) add(400 + i, 5, true);
  return out;
}

function normalise(rooms: ServerRoom[]): RoomRec[] {
  const out: RoomRec[] = [];
  for (const r of rooms) {
    const floor = FLOOR_INDEX[r.floor];
    if (!floor) continue;
    out.push({ n: r.n, floor, north: r.side === "mod gården", who: r.who || "" });
  }
  return out.length ? out : fallbackRooms();
}

// ------------------------------------------------------------------------------------ furniture
/** Against the wall opposite the door: one big piece per room. */
const TALL = ["dresser", "dresser1", "dresser2", "dresser3", "dresser4", "bookcase", "bookcase1",
  "wardrobe_tall", "blind", "blind1", "blind2", "wardrobe2", "wardrobe4", "cabinet"];
/** The strip beside the desk, and the corner by the bed. Small things only. */
const CORNER = ["bag", "bag1", "bag2", "bag3", "bag4", "board", "board1", "board2", "board3",
  "plush", "plush1", "plush2", "bottle", "bottle1", "bottle2", "clothes", "plant"];
/** Hung on the wall over the bed. */
const WALL_ART = ["banner", "banner1", "banner2", "banner3", "banner4", "banner5", "pin", "pin1",
  "poster", "mirror", "mirror2"];
const BEDS = ["bed", "bed1", "bed2", "bed3", "bed4", "bed5"];
const MATS = ["mat", "mat1", "mat2", "mat3", "rug", "rug2"];
const NIGHTSTANDS = ["nightstand", "nightstand1", "nightstand2", "nightstand3"];

const pickName = (pool: string[], n: number): string => pool[Math.abs(n) % pool.length];
/** A sprite's real footprint. Anything the atlas does not have falls back to something small
 *  enough not to overlap its neighbours. */
const size = (name: string): [number, number] => PROP_SIZE[name] ?? [12, 12];
/** Things you walk *over*, not into. */
const FLAT = new Set(["rug", "rug2", "rug_big", "mat", "mat1", "mat2", "mat3", "kmat", "kmat1"]);

const BED_W = 32;
const DESK_W = 16;
/** How much floor is kept clear in front of a room's big piece, so the resident can walk there. */
const LANE_DEPTH = 20;

/** The clear strip of floor between the bed and the desk. Everything that is not the bed or the
 *  desk is centred on it, and it is where the room's occupant paces — so the two cannot drift
 *  apart, `render.ts` asks for it here rather than working it out again. */
export function roomLane(r: Rect, doorSide: "top" | "bottom", seed: number): {
  x: number;
  w: number;
  y: number;
} {
  const x0 = px(r.x) + WALL + 2;
  const topWall = doorSide === "top" ? WALL_FACE_H : WALL_BACK_H;
  const botWall = doorSide === "bottom" ? WALL_FACE_H : WALL_BACK_H;
  return {
    x: x0 + (seed % 2 === 0 ? BED_W + 1 : DESK_W + 1),
    w: px(r.w) - (WALL + 2) * 2 - BED_W - DESK_W - 2,
    // The camera looks at the building from slightly south, so "in front of" always means further
    // down the screen. Whichever wall the big piece stands against, the resident walks nearer than
    // it — otherwise the wardrobe swallows them whole.
    y: doorSide === "top"
      ? px(r.y + r.h) - botWall - 6
      : px(r.y + r.h) - botWall - 13,
  };
}

/** Lay a room out from its seed. Deterministic, so a room looks the same every time you visit it.
 *
 *  The rule everywhere is the same: the big pieces go against the wall *opposite* the door, so the
 *  path from the doorway to the middle of the room stays clear and the room reads instantly from
 *  the Gang. */
function furnish(kind: CellKind, r: Rect, doorSide: "top" | "bottom", seed: number): Prop[] {
  const props: Prop[] = [];
  // The usable floor is what is left between the two walls. The door wall is a full face; the one
  // opposite is only a skirting, which is where the room finds space for a bed.
  const topWall = doorSide === "top" ? WALL_FACE_H : WALL_BACK_H;
  const botWall = doorSide === "bottom" ? WALL_FACE_H : WALL_BACK_H;
  const x0 = px(r.x) + WALL + 2;
  const y0 = px(r.y) + topWall + 1;
  const x1 = px(r.x + r.w) - WALL - 2;
  const y1 = px(r.y + r.h) - botWall - 1;
  const w = x1 - x0;
  const h = y1 - y0;
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;
  /** y of the wall opposite the door, and of the wall the door is in. */
  const far = doorSide === "top" ? y1 : y0;
  const near = doorSide === "top" ? y0 : y1;
  /** Place something flush against the far or near wall, given the sprite's height. */
  const atFar = (sh: number): number => (doorSide === "top" ? far - sh : far);
  const atNear = (sh: number): number => (doorSide === "top" ? near : near - sh);
  const put = (sprite: string, x: number, y: number): void => {
    props.push({ sprite, x: Math.round(x), y: Math.round(y) });
  };
  /** A sparse line of props along the far wall — how every storage room is furnished. */
  const line = (sprites: string[], sh: number, count: number, gapPx = 6): void => {
    const each = w / count;
    for (let i = 0; i < count; i++) {
      put(sprites[(seed + i) % sprites.length], x0 + i * each + gapPx, atFar(sh));
    }
  };
  const flip = seed % 2 === 0;

  switch (kind) {
    case "room": {
      // A GAHK room is 102x58 px of floor: a bed and its nightstand on one side, a desk and chair
      // on the other, and a clear lane down the middle that the resident paces. Everything is
      // picked from the room's seed, so no two are furnished alike and any one room is always the
      // same. Sizes come from `PROP_SIZE`, which the atlas generator writes, so the layout cannot
      // drift when a sprite is recut.
      const bedName = pickName(BEDS, seed);
      const [bedW, bedH] = size(bedName);
      const bedX = flip ? x0 : x1 - bedW;
      const deskX = flip ? x1 - DESK_W : x0;
      put(bedName, bedX, atFar(bedH));

      // A nightstand tucked against the bed, on whichever side faces the middle of the room.
      const nsName = pickName(NIGHTSTANDS, seed >> 3);
      put(nsName, flip ? bedX + bedW + 1 : bedX - size(nsName)[0] - 1, atFar(size(nsName)[1]));

      put("desk", deskX + 1, atFar(22));
      put("chair", deskX + 2, doorSide === "top" ? atFar(22) - 22 : atFar(22) + 23);

      // Something hung over the bed. The near wall is clear there — the bed only reaches 38 px in.
      if ((seed >> 6) % 4 !== 0) {
        const art = pickName(WALL_ART, seed >> 7);
        put(art, bedX + (bedW - size(art)[0]) / 2, atNear(size(art)[1]));
      }

      const lane = roomLane(r, doorSide, seed);
      const matName = pickName(MATS, seed >> 12);
      if ((seed >> 11) % 4 !== 0) {
        put(matName, lane.x + (lane.w - size(matName)[0]) / 2, cy - size(matName)[1] / 2);
      }

      // The big piece, held back by the width of the lane so the resident walks in front of it.
      const tallName = pickName(TALL, seed >> 2);
      const [tallW, tallH] = size(tallName);
      const against = (sh: number): number => (doorSide === "top" ? y1 - LANE_DEPTH - sh : y0 + 4);
      if (tallW <= 20) {
        const mate = pickName(CORNER, seed >> 15);
        put(tallName, lane.x + 2, against(tallH));
        put(mate, lane.x + lane.w - size(mate)[0] - 2, against(size(mate)[1]));
      } else {
        put(tallName, lane.x + (lane.w - tallW) / 2, against(tallH));
      }

      // The strip past the desk has about 15 px to spare, so only the flattest things fit there.
      if ((seed >> 8) % 3 !== 0) {
        const cornerName = pickName(CORNER, seed >> 9);
        put(cornerName, deskX + 1, atNear(Math.min(15, size(cornerName)[1])));
      }
      break;
    }
    case "kitchen": {
      // Gangkøkkenet. A worktop run along the wall opposite the door, and a table in the middle
      // that four people can stand around — the party event puts its guests here.
      const wall = (name: string, at: number): number => {
        const [pw, ph] = size(name);
        put(name, at, atFar(ph));
        return at + pw + 1;
      };
      let at = x0 + 1;
      at = wall(pickName(["kfridge", "kfridge1", "kfridge2"], seed), at);
      at = wall(pickName(["worktop", "worktop1", "worktop2"], seed >> 2), at);
      at = wall(pickName(["hob", "hob1", "hob2"], seed >> 4), at);
      at = wall(pickName(["worktop", "worktop1", "worktop2"], seed >> 6), at);
      if (at + 20 < x1) at = wall(seed % 2 ? "microwave" : "cooler", at);
      if (at + 26 < x1) wall(pickName(["sideboard", "sideboard1", "sideboard2"], seed >> 8), at);

      const mat = pickName(["kmat", "kmat1"], seed >> 10);
      put(mat, cx - size(mat)[0] / 2, cy - size(mat)[1] / 2 + 4);
      // A table with legs, then the cloth on top of it — the kitchen theme's "table" sprites are
      // just the cloth, which on its own reads as a slab of colour on the floor.
      const board = pickName(["lowtable", "lowtable1", "lowtable2", "lowtable3"], seed >> 11);
      const [bw, bh] = size(board);
      put(board, cx - bw / 2, cy - bh / 2);
      put("stool", cx - bw / 2 - 16, cy - 2);
      put("stool", cx + bw / 2 + 2, cy - 2);
      break;
    }
    case "bath":
      put("shower", x0, atFar(14));
      put("toilet", cx - 4, atFar(11));
      put("sink", x1 - 12, atFar(8));
      break;
    case "kiosk":
      // The bar is in the door wall — this is a counter you are served over, not a room you enter.
      put("bar", cx - 12, atNear(10));
      put("fridge", x0 + 4, atFar(32));
      put("fridge", x0 + 72, atFar(32));
      line(["crate", "keg", "barrel"], 12, 3, 8);
      break;
    case "workshop":
      put("workbench", x0 + 2, atFar(10));
      put("crate", x1 - 14, atFar(10));
      break;
    case "lounge": {
      // The cellar common room.
      const couch = pickName(["couch", "couch1", "couch2", "couch3"], seed);
      put("kmat", cx - 15, cy - 12);
      put(couch, x0 + 6, atFar(size(couch)[1]));
      const lt = pickName(["lowtable", "lowtable1", "lowtable2", "lowtable3"], seed >> 3);
      put(lt, cx - size(lt)[0] / 2, cy - 6);
      put("plant_tall", x1 - 18, atFar(34));
      break;
    }
    case "wardrobe":
      // Garderoben: a run of cupboards along the far wall.
      line(["wardrobe_tall", "cupboard", "cupboard1"], size("wardrobe_tall")[1],
        Math.max(2, Math.floor(w / 36)), 6);
      break;
    case "hall": {
      // The Hall on Stuen and festsalen in Kælderen. Both are open — you walk straight in from the
      // Gang — and both are wide, so the furniture is laid out as a repeating run rather than
      // placed by hand: seating along the far wall, low tables in front of it, plants at the ends.
      let at = x0 + 6;
      let i = 0;
      while (at + 34 < x1) {
        const couch = pickName(["couch", "couch1", "couch2", "couch3"], seed + i);
        const [cw, ch] = size(couch);
        put(couch, at, atFar(ch));
        const lt = pickName(["lowtable", "lowtable1", "lowtable2", "lowtable3"], seed + i * 3);
        put(lt, at + (cw - size(lt)[0]) / 2, atFar(ch) + (doorSide === "top" ? -20 : ch + 4));
        at += cw + 14;
        i += 1;
      }
      const benchName = pickName(["bench", "bench1", "bench2"], seed >> 5);
      put(benchName, cx - size(benchName)[0] / 2, atNear(size(benchName)[1]));
      put("plant_tall", x0 + 2, atNear(34));
      put("palm", x1 - 28, atNear(34));
      break;
    }
    case "utility": {
      // Cellar storage. The kit is picked by the seed the caller passes, so vaskekælderen is full
      // of washing machines and cykelkælderen of bikes rather than both being generic clutter.
      const kits = [
        ["washer", "washer", "crate"],
        ["bike", "bike", "bike"],
        ["barrel", "keg", "crate"],
        ["crate", "barrel", "crate"],
        ["shelf", "crate", "barrel"],
      ];
      const kit = kits[seed % kits.length];
      line(kit, 12, Math.max(2, Math.min(5, Math.floor(w / 30))), 8);
      break;
    }
    default:
      break;
  }
  return props;
}

// -------------------------------------------------------------------------- corridor clutter
/** Things left standing in the Gang. Deterministic per floor, so the route you learn stays the
 *  route — but different enough between floors that the run up to 4. sal is not the run up to 1.
 *
 *  Obstacles block; hazards (spilt beer) only slow you down. Both are kept clear of the doors and
 *  the stairwells so nothing can ever wall you in or make an order unreachable. */
const CLUTTER_KIT: { sprite: string; w: number; h: number }[] = [
  { sprite: "boxes", w: 18, h: 16 },
  { sprite: "bucket", w: 12, h: 12 },
  { sprite: "mop", w: 10, h: 16 },
  { sprite: "bike", w: 16, h: 8 },
  { sprite: "crate", w: 10, h: 10 },
];

function clutter(
  floor: number,
  cells: Cell[],
  corridorY: number,
  corridorH: number,
): { obstacles: Obstacle[]; hazards: Hazard[] } {
  const obstacles: Obstacle[] = [];
  const hazards: Hazard[] = [];
  const doors = cells.filter((c) => !c.open).map((c) => c.doorX);
  const top = px(corridorY);
  const bottom = px(corridorY + corridorH);

  /** Free of doorways, of both stairwells, and of anything already dropped here. */
  const ok = (x: number, w: number): boolean => {
    if (x < px(14) || x + w > px(FLOOR_TW - 14)) return false;
    if (doors.some((d) => Math.abs(d - (x + w / 2)) < 34)) return false;
    if (obstacles.some((o) => x < o.x + o.w + 20 && o.x < x + w + 20)) return false;
    return !hazards.some((h) => x < h.x + h.w + 20 && h.x < x + w + 20);
  };

  for (let i = 0; i < 14; i++) {
    const h = hash(floor * 131 + i, 17);
    const kit = CLUTTER_KIT[h % CLUTTER_KIT.length];
    const x = px(14) + ((h >> 4) % (px(FLOOR_TW - 28) - kit.w));
    if (obstacles.length < 3 + (floor % 2) && ok(x, kit.w)) {
      // Against one wall of the Gang, never in the middle: there must always be a way past.
      const y = (h >> 12) % 2 ? top + 3 : bottom - kit.h - 3;
      obstacles.push({ x, y, w: kit.w, h: kit.h, sprite: kit.sprite });
      continue;
    }
    if (hazards.length < 2 && ok(x, 22)) {
      hazards.push({ x, y: top + 18 + ((h >> 16) % 20), w: 22, h: 12 });
    }
  }
  return { obstacles, hazards };
}

// -------------------------------------------------------------------------------- construction
interface Slot {
  kind: CellKind;
  label: string;
  w: number; // tiles
  room?: number;
  who?: string;
  /** A gap in the row rather than a cell. */
  gap?: boolean;
  /** Open to the Gang — the Hall and festsalen are rooms you walk through, not knock on. */
  open?: boolean;
}

const slot = (kind: CellKind, label: string, w: number, room = 0, who = ""): Slot => ({
  kind,
  label,
  w,
  room,
  who,
});
const openSlot = (kind: CellKind, label: string, w: number): Slot => ({ kind, label, w, open: true });
const gap = (w: number): Slot => ({ kind: "room", label: "", w, gap: true });

function row(slots: Slot[], startX: number, y: number, h: number, doorSide: "top" | "bottom", floor: number): Cell[] {
  const cells: Cell[] = [];
  let x = startX;
  for (const s of slots) {
    if (!s.gap) {
      const r = rect(x, y, s.w, h);
      const seed = hash(floor * 977 + x * 13, doorSide === "top" ? 5 : 9);
      const doorX = px(x + s.w / 2);
      const doorY = doorSide === "top" ? px(y) : px(y + h);
      cells.push({
        ...r,
        kind: s.kind,
        open: !!s.open,
        label: s.label,
        room: s.room ?? 0,
        who: s.who ?? "",
        doorSide,
        doorX,
        doorY,
        seed,
        props: furnish(s.kind, r, doorSide, seed),
      });
    }
    x += s.w;
  }
  return cells;
}

function stairwell(bx: number): Stairwell {
  return {
    frame: rect(bx, 0, STAIR_W, CORR_Y),
    down: rect(bx + 1, 1, 3, 4),
    lift: rect(bx + 4, 1, 4, 4),
    up: rect(bx + 8, 1, 3, 4),
    downAt: { x: px(bx + 2.5), y: px(5.6) },
    liftAt: { x: px(bx + 6), y: px(5.6) },
    upAt: { x: px(bx + 9.5), y: px(5.6) },
  };
}

/** Both stairwells, plus the landings that join them to the Gang. Identical on every floor, so a
 *  flight always arrives where the one below it left. */
function stairsAndLandings(): { stairs: Stairwell[]; walk: Rect[] } {
  return {
    stairs: [stairwell(0), stairwell(RIGHT_STAIR_X)],
    walk: [rect(1, 5, 10, 2), rect(RIGHT_STAIR_X + 1, 5, 10, 2)],
  };
}

function upperFloor(index: number, rooms: RoomRec[]): Floor {
  const on = rooms.filter((r) => r.floor === index).sort((a, b) => a.n - b.n);
  const north = on.filter((r) => r.north);
  const south = on.filter((r) => !r.north);
  const num = (n: number): string => String(n).padStart(3, "0");

  // --- mod gården (above the Gang): køkken, the five rooms, toilet og bad ---------------------
  const top: Slot[] = [slot("kitchen", "køkken", 7)];
  if (index === 1) {
    // Stuen: 009, then the Hall, then 010 (see the plan).
    top.push(slot("room", num(9), 7, 9, north[0]?.who ?? ""));
    top.push(openSlot("hall", "Hall", 21));
    top.push(slot("room", num(10), 7, 10, north[1]?.who ?? ""));
  } else {
    for (const r of north) top.push(slot("room", num(r.n), 7, r.n, r.who));
  }
  top.push(slot("bath", "toilet", 7));

  // --- mod gaden (below the Gang) --------------------------------------------------------------
  let bottom: Slot[];
  if (index === 1) {
    bottom = [];
    for (const r of south) {
      bottom.push(slot("room", num(r.n), 7, r.n, r.who));
      if (r.n === 4) bottom.push(gap(7)); // the plan's break between 004 and 005
    }
  } else if (index === 5) {
    const by = (n: number) => south.find((r) => r.n === n);
    const cell = (n: number): Slot => {
      const r = by(n);
      return slot("room", num(n), 9, n, r?.who ?? "");
    };
    bottom = [
      cell(401),
      slot("lounge", "lounge", 9),
      slot("workshop", "værksted", 9),
      cell(402),
      cell(403),
      slot("wardrobe", "garderobe", 9),
      cell(404),
    ];
  } else {
    bottom = south.map((r) => slot("room", num(r.n), 7, r.n, r.who));
  }

  const { stairs, walk } = stairsAndLandings();
  const cells = [
    ...row(top, STAIR_W, TOP_Y, TOP_H, "bottom", index),
    ...row(bottom, 5, BOT_Y, BOT_H, "top", index),
  ];

  const floorWalk = [rect(5, CORR_Y, FLOOR_TW - 10, CORR_H), ...walk];

  // Open areas (Stuen's Hall) are part of the Gang: walk straight in, no door.
  for (const c of cells) {
    if (c.open) floorWalk.push(rect(c.x + 1, c.y + 1, c.w - 2, c.h - 1));
  }

  // 4. sal's værksted is the one *closed* room you can walk into — the lift tools are in there.
  if (index === 5) {
    const ws = cells.find((c) => c.kind === "workshop");
    if (ws) {
      floorWalk.push(rect(ws.x + 1, ws.y + 1, ws.w - 2, ws.h - 1));
      floorWalk.push(rect(ws.x + ws.w / 2 - 1.5, ws.y, 3, 1)); // the doorway itself
    }
  }

  const { obstacles, hazards } = clutter(index, cells, CORR_Y, CORR_H);
  return {
    index,
    name: FLOOR_NAMES[index],
    cells,
    walk: floorWalk,
    obstacles: [...obstacles, ...openFurniture(cells)],
    hazards,
    stairs,
    ...wallsFor(index),
  };
}

/** Furniture standing in an open area is scenery you have to walk around, not decoration behind a
 *  door — so it moves out of `props` and into the floor's obstacle list. */
function openFurniture(cells: Cell[]): Obstacle[] {
  const out: Obstacle[] = [];
  for (const c of cells) {
    if (!c.open) continue;
    for (const prop of c.props) {
      // A hand-tuned box where there is one — you should be able to brush past the corner of a
      // sofa — and otherwise one derived from the sprite. Falling through used to *drop* the prop
      // entirely, which is how festsalen ended up an empty room the day it got furniture.
      const [pw, ph] = size(prop.sprite);
      const [bw, bh] = COLLIDE[prop.sprite] ?? (FLAT.has(prop.sprite)
        ? [0, 0]
        : [Math.max(6, pw - 8), Math.min(13, Math.max(5, ph - 8))]);
      out.push({
        x: prop.x,
        y: prop.y,
        w: pw,
        h: ph,
        sprite: prop.sprite,
        // Anchored at the foot of the sprite: the base is what is on the floor with you.
        hit: { x: prop.x + (pw - bw) / 2, y: prop.y + ph - bh, w: bw, h: bh },
      });
    }
    c.props = [];
  }
  return out;
}

/** Collision boxes for props that end up in a walkable area. Deliberately *not* the sprite's real
 *  footprint: you should be able to brush past the corner of a sofa. */
const COLLIDE: Record<string, [number, number]> = {
  sofa: [18, 10],
  table: [18, 12],
  plant: [8, 10],
  rug: [0, 0],
  chair: [8, 8],
  crate: [10, 10],
  barrel: [10, 11],
  keg: [12, 12],
};

/** Per-floor wall colour. 2. sal is the red one; the rest step through the house's warm neutrals so
 *  you can tell which floor you are on from the walls alone. */
function wallsFor(index: number): { wall: string; wallDark: string; wallLight: string } {
  const palette: Record<number, { wall: string; wallDark: string; wallLight: string }> = {
    0: { wall: "#6d6a63", wallDark: "#3f3d39", wallLight: "#8b877e" }, // Kælderen — bare render
    1: { wall: "#b7a684", wallDark: "#6b6049", wallLight: "#d6c7a6" },
    2: { wall: "#a8b09a", wallDark: "#616754", wallLight: "#c8cfba" },
    3: { wall: "#b4544c", wallDark: "#632924", wallLight: "#d47a70" }, // 2. sal — red
    4: { wall: "#9fa8b8", wallDark: "#5b626f", wallLight: "#c0c9d6" },
    5: { wall: "#bda37e", wallDark: "#6f5d45", wallLight: "#dbc39e" },
  };
  return palette[index] ?? palette[1];
}

/** The cellar. Ølkælderen is the counter every order is picked up from; festsalen and the kitchen
 *  are the two blocks that make this floor's walkable area different from every other one. */
function basement(): Floor {
  const cells: Cell[] = [];
  const add = (
    kind: CellKind,
    label: string,
    r: Rect,
    doorSide: "top" | "bottom",
    seedSalt = 0,
    open = false,
  ): void => {
    const seed = hash(r.x * 31 + r.y, seedSalt);
    cells.push({
      ...r,
      kind,
      open,
      label,
      room: 0,
      who: "",
      doorSide,
      doorX: px(r.x + r.w / 2),
      doorY: doorSide === "top" ? px(r.y) : px(r.y + r.h),
      seed,
      props: furnish(kind, r, doorSide, seed),
    });
  };

  add("bath", "toilet", rect(13, TOP_Y, 6, TOP_H), "bottom");
  add("kiosk", "ØLKÆLDEREN", rect(19, TOP_Y, 12, TOP_H), "bottom");
  add("hall", "festsalen", rect(33, 0, 24, CORR_Y), "bottom", 2, true);
  add("utility", "vaskekælder", rect(5, BOT_Y, 10, BOT_H), "top", 0); // washers
  add("utility", "cykelkælder", rect(15, BOT_Y, 8, BOT_H), "top", 1); // bikes
  add("utility", "batik", rect(23, BOT_Y, 10, BOT_H), "top", 4); // tables
  add("kitchen", "kitchen", rect(46, BOT_Y - 1, 22, BOT_H + 1), "top");

  const { stairs, walk } = stairsAndLandings();
  // The Gang is cut short on the right by the kitchen, which juts a tile up into it, and it opens
  // straight into festsalen — the one room down here nobody has to knock on.
  const floorWalk = [rect(5, CORR_Y, 41, CORR_H), rect(46, CORR_Y, 22, CORR_H - 1), ...walk];
  for (const c of cells) {
    if (c.open) floorWalk.push(rect(c.x + 1, c.y + 1, c.w - 2, c.h - 1));
  }
  const { obstacles, hazards } = clutter(0, cells, CORR_Y, CORR_H);
  return {
    index: 0,
    name: FLOOR_NAMES[0],
    cells,
    walk: floorWalk,
    obstacles: [...obstacles, ...openFurniture(cells)],
    hazards,
    stairs,
    ...wallsFor(0),
  };
}

export interface Building {
  floors: Floor[];
  rooms: { room: number; floor: number; cell: Cell }[];
  /** Where a party can break out: festsalen, and every gangkøkken. Never somebody's bedroom. */
  partySpots: { cell: Cell; floor: number }[];
  kiosk: Cell;
  /** Where a shift begins: on the Gang, just outside the Ølkælder counter. */
  start: { x: number; y: number };
}

export function buildBuilding(serverRooms: ServerRoom[]): Building {
  const rooms = normalise(serverRooms);
  const floors: Floor[] = [basement()];
  for (let i = 1; i <= 5; i++) floors.push(upperFloor(i, rooms));

  const roomList: Building["rooms"] = [];
  for (const f of floors) {
    for (const c of f.cells) {
      if (c.kind === "room") roomList.push({ room: c.room, floor: f.index, cell: c });
    }
  }

  const partySpots: Building["partySpots"] = [];
  for (const f of floors) {
    for (const c of f.cells) {
      if (c.kind === "kitchen" || (c.kind === "hall" && c.open)) partySpots.push({ cell: c, floor: f.index });
    }
  }

  const kiosk = floors[0].cells.find((c) => c.kind === "kiosk")!;
  return {
    floors,
    rooms: roomList,
    partySpots,
    kiosk,
    start: { x: kiosk.doorX, y: px(CORR_Y + 1.5) },
  };
}

// ------------------------------------------------------------------------------------- helpers
export const inRect = (r: Rect, x: number, y: number): boolean =>
  x >= px(r.x) && x <= px(r.x + r.w) && y >= px(r.y) && y <= px(r.y + r.h);

export const inAnyRect = (rects: Rect[], x: number, y: number): boolean =>
  rects.some((r) => inRect(r, x, y));

export const rectPx = (r: Rect): Rect => ({ x: px(r.x), y: px(r.y), w: px(r.w), h: px(r.h) });

/** A fictional stand-in when a room is empty on the current residency list. */
const SPARE_NAMES = ["Emil", "Sofie", "Jonas", "Freja", "Mads", "Ida", "Clara", "Oscar", "Alma", "Anton"];
export const occupantOf = (cell: Cell): string =>
  cell.who || SPARE_NAMES[hash(cell.room, 7) % SPARE_NAMES.length];
