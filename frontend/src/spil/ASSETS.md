# Ølbuddet — art assets

The game ships with a real sprite sheet: **`app/static/spil/atlas.png`** (+ `atlas.json`). It holds
the bud's walk cycles and every prop in the building — beds, desks, wardrobes, kitchen counters,
stoves, fridges, toilets, sinks, showers, doors, crates, kegs, washing machines, bikes, the workbench
and the lift — all top-down, on a 16 px grid, from one 26-colour palette.

## Where it comes from

`frontend/tools/build-atlas.mjs` generates it:

```bash
npm run atlas      # or just `npm run build`, which runs it first
```

The sprites are **defined in code** rather than painted, on purpose: they stay diffable in review, a
palette change is one edit rather than thirty repaints, and there is no binary to merge-conflict on.
The script has no dependencies — it encodes the PNG itself.

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
