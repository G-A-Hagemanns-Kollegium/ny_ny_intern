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

import { deflateSync, inflateSync } from "node:zlib";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "../../app/static/spil");
/** LimeZu "Modern Interiors" (free tier), if it has been downloaded. Optional by design: without it
 *  every sprite falls back to the procedural version below and the build still works. */
const LIMEZU = resolve(HERE, "../src/spil/ASSETS/Modern tiles_Free");
/** The full pack, added later. Everything still degrades: free tier, then procedural. */
const FULL = resolve(HERE, "../src/spil/ASSETS/moderninteriors");

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

def("clothes", 16, 11, (s) => {
  // A heap on the floor. Every GAHK room has one.
  box(s, 2, 4, 12, 6, C.cloth2);
  box(s, 0, 6, 16, 4, C.cloth2Hi);
  box(s, 4, 2, 8, 4, C.cloth);
  box(s, 6, 1, 5, 3, C.clothHi);
  box(s, 9, 6, 5, 3, C.linen);
  hline(s, 1, 10, 14, C.dark);
});

// --- what the bud carries, drawn for a 14x16 hotbar slot -------------------------------------
// The pack ships no groceries, so these are ours. They are read at 1:1 in the inventory bar and
// never in the world, so they are drawn for legibility at 14 px rather than to match a tile.
const bottle = (s, body, hi, cap, label) => {
  box(s, 5, 1, 4, 3, C.line);            // neck
  box(s, 6, 2, 2, 2, cap);
  box(s, 3, 4, 8, 11, C.line);           // body outline
  box(s, 4, 5, 6, 9, body);
  vline(s, 4, 5, 9, hi);
  if (label) box(s, 4, 8, 6, 4, label);
};

def("item_beer", 14, 16, (s) => bottle(s, "6b4a1eff", "8f6a2eff", C.brass, C.linen));
def("item_spirit", 14, 16, (s) => bottle(s, "2f5c3aff", "487a52ff", C.line, "c9a24aff"));
def("item_water", 14, 16, (s) => bottle(s, "7fb0c4ff", "a8cdddff", C.cloth2, C.porc));

def("item_soda", 14, 16, (s) => {
  panel(s, 3, 3, 8, 12, C.cloth, C.clothHi, "8c3b38ff");   // can
  hline(s, 4, 4, 6, C.steelHi);
  box(s, 4, 7, 6, 3, C.linen);
  box(s, 5, 8, 4, 1, C.cloth);
});

def("item_snack", 14, 16, (s) => {
  panel(s, 2, 4, 10, 10, "c9702fff", "e08b45ff", "9c5320ff"); // crisp bag
  hline(s, 3, 5, 8, C.linen);
  box(s, 4, 8, 6, 3, "f0c98aff");
  for (const x of [3, 6, 9]) put(s, x, 4, C.line);           // crimped top
});

def("item_candy", 14, 16, (s) => {
  panel(s, 3, 5, 8, 7, "8c4a86ff", "ab63a3ff", "6b3566ff");  // wrapper
  box(s, 1, 7, 2, 3, "ab63a3ff");                            // twisted ends
  box(s, 11, 7, 2, 3, "ab63a3ff");
  hline(s, 4, 8, 6, C.linen);
});

def("item_misc", 14, 16, (s) => {
  panel(s, 2, 4, 10, 10, C.wood, C.woodHi, C.woodLo);        // a box of something
  hline(s, 3, 8, 8, C.woodDk);
  vline(s, 7, 5, 8, C.woodDk);
});

// --- skill icons, read at 1:1 on the færdigheder screen -------------------------------------
def("ic_sko", 16, 16, (s) => {
  // A trainer seen from the side: toe to the right, laces up the middle, thick sole.
  box(s, 1, 10, 14, 4, C.line);                // sole
  box(s, 2, 11, 12, 2, C.linen);
  box(s, 2, 4, 7, 7, C.line);                  // heel and ankle
  box(s, 3, 5, 5, 6, C.cloth2);
  box(s, 8, 6, 6, 5, C.line);                  // toe box
  box(s, 8, 7, 6, 4, C.cloth2Hi);
  for (const y of [6, 8]) hline(s, 4, y, 4, C.linen);
  put(s, 13, 10, C.linen);
});

def("ic_skate", 16, 16, (s) => {
  panel(s, 2, 2, 11, 7, C.cloth, C.clothHi, "8c3b38ff"); // boot
  box(s, 1, 9, 14, 3, C.line);
  box(s, 2, 10, 12, 1, C.steelHi);
  for (const x of [3, 7, 11]) { box(s, x, 12, 3, 3, C.line); put(s, x + 1, 13, C.brass); }
});

def("ic_dash", 16, 16, (s) => {
  // Two chevrons pointing right, with speed lines behind them.
  const chevron = (ox, c) => {
    for (let i = 0; i < 4; i++) {
      box(s, ox + i, 3 + i, 2, 2, c);
      box(s, ox + i, 11 - i, 2, 2, c);
    }
  };
  for (const [y, w] of [[5, 4], [8, 6], [11, 4]]) box(s, 0, y, w, 2, C.brassLo);
  chevron(5, C.line);
  chevron(6, C.brass);
  chevron(9, C.line);
  chevron(10, C.brass);
});

def("ic_kasse", 16, 16, (s) => {
  panel(s, 1, 4, 14, 10, C.wood, C.woodHi, C.woodDk);
  vline(s, 5, 5, 8, C.woodDk);
  vline(s, 10, 5, 8, C.woodDk);
  for (const x of [2, 7, 12]) box(s, x, 1, 3, 4, C.brass);  // bottle necks
  hline(s, 2, 8, 12, C.woodLo);
});

def("ic_hop", 16, 16, (s) => {
  box(s, 6, 1, 4, 4, C.skin);                  // a bud, mid-air
  box(s, 5, 5, 6, 5, C.green);
  box(s, 4, 10, 2, 3, C.greenLo);
  box(s, 10, 10, 2, 3, C.greenLo);
  hline(s, 2, 14, 12, C.brassLo);              // the thing being cleared
  box(s, 6, 13, 4, 2, C.brass);
});

def("ic_kort", 16, 16, (s) => {
  panel(s, 1, 2, 14, 12, C.linen, "ffffffff", C.linenLo);
  hline(s, 3, 5, 10, C.steelLo);
  hline(s, 3, 8, 10, C.steelLo);
  hline(s, 3, 11, 10, C.steelLo);
  box(s, 10, 4, 3, 3, C.cloth);                // you are here
  put(s, 11, 5, C.linen);
});

// --- doors, seen face-on in a wall ---------------------------------------------------------------
// The walls stand up in the game's oblique view, so a door is a front elevation, not a plan.
def("door_front", 16, 15, (s) => {
  box(s, 0, 0, 16, 15, C.woodDk);                 // frame
  box(s, 1, 1, 14, 14, C.wood);                   // leaf
  hline(s, 1, 1, 14, C.woodHi);
  for (const [py, ph] of [[3, 4], [9, 4]]) {      // two recessed panels
    box(s, 3, py, 10, ph, C.woodLo);
    hline(s, 3, py, 10, C.woodDk);
    hline(s, 3, py + ph - 1, 10, C.woodHi);
  }
  box(s, 12, 7, 2, 2, C.brass);                   // handle
  hline(s, 0, 14, 16, C.line);                    // threshold
});

def("door_front_open", 16, 15, (s) => {
  box(s, 0, 0, 16, 15, C.woodDk);
  box(s, 1, 1, 14, 13, "1a1522ff");               // the dark beyond
  box(s, 1, 1, 4, 13, C.woodLo);                  // leaf, swung back
  vline(s, 5, 1, 13, C.woodDk);
  box(s, 2, 6, 2, 2, C.brass);
  hline(s, 0, 14, 16, C.line);
});

def("door_front_wide", 26, 15, (s) => {
  box(s, 0, 0, 26, 15, C.woodDk);                 // archway
  box(s, 2, 2, 22, 12, "1a1522ff");
  hline(s, 1, 0, 24, C.brassLo);                  // lintel
  vline(s, 1, 1, 13, C.woodLo);
  vline(s, 24, 1, 13, C.woodLo);
  hline(s, 0, 14, 26, C.line);
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

// ------------------------------------------------------------------ LimeZu "Modern Interiors"
// Hand-drawn art beats anything a generator makes, so where the pack has a sprite we use it and
// the procedural version above becomes the fallback. Coordinates were read off the sheets with a
// connected-component scan rather than by eye — see ASSETS.md.

/** Minimal PNG reader. The pack's sheets use adaptive filtering, so all five filter types matter. */
function readPng(path) {
  const buf = readFileSync(path);
  let p = 8, w = 0, h = 0, ctype = 6, pal = null, trns = null;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString("latin1", p + 4, p + 8);
    const d = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = d.readUInt32BE(0);
      h = d.readUInt32BE(4);
      if (d[8] !== 8) throw new Error(`${path}: only 8-bit PNGs are supported`);
      ctype = d[9];
    } else if (type === "PLTE") pal = d;
    else if (type === "tRNS") trns = d;
    else if (type === "IDAT") idat.push(d);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = new Uint8Array(w * h * 4);
  const line = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  let at = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[at++];
    raw.copy(line, 0, at, at + stride);
    at += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = v & 0xff;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const i = x * bpp;
      if (ctype === 6) out.set(line.subarray(i, i + 4), o);
      else if (ctype === 2) { out.set(line.subarray(i, i + 3), o); out[o + 3] = 255; }
      else if (ctype === 0) { out[o] = out[o+1] = out[o+2] = line[i]; out[o+3] = 255; }
      else if (ctype === 4) { out[o] = out[o+1] = out[o+2] = line[i]; out[o+3] = line[i+1]; }
      else { const k = line[i];
        out[o] = pal[k*3]; out[o+1] = pal[k*3+1]; out[o+2] = pal[k*3+2];
        out[o+3] = trns && k < trns.length ? trns[k] : 255; }
    }
    prev.set(line);
  }
  return { w, h, data: out };
}

if (existsSync(LIMEZU)) {
  const sheets = {};
  const sheet = (rel) => (sheets[rel] ??= readPng(resolve(LIMEZU, rel)));

  /** Copy a rectangle out of a sheet, optionally multiplied by a tint. */
  const cut = (rel, sx, sy, w, h, tint) => {
    const src = sheet(rel);
    const s = surface(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = ((sy + y) * src.w + sx + x) * 4;
        const o = (y * w + x) * 4;
        s.data[o] = tint ? (src.data[i] * tint[0]) / 255 : src.data[i];
        s.data[o + 1] = tint ? (src.data[i + 1] * tint[1]) / 255 : src.data[i + 1];
        s.data[o + 2] = tint ? (src.data[i + 2] * tint[2]) / 255 : src.data[i + 2];
        s.data[o + 3] = src.data[i + 3];
      }
    }
    return s;
  };
  const take = (name, rel, sx, sy, w, h, tint) => {
    SPRITES[name] = cut(rel, sx, sy, w, h, tint);
  };

  /** One object from the full pack's "Singles" folders — one file per prop, which beats guessing
   *  rectangles out of a sheet. The files carry transparent padding, so crop to what is actually
   *  drawn; everything downstream positions props by that real size. */
  const SINGLES = "../moderninteriors/1_Interiors/16x16/Theme_Sorter_Shadowless_Singles";
  const THEMES = {
    bedroom: ["4_Bedroom_Singles_Shadowless", "Bedroom_Singles_Shadowless"],
    kitchen: ["12_Kitchen_Singles_Shadowless", "Kitchen_Singles_Shadowless"],
    living: ["2_Living_Room_Singles_Shadowless", "Living_Room_Singles_Shadowless"],
  };
  const single = (name, theme, n) => {
    const [dir, stem] = THEMES[theme];
    const rel = `${SINGLES}/${dir}/${stem}_${n}.png`;
    const src = sheet(rel);
    let x0 = src.w, y0 = src.h, x1 = -1, y1 = -1;
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        if (src.data[(y * src.w + x) * 4 + 3] === 0) continue;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) throw new Error(`${rel} is empty`);
    SPRITES[name] = cut(rel, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  };

  /** Paint one surface over another, source-over. */
  const over = (dst, src) => {
    for (let i = 0; i < dst.data.length; i += 4) {
      const sa = src.data[i + 3] / 255;
      if (sa === 0) continue;
      const da = dst.data[i + 3] / 255;
      const oa = sa + da * (1 - sa);
      for (let k = 0; k < 3; k++) {
        dst.data[i + k] = (src.data[i + k] * sa + dst.data[i + k] * da * (1 - sa)) / oa;
      }
      dst.data[i + 3] = oa * 255;
    }
    return dst;
  };

  /** The free tier's beds are frames with a *hole* where the bedding layer goes — the mattress is a
   *  separate sprite that only ships in the paid pack. Unfilled they read as a coloured slab with a
   *  window in it. So: find the enclosed transparent region and make a bed out of it. */
  const makeBed = (name, duvet, duvetHi) => {
    const s = SPRITES[name];
    const { w, h, data } = s;
    // Flood the transparency that touches the border; whatever transparency is left is the recess.
    const outside = new Uint8Array(w * h);
    const stack = [];
    for (let x = 0; x < w; x++) { stack.push([x, 0], [x, h - 1]); }
    for (let y = 0; y < h; y++) { stack.push([0, y], [w - 1, y]); }
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const k = y * w + x;
      if (outside[k] || data[k * 4 + 3] >= 8) continue;
      outside[k] = 1;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    let top = h, bottom = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = y * w + x;
      if (outside[k] || data[k * 4 + 3] >= 8) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
    if (bottom < 0) return; // already a complete sprite
    const pillowEnd = top + Math.round((bottom - top) * 0.26);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = y * w + x;
      if (outside[k] || data[k * 4 + 3] >= 8) continue;
      // Pillow at the head, duvet below it, with a lit fold two rows down.
      const hex = y <= pillowEnd ? C.linen : y === pillowEnd + 2 ? duvetHi : duvet;
      put(s, x, y, hex);
    }
    // A crease down the middle of the duvet so it does not read as a flat rectangle.
    for (let y = pillowEnd + 4; y < bottom - 1; y++) put(s, Math.floor(w / 2), y, duvetHi);
  };

  // --- the cast -------------------------------------------------------------------------------
  // Each row of the combined sheet is 24 frames of 16x32, six per facing, ordered side/up/side/down.
  //   row 0 (y=0)  : idle, one frame per facing
  //   row 1 (y=32) : *idle animation* — six near-identical frames of breathing
  //   row 2 (y=64) : the walk cycle
  // Slicing row 1 as the walk is why walking used to look frozen while running animated fine.
  const IDLE_ROW = 32;
  const WALK_ROW = 64;
  const FACINGS = { side: 0, up: 6, down: 18 };

  // --- the residents you deliver to, from the free tier's four fixed characters ---------------
  const CAST = { res: "Amelia", res2: "Bob", res3: "Alex" };
  for (const [name, who] of Object.entries(CAST)) {
    for (const [facing, col] of Object.entries(FACINGS)) {
      for (let i = 0; i < 6; i++) {
        const rel = `Characters_free/${who}_16x16.png`;
        take(`${name}_${facing}_${i}`, rel, (col + i) * 16, WALK_ROW, 16, 32);
        take(`${name}_idle_${facing}_${i}`, rel, (col + i) * 16, IDLE_ROW, 16, 32);
      }
    }
  }

  // --- the four buds, built from the full pack's character generator ---------------------------
  // Body, eyes, outfit and hair are separate sheets on an identical rig, so a character is just a
  // stack of four crops. That is the only way to hit an actual brief — "red hair, red shirt" is not
  // something the twenty premade characters happen to contain.
  //
  // The generator ships no *run* cycle (idle, walk, sit, phone, carry… but no run), so sprinting
  // plays the walk cycle faster rather than a second set of frames. See `render.ts`.
  const GEN = "../moderninteriors/2_Characters/Character_Generator";
  const BUDS = {
    alb: ["Body_01", "Eyes_01", "Outfit_10_05", "Hairstyle_15_04"], // long dark brown, green top
    mar: ["Body_01", "Eyes_02", "Outfit_17_01", "Hairstyle_15_02"], // long blonde, teal
    bor: ["Body_02", "Eyes_01", "Outfit_16_03", "Hairstyle_02_01"], // ginger, red shirt
    fre: ["Body_03", "Eyes_03", "Outfit_13_01", "Hairstyle_12_03"], // short brown, blue
  };
  const LAYER_DIR = { Body: "Bodies", Eyes: "Eyes", Outfit: "Outfits", Hairstyle: "Hairstyles" };
  const budLayers = (parts) =>
    parts.map((f) => `${GEN}/${LAYER_DIR[f.split("_")[0]]}/16x16/${f}.png`);

  for (const [name, parts] of Object.entries(BUDS)) {
    const files = budLayers(parts);
    for (const [facing, col] of Object.entries(FACINGS)) {
      for (let i = 0; i < 6; i++) {
        for (const [key, row] of [["", WALK_ROW], ["idle_", IDLE_ROW]]) {
          const x = (col + i) * 16;
          let s = cut(files[0], x, row, 16, 32);
          for (const f of files.slice(1)) over(s, cut(f, x, row, 16, 32));
          SPRITES[`${name}_${key}${facing}_${i}`] = s;
        }
      }
    }
  }

  // --- floors ---------------------------------------------------------------------------------
  const RB = "Interiors_free/16x16/Room_Builder_free_16x16.png";
  take("floor_wood", RB, 176, 208, 16, 16); // herringbone — the Gang
  take("floor_carpet", RB, 176, 112, 16, 16); // bedrooms — warm cream, not the grey carpet
  take("floor_bath", RB, 176, 144, 16, 16); // mint tile
  take("floor_kitchen", RB, 176, 80, 16, 16); // kitchens and the kiosk — red quarry tile
  take("floor_concrete", RB, 176, 176, 16, 16); // cellar and stairwells
  take("floor_brick", RB, 176, 80, 16, 16);

  // --- walls ----------------------------------------------------------------------------------
  // Each wall style in the pack is 32 px tall; we want the bottom strip, which carries the colour
  // band and the skirting. Two of the six floors are tints of a style, because the free tier only
  // ships four.
  const WALL_H = 15;
  const wallAt = (top) => top + 32 - WALL_H;
  take("wall_0", RB, 0, wallAt(176), 16, WALL_H, [150, 150, 160]); // Kælderen — cold wood
  take("wall_1", RB, 0, wallAt(112), 16, WALL_H); // Stuen — yellow
  take("wall_2", RB, 0, wallAt(144), 16, WALL_H); // 1. sal — mint
  take("wall_3", RB, 0, wallAt(80), 16, WALL_H); // 2. sal — the red one
  take("wall_4", RB, 0, wallAt(144), 16, WALL_H, [170, 195, 255]); // 3. sal — blue
  take("wall_5", RB, 0, wallAt(176), 16, WALL_H); // 4. sal — wood

  // --- furniture ------------------------------------------------------------------------------
  const IN = "Interiors_free/16x16/Interiors_free_16x16.png";
  take("bed", IN, 3, 12, 42, 54);
  take("bed2", IN, 163, 12, 42, 54);
  take("bed3", IN, 3, 92, 42, 54);
  makeBed("bed", C.cloth, C.clothHi);
  makeBed("bed2", C.cloth2, C.cloth2Hi);
  makeBed("bed3", C.green, C.greenHi);
  take("wardrobe", IN, 48, 58, 29, 70);
  take("nightstand", IN, 51, 16, 26, 32);
  take("desk", IN, 35, 609, 13, 22);
  take("worktable", IN, 13, 161, 38, 37);
  take("table", IN, 93, 161, 38, 37);
  take("sidetable", IN, 64, 161, 16, 37);
  take("sofa", IN, 117, 216, 38, 21);
  take("chair", IN, 49, 609, 12, 21);
  take("stool", IN, 97, 209, 14, 14);
  take("shelf", IN, 80, 224, 32, 64); // shop shelving — the Ølkælder's stock
  take("fridge", IN, 32, 296, 64, 32); // drinks cooler
  take("trolley", IN, 102, 297, 21, 31);
  take("rug", IN, 181, 254, 24, 18);
  take("rug_big", IN, 114, 244, 60, 40);
  take("counter", IN, 0, 455, 64, 25);
  // --- the full pack's furniture, one file per object ------------------------------------------
  // These override the free-tier cuts below wherever the names collide. A GAHK room is 102x58 px of
  // floor, so everything here is chosen to fit that: nothing wider than about a third of the room,
  // nothing taller than the wall-to-wall depth.
  if (existsSync(resolve(LIMEZU, SINGLES))) {
    // Beds with actual bedding — no more filling in the free tier's transparent recess by hand.
    [217, 235, 251, 265, 229, 245].forEach((n, i) => single(`bed${i || ""}`, "bedroom", n));
    // Dressers, each with a picture hung over it: one sprite that furnishes a whole wall.
    [393, 397, 405, 411, 415].forEach((n, i) => single(`dresser${i || ""}`, "bedroom", n));
    [537, 538].forEach((n, i) => single(`bookcase${i || ""}`, "bedroom", n));
    single("wardrobe_tall", "bedroom", 539);
    [421, 423, 425].forEach((n, i) => single(`blind${i || ""}`, "bedroom", n));
    [382, 383, 385, 386].forEach((n, i) => single(`mat${i || ""}`, "bedroom", n));
    [429, 430, 431, 432].forEach((n, i) => single(`nightstand${i || ""}`, "bedroom", n));
    [433, 437, 441, 445, 449].forEach((n, i) => single(`bag${i || ""}`, "bedroom", n));
    [468, 470, 472, 474].forEach((n, i) => single(`board${i || ""}`, "bedroom", n));
    [479, 480].forEach((n, i) => single(`pin${i || ""}`, "bedroom", n));
    [196, 199, 205, 209, 212, 214].forEach((n, i) => single(`banner${i || ""}`, "bedroom", n));
    [301, 305, 313].forEach((n, i) => single(`plush${i || ""}`, "bedroom", n));
    [540, 541, 542].forEach((n, i) => single(`bottle${i || ""}`, "bedroom", n));

    // Gangkøkkenet.
    [148, 150, 152].forEach((n, i) => single(`hob${i || ""}`, "kitchen", n));
    // Not `fridge` — that name belongs to Ølkælderen's wide shop cooler, which is a different
    // object entirely and would be silently replaced by a household fridge.
    [158, 159, 161].forEach((n, i) => single(`kfridge${i || ""}`, "kitchen", n));
    single("kfridge_open", "kitchen", 162);
    [192, 193, 194].forEach((n, i) => single(`worktop${i || ""}`, "kitchen", n));
    single("microwave", "kitchen", 189);
    single("cooler", "kitchen", 191);
    [177, 178].forEach((n, i) => single(`espresso${i || ""}`, "kitchen", n));
    [336, 338].forEach((n, i) => single(`kbord${i || ""}`, "kitchen", n));
    [309, 310, 311].forEach((n, i) => single(`sideboard${i || ""}`, "kitchen", n));
    [226, 236].forEach((n, i) => single(`kmat${i || ""}`, "kitchen", n));
    [406, 408].forEach((n, i) => single(`display${i || ""}`, "kitchen", n));

    // Festsalen and the Hall.
    [19, 21, 23, 25].forEach((n, i) => single(`couch${i || ""}`, "living", n));
    [29, 31, 33].forEach((n, i) => single(`bench${i || ""}`, "living", n));
    [30, 34].forEach((n, i) => single(`console${i || ""}`, "living", n));
    [39, 40].forEach((n, i) => single(`cupboard${i || ""}`, "living", n));
    [51, 53, 55, 57].forEach((n, i) => single(`lowtable${i || ""}`, "living", n));
  }

  // Odds and ends, so no two rooms end up furnished alike.
  take("bookshelf", IN, 161, 1094, 29, 32);
  take("bookshelf2", IN, 191, 1094, 29, 32);
  take("bookshelf3", IN, 162, 1144, 28, 32);
  take("bookshelf4", IN, 222, 1093, 29, 33);
  take("wardrobe2", IN, 115, 772, 29, 37);
  take("wardrobe3", IN, 146, 783, 25, 26);
  take("wardrobe4", IN, 145, 818, 30, 36);
  take("cabinet", IN, 178, 776, 29, 32);
  take("plant_tall", IN, 168, 713, 16, 34);
  take("plant_pot", IN, 189, 720, 15, 27);
  take("palm", IN, 212, 703, 26, 34);
  take("lamp", IN, 176, 855, 16, 34);
  take("lamp_table", IN, 227, 824, 13, 17);
  take("mirror", IN, 160, 425, 12, 16);
  take("mirror2", IN, 180, 425, 12, 16);
  take("mirror_wide", IN, 114, 457, 28, 21);
  take("mirror_tall", IN, 105, 1080, 16, 32);
  take("mirror_stand", IN, 136, 1063, 17, 34);
  take("poster", IN, 161, 1065, 30, 18);
  take("globe", IN, 192, 1055, 15, 23);
  take("window", IN, 32, 455, 32, 25);
  take("rug2", IN, 163, 451, 26, 28);
  take("clutter", IN, 210, 454, 28, 23);
  take("door_front", IN, 113, 139, 14, 21);
  take("door_front_open", IN, 129, 139, 14, 21);
  console.log("LimeZu: using Modern Interiors (free) for cast, floors, walls and furniture");
} else {
  console.log("LimeZu pack not found — using the procedural sprites only");
}

// ---------------------------------------------------------------------------------- pack + encode
const names = Object.keys(SPRITES);
const PAD = 1;
const SHEET_W = 512;
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
// The map is laid out from these numbers — a room decides where a wardrobe goes from how big the
// wardrobe actually is. Emitting them here rather than keeping a hand-written table means the
// layout cannot silently drift when a sprite is recut.
writeFileSync(
  resolve(HERE, "../src/spil/propsize.ts"),
  "// GENERATED by tools/build-atlas.mjs. Do not edit — run `node tools/build-atlas.mjs`.\n" +
    "/** Every sprite's real footprint in world pixels, `[width, height]`. */\n" +
    "export const PROP_SIZE: Record<string, [number, number]> = {\n" +
    names.map((n) => `  ${/^[a-z_][\w]*$/i.test(n) ? n : JSON.stringify(n)}: [${SPRITES[n].w}, ${SPRITES[n].h}],`).join("\n") +
    "\n};\n",
);

console.log(`atlas.png ${SHEET_W}x${SHEET_H}, ${names.length} frames`);
