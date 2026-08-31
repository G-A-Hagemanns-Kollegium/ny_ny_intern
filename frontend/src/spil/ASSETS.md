# Lords of the ØK — art assets

The game's sprite sheet is **`app/static/spil/atlas.png`** (+ `atlas.json`), built by
`frontend/tools/build-atlas.mjs`. It has two sources, and the generator composites them:

1. **LimeZu "Modern Interiors" (free tier)** — the cast, the floors, the wall runs and most of the
   furniture. Hand-drawn, and much better than anything a generator produces.
2. **Procedural sprites defined in the generator itself** — everything the free tier does not
   cover: the lift, the Ølkælder bar, kegs and barrels, the toolbox, spilt beer, mop buckets, the
   bathroom fittings, and the stairs.

The split is not a compromise, it is the fallback: every sprite has a procedural version, and the
LimeZu cut simply overwrites it when the pack is present. **`npm run atlas` works with or without
the download** — without it you get a complete, if plainer, game.

## The LimeZu pack

Not committed, and **must not be** — see the licence below. `.gitignore` keeps it out. To get it
back:

1. Buy/download "Modern Interiors" from <https://limezu.itch.io/moderninteriors>.
2. Unzip so that these paths exist:
   `frontend/src/spil/ASSETS/moderninteriors/` (full pack) and, optionally,
   `frontend/src/spil/ASSETS/Modern tiles_Free/` (free tier).
3. `npm run atlas`

## Licence

The **full pack is licensed** (bought 2026-08-31). Its terms, verbatim from `LICENSE.txt`:

> YOU CAN: Edit and use the asset in any commercial or non commercial project
> YOU CAN'T: Resell or distribute the asset to others. Edit and resell the asset to others.
> Credits required (limezu.itch.io)

Three consequences, none of them optional:

1. **Commercial use is fine now.** The old "if the game ever leaves gahk.dk, buy it first" caveat is
   settled — that is what the purchase bought.
2. **The pack still cannot be committed.** "Distribute the asset to others" is exactly what pushing
   53 000 files to a *public* repo does, and buying a licence to *use* art is not a licence to
   *redistribute* it. This is the same conclusion as before the purchase, for a stronger reason: the
   free tier merely said nothing about redistribution, the paid one forbids it outright. What ships
   is the **generated atlas** (`app/static/spil/atlas.png`) — the asset edited and used in a
   project, which the licence expressly allows.
3. **Credit is required.** It is on the title screen (`.spil-credit`). Do not remove it.

The 320 MB / 53 000 files would also be a bad thing to put in git on its own merits: git keeps blobs
forever, so it would weigh on every clone of this repo from now on.

### The character sheets

Each combined sheet is 384×224 — rows of 24 frames of 16×32, **six per facing, ordered
side / up / side / down**. The rows are *not* what you would guess:

| Row | y | What |
|---|---|---|
| 0 | 0 | idle — one frame per facing, only four sprites |
| 1 | 32 | **idle animation** — six frames of gentle bobbing |
| 2 | 64 | **the walk cycle** |
| 3+ | 96+ | sitting, phone, reading |

Running lives in its own file (`*_run_16x16.png`, 384×32) with the same 24-frame layout.

Slicing row 1 as the walk is an easy mistake and produces a bud who glides without moving his legs
while the run cycle animates perfectly — which is exactly what happened here.

### The beds have a hole in them

LimeZu builds beds in layers: the sprite in the free tier is the **frame only**, with a transparent
recess where the mattress and duvet go — those layers ship with the paid pack. Blitted as-is a bed
reads as a coloured slab with a window cut in it, which is exactly how it first looked in game.

`makeBed()` in the generator fixes it: flood-fill the transparency that touches the border, and
whatever transparency is left over is the recess. Fill that with a pillow at the head, a duvet
below and a crease down the middle. Three beds, three duvet colours, no hand-pixelling.

Worth remembering if you ever add more layered furniture from this pack.

### What is taken from where

Coordinates were read off the sheets with a connected-component scan, not by eye. All of them live
in one block at the bottom of `build-atlas.mjs`.

| Frames | Source |
|---|---|
| `bud_*` `res_*` `res2_*` `res3_*` | `Characters_free/{Adam,Amelia,Bob,Alex}_16x16.png` — see the row layout below |
| `*_run_*` | `Characters_free/{…}_run_16x16.png`, the whole sheet: same 24-frame layout |
| `floor_wood` `floor_carpet` `floor_bath` `floor_kitchen` `floor_concrete` | `Room_Builder_free_16x16.png`, the floor block at x=176/224 |
| `wall_0` … `wall_5` | the same sheet's wall runs — bottom 15 px of each 32 px wall; two of the six floors are tinted, because the free tier only ships four wall styles |
| `bed` `bed2` `bed3` `wardrobe` `nightstand` `desk` `table` `sidetable` `sofa` `chair` `stool` `shelf` `fridge` `trolley` `rug` `counter` `door_front` `door_front_open` | `Interiors_free_16x16.png` |

## Rebuilding

```bash
npm run atlas      # or just `npm run build`, which runs it first
```

No dependencies: the script decodes the LimeZu PNGs (adaptive filtering and all) and encodes the
output itself.

## Replacing it with hand-drawn art

Every draw call goes through `sprite(ctx, atlas, "<name>", …)`, which falls back to a plain block
when a frame is missing. So you can take over the art gradually:

1. Open `atlas.png` in Aseprite and paint over whichever frames you want. Keep each frame's
   position and size, and stop running `npm run atlas` (it would overwrite your work — delete the
   `build-atlas.mjs` step from `package.json` when you get there).
2. Or drop in a completely different sheet and rewrite `atlas.json` to match. Aseprite writes this
   exact format: **File → Export Sprite Sheet → Output → JSON Data → Hash**.

Frame names the renderer asks for, with the sizes it expects:

| Frame | Size | Notes |
|---|---|---|
| `bud_down_{0,1,2}` | 12×18 | facing the camera; frame 1 is the step |
| `bud_up_{0,1,2}` | 12×18 | seen from behind |
| `bud_side_{0,1,2}` | 12×18 | facing right; the renderer mirrors it for left |
| `bed` `desk` `chair` `wardrobe` `shelf` `rug` `plant` `sofa` | ≤18 wide | bedrooms |
| `toilet` `sink` `shower` | ≤14 wide | toilet og bad |
| `counter` `stove` `fridge` `table` | ≤20 wide | gangkøkkenet |
| `bar` `crate` `barrel` `keg` | ≤24 wide | Ølkælderen |
| `washer` `bike` `workbench` `toolbox` | ≤20 wide | kælderen and værkstedet |
| `door` `door_open` `door_wide` | 14–22 × 6 | seen from above, in a horizontal wall |
| `lift_open` `lift_broken` | 36×36 | the shaft between the two flights, working and taped shut |
| `res_{down,up,side}_{0,1,2}` | 12×18 | the GAHK'ere who wander the Gang |
| `boxes` `bucket` `mop` | ≤18 wide | corridor obstacles you have to go around |
| `puddle` | 22×12 | spilt beer — slows you down, no collision |

**Author at 1×.** The world is 16 px tiles and the renderer scales the whole scene up; a 14×22 bed
upscaled is the Terraria/Stardew look, a 56×88 bed downscaled is mush.

## If you want richer art than a generator can make

1. **Start from a pack and repaint.** For a dormitory the closest thing that exists is **LimeZu's
   "Modern Interiors"** (itch.io): 16×16 top-down, thousands of interior tiles — beds, desks,
   kitchens, bathrooms, corridors, doors — plus a character generator. Starting from a pack solves
   palette and light-direction consistency, which is what makes hand-drawn tiles look amateur.
   **Kenney** (kenney.nl) is the CC0 fallback but reads more "clean vector" than Stardew. Check the
   licence: most itch packs allow commercial use but forbid redistributing the raw tiles, which is
   fine for a compiled atlas.
2. **Hand-draw the GAHK-specific pieces in Aseprite** (~$20, or **LibreSprite** free). No pack will
   contain Albergon, the Ølkælder counter, varmetrappen or a røvhullet door plate. A character walk
   cycle is an afternoon. Keep to ~24 colours and reuse them everywhere.
3. **Don't generate tilesets with an image model.** It cannot hold a fixed palette, a 16 px grid or a
   consistent light direction across frames, and tiles that disagree on any of those will not
   tessellate. It is genuinely useful for *concept* frames — mood, colour, what the Gang should feel
   like at 01:00 — which you then redraw by hand on the grid.

## Room props

The free tier has no clothes pile, so `clothes` is drawn procedurally; everything else in a bedroom
is a slice of `Interiors_free/16x16/Interiors_free_16x16.png`. Two rows are worth knowing about,
because they are easy to mistake for each other:

| Source rows | What is actually there |
|---|---|
| `y 490–555` | **chairs and stools**, not bookshelves — side and back views, in five woods |
| `y 1094–1176` | the **shelving units** (`bookshelf`…`bookshelf4`). Shop shelves, but the coloured spines read as books at 16 px |

Others in use: wardrobes at `y 772–853` (`wardrobe3`/`wardrobe4` have mirrored doors), potted plants
and palms at `y 703–746`, standing and table lamps at `y 824–888`, mirrors at `y 425–441`,
`y 457–478` and `y 1063–1111`, the wall map at `y 1065`, a globe at `y 1055`, a window at `y 455`,
and the scattered books that stand in for a desk's worth of mess at `y 454`.

Footprints live in `ROOM_PROP` in `building.ts` and must match the cuts — a room is laid out from
those numbers, not by measuring the atlas at runtime.

## Goods

The pack has no groceries, so the seven `item_*` icons are drawn in `build-atlas.mjs`. They are
read at 1:1 in a 16x18 belt slot and never in the world, so they are drawn for legibility at that
size rather than to match a 16 px tile. `goodIcon()` in `orders.ts` picks between them by matching
on the product name — the names come from the live Ølkælder list, so it matches on what is *in* a
name and falls back to a crate. Order matters there: "Sodavand" contains "vand".

## The full pack

`moderninteriors/` alongside the free tier. Two things in it change how the art is built:

- **`Theme_Sorter_Shadowless_Singles/`** — one PNG per object, so furniture is loaded by name
  instead of by guessing rectangles out of a sheet. The files carry transparent padding, so
  `single()` crops to the drawn pixels and everything downstream positions props by that real size.
- **`2_Characters/Character_Generator/`** — bodies, eyes, outfits and hairstyles as separate sheets
  on one rig. The four buds are composited from these at build time. Rows are the same as the free
  tier's: y=32 idle, y=64 walk, facings at frame columns side 0, up 6, down 18. There is **no run
  row** anywhere in the generator.

Both are still optional: the build falls back to the free tier, then to procedural sprites.
