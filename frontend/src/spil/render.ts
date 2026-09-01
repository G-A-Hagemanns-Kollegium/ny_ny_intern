/** Top-down renderer with oblique walls: one floor of the building, seen from above and slightly in
 *  front, so every wall stands up and you can see the doors in it.
 *
 *  Everything is drawn in *logical* pixels (448×288, tiles of 16) and the context is scaled once, so
 *  the game is resolution-independent and the same code works fullscreen.
 */

import { panel, rect, sprite, spriteFoot, text, textOut, tileFill, type Atlas } from "./art";
import {
  CORR_Y,
  WORLD_H,
  hash,
  WORLD_W,
  occupantOf,
  rectPx,
  roomLane,
  type Cell,
  type Floor,
  type Rect,
  type Stairwell,
} from "./building";
import { HUD_H, PALETTE as P, TILE, VIEW_H, VIEW_W, WALL_BACK_H, WALL_FACE_H, WALL_SIDE } from "./config";
import { eventFraction, type ActiveEvent, type Party } from "./events";
import { clockText, goodIcon, type Order, type OrderBook } from "./orders";
import { COMBO_WINDOW } from "./config";
import { comboMultiplier, xpNeeded, type Run } from "./progress";

/** The score sits beside the clock, not centred: the right-hand half of the top bar is the order
 *  strip, and five cards need all of it. `CARDS_X` clears the widest score a run can print. */
const SCORE_X = 66;
/** Width the bottom bar keeps clear on the right for the DOM skill-point button. Matches
 *  `.spil-skillbtn` in spil.css: 4.4em wide at a frame font-size of 1.8cqw, plus its inset. */
const SKILL_BTN_W = 46;
const CARDS_X = 178;

/** The persistent readouts all live in one strip along the bottom. Kept as shallow as the plan and
 *  the crate will allow, because whatever height it takes it takes off the foot of the south rooms. */
const BAR_H = 40;
/** The one colour that means "this is the bonus event". */
const EVENT_COL = "#e2a0ff";
/** The building is nudged up rather than centred: there is slack above the stairwells that nobody
 *  looks at, and every pixel of it is a pixel of south room the bar does not cover. */
const WORLD_TOP = HUD_H - 9;
const DOOR_W = 14;
/** Where the band of rooms mod gaden begins — anything past this is drawn after the bud. */
const SOUTH_BAND_Y = (CORR_Y + 4) * TILE;

export interface PlayerView {
  x: number;
  y: number;
  facing: "up" | "down" | "left" | "right";
  moving: boolean;
  anim: number;
  carrying: boolean;
  sprinting: boolean;
  /** 0 on the ground, 1 at the top of a jump. */
  jump: number;
}

export interface NpcView {
  x: number;
  y: number;
  dir: -1 | 1;
  anim: number;
  moving: boolean;
}

export interface Pop {
  text: string;
  x: number;
  y: number;
  life: number;
  good: boolean;
  big: boolean;
}

/** A firework spark, in screen space so it does not scroll with the building. */
export interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  delay: number;
  colour: string;
}

/** Dust off the heels of a dash, in world space. */
export interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  max: number;
}

export interface Scene {
  floor: Floor;
  camX: number;
  player: PlayerView;
  npc: NpcView | null;
  party: Party | null;
  orders: OrderBook;
  event: ActiveEvent | null;
  run: Run;
  /** Everything you have accepted: taken (still to fetch) and carrying. */
  running: Order[];
  capacity: number;
  /** Atlas prefix for the bud the player picked. */
  art: string;
  showMap: boolean;
  prompt: string | null;
  pops: Pop[];
  sparks: Spark[];
  puffs: Puff[];
  /** "LEVEL 4!" while the fireworks are up. */
  banner: string | null;
  toolbox: { floor: number; x: number; y: number } | null;
  fade: number;
  fadeLabel: string;
}

/** Flat things — they are the floor, not on it, so they never take part in the depth sort. */
const FLAT = new Set(["rug", "rug2", "rug_big"]);

/** One frame of a room occupant's walk, worked out before the depth sort and painted after it. */
interface Pose {
  x: number;
  y: number;
  name: string;
  fallback: string;
  mirror: boolean;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private scale = 2;

  constructor(
    private canvas: HTMLCanvasElement,
    private atlas: Atlas,
  ) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
  }

  setAtlas(atlas: Atlas): void {
    this.atlas = atlas;
  }

  /** How many frames a walk cycle actually has — three for the generated cast, six for LimeZu's. */
  private cycle(prefix: string): number {
    let n = 0;
    while (this.atlas.frames[`${prefix}_${n}`]) n++;
    return Math.max(1, n);
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = this.canvas.clientWidth || VIEW_W * 2;
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.round((w * VIEW_H) / VIEW_W);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.scale = w / VIEW_W;
  }

  draw(s: Scene): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = P.void;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.scale(this.scale, this.scale);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, HUD_H, VIEW_W, VIEW_H - HUD_H);
    ctx.clip();
    ctx.translate(-Math.round(s.camX), WORLD_TOP);
    this.drawWorld(s);
    ctx.restore();

    this.drawHud(s);
    this.drawEventCard(s);
    this.drawBottomBar(s);
    if (s.prompt) this.drawPrompt(s.prompt);
    if (s.fade > 0) this.drawFade(s.fade, s.fadeLabel);
    this.drawSparks(s);
  }

  // -------------------------------------------------------------------------------- the floor
  private drawWorld(s: Scene): void {
    const f = s.floor;
    const north = f.cells.filter((c) => c.y < CORR_Y);
    const south = f.cells.filter((c) => c.y >= CORR_Y);
    // Rooms mod gaden are painted after the bud — unless he has walked into one of them, which is
    // exactly what happens in Værkstedet on 4. sal, and used to make him vanish.
    const budIsSouth = s.player.y >= SOUTH_BAND_Y;
    const toolboxHere = s.toolbox && s.toolbox.floor === f.index && !s.run.tools;

    this.drawRoof(f);
    this.drawWalkable(f);
    for (const st of f.stairs) this.drawStairwell(st, f, s);
    for (const c of north) this.drawCell(c, f, s);
    this.drawGangWall(f, "north");

    for (const h of f.hazards) this.drawHazard(h);
    for (const o of f.obstacles) this.drawObstacle(o);
    if (s.npc) this.drawNpc(s.npc);
    if (!budIsSouth) this.drawPlayer(s);

    for (const c of south) this.drawCell(c, f, s);
    this.drawGangWall(f, "south");
    if (toolboxHere) this.drawPickup(s.toolbox!.x, s.toolbox!.y, s.player.anim);
    if (budIsSouth) this.drawPlayer(s);

    if (s.party && s.party.floor === f.index) this.drawParty(s.party);
    for (const u of s.puffs) this.drawPuff(u);
    for (const c of f.cells) this.drawMarker(c, s);
    for (const p of s.pops) this.drawPop(p);
  }

  private drawRoof(f: Floor): void {
    const ctx = this.ctx;
    for (const c of f.cells) {
      if (c.y >= CORR_Y || c.h <= 2) continue;
      const r = rectPx(c);
      const y = Math.max(0, r.y - 15);
      rect(ctx, r.x - 2, y, r.w + 4, r.y - y, "#2b2333");
      rect(ctx, r.x - 2, y, r.w + 4, 2, "#3d3448");
      for (let i = Math.ceil(r.x / 10) * 10; i < r.x + r.w; i += 10) {
        rect(ctx, i, y + 3, 1, r.y - y - 4, "rgba(0,0,0,0.18)");
      }
      rect(ctx, r.x - 2, r.y - 2, r.w + 4, 2, f.wallDark);
    }
  }

  /** A wall standing up out of the plan: lit along the top, skirting at the bottom, and a shadow
   *  thrown onto the floor in front of it. This one primitive is the whole 2.5D effect. */
  private wallFace(x: number, y: number, w: number, h: number, f: Floor, shadow = true): void {
    const ctx = this.ctx;
    // One wall run per floor, so you can tell where you are from the wallpaper alone.
    if (!tileFill(ctx, this.atlas, `wall_${f.index}`, x, y, w, h)) {
      rect(ctx, x, y, w, h, f.wall);
      rect(ctx, x, y, w, 2, f.wallLight);
      rect(ctx, x, y + 2, w, 1, "rgba(0,0,0,0.10)");
      if (h > 10) {
        rect(ctx, x, y + 5, w, 1, f.wallLight); // picture rail
        rect(ctx, x, y + 6, w, 1, "rgba(0,0,0,0.12)");
      }
      rect(ctx, x, y + h - 4, w, Math.min(4, h - 2), f.wallDark);
      rect(ctx, x, y + h - 5, w, 1, f.wallLight);
    }
    rect(ctx, x, y + h - 1, w, 1, "rgba(0,0,0,0.45)");
    if (shadow) {
      const g = ctx.createLinearGradient(0, y + h, 0, y + h + 5);
      g.addColorStop(0, "rgba(14,10,20,0.38)");
      g.addColorStop(1, "rgba(14,10,20,0)");
      ctx.fillStyle = g;
      ctx.fillRect(Math.round(x), Math.round(y + h), Math.round(w), 5);
    }
  }

  /** The Gang's own two walls, across every stretch no room already covers. Openings — the Hall,
   *  festsalen, the stairwell landings — are left out, because you walk through those. */
  private drawGangWall(f: Floor, side: "north" | "south"): void {
    const y = side === "north" ? CORR_Y * TILE - WALL_FACE_H : SOUTH_BAND_Y;
    let spans: [number, number][] = [[5 * TILE, (73 - 5) * TILE]];
    const cut = (a: number, b: number): void => {
      const out: [number, number][] = [];
      for (const [s0, s1] of spans) {
        if (b <= s0 || a >= s1) out.push([s0, s1]);
        else {
          if (s0 < a) out.push([s0, a]);
          if (b < s1) out.push([b, s1]);
        }
      }
      spans = out;
    };
    for (const c of f.cells) {
      const on = side === "north" ? c.y < CORR_Y : c.y >= CORR_Y;
      if (on) cut(c.x * TILE, (c.x + c.w) * TILE);
    }
    if (side === "north") {
      for (const st of f.stairs) cut(st.frame.x * TILE, (st.frame.x + st.frame.w) * TILE);
    }
    for (const [a, b] of spans) this.wallFace(a, y, b - a, WALL_FACE_H, f, side === "north");
  }

  private drawWalkable(f: Floor): void {
    const ctx = this.ctx;
    for (const r of f.walk) {
      const w = rectPx(r);
      if (!tileFill(ctx, this.atlas, "floor_wood", w.x, w.y, w.w, w.h)) {
        rect(ctx, w.x, w.y, w.w, w.h, P.corridor);
        for (let y = w.y + 5; y < w.y + w.h; y += 6) rect(ctx, w.x, y, w.w, 1, P.corridorAlt);
        for (let x = w.x; x < w.x + w.w; x += TILE * 3) rect(ctx, x, w.y, 1, w.h, P.corridorAlt);
      }
      if (w.h >= 48) {
        const ry = w.y + w.h / 2 - 11;
        // The GAHK runner, kept translucent so the boards still read through it.
        ctx.save();
        ctx.globalAlpha = 0.72;
        rect(ctx, w.x, ry, w.w, 22, P.runner);
        ctx.restore();
        rect(ctx, w.x, ry, w.w, 1, P.runnerEdge);
        rect(ctx, w.x, ry + 21, w.w, 1, P.runnerEdge);
      }
    }
  }

  private drawHazard(h: Rect): void {
    const ctx = this.ctx;
    if (!sprite(ctx, this.atlas, "puddle", h.x, h.y, h.w, h.h)) {
      ctx.save();
      ctx.globalAlpha = 0.6;
      rect(ctx, h.x, h.y, h.w, h.h, "#b8a04a");
      ctx.restore();
    }
  }

  private drawObstacle(o: Rect & { sprite: string }): void {
    const ctx = this.ctx;
    ctx.fillStyle = P.shadow;
    ctx.fillRect(o.x + 1, o.y + o.h - 2, o.w, 3);
    if (!sprite(ctx, this.atlas, o.sprite, o.x, o.y, o.w, o.h)) {
      rect(ctx, o.x, o.y, o.w, o.h, "#6d5a48");
    }
  }

  private drawCell(c: Cell, f: Floor, s: Scene): void {
    const ctx = this.ctx;
    const r = rectPx(c);
    if (r.x - s.camX > VIEW_W || r.x + r.w - s.camX < 0) return;

    const here = s.orders.atCell(c);
    const lit = here.length > 0 || c.kind === "kiosk" || c.kind === "workshop" || c.open;

    const topWall = c.doorSide === "top" ? WALL_FACE_H : WALL_BACK_H;
    const botWall = c.doorSide === "bottom" ? WALL_FACE_H : WALL_BACK_H;
    const fx = r.x + WALL_SIDE;
    const fw = r.w - WALL_SIDE * 2;
    const tiled = c.kind === "bath" || c.kind === "kitchen" || c.kind === "kiosk";
    const floorTile =
      c.kind === "room" ? "floor_carpet"
      : c.kind === "bath" ? "floor_bath"
      : tiled ? "floor_kitchen"
      : "floor_concrete";
    if (!tileFill(ctx, this.atlas, floorTile, fx, r.y, fw, r.h)) {
      rect(ctx, fx, r.y, fw, r.h, tiled ? P.tileFloor : c.kind === "room" ? P.roomFloor : P.concrete);
      for (let y = r.y + 6; y < r.y + r.h; y += 7) {
        rect(ctx, fx, y, fw, 1, c.kind === "room" ? P.roomFloorAlt : "#6d6a63");
      }
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(fx, r.y + topWall, fw, r.h - topWall - botWall);
    ctx.clip();
    // Painter's algorithm on the near edge of each thing, so the resident walks behind the wardrobe
    // and in front of the rug rather than always on top of both. Rugs are flat and always go first.
    const layers: { base: number; draw: () => void }[] = c.props.map((prop) => {
      const frame = this.atlas.frames[prop.sprite];
      const flat = FLAT.has(prop.sprite);
      return {
        base: flat ? -1e9 : prop.y + (frame ? frame.h : 10),
        draw: (): void => {
          if (frame && !flat) {
            ctx.fillStyle = "rgba(20,14,26,0.30)";
            ctx.fillRect(prop.x + 1, prop.y + frame.h - 1, frame.w, 3);
          }
          if (!sprite(ctx, this.atlas, prop.sprite, prop.x, prop.y)) {
            rect(ctx, prop.x, prop.y, 12, 10, "#6d5a48");
          }
        },
      };
    });
    if (c.kind === "room") {
      const pose = this.occupantPose(c, s);
      layers.push({ base: pose.y, draw: (): void => this.paintOccupant(pose) });
    }
    layers.sort((a, b) => a.base - b.base);
    for (const layer of layers) layer.draw();
    ctx.restore();

    if (lit) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(255,196,110,0.16)";
      ctx.fillRect(fx, r.y, fw, r.h);
      ctx.restore();
    } else if (c.kind === "room") {
      ctx.fillStyle = "rgba(24,18,32,0.42)";
      ctx.fillRect(fx, r.y, fw, r.h);
    }

    rect(ctx, r.x, r.y, WALL_SIDE, r.h, f.wallDark);
    rect(ctx, r.x, r.y, 1, r.h, f.wallLight);
    rect(ctx, r.x + r.w - WALL_SIDE, r.y, WALL_SIDE, r.h, f.wallDark);
    rect(ctx, r.x + r.w - 1, r.y, 1, r.h, "rgba(0,0,0,0.35)");

    const openTop = c.open && c.doorSide === "top";
    const openBottom = c.open && c.doorSide === "bottom";
    if (!openTop) this.wallFace(r.x, r.y, r.w, topWall, f, c.doorSide === "top");
    if (!openBottom) this.wallFace(r.x, r.y + r.h - botWall, r.w, botWall, f, c.doorSide === "bottom");

    if (!c.open) this.drawDoor(c, f, here.length > 0);
    this.drawLabel(c, here.length && c.room ? occupantOf(c) : "");
  }

  /** The GAHK'er whose room this is, pacing their own floor. Which sprite they get and how they
   *  move is fixed by the room number, so a room always has the same person doing the same round —
   *  and it needs no state, because the whole walk is a function of the clock. */
  private occupantPose(c: Cell, s: Scene): Pose {
    const cast = ["res", "res2", "res3", "bud"][hash(c.room, 21) % 4];
    const seed = hash(c.room, 33);

    // One slow lap back and forth across the clear middle of the room.
    const period = 9 + (seed % 7);
    const theta = ((s.player.anim + (seed % 100)) / period) * Math.PI * 2;
    const drift = Math.cos(theta); // sign is the heading, size is how fast they are going
    const lane = roomLane(c, c.doorSide, c.seed);

    // Near the turning points they are barely moving, so they stand still and face the door.
    const walking = Math.abs(drift) > 0.3;
    const facing = walking ? "side" : c.doorSide === "top" ? "up" : "down";
    const prefix = `${walking ? "" : "idle_"}${facing}`;
    const n = Math.max(1, this.cycle(`${cast}_${prefix}`));
    return {
      x: lane.x + lane.w / 2 + Math.sin(theta) * Math.max(4, lane.w / 2 - 7),
      y: lane.y + Math.cos(theta * 0.7) * 2,
      name: `${cast}_${prefix}_${Math.floor(s.player.anim * (walking ? 7 : 2.2)) % n}`,
      fallback: `${cast}_down_0`,
      mirror: walking && drift < 0,
    };
  }

  private paintOccupant(pose: Pose): void {
    const ctx = this.ctx;
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(pose.x, pose.y, 5, 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (!spriteFoot(ctx, this.atlas, pose.name, pose.x, pose.y, pose.mirror)) {
      spriteFoot(ctx, this.atlas, pose.fallback, pose.x, pose.y);
    }
  }

  private drawDoor(c: Cell, f: Floor, lit: boolean): void {
    const ctx = this.ctx;
    const wide = c.kind === "kiosk" || c.kind === "hall";
    const w = wide ? 26 : DOOR_W;
    const x = c.doorX - w / 2;
    const y = c.doorSide === "bottom" ? c.doorY - WALL_FACE_H : c.doorY;
    const h = WALL_FACE_H;

    rect(ctx, x - 1, y, w + 2, h, f.wallDark);
    rect(ctx, x, y, w, h - 1, "#171220");
    rect(ctx, x, y, w, 2, "#0d0a12");

    const name = wide ? "door_front_wide" : c.kind === "workshop" ? "door_front_open" : "door_front";
    // A door is taller than the strip of wall you can see, so it is hung from the threshold and
    // allowed to overlap upwards rather than squashed into the band.
    const frame = this.atlas.frames[name];
    if (frame) {
      const dw = Math.min(w, frame.w);
      sprite(ctx, this.atlas, name, c.doorX - dw / 2, y + h - frame.h, dw, frame.h);
    } else {
      rect(ctx, x, y, w, h, "#8a6240");
      rect(ctx, x, y, w, 1, "#a97a52");
    }

    if (lit) {
      const dir = c.doorSide === "top" ? -1 : 1;
      const base = c.doorSide === "top" ? y : y + h;
      const g = ctx.createLinearGradient(0, base, 0, base + dir * 24);
      g.addColorStop(0, "rgba(255,196,110,0.5)");
      g.addColorStop(1, "rgba(255,196,110,0)");
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(c.doorX - w / 2, base);
      ctx.lineTo(c.doorX + w / 2, base);
      ctx.lineTo(c.doorX + w / 2 + 10, base + dir * 24);
      ctx.lineTo(c.doorX - w / 2 - 10, base + dir * 24);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  private drawLabel(c: Cell, who: string): void {
    const ctx = this.ctx;
    if (!c.label) return;
    const wide = c.label.length * 3.7 + 8;
    const y = c.open
      ? c.doorSide === "top"
        ? c.doorY + 4
        : c.doorY - 12
      : c.doorSide === "top"
        ? c.doorY + WALL_FACE_H + 2
        : c.doorY - WALL_FACE_H - 11;
    panel(ctx, c.doorX - wide / 2, y, wide, 8, "rgba(24,18,30,0.82)", "rgba(217,181,102,0.5)", 2);
    text(ctx, c.label, c.doorX, y + 6, P.brass, 5.5, "center");
    if (who) text(ctx, who, c.doorX, c.doorSide === "top" ? y + 15 : y - 3, "#ffe9c4", 5.5, "center");
  }

  private drawStairwell(st: Stairwell, f: Floor, s: Scene): void {
    const ctx = this.ctx;
    const fr = rectPx(st.frame);
    if (fr.x - s.camX > VIEW_W || fr.x + fr.w - s.camX < 0) return;

    rect(ctx, fr.x + WALL_SIDE, fr.y, fr.w - WALL_SIDE * 2, fr.h, P.concrete);
    for (let y = fr.y + WALL_FACE_H + 6; y < fr.y + fr.h; y += 8) {
      rect(ctx, fr.x + WALL_SIDE, y, fr.w - WALL_SIDE * 2, 1, "rgba(0,0,0,0.10)");
    }
    rect(ctx, fr.x, fr.y, WALL_SIDE, fr.h, f.wallDark);
    rect(ctx, fr.x, fr.y, 1, fr.h, f.wallLight);
    rect(ctx, fr.x + fr.w - WALL_SIDE, fr.y, WALL_SIDE, fr.h, f.wallDark);
    rect(ctx, fr.x + fr.w - 1, fr.y, 1, fr.h, "rgba(0,0,0,0.35)");
    this.wallFace(fr.x, fr.y, fr.w, WALL_FACE_H, f);

    const flight = (r: Rect, up: boolean): void => {
      const q = rectPx(r);
      rect(ctx, q.x, q.y, q.w, q.h, "#5f5c66");
      for (let i = 0; i < 8; i++) {
        const y = q.y + 2 + i * ((q.h - 4) / 8);
        rect(ctx, q.x + 2, y, q.w - 4, 2, i % 2 ? "#8f8a99" : "#787281");
      }
      const cx = q.x + q.w / 2;
      const cy = q.y + q.h / 2;
      const d = up ? -1 : 1;
      rect(ctx, cx - 1, cy - 6, 2, 12, P.red);
      for (let i = 0; i < 4; i++) rect(ctx, cx - 1 - i, cy + d * (6 - i) - 1, 2 + i * 2, 2, P.red);
    };
    flight(st.down, false);
    flight(st.up, true);

    const lf = rectPx(st.lift);
    const lx = lf.x + lf.w / 2 - 18;
    const ly = lf.y + lf.h / 2 - 18;
    if (!sprite(ctx, this.atlas, s.run.lift ? "lift_open" : "lift_broken", lx, ly, 36, 36)) {
      rect(ctx, lx, ly, 36, 36, s.run.lift ? "#9aa3aa" : "#4a4d55");
    }
    if (s.run.lift) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(255,214,150,0.22)";
      ctx.fillRect(lx + 6, ly + 10, 24, 24);
      ctx.restore();
    } else {
      // The lift quest, written on the wall where you actually meet it.
      const sign = s.run.tools ? "TRYK E: REPARÉR" : "VÆRKTØJ: VÆRKSTEDET, 4. SAL";
      const w = sign.length * 3.4 + 10;
      const sx = lf.x + lf.w / 2 - w / 2;
      const sy = ly + 38;
      panel(ctx, sx, sy, w, 10, "rgba(28,18,14,0.94)", s.run.tools ? P.greenLight : P.red, 2);
      text(ctx, sign, lf.x + lf.w / 2, sy + 7, s.run.tools ? "#bfe6cb" : "#f0c3bc", 5.5, "center");
    }
  }

  private drawPickup(x: number, y: number, anim: number): void {
    const ctx = this.ctx;
    const bob = Math.sin(anim * 4) * 1.5;
    ctx.fillStyle = P.shadow;
    ctx.fillRect(x - 4, y + 4, 10, 3);
    if (!sprite(ctx, this.atlas, "toolbox", x - 5, y - 4 + bob)) {
      rect(ctx, x - 5, y - 4 + bob, 10, 8, "#b8524f");
    }
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(217,181,102,0.25)";
    ctx.beginPath();
    ctx.arc(x, y, 12 + Math.sin(anim * 4) * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawMarker(c: Cell, s: Scene): void {
    const here = s.orders.atCell(c);
    if (!here.length || here[0].floor !== s.floor.index) return;
    if (c.doorX - s.camX < -30 || c.doorX - s.camX > VIEW_W + 30) return;

    const ctx = this.ctx;
    const order = s.orders.nextAtCell(c)!;
    const bob = Math.sin(s.player.anim * 3 + c.x) * 1.5;
    const y = (c.doorSide === "top" ? c.doorY - 22 : c.doorY + 8) + bob;
    const urgent = s.orders.isUrgent(order);
    const carrying = order.phase === "carrying";
    const fill = carrying ? "#2f6b45" : urgent ? "#7d2f2a" : "#2c2418";
    const stroke = carrying ? P.greenLight : urgent ? P.red : P.brass;

    panel(ctx, c.doorX - 7, y, 14, 13, fill, stroke, 3);
    if (carrying) {
      rect(ctx, c.doorX - 4, y + 4, 8, 6, "#c99a52");
      rect(ctx, c.doorX - 4, y + 6, 8, 1, "#8d6a34");
    } else {
      text(ctx, order.phase === "pending" ? "?" : "!", c.doorX, y + 10, stroke, 9, "center");
    }
    if (here.length > 1) {
      panel(ctx, c.doorX + 7, y - 2, 10, 9, "#2c2418", P.brass, 2);
      text(ctx, `${here.length}`, c.doorX + 12, y + 5, P.brass, 6.5, "center");
    }
    if (order.phase !== "pending") {
      rect(ctx, c.doorX - 7, y + 14, 14, 2, "rgba(0,0,0,0.5)");
      rect(ctx, c.doorX - 7, y + 14, 14 * s.orders.fraction(order), 2, urgent ? P.red : P.greenLight);
    }
  }

  /** Four guests standing about, and a couple of notes so you can spot the party down the Gang. */
  private drawParty(party: Party): void {
    const ctx = this.ctx;
    party.guests.forEach((g, gi) => {
      const cast = ["res", "res2", "res3", "res"][gi % 4];
      const bob = Math.floor(g.anim * 4) % this.cycle(`${cast}_down`);
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.ellipse(g.x, g.y, 6, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (!spriteFoot(ctx, this.atlas, `${cast}_down_${bob}`, g.x, g.y, g.dir < 0)) {
        rect(ctx, g.x - 5, g.y - 16, 10, 16, "#4f7fa8");
      }
    });
    const mid = party.guests[1] ?? party.guests[0];
    if (mid) {
      const t = party.guests[0].anim;
      for (let i = 0; i < 2; i++) {
        const yy = mid.y - 26 - ((t * 14 + i * 9) % 18);
        text(ctx, "♪", mid.x + (i ? 9 : -7), yy, "rgba(255,220,160,0.75)", 7, "center");
      }
    }
  }

  private drawNpc(n: NpcView): void {
    const ctx = this.ctx;
    const x = Math.round(n.x);
    const y = Math.round(n.y);
    const frame = n.moving ? Math.floor(n.anim * 8) % this.cycle("res_side") : 0;
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(x, y, 6, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (!spriteFoot(ctx, this.atlas, `res_side_${frame}`, x, y, n.dir < 0)) {
      rect(ctx, x - 5, y - 16, 10, 16, "#4f7fa8");
    }
  }

  private drawPlayer(s: Scene): void {
    const ctx = this.ctx;
    const p = s.player;
    const x = Math.round(p.x);
    const ground = Math.round(p.y);
    const y = ground - Math.round(p.jump * 13);
    // Two cycles, not three: the character generator ships idle and walk but no run, so sprinting
    // is the walk cycle driven faster. The dust puffs do the rest of the work.
    const gait = p.moving ? s.art : `${s.art}_idle`;
    const rate = !p.moving ? 3 : p.sprinting ? 16 : 9;
    const frames = this.cycle(`${gait}_side`);
    const frame = Math.floor(p.anim * rate) % Math.max(1, frames);

    ctx.save();
    ctx.globalAlpha = 0.4 - p.jump * 0.2;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(x, ground, 6 - p.jump * 2, 2.5 - p.jump, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const facing = p.facing === "up" ? "up" : p.facing === "down" ? "down" : "side";
    if (!spriteFoot(ctx, this.atlas, `${gait}_${facing}_${frame}`, x, y, p.facing === "left")) {
      rect(ctx, x - 5, y - 16, 10, 16, P.green);
      rect(ctx, x - 4, y - 16, 8, 6, "#d9a273");
    }

    if (p.carrying) {
      const carrying = s.running.filter((o) => o.phase === "carrying");
      const cy = p.facing === "up" ? y - 22 : y - 12;
      rect(ctx, x - 8, cy, 16, 7, "#c99a52");
      rect(ctx, x - 8, cy, 16, 1, "#e0b877");
      rect(ctx, x - 8, cy + 3, 16, 1, "#8d6a34");
      // Whose goods they are, written on the crate.
      if (carrying.length) {
        const tag = carrying.length > 1 ? `${carrying.length} STK` : carrying[0].label;
        panel(ctx, x - 13, cy - 10, 26, 9, "rgba(20,14,26,0.9)", P.brass, 2);
        text(ctx, tag, x, cy - 3.5, "#ffe1a0", 6, "center");
      }
    }
  }

  /** What you just earned, thrown up over the bud's head. Outlined, because it has to be readable
   *  over a lit doorway, a rug and a wall face all at once. */
  private drawPop(p: Pop): void {
    const ctx = this.ctx;
    const t = 1 - p.life / (p.big ? 2 : 1.5);
    ctx.save();
    ctx.globalAlpha = Math.min(1, p.life * 2);
    const size = p.big ? 15 * Math.min(1, 0.7 + t * 3) : 8;
    textOut(ctx, p.text, p.x, p.y, p.good ? "#ffe9a8" : "#f0c3bc", size);
    ctx.restore();
  }

  private drawPuff(u: Puff): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = (u.life / u.max) * 0.5;
    ctx.fillStyle = "#d8cfc0";
    ctx.beginPath();
    ctx.arc(u.x, u.y, u.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Fireworks, drawn in screen space after everything else. */
  private drawSparks(s: Scene): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const k of s.sparks) {
      if (k.delay > 0) continue;
      const a = Math.min(1, k.life / 0.45);
      ctx.globalAlpha = a;
      ctx.fillStyle = k.colour;
      ctx.fillRect(Math.round(k.x) - 1, Math.round(k.y) - 1, 2, 2);
      // A short trail back along the direction of travel.
      ctx.globalAlpha = a * 0.4;
      ctx.fillRect(Math.round(k.x - k.vx * 0.02), Math.round(k.y - k.vy * 0.02), 1, 1);
    }
    ctx.restore();
    if (s.banner) {
      const y = 58;
      ctx.save();
      ctx.globalAlpha = Math.min(1, s.banner.length ? 1 : 0);
      textOut(ctx, s.banner, VIEW_W / 2, y, "#ffe9a8", 20);
      textOut(ctx, "ET FÆRDIGHEDSPOINT", VIEW_W / 2, y + 13, "#d9b566", 8);
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------------------------- overlays
  private drawHud(s: Scene): void {
    const ctx = this.ctx;
    const run = s.run;
    rect(ctx, 0, 0, VIEW_W, HUD_H, "rgba(16,12,22,0.94)");
    rect(ctx, 0, HUD_H - 1, VIEW_W, 1, "rgba(217,181,102,0.45)");

    // Left: where you are, and how much of the fifteen minutes is left.
    text(ctx, s.floor.name.toUpperCase(), 9, 11, P.brass, 6.5);
    const low = run.left < 60;
    text(ctx, clockText(run.left), 9, 28, low ? P.red : "#f3efe6", 14);

    // Then the score, as big as it will go. It sits next to the clock rather than centred so that
    // the whole right-hand half of the bar belongs to the order strip.
    const money = Math.round(run.money).toLocaleString("da-DK");
    text(ctx, "SCORE", SCORE_X, 9, "rgba(217,181,102,0.7)", 5.5);
    // Say it while there is still a run to abandon, not as a surprise on the results screen.
    if (run.cheated) text(ctx, "· TÆLLER IKKE", SCORE_X + 32, 9, P.red, 5.5);
    text(ctx, `${money} kr`, SCORE_X, 26, "#ffe1a0", 17);

    if (run.combo > 1) {
      const w = 46;
      rect(ctx, SCORE_X, 29, w, 3, "rgba(0,0,0,0.5)");
      rect(ctx, SCORE_X, 29, w * Math.max(0, run.comboLeft / COMBO_WINDOW), 3, P.brass);
      text(ctx, `${run.combo}× ×${comboMultiplier(run).toFixed(2)}`, SCORE_X + w + 4, 32, P.brass, 6.5);
    }

    this.drawOrderCards(s);
  }

  /** The accepted orders, as a strip of cards along the right-hand end of the top bar. Each carries
   *  only what you need mid-corridor — where it goes and how long is left — because nothing longer
   *  gets read at a sprint. What does not fit becomes a "+n" chip rather than a scrolling list. */
  private drawOrderCards(s: Scene): void {
    if (!s.running.length) return;
    const ctx = this.ctx;
    const y = 5;
    const h = 24;
    const cw = 40;
    const gap = 3;
    // From clear of the widest score the run can print, to clear of the fullscreen button.
    const from = CARDS_X;
    const to = VIEW_W - 34;
    const room = to - from;

    let fit = Math.min(s.running.length, Math.floor((room + gap) / (cw + gap)));
    // A chip costs a card's worth of space, so only give it one if it is actually needed.
    if (fit < s.running.length && (fit + 1) * (cw + gap) > room + gap) fit -= 1;
    const extra = s.running.length - fit;

    let x = from;
    for (const o of s.running.slice(0, fit)) {
      const urgent = s.orders.isUrgent(o);
      const carrying = o.phase === "carrying";
      // An event order keeps the event's colour so you can tell at a glance which cards are the
      // bonus and which are ordinary work.
      const onEvent = s.event?.orders.includes(o.id) ?? false;
      const col = urgent ? P.red : carrying ? P.greenLight : onEvent ? EVENT_COL : P.brass;
      panel(
        ctx,
        x,
        y,
        cw,
        h,
        carrying ? "rgba(20,42,28,0.95)" : onEvent ? "rgba(38,20,46,0.95)" : "rgba(30,24,16,0.95)",
        col,
        2,
      );
      text(ctx, o.label, x + cw / 2, y + 10, carrying ? "#d7f0df" : "#f3efe6", 8, "center");
      text(ctx, clockText(o.left), x + cw / 2, y + 18, col, 6.5, "center");
      rect(ctx, x + 3, y + h - 5, cw - 6, 2, "rgba(0,0,0,0.5)");
      rect(ctx, x + 3, y + h - 5, (cw - 6) * s.orders.fraction(o), 2, col);
      x += cw + gap;
    }
    if (extra > 0) {
      panel(ctx, x, y, cw, h, "rgba(30,24,16,0.95)", "rgba(217,181,102,0.4)", 2);
      text(ctx, `+${extra}`, x + cw / 2, y + 16, "rgba(243,239,230,0.65)", 8, "center");
    }
  }

  /** The bonus event, centred just under the top bar while one is running. It keeps a row to
   *  itself: it is a headline, it only appears occasionally, and it is far too wide to share the
   *  order strip. */
  private drawEventCard(s: Scene): void {
    const ev = s.event;
    if (!ev) return;
    const ctx = this.ctx;
    // Wide enough for the address: an event you cannot find is an event you ignore.
    const w = Math.max(140, ev.where.length * 3.4 + 16);
    const h = 30;
    const x = Math.round((VIEW_W - w) / 2);
    const y = HUD_H + 4;
    const frac = eventFraction(ev);
    const col = frac < 0.3 ? P.red : EVENT_COL;

    panel(ctx, x, y, w, h, "rgba(38,20,46,0.94)", col, 3);
    text(ctx, ev.name, x + 5, y + 9, col, 6.5);
    text(ctx, clockText(ev.left), x + w - 5, y + 9, col, 6.5, "right");
    // Where to go, spelled out.
    text(ctx, ev.where, x + w / 2, y + 18, "#f3efe6", 6, "center");
    // One pip per order the event still wants.
    for (let i = 0; i < ev.need; i++) {
      rect(ctx, x + 5 + i * 5, y + 21, 4, 3, i < ev.done ? P.greenLight : "rgba(255,255,255,0.2)");
    }
    rect(ctx, x + 5, y + h - 4, w - 10, 2, "rgba(0,0,0,0.5)");
    rect(ctx, x + 5, y + h - 4, (w - 10) * frac, 2, col);
  }

  /** The bottom bar. Everything you read *while* running rather than *before* moving lives here in
   *  one strip: the plan on the left, the crate in the middle, level and experience on the right.
   *  It floats over the world rather than reserving space — the building is already 2 px taller
   *  than the view, so there is no room to give it. */
  private drawBottomBar(s: Scene): void {
    const ctx = this.ctx;
    const y0 = VIEW_H - BAR_H;
    rect(ctx, 0, y0, VIEW_W, BAR_H, "rgba(14,10,20,0.9)");
    rect(ctx, 0, y0, VIEW_W, 1, "rgba(217,181,102,0.45)");

    const left = s.showMap ? this.drawMinimap(s, y0) : 8;
    const right = this.drawLevel(s, y0);
    this.drawBelt(s, left, right, y0);
  }

  /** The level you are on, at the right-hand end of the bottom bar. The experience bar is not here
   *  — it runs under the crate, drawn by `drawBelt` — and neither is the unspent-point badge, which
   *  is the DOM button floating just above this corner. Returns the x the belt must stop before. */
  private drawLevel(s: Scene, y0: number): number {
    // The last ~46 px of the bar are left empty: that is where the DOM skill-point button sits.
    const right = VIEW_W - SKILL_BTN_W;
    const blockW = 62;
    text(this.ctx, `LEVEL ${s.run.level}`, right, y0 + 22, "#e4dcf2", 12, "right");
    return right - blockW - 6;
  }

  private drawBelt(s: Scene, left: number, right: number, y0: number): void {
    const ctx = this.ctx;
    const slots = s.capacity;
    const gap = 1;
    // Vogn can buy fifteen slots, and fifteen have to fit between the plan and the level block.
    const sw = Math.max(9, Math.min(16, Math.floor((right - left) / slots) - gap));
    const sh = 17;
    const w = slots * (sw + gap) - gap;
    const x0 = Math.round(left + (right - left - w) / 2);
    const y = y0 + 13;

    // What is in the crate, one entry per item, so a slot really is a slot.
    const held: { icon: string; label: string }[] = [];
    for (const o of s.running) {
      if (o.phase !== "carrying") continue;
      for (const line of o.lines) {
        for (let i = 0; i < line.qty && held.length < slots; i++) {
          held.push({ icon: goodIcon(line.name), label: o.label });
        }
      }
    }

    for (let i = 0; i < slots; i++) {
      const sx = x0 + i * (sw + gap);
      const item = held[i];
      rect(ctx, sx, y, sw, sh, item ? "rgba(86,66,38,0.98)" : "rgba(72,66,86,0.55)");
      rect(ctx, sx, y, sw, 1, "rgba(255,255,255,0.28)");
      rect(ctx, sx, y, 1, sh, "rgba(255,255,255,0.16)");
      rect(ctx, sx + sw - 1, y, 1, sh, "rgba(0,0,0,0.45)");
      rect(ctx, sx, y + sh - 1, sw, 1, "rgba(0,0,0,0.5)");
      if (item) sprite(ctx, this.atlas, item.icon, sx + (sw - 14) / 2, y + 1);
    }

    // The experience bar runs the width of the crate, directly under it: progress toward the next
    // level belongs with the thing you fill up, not off in a corner of the bar.
    const xpY = y + sh + 3;
    rect(ctx, x0, xpY, w, 4, "rgba(255,255,255,0.14)");
    rect(ctx, x0, xpY, w * (s.run.xpInLevel / xpNeeded(s.run)), 4, "#8a6ad0");

    // Whose the goods are, written once over each unbroken run of slots — the crate tag above the
    // bud only has room for one name, and you can be carrying three orders at a time.
    let from = 0;
    while (from < held.length) {
      let to = from;
      while (to + 1 < held.length && held[to + 1].label === held[from].label) to += 1;
      const runW = (to - from + 1) * (sw + gap) - gap;
      const sx = x0 + from * (sw + gap);
      rect(ctx, sx, y - 2, runW, 1, P.greenLight);
      text(ctx, held[from].label, sx + runW / 2, y - 4, P.greenLight, 5.5, "center");
      from = to + 1;
    }
  }

  /** The Minikort skill: the floor you are on, drawn to scale — the same rectangles the game is
   *  built out of, shrunk to fit the left-hand end of the bottom bar. Under it, how many orders are
   *  waiting on each of the other floors, because knowing *which* staircase to run for is half the
   *  job. Returns the x the belt must start after. */
  private drawMinimap(s: Scene, y0: number): number {
    const ctx = this.ctx;
    const planW = 84;
    const k = planW / WORLD_W;
    const planH = Math.round(WORLD_H * k);
    const x = 8;
    const py = y0 + 4;

    rect(ctx, x, py, planW, planH, "#0d0a12");
    for (const r of s.floor.walk) {
      const q = rectPx(r);
      rect(ctx, x + q.x * k, py + q.y * k, Math.max(1, q.w * k), Math.max(1, q.h * k), "#837a99");
    }
    for (const c of s.floor.cells) {
      const q = rectPx(c);
      const fill = s.orders.atCell(c).length
        ? "#8a6a2c"
        : c.kind === "kiosk"
          ? "#3f7a55"
          : c.open
            ? "#4a4258"
            : "#2e2739";
      rect(ctx, x + q.x * k, py + q.y * k, Math.max(1, q.w * k), Math.max(1, q.h * k), fill);
    }
    for (const st of s.floor.stairs) {
      const q = rectPx(st.frame);
      rect(ctx, x + q.x * k, py + q.y * k, Math.max(1, q.w * k), Math.max(1, q.h * k), "#9a93ad");
      const lf = rectPx(st.lift);
      rect(ctx, x + lf.x * k, py + lf.y * k, 2, 2, s.run.lift ? P.brass : P.red);
    }
    for (const o of s.orders.active) {
      if (o.floor !== s.floor.index) continue;
      const onEvent = s.event?.orders.includes(o.id) ?? false;
      const col = onEvent
        ? EVENT_COL
        : o.phase === "carrying"
          ? P.greenLight
          : s.orders.isUrgent(o)
            ? P.red
            : P.brass;
      // Event markers are a pixel bigger as well as a different colour — at this scale colour
      // alone is easy to miss.
      const r = onEvent ? 2 : 1;
      rect(ctx, x + o.cell.doorX * k - r, py + o.cell.doorY * k - r, r * 2 + 1, r * 2 + 1, col);
    }
    if (s.party && s.party.floor === s.floor.index) {
      const q = rectPx(s.party.cell);
      rect(ctx, x + (q.x + q.w / 2) * k - 2, py + (q.y + q.h / 2) * k - 2, 4, 4, "#e2a0ff");
    }
    rect(ctx, x + s.player.x * k - 1, py + s.player.y * k - 2, 3, 4, "#ffffff");
    rect(ctx, x - 1, py - 1, planW + 2, 1, "rgba(217,181,102,0.35)");
    rect(ctx, x - 1, py + planH, planW + 2, 1, "rgba(217,181,102,0.35)");

    // How many orders are waiting on each floor: knowing which staircase to run for is half the job.
    const short = ["K", "St", "1", "2", "3", "4"];
    const cellW = planW / 6;
    for (let i = 0; i < 6; i++) {
      const on = i === s.floor.index;
      const n = s.orders.active.filter((o) => o.floor === i).length;
      // A floor the event wants something on gets its label in the event colour, so "which
      // staircase" is answerable without opening anything.
      const wanted = s.event?.floors.includes(i) ?? false;
      const cx = x + cellW * i + cellW / 2;
      if (wanted) rect(ctx, cx - 7, y0 + BAR_H - 9, 14, 8, "rgba(226,160,255,0.18)");
      text(ctx, short[i], cx - 4, y0 + BAR_H - 4, wanted ? EVENT_COL : on ? P.brass : "#7d7590", 5, "center");
      text(
        ctx,
        n ? String(n) : "·",
        cx + 4,
        y0 + BAR_H - 4,
        wanted ? EVENT_COL : n ? "#ffe1a0" : "#4e4860",
        5,
        "center",
      );
    }
    return x + planW + 8;
  }

  private drawPrompt(prompt: string): void {
    const ctx = this.ctx;
    const w = prompt.length * 4.2 + 22;
    const x = VIEW_W / 2 - w / 2;
    const y = VIEW_H - 52;
    panel(ctx, x, y, w, 16, "rgba(16,12,22,0.92)", P.brass, 4);
    panel(ctx, x + 5, y + 3.5, 9, 9, "#2c2418", P.brass, 2);
    text(ctx, "E", x + 9.5, y + 11, P.brass, 7, "center");
    text(ctx, prompt, x + 18, y + 11, "#f3efe6", 7.5);
  }

  private drawFade(alpha: number, label: string): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha);
    rect(ctx, 0, HUD_H, VIEW_W, VIEW_H - HUD_H, "#0b0810");
    ctx.restore();
    if (label && alpha > 0.55) text(ctx, label, VIEW_W / 2, VIEW_H / 2, P.brass, 11, "center");
  }
}
