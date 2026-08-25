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

import { TILE } from "./config";

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
  /** World pixels — obstacles are placed by eye, not on the tile grid. */
  x: number;
  y: number;
  w: number;
  h: number;
  sprite: string;
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
  /** Wall colour for this floor — 2. sal is the red one. */
  wall: string;
  wallDark: string;
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
const CORR_Y = 7;
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
/** Lay a room out from its seed. Deterministic, so a room looks the same every time you visit it.
 *
 *  The rule everywhere is the same: the big pieces go against the wall *opposite* the door, so the
 *  path from the doorway to the middle of the room stays clear and the room reads instantly from
 *  the Gang. */
function furnish(kind: CellKind, r: Rect, doorSide: "top" | "bottom", seed: number): Prop[] {
  const props: Prop[] = [];
  const x0 = px(r.x) + WALL + 2;
  const y0 = px(r.y) + WALL + 2;
  const x1 = px(r.x + r.w) - WALL - 2;
  const y1 = px(r.y + r.h) - WALL - 2;
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
      const bedX = flip ? x0 : x1 - 14;
      const deskX = flip ? x1 - 16 : x0;
      put("rug", cx - 9, cy - 6);
      put("bed", bedX, atFar(20));
      put("desk", deskX, atFar(10));
      put("chair", deskX + 4, doorSide === "top" ? atFar(10) - 9 : atFar(10) + 11);
      put(seed % 3 === 0 ? "shelf" : "wardrobe", flip ? x1 - 10 : x0, atNear(14));
      if (seed % 4 === 0) put("plant", flip ? x0 + 2 : x1 - 8, atNear(10));
      break;
    }
    case "kitchen":
      put("counter", x0, atFar(10));
      put("stove", x0 + 24, atFar(12));
      put("fridge", x1 - 12, atFar(14));
      put("table", cx - 9, cy - 2);
      put("chair", cx - 4, atNear(8));
      break;
    case "bath":
      put("shower", x0, atFar(14));
      put("toilet", cx - 4, atFar(11));
      put("sink", x1 - 12, atFar(8));
      break;
    case "kiosk":
      // The bar is in the door wall — this is a counter you are served over, not a room you enter.
      put("bar", cx - 12, atNear(10));
      line(["crate", "keg", "barrel", "crate"], 12, 5);
      break;
    case "workshop":
      // No toolbox here: that one is a pickup in the world, not scenery.
      put("workbench", x0 + 4, atFar(10));
      put("crate", x1 - 14, atFar(10));
      put("shelf", cx - 8, atNear(6));
      break;
    case "lounge":
      put("sofa", x0 + 4, atFar(10));
      put("table", cx - 9, cy - 4);
      put("plant", x1 - 10, atFar(10));
      break;
    case "wardrobe":
      line(["wardrobe"], 14, Math.max(2, Math.floor(w / 22)), 4);
      break;
    case "hall":
      put("rug", cx - 9, cy - 6);
      put("sofa", x0 + 8, atFar(10));
      put("sofa", x1 - 26, atFar(10));
      put("table", cx - 9, atNear(12));
      put("plant", x0 + 2, atNear(10));
      put("plant", x1 - 10, atNear(10));
      break;
    case "utility": {
      // Cellar storage. The kit is picked by the seed the caller passes, so vaskekælderen is full
      // of washing machines and cykelkælderen of bikes rather than both being generic clutter.
      const kits = [
        ["washer", "washer", "crate"],
        ["bike", "bike", "bike"],
        ["barrel", "keg", "crate"],
        ["crate", "barrel", "crate"],
        ["table", "chair", "crate"],
      ];
      const kit = kits[seed % kits.length];
      line(kit, 12, Math.max(2, Math.min(5, Math.floor(w / 30))), 8);
      if (h > 50) put(kit[0], x0 + 8, atNear(12));
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
      const size = PROP_SIZE[prop.sprite];
      if (size) out.push({ x: prop.x, y: prop.y, w: size[0], h: size[1], sprite: prop.sprite });
    }
    c.props = [];
  }
  return out;
}

/** Collision sizes for the props that can end up in a walkable area. */
const PROP_SIZE: Record<string, [number, number]> = {
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
function wallsFor(index: number): { wall: string; wallDark: string } {
  const palette: Record<number, { wall: string; wallDark: string }> = {
    0: { wall: "#6d6a63", wallDark: "#474540" },
    1: { wall: "#b7a684", wallDark: "#7d7057" },
    2: { wall: "#a8b09a", wallDark: "#6f7565" },
    3: { wall: "#b4544c", wallDark: "#7a3630" }, // 2. sal — red
    4: { wall: "#9fa8b8", wallDark: "#6a7280" },
    5: { wall: "#bda37e", wallDark: "#806c52" },
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

  const kiosk = floors[0].cells.find((c) => c.kind === "kiosk")!;
  return {
    floors,
    rooms: roomList,
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
