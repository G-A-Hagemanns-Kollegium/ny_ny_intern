# Lords of the ØK: The Game — handover notes

A delivery game built for the GAHK hackathon on the `Albert-Hackathon` branch. You play a bud for
Ølkælderen: knock on doors, fetch the goods from the cellar, run them back up. Reachable at
`/intern/spil/`, from the **Fritid** section at the bottom of the sidebar.

The directory is still called `spil` everywhere — the app label, the URL and the CSS prefix are
load-bearing and were not worth churning for a rename.

This file is the context a new session needs. `ASSETS.md` next door covers the art pipeline.

---

## 1. Where everything lives

| Path | What |
|---|---|
| `app/spil/` | Django app. **No models**, no migrations. One login-gated view. |
| `app/templates/spil/spil.html` | The page: a canvas, a few overlay elements, two `json_script` payloads. |
| `app/static/spil/spil.css` | All page styling. Every selector is under `.spil-*` / `#spil-*`. Linked with `?v=<mtime>` — see `_css_version()`. |
| `app/static/spil/atlas.png` + `.json` | The generated sprite sheet. Committed. |
| `frontend/src/spil/*.ts` | The game, ~3 900 lines. Its own Vite entry → `dist/spil.js`. |
| `frontend/tools/build-atlas.mjs` | Builds the sprite sheet. Runs as part of `npm run build`. |
| `frontend/src/spil/propsize.ts` | **Generated** by the above: every sprite's real footprint. Do not edit. |
| `app/tests/test_spil.py` | 8 tests. They cover the *seam*, not the game. |

### The isolation rules — do not break these

The game is a guest in somebody else's application. It was accepted on those terms:

- **No models.** A test asserts that loading the page creates zero rows in any of our tables. The
  two queries in `views.py` are read-only flavour (`core.Room`, `oelkaelder.Product`, `Residency`).
- **Its own bundle.** `spil` imports nothing from `main.ts`, so Rollup emits no shared chunk and
  `app.js`/`app.css` stay byte-identical. Check this if you ever add a shared import.
- **Keyboard is bound to the canvas**, never to `window` — arrow keys still scroll the page
  everywhere else on the site.
- **Total footprint on shared files is ~24 lines**: one `INSTALLED_APPS` entry, one `include()`, the
  nav section in `core/context_processors.py`, one SVG icon in `base.html`, and the Vite config.

---

## 2. The game, as a system

### A run

Seven minutes (`RUN_SECONDS`). Kroner are the **score** and cannot be spent. When the clock runs out
the score goes on a local top-ten leaderboard and the run is over.

Copy that quotes the shift length uses `RUN_MINUTES`, derived from `RUN_SECONDS`, so the two cannot
drift. **Changing the shift length means bumping `SAVE_KEY`** — every time. Scores from shifts of
different lengths are not the same achievement, and mixing them on one board is worse than losing
the old one. `STALE_KEYS` clears the superseded keys on load so the bumps do not leave litter
behind. It has gone v4 → v5 (15 → 10 min) → v6 (10 → 7 min).

Shortening the shift also shortens progression, so the XP awards in `config.ts` went up by about a
third at the same time — the two knobs have to move together or a shorter run just means fewer
levels.

### Orders

`orders.ts`. Life cycle: `pending → taken → carrying → paid`.

- A pending request has **no clock**. The single timer starts when you knock and stops when you
  deliver. That timer drives everything: the kroner get a speed bonus, and experience is *mostly*
  the fraction of the deadline you had left.
- An order is addressed to a **`Cell`, not a room number**. Usually that cell is someone's room;
  during a party it is festsalen or a gangkøkken, where nobody lives. `atCell()` / `nextAtCell()`
  are the lookups. `room` is `0` for a non-room delivery and `label` is what the UI shows.
- Spawning keeps the higher of two floor draws only **half** the time, and a run seeds four
  low-floor orders at the start. A straight max-of-two starved Stuen and 1. sal completely.
- Two caps, and they are different things: `MAX_PENDING` is how many requests may be *waiting*,
  `MAX_ACCEPTED` is how many you may have *on the go*. At the cap the door prompt reads "Hænderne
  er fulde" before you walk over, and pressing E says why. `MAX_ACCEPTED` and the width of the
  order strip have to move together — the strip is sized to show exactly that many cards.
- Nothing announces a new order. There is no popup: the `?` over a door and the per-floor tally on
  the minikort are how you find work.

### The four buds

`CHARACTERS` in `progress.ts`. Albergon, Markolas, Boraniel and Fredo, all playable from the start.
Each carries a `Perk`, copied onto the `Run` at `newRun()` so every balance helper works off the run
alone and nothing has to reach for the save:

| Bud | Perk |
|---|---|
| Albergon | starts the shift with Minikort already owned (`starts`) |
| Markolas | ×1.2 speed, one belt slot fewer |
| Boraniel | ×0.8 speed, two belt slots more |
| Fredo | `sureFooted`: spilt beer and people do not slow him. Boxes and bikes still block. |

Two of those are deliberate trade-offs rather than upgrades, so picking one is a choice and not a
ranking. `capacity()` floors at 2 so a slot penalty can never leave you unable to carry an order. Each is a stack of four layers
(body, eyes, outfit, hair) from the full pack's character generator, composited by the atlas
builder; the twenty premade characters do not contain "red hair and a red shirt", so a brief like
that can only be met by building it. `art` is the atlas prefix, `artOf()` resolves a saved id.

The generator ships idle and walk but **no run cycle**, so sprinting plays the walk cycle faster
instead of a second set of frames. That is the one thing lost by moving off the free tier's fixed
cast, and it is why `drawPlayer` has two gaits rather than three.

### The menus

Four screens, in order: **title** (`showTitle` — logo, one button, the leaderboard; no tagline) → **tutorial**
(`showTutorial`) → **select** (`showSelect`) → run. "En gang til" on the game-over screen skips all
three and restarts immediately, which is why they are separate screens rather than one flow.

The tutorial is four illustrated steps and a key list. The art is *atlas frames*, drawn with
`chip()` — the board shows the actual doors, crates and bottles the player is about to see. `chip()`
takes the height the sprite should end up at rather than a scale factor: these range from a 14 px
bottle to a 32 px bud, and one shared factor makes one of them wrong every time.

### Experience, levels, skills

`progress.ts`. `Run` is one shift and dies with it; `Save` is the leaderboard and chosen character
and persists. XP → levels → one skill point each. Seven skills (`SKILLS`), including two with
prerequisite. The færdigheder screen lays them out under **three tracks** (`TRACKS`: Mobilitet,
Last, Andet), one *row per skill* and one *card per level* of it, connected by a line — so a build
reads as routes you extend. Exactly one card is ever for sale: the next level up, and only when a
point is in hand. The panel is allowed to scroll.

Løbesko span the same speed range they always did (level 1 is +22 %, the top +132 %) but over four
levels instead of six, so `sprintFactor` interpolates rather than multiplying by a fixed step —
change `max` and the curve still hits the same endpoints. Two skills are gone: Telefonliste, which gated the minikort's per-floor order tally (always
readable now), and Sækkevogn, which bought three extra slots and waived the carry speed penalty —
so a full crate always slows you down, with no way to buy out of it. The UI says **level**, never *niveau* — one word, everywhere.

Levelling fires fireworks, a banner and a toast, and **nothing else** — the panel used to open
itself 1.5 s later, which stopped the run mid-stride for a decision that can wait. The point keeps
until you ask for it on the Diablo-style button in the **bottom-right corner** (also `K`), which
glows and has an arrow bouncing at it.

Two things about that button are easy to break. The arrow is a *sibling*, not a child: the button's
`clip-path` bevel clips its own descendants. And it sits flush in the corner, *over* the right-hand
end of the canvas bottom bar rather than floating above it — `drawLevel` keeps `SKILL_BTN_W` (46
logical px) of that corner empty for it, so the two constants have to move together.

**In fullscreen the frame fills the screen but the canvas is letterboxed inside it**, so anything
anchored to a corner needs insetting by the bar or it floats out over the background. `--spil-bar-x`
/ `--spil-bar-y` under `.spil-frame:fullscreen` restate the canvas's own sizing rule to compute it.

A **combo** multiplies both kroner and XP: deliver again within `COMBO_WINDOW` and it climbs.

### Events

`events.ts`. One at a time, on a cooldown. Three kinds: `trappe` (three orders on three different
floors), `fest` (a party at festsalen or a gangkøkken — four guests, four orders, one address),
`storkunde` (one double-size order at double pay). Event orders count against `MAX_ACCEPTED` like
any other, so a party can fill your hands on its own.

**An event you cannot find is an event you ignore**, so every event carries a `where` string and a
`floors` list, and one colour (`EVENT_COL`) says "this is the bonus" in four places at once:

- the event card spells out the address — `007 · Stuen  112 · 1. sal  402 · 4. sal` for a race,
  `køkken · 4. sal` for a party, `010 · Stuen · 8 varer` for a big order;
- the opening toast names it too, for when the card is not what you are looking at;
- the minikort tints the tally for every floor the event wants something on, so "which staircase"
  is answerable without opening anything, and draws its order markers a pixel bigger;
- accepted event orders keep the colour in the top strip, so the bonus card is distinguishable from
  ordinary work.

### The lift

The one thing skill points cannot buy. It starts broken, with the quest written on a sign next to
every shaft. Collect the toolbox in **Værkstedet on 4. sal**, then press E at any lift door.

### Obstacles

Per floor, deterministic from the floor index: boxes, buckets, mops, bikes and crates hugging one
wall of the Gang, plus puddles of spilt beer that halve your speed. Placement keeps 34 px clear of
every doorway and never touches a stairwell — **nothing may ever wall you in or make an order
unreachable**. One NPC paces each floor; bumping them costs you a moment.

---

## 3. The map

`building.ts`. Six levels: Kælderen plus Stuen and 1.–4. sal, from Albert's floor plans.

A floor is three things: `cells` (rooms and other closed spaces, each with a door), `walk` (the
rectangles you may stand in), and `stairs` (two stairwells, each a down flight and an up flight
wrapped around the lift shaft).

- **The walkable area differs per floor** — the cellar's is cut short by the kitchen — so it is
  stored per floor, not derived.
- **Open cells** (Stuen's Hall, festsalen) have no door and no fourth wall; you walk straight in
  from the Gang, and their furniture becomes collision rather than decoration.
- Room numbers and occupants come from `core.Room` + the current `Residency` list. With an empty
  database the client rebuilds the identical map from the legacy `delt.php` rules.
- Occupants are **first names only** — the alumneliste already shows every logged-in resident far
  more than that, and a test asserts the surname and e-mail never reach the page.

---

## 4. Rendering

`render.ts`. Top-down with an **oblique projection**: the floor plan is unchanged, but every wall
stands up toward the camera with a visible face.

Two rules worth knowing before you touch it:

1. **Wall heights.** The wall containing the door is a full face (`WALL_FACE_H`, 15 px); the wall
   opposite is a skirting (`WALL_BACK_H`, 7 px). This is not decorative — it is what gives a room
   enough floor for a LimeZu bed (42×54) to fit inside the clip. Before it, beds were cropped to
   their headboards and looked like grey boxes.
2. **Draw order is north → south**, so a wall lands in front of what it should hide. The bud is
   drawn between the two bands *unless he is standing in a south-band room* — that check
   (`budIsSouth`) is what stopped him vanishing inside Værkstedet.

Everything is drawn in logical pixels (448×288, 16 px tiles) and the context is scaled once, so the
game is resolution-independent and fullscreen needs no special case.

### On-screen UI

The screen is split into three bands, and the rule is what you read *before moving* goes at the
top, what you read *while running* goes at the bottom, and the world is what is left.

- **HUD** (canvas, top): floor and run clock on the far left, then the big score, then the
  **order strip** filling the whole right-hand half — one card per accepted order, room and
  countdown only, because nothing longer gets read at a sprint. The score is left-aligned at
  `SCORE_X` rather than centred so the strip gets that space; `CARDS_X` clears the widest score a
  run can print, and the combo readout tucks under the score for the same reason. Everything but the clock and the score
  is a size down from the rest; those two are what you glance at.
- **Event card** (canvas, just under the HUD): the bonus event keeps a row to itself — it is a
  headline, it only appears occasionally, and it is far too wide to share the order strip. It sizes
  itself to the address it has to print. It used
  to be a DOM banner in the top-right, which is how it ended up on top of the experience bar.
- **Bottom bar** (canvas, `BAR_H`): the plan on the left, the crate in the middle with the
  experience bar running its full width directly underneath, and the level and any unspent point on
  the right. It floats over the world rather than reserving space — the building is
  taller than the view, so there is none to give — and it is kept as shallow as the three will
  allow, because its height comes straight off the foot of the south rooms. `WORLD_TOP` nudges the
  building up by the slack above the stairwells for the same reason.
- **The belt** is a Minecraft hotbar: one slot per unit of capacity, filled left to right with what
  is actually in the crate, each good drawn as its own icon (`goodIcon` maps the real Ølkælder
  product names onto them). Over each unbroken run of slots is the room it is for, because you can
  carry three orders at once and the tag above the bud fits one name. Slot width shrinks to fit
  whatever Vogn has bought — fifteen slots still land between the plan and the level block. The
  experience bar is drawn by `drawBelt` so the two cannot drift apart: progress toward the next
  level belongs with the thing you fill up.
- **Toast**, the **skill-point button** and the **modals** are the only DOM left.

The DOM overlays scale with the frame: `.spil-frame` is a CSS size container and sets its own
`font-size` from its width, and every overlay is measured in `em`. No JS involved.

---

## 5. Running it

```bash
task dev          # builds the frontend, migrates, serves on 127.0.0.1:8800
```

Log in (`beboer@gahk.dk` / `demo1234` on seeded demo data) and open Lords of the ØK.

```bash
cd frontend && npm run build     # atlas + both bundles
cd frontend && npx tsc --noEmit  # the only TS typecheck; CI does not run it
task test:sqlite                 # 305 tests
task lint && task typecheck      # ruff + mypy
```

### The cheat console

Press **`/`** (or `½` / F2) with the game focused. It pauses the run, Esc closes it, ↑/↓ walks
history. `hjælp` lists everything. The ones that save real time:

- `rum <nnn>` — teleport in front of a door
- `event [trappe|fest|storkunde]` — fire one now instead of waiting out the cooldown
- `alt` — every skill maxed, lift repaired
- `xp <n>`, `point <n>`, `tid <n>`, `slut`, `status`

It is always on, not `DEBUG`-gated: the save is localStorage-only and the leaderboard is local, so
there is nothing to protect. **If you ever add a server leaderboard, gate the console first** —
`penge 99999` would otherwise make any posted score meaningless.

---

## 6. Testing in a headless browser — read this before you waste an hour

The preview pane reports the tab as hidden, so **`requestAnimationFrame` never fires** and the game
loop is frozen. Symptoms: nothing moves, screenshots look stale, timers do not advance.

The workaround is to drive the loop by hand:

```js
window.__pending = null;
window.__t = performance.now() + 60000;      // stay ahead of any real rAF timestamp already seen
window.requestAnimationFrame = (cb) => { window.__pending = cb; return 1; };
window.__step = (n) => { for (let i = 0; i < n; i++) {
  const cb = window.__pending; if (!cb) return 'dead@' + i;
  window.__pending = null; window.__t += 16; cb(window.__t);
} return 'ok'; };
```

Then dispatch `KeyboardEvent`s at `#spil-canvas` and call `__step(n)` for exactly `n` frames.

Two traps:
- After installing the shim the chain is **dead until one real paint happens** — take a screenshot
  once to kick it, then step freely.
- Scripted straight-line walks fail where corridor obstacles are. Walk down the middle of the Gang
  (`y ≈ 150`), not along a wall.

---

## 7. Decisions worth not re-litigating

- **The leaderboard is local (localStorage).** A shared one is small — one model, one POST view —
  but it needs the cheat console gated first, and this app has been deliberately model-free.
- **Fictional names were replaced with real ones** on request. First names only, per §3.
- **Both stairwells are aligned on every floor**, though the cellar plan draws the right one lower.
  A flight has to land where the one below it left, or you slide sideways on every floor change.
- **The sprite atlas is generated, not painted**, in three layers: procedural sprites, then the
  free tier over the top, then the full pack over that. Any of them can be missing and the build
  still produces a complete, if plainer, game. The packs are gitignored because their licence
  forbids redistributing them, and the required credit is on the title screen — see `ASSETS.md`.
- **Sprite sizes are generated too** (`propsize.ts`). Rooms are laid out from a sprite's real
  footprint, so a hand-written table would drift silently the first time a sprite was recut.
- **No vertical squash** for the 3D look, and **walls do not occlude the player**. Both were
  considered; both cost more than they are worth at a 64 px corridor height.
- **Momentum on Rulleskøjter** was proposed and not built. Speed currently has no downside, which
  makes it a strictly-correct buy; inertia would fix that and make the obstacles matter. ~15 lines
  in `move()`. Probably the best value left on the table.

## 8. Bugs that were real, so they do not come back

- **Negative `dt`.** A frame timestamp that goes backwards (tab restore) ran the shift clock in
  reverse and silently broke spawning *and* movement. `dt` is now clamped at both ends.
- **Django's `{# … #}` is single-line only.** A two-line one never closes and renders verbatim onto
  the page. `test_templates.py` catches it; it has fired for real.
- **`{% static %}` on a file that does not exist is a hard 500** under the hashed manifest storage.
  The atlas path is passed as a raw `STATIC_URL` string from the view for exactly this reason.
- **The bud vanished in Værkstedet** — see the draw-order rule in §4.
- **Walking looked frozen while running animated.** Row 1 of a LimeZu character sheet is the *idle*
  animation; the walk is row 2. See the row table in `ASSETS.md`.
- **The occupant stood on top of the furniture, then inside it.** Both are the same mistake: the
  camera looks from slightly south, so "in front of" always means further down the screen, and for
  a room whose door is in its *top* wall the wall opposite the door is the one nearest the camera.
  Big pieces are set back from it and the occupant walks in the gap.
- **Beds rendered as slabs with a window in them.** The free tier's beds are frames with a
  transparent recess; the bedding is a separate layer that only ships in the paid pack. The
  generator fills the recess itself — see `makeBed()` and the note in `ASSETS.md`.
- **The select screen showed a bud who was not the one you play.** The portrait was drawn in CSS
  from the old procedural palette and nobody updated it when the cast became LimeZu's. It now comes
  off the same sheet as the sprite, so it cannot drift again.
- **Festsalen came out empty the day it got furniture.** Props in an *open* cell are moved into the
  floor's obstacle list and the cell's `props` cleared; anything without a hand-tuned collision box
  was dropped on the way. Unknown sprites now get a box derived from their footprint.
- **Open-cell furniture was drawn squashed.** `drawObstacle` scaled the sprite to the obstacle rect,
  which was the *collision* box — so a sofa was painted at the size of the thing you bump into.
  `Obstacle.hit` now carries the collision box separately from the drawn rect.
- **A new kitchen fridge silently replaced Ølkælderen's.** The kiosk's wide shop cooler and a
  household fridge are different objects that both wanted the name `fridge`. Atlas names are one
  flat namespace — check before adding one.
- **An edited spil.css kept serving from cache**, twice hiding finished work behind "it looks the
  same to me". `{% static %}` returns a bare path in development; the link now carries the file's
  mtime as `?v=`, and a test asserts it. Production's hashed manifest storage was never affected.
- **The skill-point button was verified in the wrong layout.** It was only ever checked with the
  fullscreen override used for screenshots, where the frame is taller than the canvas — a `bottom`
  percentage that looked like the corner there was 37 px shy of it on the real page. Check overlay
  positions against `#spil-canvas`'s bounding rect, not by eye in a forced layout.
- **Corner stairwells were unreachable** because the player clamp stopped 10 px from the wall and
  the flights are 40 px in with a 26 px reach. Clamp is 16 px now.

## 9. Ideas not yet built

A full brainstorm of character abilities and skills was done and not implemented — active
abilities on a cooldown, per-character passives (Trappetrolden, Værten, Nattevagten, Mekanikeren),
and skill-tree additions like **Stemmen** (orders accept as you walk past) and **Kældergenvej** (a
chute so you can load from any floor). The framework needed is small: a per-character passive hook
plus one active with a cooldown pip in the HUD. After that each character is mostly data.

The single biggest structural cost in the game is **the round trip to the cellar**. Abilities that
attack it change the game most; anything else should be deliberately smaller.
