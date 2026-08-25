/**
 * Builds Ølbuddet's sprite sheet: app/static/spil/atlas.png (+ atlas.json).
 *
 *   node tools/build-atlas.mjs          (also runs as part of `npm run build`)
 *
 * The sprites are *defined in code* rather than drawn in an editor so they stay diffable and so a
 * palette change is one edit rather than 30 repaints. The output is an ordinary RGBA PNG on a 16 px
 * grid: open it in Aseprite, paint over any frame, and keep the coordinates in atlas.json — the game
 * blits by name and never knows the difference. (See src/spil/ASSETS.md.)
 *
 * Everything is top-down, lit from the north-west, 1x. No dependencies: PNG is encoded here.
 */

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../app/static/spil");

// ---------------------------------------------------------------------------------- palette
// 26 colours, warm-neutral with GAHK green and brass. Every sprite draws from this and nothing else,
// which is what makes props from different rooms look like one game.
const C = {
  none: "00000000",
  line: "2a2130ff", // universal dark outline
  shade: "00000038", // translucent contact shadow

  wood: "8a6240ff",
  woodHi: "a97a52ff",
  woodLo: "63432aff",
  woodDk: "4a3221ff",

  cloth: "b8524fff",
  clothHi: "d1706cff",
  cloth2: "4f7fa8ff",
  cloth2Hi: "6d9cc4ff",
  linen: "e8ddc8ff",
  linenLo: "c3b7a0ff",

  green: "3f7a55ff",
  greenHi: "5b9a71ff",
  greenLo: "2b5c3dff",

  brass: "d9b566ff",
  brassLo: "9c7c34ff",

  steel: "9aa3aaff",
  steelHi: "c3ccd2ff",
  steelLo: "667079ff",

  porc: "e4eaecff",
  porcLo: "b9c4c8ff",

  skin: "d9a273ff",
  skinLo: "b07c53ff",
  hair: "5d3f27ff",

  dark: "3a3040ff",
  glass: "7fb0c4ff",
};

// ---------------------------------------------------------------------------------- tiny canvas
function surface(w, h) {
  return { w, h, data: new Uint8Array(w * h * 4) };
}

function put(s, x, y, hex) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= s.w || y >= s.h || hex === C.none) return;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const a = parseInt(hex.slice(6, 8), 16);
  const i = (y * s.w + x) * 4;
  if (a === 255) {
    s.data[i] = r;
    s.data[i + 1] = g;
    s.data[i + 2] = b;
    s.data[i + 3] = 255;
    return;
  }
  // source-over, so the soft shadows actually read as shadows
  const sa = a / 255;
  const da = s.data[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) return;
  s.data[i] = (r * sa + s.data[i] * da * (1 - sa)) / oa;
  s.data[i + 1] = (g * sa + s.data[i + 1] * da * (1 - sa)) / oa;
  s.data[i + 2] = (b * sa + s.data[i + 2] * da * (1 - sa)) / oa;
  s.data[i + 3] = oa * 255;
}

const box = (s, x, y, w, h, c) => {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(s, x + i, y + j, c);
};
const hline = (s, x, y, w, c) => box(s, x, y, w, 1, c);
const vline = (s, x, y, h, c) => box(s, x, y, 1, h, c);

/** A filled rectangle with the dark outline every prop shares, plus an optional lit top edge and
 *  shaded bottom edge. Sharing one primitive is what makes props from different rooms read as a set.
 *  Nothing here bakes in a drop shadow — the renderer draws those, so props sit correctly on any
 *  floor colour. */
function panel(s, x, y, w, h, fill, top, bottom) {
  box(s, x, y, w, h, C.line); // outline
  box(s, x + 1, y + 1, w - 2, h - 2, fill); // body
  if (top && h > 2) hline(s, x + 1, y + 1, w - 2, top);
  if (bottom && h > 3) hline(s, x + 1, y + h - 2, w - 2, bottom);
}

// ---------------------------------------------------------------------------------- the sprites
const SPRITES = {};
const def = (name, w, h, draw) => {
  const s = surface(w, h);
  draw(s);
  SPRITES[name] = s;
};

// --- Albergon, top-down, three facings x three frames (left is the mirror of side) --------------
function walker(s, facing, frame, body, bodyHi, bodyLo, hair, detail) {
  const bob = frame === 1 ? 1 : 0; // step
  const legL = frame === 1 ? 1 : frame === 2 ? -1 : 0;
  const y = 1 + bob;

  // legs
  box(s, 3 + (facing === "side" ? legL : 0), 12 - bob, 2, 4, C.dark);
  box(s, 7 - (facing === "side" ? legL : 0), 12 - bob, 2, 4, C.dark);

  // apron / torso
  panel(s, 2, y + 5, 8, 8, body, bodyHi, bodyLo);
  if (facing !== "up") {
    box(s, 4, y + 8, 4, 3, bodyLo); // apron pocket
    box(s, 4, y + 8, 4, 1, detail);
  }
  // arms
  box(s, 1, y + 6, 1, 4, bodyLo);
  box(s, 10, y + 6, 1, 4, bodyLo);

  // head — the facing is carried by the hair line and the eyes, so a 12 px sprite still reads
  panel(s, 2, y, 8, 7, C.skin, null, C.skinLo);
  if (facing === "down") {
    box(s, 3, y + 1, 6, 2, hair);
    put(s, 4, y + 4, C.line);
    put(s, 7, y + 4, C.line);
    hline(s, 5, y + 5, 2, C.skinLo);
  } else if (facing === "side") {
    box(s, 3, y + 1, 5, 3, hair);
    put(s, 8, y + 4, C.line);
  } else {
    box(s, 3, y + 1, 6, 4, hair); // from behind: mostly hair, but keep the neck visible
  }
}
// Albergon in the Ølkælder apron, and the GAHK'ere who wander the Gang and get in his way.
const CASTS = {
  bud: [C.green, C.greenHi, C.greenLo, C.hair, C.brassLo],
  res: [C.cloth2, C.cloth2Hi, C.dark, "2f2f38ff", C.linen],
};
for (const [name, cast] of Object.entries(CASTS)) {
  for (const f of ["down", "up", "side"]) {
    for (let i = 0; i < 3; i++) def(`${name}_${f}_${i}`, 12, 18, (s) => walker(s, f, i, ...cast));
  }
}

// --- bedroom -----------------------------------------------------------------------------------
def("bed", 14, 20, (s) => {
  panel(s, 0, 0, 14, 20, C.wood, C.woodHi, C.woodLo); // frame
  box(s, 1, 3, 12, 15, C.cloth); // duvet
  hline(s, 1, 3, 12, C.clothHi);
  box(s, 2, 1, 10, 4, C.linen); // pillow
  hline(s, 2, 1, 10, C.linen);
  box(s, 2, 4, 10, 1, C.linenLo);
  box(s, 1, 11, 12, 1, C.clothHi); // fold
  vline(s, 6, 5, 13, C.clothHi);
});

def("desk", 16, 10, (s) => {
  panel(s, 0, 0, 16, 9, C.wood, C.woodHi, C.woodLo);
  box(s, 2, 2, 5, 4, C.linen); // papers
  hline(s, 2, 2, 5, C.linenLo);
  box(s, 9, 2, 5, 4, C.dark); // laptop
  box(s, 10, 3, 3, 2, C.glass);
  box(s, 1, 7, 14, 1, C.woodLo);
});

def("chair", 8, 8, (s) => {
  panel(s, 1, 0, 6, 7, C.woodLo, C.wood, C.woodDk);
  box(s, 2, 1, 4, 3, C.wood);
});

def("wardrobe", 10, 14, (s) => {
  panel(s, 0, 0, 10, 14, C.woodLo, C.wood, C.woodDk);
  vline(s, 5, 1, 12, C.woodDk);
  put(s, 4, 7, C.brass);
  put(s, 6, 7, C.brass);
});

def("shelf", 16, 6, (s) => {
  panel(s, 0, 0, 16, 6, C.woodLo, C.wood, C.woodDk);
  for (let i = 0; i < 6; i++) box(s, 2 + i * 2, 1, 1, 4, i % 2 ? C.cloth : C.cloth2);
});

def("rug", 18, 12, (s) => {
  box(s, 1, 0, 16, 12, C.green);
  box(s, 0, 1, 18, 10, C.green);
  box(s, 2, 2, 14, 8, C.greenLo);
  box(s, 4, 4, 10, 4, C.greenHi);
  hline(s, 1, 1, 16, C.greenHi);
  hline(s, 1, 10, 16, C.greenLo);
});

def("plant", 8, 10, (s) => {
  panel(s, 2, 5, 4, 5, C.woodLo, C.wood, C.woodDk);
  box(s, 1, 1, 6, 4, C.green);
  box(s, 2, 0, 4, 2, C.greenHi);
  box(s, 0, 2, 8, 2, C.greenLo);
  box(s, 3, 1, 2, 4, C.greenHi);
});

def("sofa", 18, 10, (s) => {
  panel(s, 0, 0, 18, 10, C.cloth2, C.cloth2Hi, C.dark);
  box(s, 2, 3, 14, 5, C.cloth2Hi);
  vline(s, 9, 3, 5, C.cloth2);
  box(s, 0, 2, 2, 7, C.cloth2);
  box(s, 16, 2, 2, 7, C.cloth2);
});

// --- bathroom ----------------------------------------------------------------------------------
def("toilet", 8, 11, (s) => {
  panel(s, 1, 0, 6, 4, C.porc, C.porcLo, C.porcLo); // cistern
  panel(s, 0, 3, 8, 8, C.porc, null, C.porcLo); // bowl
  box(s, 1, 5, 6, 4, C.porcLo);
  box(s, 2, 6, 4, 2, C.steelLo);
  put(s, 6, 1, C.steel);
});

def("sink", 10, 8, (s) => {
  panel(s, 0, 0, 10, 8, C.porc, C.porcLo, C.porcLo);
  box(s, 2, 2, 6, 4, C.porcLo);
  box(s, 3, 3, 4, 2, C.steelLo);
  box(s, 4, 0, 2, 2, C.steel);
});

def("shower", 14, 14, (s) => {
  panel(s, 0, 0, 14, 14, C.porcLo, C.porc, C.steelLo);
  for (let y = 2; y < 12; y += 3) for (let x = 2; x < 12; x += 3) box(s, x, y, 2, 2, C.porc);
  box(s, 5, 1, 4, 3, C.steel);
  box(s, 6, 4, 2, 1, C.steelHi);
});

// --- kitchen -----------------------------------------------------------------------------------
def("counter", 20, 10, (s) => {
  panel(s, 0, 0, 20, 10, C.woodLo, C.wood, C.woodDk);
  box(s, 1, 1, 18, 3, C.steelHi); // worktop
  hline(s, 1, 1, 18, C.porc);
  for (let x = 3; x < 18; x += 5) box(s, x, 6, 3, 1, C.brass); // drawer pulls
  vline(s, 6, 5, 4, C.woodDk);
  vline(s, 13, 5, 4, C.woodDk);
});

def("stove", 12, 12, (s) => {
  panel(s, 0, 0, 12, 12, C.steelLo, C.steel, C.dark);
  box(s, 1, 1, 10, 7, C.dark);
  for (const [x, y] of [[2, 2], [7, 2], [2, 5], [7, 5]]) {
    box(s, x, y, 3, 2, C.steelLo);
    box(s, x + 1, y, 1, 2, C.cloth);
  }
  box(s, 2, 9, 8, 2, C.steelHi);
});

def("fridge", 10, 14, (s) => {
  panel(s, 0, 0, 10, 14, C.steel, C.steelHi, C.steelLo);
  hline(s, 1, 5, 8, C.steelLo);
  vline(s, 7, 2, 3, C.steelLo);
  vline(s, 7, 8, 4, C.steelLo);
});

def("table", 18, 12, (s) => {
  panel(s, 0, 0, 18, 12, C.wood, C.woodHi, C.woodLo);
  box(s, 2, 2, 14, 8, C.woodHi);
  box(s, 7, 4, 4, 4, C.linen);
  box(s, 8, 3, 2, 2, C.green);
});

// --- cellar ------------------------------------------------------------------------------------
def("bar", 24, 10, (s) => {
  panel(s, 0, 0, 24, 10, C.woodLo, C.woodHi, C.woodDk);
  box(s, 1, 1, 22, 3, C.wood);
  hline(s, 1, 1, 22, C.woodHi);
  for (let i = 0; i < 3; i++) {
    box(s, 5 + i * 6, 5, 2, 4, C.brass); // taps
    box(s, 4 + i * 6, 4, 4, 1, C.brassLo);
  }
});

def("crate", 10, 10, (s) => {
  panel(s, 0, 0, 10, 10, C.wood, C.woodHi, C.woodLo);
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 2; j++) box(s, 2 + i * 4, 2 + j * 4, 3, 3, j ? C.greenLo : C.brassLo);
});

def("barrel", 10, 11, (s) => {
  panel(s, 0, 0, 10, 11, C.woodLo, C.wood, C.woodDk);
  hline(s, 1, 2, 8, C.brassLo);
  hline(s, 1, 8, 8, C.brassLo);
  box(s, 3, 4, 4, 3, C.woodDk);
});

def("keg", 12, 12, (s) => {
  panel(s, 0, 0, 12, 12, C.steelLo, C.steelHi, C.dark);
  box(s, 2, 2, 8, 8, C.steel);
  box(s, 4, 4, 4, 4, C.steelLo);
  hline(s, 1, 6, 10, C.steelHi);
});

def("washer", 12, 12, (s) => {
  panel(s, 0, 0, 12, 12, C.porcLo, C.porc, C.steelLo);
  box(s, 3, 4, 6, 6, C.steelLo);
  box(s, 4, 5, 4, 4, C.glass);
  box(s, 2, 1, 8, 2, C.steelHi);
});

def("bike", 16, 8, (s) => {
  // Wheels as rings: a filled disc reads as a blob at this size, a ring reads as a wheel.
  for (const cx of [3, 12]) {
    hline(s, cx - 1, 0, 3, C.line);
    hline(s, cx - 1, 7, 3, C.line);
    vline(s, cx - 2, 1, 6, C.line);
    vline(s, cx + 2, 1, 6, C.line);
    put(s, cx, 3, C.steelLo);
    put(s, cx, 4, C.steelLo);
  }
  box(s, 4, 3, 8, 1, C.green);
  box(s, 6, 2, 4, 1, C.greenHi);
  box(s, 7, 1, 2, 1, C.dark); // saddle
});

def("workbench", 20, 10, (s) => {
  panel(s, 0, 0, 20, 10, C.woodDk, C.wood, C.woodDk);
  box(s, 1, 1, 18, 4, C.woodLo);
  box(s, 2, 2, 4, 2, C.steelLo); // vice
  box(s, 8, 2, 7, 1, C.steel);
  box(s, 9, 5, 2, 4, C.brassLo);
  box(s, 14, 5, 4, 3, C.cloth);
});

def("toolbox", 10, 8, (s) => {
  panel(s, 0, 1, 10, 7, C.cloth, C.clothHi, C.woodDk);
  box(s, 3, 0, 4, 2, C.steelLo); // handle
  box(s, 4, 1, 2, 1, C.none);
  hline(s, 1, 4, 8, C.woodDk);
  box(s, 2, 5, 2, 2, C.brass);
});

// --- doors -------------------------------------------------------------------------------------
// A door in a horizontal wall, seen from above: the leaf plus its swing.
def("door", 14, 6, (s) => {
  panel(s, 0, 0, 14, 6, C.wood, C.woodHi, C.woodLo);
  box(s, 2, 1, 10, 4, C.woodLo);
  box(s, 3, 2, 8, 2, C.wood);
  box(s, 11, 2, 1, 2, C.brass); // handle
});
def("door_open", 14, 6, (s) => {
  box(s, 0, 0, 14, 6, C.woodDk);
  box(s, 1, 1, 12, 4, C.dark);
  box(s, 0, 0, 2, 6, C.wood);
  box(s, 12, 0, 2, 6, C.wood);
});
def("door_wide", 22, 6, (s) => {
  box(s, 0, 0, 22, 6, C.woodDk);
  box(s, 1, 1, 20, 4, C.dark);
  box(s, 0, 0, 2, 6, C.woodLo);
  box(s, 20, 0, 2, 6, C.woodLo);
  hline(s, 2, 0, 18, C.brassLo);
});

// --- stairs and lift ---------------------------------------------------------------------------
def("stair_step", 16, 4, (s) => {
  box(s, 0, 0, 16, 4, C.steelLo);
  hline(s, 0, 0, 16, C.steelHi);
  hline(s, 0, 3, 16, C.line);
});

/** The lift, seen head-on in the shaft wall: frame, floor indicator, call button, and two doors
 *  that part in the middle. Big enough (36x36) to read as a real lift rather than a grey slot. */
function liftFrame(s, open) {
  panel(s, 0, 0, 36, 36, C.steelLo, C.steelHi, C.dark);
  box(s, 3, 2, 30, 6, C.dark);                       // indicator strip
  for (let i = 0; i < 6; i++) box(s, 5 + i * 5, 4, 3, 2, i === (open ? 5 : 0) ? C.brass : "4a4550ff");
  box(s, 3, 9, 30, 24, C.dark);                      // door recess
  if (open) {
    box(s, 8, 11, 20, 20, "4a4550ff");               // the cab beyond
    box(s, 8, 11, 20, 7, "5c5766ff");
    box(s, 9, 19, 18, 1, C.brass);                   // handrail
    box(s, 3, 9, 5, 24, C.steel);
    box(s, 28, 9, 5, 24, C.steel);
    box(s, 3, 9, 5, 2, C.steelHi);
    box(s, 28, 9, 5, 2, C.steelHi);
  } else {
    box(s, 4, 10, 13, 22, C.steel);
    box(s, 19, 10, 13, 22, C.steel);
    box(s, 4, 10, 13, 2, C.steelHi);
    box(s, 19, 10, 13, 2, C.steelHi);
    vline(s, 17, 10, 22, C.steelLo);
    vline(s, 18, 10, 22, C.dark);
    box(s, 14, 20, 2, 3, C.steelLo);                 // door handles
    box(s, 20, 20, 2, 3, C.steelLo);
  }
  box(s, 33, 14, 2, 8, C.dark);                      // call panel
  put(s, 34, 16, open ? C.brass : C.cloth);
}
def("lift_open", 36, 36, (s) => liftFrame(s, true));

/** Out of order: doors shut, dead indicator, tape across the front. */
def("lift_broken", 36, 36, (s) => {
  liftFrame(s, false);
  for (let i = 0; i < 6; i++) box(s, 5 + i * 5, 4, 3, 2, "4a4550ff");
  for (let i = 0; i < 32; i += 6) box(s, 2 + i, 17 + Math.floor(i / 7), 4, 3, C.brass);
  for (let i = 3; i < 32; i += 6) box(s, 2 + i, 17 + Math.floor(i / 7), 3, 3, C.dark);
});

// --- things in the way ------------------------------------------------------------------------
def("bucket", 12, 12, (s) => {
  panel(s, 1, 2, 10, 10, C.cloth, C.clothHi, C.woodDk);
  box(s, 2, 4, 8, 4, C.glass);
  hline(s, 2, 4, 8, C.steelHi);
  box(s, 0, 1, 12, 2, C.steelLo);
  box(s, 5, 0, 2, 3, C.steelLo);
});

def("boxes", 18, 16, (s) => {
  panel(s, 0, 4, 11, 12, C.wood, C.woodHi, C.woodLo);
  panel(s, 9, 0, 9, 10, C.woodLo, C.wood, C.woodDk);
  hline(s, 1, 9, 9, C.woodLo);
  hline(s, 10, 4, 7, C.woodDk);
});

def("mop", 10, 16, (s) => {
  box(s, 4, 0, 2, 11, C.wood);
  panel(s, 1, 10, 8, 6, C.linenLo, C.linen, C.steelLo);
});

/** Spilt beer: no collision, but you wade through it. */
def("puddle", 22, 12, (s) => {
  const c = "b8a04a99";
  box(s, 3, 2, 16, 8, c);
  box(s, 1, 4, 20, 4, c);
  box(s, 5, 1, 12, 10, c);
  hline(s, 6, 3, 6, "d8c47088");
  put(s, 15, 7, "d8c47088");
});

// ---------------------------------------------------------------------------------- pack + encode
const names = Object.keys(SPRITES);
const PAD = 1;
const SHEET_W = 256;
let cx = PAD;
let cy = PAD;
let rowH = 0;
const frames = {};
for (const name of names) {
  const s = SPRITES[name];
  if (cx + s.w + PAD > SHEET_W) {
    cx = PAD;
    cy += rowH + PAD;
    rowH = 0;
  }
  frames[name] = { frame: { x: cx, y: cy, w: s.w, h: s.h } };
  cx += s.w + PAD;
  rowH = Math.max(rowH, s.h);
}
const SHEET_H = cy + rowH + PAD;

const sheet = surface(SHEET_W, SHEET_H);
for (const name of names) {
  const s = SPRITES[name];
  const f = frames[name].frame;
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const i = (y * s.w + x) * 4;
      const j = ((f.y + y) * SHEET_W + f.x + x) * 4;
      sheet.data[j] = s.data[i];
      sheet.data[j + 1] = s.data[i + 1];
      sheet.data[j + 2] = s.data[i + 2];
      sheet.data[j + 3] = s.data[i + 3];
    }
  }
}

// -- minimal PNG writer (RGBA, filter 0) --
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SHEET_W, 0);
ihdr.writeUInt32BE(SHEET_H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc((SHEET_W * 4 + 1) * SHEET_H);
for (let y = 0; y < SHEET_H; y++) {
  raw[y * (SHEET_W * 4 + 1)] = 0;
  Buffer.from(sheet.data.buffer, y * SHEET_W * 4, SHEET_W * 4).copy(
    raw,
    y * (SHEET_W * 4 + 1) + 1,
  );
}
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(resolve(OUT_DIR, "atlas.png"), png);
writeFileSync(
  resolve(OUT_DIR, "atlas.json"),
  JSON.stringify(
    {
      _note:
        "GENERATED by frontend/tools/build-atlas.mjs — edit that file, or repaint atlas.png by hand and stop regenerating it. Frames are looked up by name from src/spil/render.ts.",
      meta: { image: "atlas.png", size: { w: SHEET_W, h: SHEET_H }, scale: "1" },
      frames,
    },
    null,
    2,
  ) + "\n",
);
console.log(`atlas.png ${SHEET_W}x${SHEET_H}, ${names.length} frames`);
