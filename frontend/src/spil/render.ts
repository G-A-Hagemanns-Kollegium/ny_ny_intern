/** Top-down renderer: one floor of the building seen from above, exactly as the plans draw it.
 *
 *  Everything is drawn in *logical* pixels (448×288, tiles of 16) and the context is scaled once, so
 *  the game is resolution-independent and the same code works fullscreen.
 *
 *  Props come from the sprite sheet (static/spil/atlas.png). If a frame is missing the prop is drawn
 *  as a labelled block instead, so the game is never broken by absent art.
 */

import { panel, rect, sprite, text, type Atlas } from "./art";
import {
  WALL,
  WORLD_H,
  WORLD_W,
  occupantOf,
  rectPx,
  type Cell,
  type Floor,
  type Rect,
  type Stairwell,
} from "./building";
import { HUD_H, PALETTE as P, TILE, VIEW_H, VIEW_W } from "./config";
import { clockText, type Order, type OrderBook } from "./orders";
import type { ActiveEvent } from "./events";

/** The world is 256 px tall and the viewport gives it 262 — centre it under the HUD. */
const WORLD_TOP = HUD_H + Math.floor((VIEW_H - HUD_H - WORLD_H) / 2);

const DOOR_W = 14;

export interface PlayerView {
  x: number;
  y: number;
  facing: "up" | "down" | "left" | "right";
  moving: boolean;
  anim: number;
  carrying: boolean;
  sprinting: boolean;
}

export interface NpcView {
  x: number;
  y: number;
  dir: -1 | 1;
  anim: number;
  moving: boolean;
}

export interface Scene {
  floor: Floor;
  camX: number;
  player: PlayerView;
  npc: NpcView | null;
  orders: OrderBook;
  event: ActiveEvent | null;
  money: number;
  carried: number;
  capacity: number;
  prompt: string | null;
  hasPhone: boolean;
  hasLift: boolean;
  hasTools: boolean;
  /** The toolbox still lying in Værkstedet, if it has not been picked up. */
  toolbox: { floor: number; x: number; y: number } | null;
  fade: number;
  fadeLabel: string;
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
    if (s.prompt) this.drawPrompt(s.prompt);
    if (s.fade > 0) this.drawFade(s.fade, s.fadeLabel);
  }

  // -------------------------------------------------------------------------------- the floor
  private drawWorld(s: Scene): void {
    const f = s.floor;
    this.drawWalkable(f);
    for (const st of f.stairs) this.drawStairwell(st, f, s);
    for (const c of f.cells) this.drawCell(c, f, s);
    for (const h of f.hazards) this.drawHazard(h);
    for (const o of f.obstacles) this.drawObstacle(o);
    if (s.toolbox && s.toolbox.floor === f.index && !s.hasTools) {
      this.drawPickup(s.toolbox.x, s.toolbox.y, s.player.anim);
    }
    if (s.npc) this.drawNpc(s.npc);
    this.drawPlayer(s);
    for (const c of f.cells) {
      if (c.kind === "room") this.drawMarker(c, s);
    }
  }

  /** Spilt beer on the floorboards. No collision — it just costs you speed. */
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

  /** The Gang. Its shape is per-floor, so it is drawn straight from the walkable rectangles. */
  private drawWalkable(f: Floor): void {
    const ctx = this.ctx;
    for (const r of f.walk) {
      const w = rectPx(r);
      rect(ctx, w.x, w.y, w.w, w.h, P.corridor);
      // Boards along the length of the corridor
      for (let y = w.y + 5; y < w.y + w.h; y += 6) {
        rect(ctx, w.x, y, w.w, 1, P.corridorAlt);
      }
      for (let x = w.x; x < w.x + w.w; x += TILE * 3) {
        rect(ctx, x, w.y, 1, w.h, P.corridorAlt);
      }
      // The runner down the middle of anything wide enough to have one.
      if (w.h >= 48) {
        const ry = w.y + w.h / 2 - 11;
        rect(ctx, w.x, ry, w.w, 22, P.runner);
        rect(ctx, w.x, ry, w.w, 1, P.runnerEdge);
        rect(ctx, w.x, ry + 21, w.w, 1, P.runnerEdge);
      }
    }
  }

  private drawCell(c: Cell, f: Floor, s: Scene): void {
    const ctx = this.ctx;
    const r = rectPx(c);
    if (r.x - s.camX > VIEW_W || r.x + r.w - s.camX < 0) return;

    const order = c.kind === "room" ? s.orders.byRoom(c.room) : undefined;
    const lit = !!order || c.kind === "kiosk" || c.kind === "workshop" || c.open;

    // Walls, then the floor inset inside them. An open area (the Hall, festsalen) keeps three
    // walls and loses the one facing the Gang — you walk straight through where a door would be.
    rect(ctx, r.x, r.y, r.w, r.h, f.wall);
    rect(ctx, r.x, r.y, 1, r.h, f.wallDark);
    rect(ctx, r.x + r.w - 1, r.y, 1, r.h, f.wallDark);
    if (!(c.open && c.doorSide === "top")) rect(ctx, r.x, r.y, r.w, 1, f.wallDark);
    if (!(c.open && c.doorSide === "bottom")) rect(ctx, r.x, r.y + r.h - 1, r.w, 1, f.wallDark);

    const fx = r.x + WALL;
    const fy = r.y + (c.open && c.doorSide === "top" ? 0 : WALL);
    const fw = r.w - WALL * 2;
    const fh = r.h - WALL - (c.open ? 0 : WALL);
    const tiled = c.kind === "bath" || c.kind === "kitchen";
    rect(ctx, fx, fy, fw, fh, tiled ? P.tileFloor : c.kind === "room" ? P.roomFloor : P.concrete);
    if (tiled) {
      for (let y = fy; y < fy + fh; y += 8) {
        for (let x = fx; x < fx + fw; x += 8) {
          if (((x - fx) / 8 + (y - fy) / 8) % 2 === 0) rect(ctx, x, y, 8, 8, "#9aa4ad");
        }
      }
    } else {
      for (let y = fy + 6; y < fy + fh; y += 7) {
        rect(ctx, fx, y, fw, 1, c.kind === "room" ? P.roomFloorAlt : "#6d6a63");
      }
    }

    // Props, with a soft contact shadow so they sit on the floor rather than float above it.
    ctx.save();
    ctx.beginPath();
    ctx.rect(fx, fy, fw, fh);
    ctx.clip();
    for (const prop of c.props) {
      const frame = this.atlas.frames[prop.sprite];
      if (frame) {
        ctx.fillStyle = P.shadow;
        ctx.fillRect(prop.x + 1, prop.y + frame.h - 2, frame.w, 3);
      }
      if (!sprite(ctx, this.atlas, prop.sprite, prop.x, prop.y)) {
        rect(ctx, prop.x, prop.y, 12, 10, "#6d5a48");
      }
    }
    ctx.restore();

    // Rooms with an order have the light on — the only cue you get before you are close enough to
    // knock, and the thing you actually scan the Gang for.
    if (lit) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(255,196,110,0.16)";
      ctx.fillRect(fx, fy, fw, fh);
      ctx.restore();
    } else if (c.kind === "room") {
      ctx.fillStyle = "rgba(24,18,32,0.42)";
      ctx.fillRect(fx, fy, fw, fh);
    }

    if (!c.open) this.drawDoor(c, f, !!order);
    this.drawLabel(c, order ? occupantOf(c) : "");
  }

  private drawDoor(c: Cell, f: Floor, lit: boolean): void {
    const ctx = this.ctx;
    const wide = c.kind === "kiosk" || c.kind === "hall";
    const w = wide ? 22 : DOOR_W;
    const x = c.doorX - w / 2;
    const y = c.doorSide === "top" ? c.doorY - 1 : c.doorY - WALL - 2;

    // Punch the doorway out of the wall first, so the door leaf sits in a real opening.
    rect(ctx, x, c.doorSide === "top" ? c.doorY : c.doorY - WALL, w, WALL + 1, "#2a2130");
    const name = wide ? "door_wide" : c.kind === "workshop" ? "door_open" : "door";
    if (!sprite(ctx, this.atlas, name, x, y, w, 6)) {
      rect(ctx, x, y, w, 6, "#8a6240");
      rect(ctx, x, y, w, 1, "#a97a52");
    }
    if (lit) {
      // Light under the door, spilling into the Gang.
      const dir = c.doorSide === "top" ? -1 : 1;
      const g = ctx.createLinearGradient(0, c.doorY, 0, c.doorY + dir * 22);
      g.addColorStop(0, "rgba(255,196,110,0.45)");
      g.addColorStop(1, "rgba(255,196,110,0)");
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(c.doorX - w / 2, c.doorY);
      ctx.lineTo(c.doorX + w / 2, c.doorY);
      ctx.lineTo(c.doorX + w / 2 + 9, c.doorY + dir * 22);
      ctx.lineTo(c.doorX - w / 2 - 9, c.doorY + dir * 22);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    void f;
  }

  /** The plate beside the door: room number, or the room's name for everything else. */
  private drawLabel(c: Cell, who: string): void {
    const ctx = this.ctx;
    const label = c.label;
    if (!label) return;
    const wide = label.length * 3.7 + 8;
    // An open area has no doorplate, so its name sits just inside the opening where you meet it.
    const y = c.open
      ? c.doorSide === "top"
        ? c.doorY + 6
        : c.doorY - 14
      : c.doorSide === "top"
        ? c.doorY + 8
        : c.doorY - 15;
    panel(ctx, c.doorX - wide / 2, y, wide, 8, "rgba(24,18,30,0.82)", "rgba(217,181,102,0.5)", 2);
    text(ctx, label, c.doorX, y + 6, P.brass, 5.5, "center");
    if (who) text(ctx, who, c.doorX, c.doorSide === "top" ? y + 15 : y - 3, "#ffe9c4", 5.5, "center");
  }

  private drawStairwell(st: Stairwell, f: Floor, s: Scene): void {
    const ctx = this.ctx;
    const fr = rectPx(st.frame);
    if (fr.x - s.camX > VIEW_W || fr.x + fr.w - s.camX < 0) return;

    rect(ctx, fr.x, fr.y, fr.w, fr.h, f.wall);
    rect(ctx, fr.x, fr.y, fr.w, 1, f.wallDark);
    rect(ctx, fr.x, fr.y, 1, fr.h, f.wallDark);
    rect(ctx, fr.x + fr.w - 1, fr.y, 1, fr.h, f.wallDark);
    rect(ctx, fr.x + WALL, fr.y + WALL, fr.w - WALL * 2, fr.h - WALL, P.concrete);

    const flight = (r: Rect, up: boolean): void => {
      const q = rectPx(r);
      rect(ctx, q.x, q.y, q.w, q.h, "#5f5c66");
      for (let i = 0; i < 8; i++) {
        const y = q.y + 2 + i * ((q.h - 4) / 8);
        rect(ctx, q.x + 2, y, q.w - 4, 2, i % 2 ? "#8f8a99" : "#787281");
      }
      // Arrow: up flights point away from the landing, down flights towards it.
      const cx = q.x + q.w / 2;
      const cy = q.y + q.h / 2;
      const d = up ? -1 : 1;
      rect(ctx, cx - 1, cy - 6, 2, 12, P.red);
      for (let i = 0; i < 4; i++) rect(ctx, cx - 1 - i, cy + d * (6 - i) - 1, 2 + i * 2, 2, P.red);
    };

    flight(st.down, false);
    flight(st.up, true);

    // The lift, between the two flights. 36×36 of proper lift door rather than a grey slot.
    const lf = rectPx(st.lift);
    const lx = lf.x + lf.w / 2 - 18;
    const ly = lf.y + lf.h / 2 - 18;
    if (!sprite(ctx, this.atlas, s.hasLift ? "lift_open" : "lift_broken", lx, ly, 36, 36)) {
      rect(ctx, lx, ly, 36, 36, s.hasLift ? "#9aa3aa" : "#4a4d55");
    }
    if (s.hasLift) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(255,214,150,0.22)";
      ctx.fillRect(lx + 6, ly + 10, 24, 24);
      ctx.restore();
    }
  }

  /** A pulsing item lying on the floor — currently only Værkstedets værktøjskasse. */
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
    const order = s.orders.byRoom(c.room);
    if (!order || order.floor !== s.floor.index) return;
    if (c.doorX - s.camX < -30 || c.doorX - s.camX > VIEW_W + 30) return;

    const ctx = this.ctx;
    const bob = Math.sin(s.player.anim * 3 + c.room) * 1.5;
    // In the Gang, just outside the door — readable while running past.
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
    if (order.phase !== "pending") {
      const left = s.orders.fraction(order);
      rect(ctx, c.doorX - 7, y + 14, 14, 2, "rgba(0,0,0,0.5)");
      rect(ctx, c.doorX - 7, y + 14, 14 * left, 2, urgent ? P.red : P.greenLight);
    }
  }

  private drawNpc(n: NpcView): void {
    const ctx = this.ctx;
    const x = Math.round(n.x);
    const y = Math.round(n.y);
    const step = n.moving ? Math.floor(n.anim * 7) % 4 : 0;
    const frame = step === 3 ? 1 : step;
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(x, y, 6, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    if (n.dir < 0) {
      ctx.translate(x, 0);
      ctx.scale(-1, 1);
      ctx.translate(-x, 0);
    }
    if (!sprite(ctx, this.atlas, `res_side_${frame}`, x - 6, y - 17)) {
      rect(ctx, x - 5, y - 16, 10, 16, "#4f7fa8");
    }
    ctx.restore();
  }

  private drawPlayer(s: Scene): void {
    const ctx = this.ctx;
    const p = s.player;
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    const step = p.moving ? Math.floor(p.anim * (p.sprinting ? 12 : 8)) % 4 : 0;
    const frame = step === 3 ? 1 : step; // 0,1,2,1 — a three-cel walk

    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(x, y, 6, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const facing = p.facing === "up" ? "up" : p.facing === "down" ? "down" : "side";
    const name = `bud_${facing}_${frame}`;
    const flip = p.facing === "left";
    ctx.save();
    if (flip) {
      ctx.translate(x, 0);
      ctx.scale(-1, 1);
      ctx.translate(-x, 0);
    }
    if (!sprite(ctx, this.atlas, name, x - 6, y - 17)) {
      rect(ctx, x - 5, y - 16, 10, 16, P.green);
      rect(ctx, x - 4, y - 16, 8, 6, "#d9a273");
    }
    ctx.restore();

    if (p.carrying) {
      const cy = p.facing === "up" ? y - 22 : y - 12;
      rect(ctx, x - 7, cy, 14, 7, "#c99a52");
      rect(ctx, x - 7, cy, 14, 1, "#e0b877");
      rect(ctx, x - 7, cy + 3, 14, 1, "#8d6a34");
    }
  }

  // ---------------------------------------------------------------------------------- overlays
  private drawHud(s: Scene): void {
    const ctx = this.ctx;
    rect(ctx, 0, 0, VIEW_W, HUD_H, "rgba(16,12,22,0.94)");
    rect(ctx, 0, HUD_H - 1, VIEW_W, 1, "rgba(217,181,102,0.45)");

    text(ctx, s.floor.name.toUpperCase(), 10, 17, P.brass, 9);

    // The one clock in the game: the tightest delivery you have running.
    const running = s.orders.running;
    if (running.length) {
      const worst = running.reduce((a, b) => (s.orders.fraction(a) < s.orders.fraction(b) ? a : b));
      const urgent = s.orders.isUrgent(worst);
      text(ctx, clockText(worst.left), VIEW_W / 2, 17, urgent ? P.red : "#f3efe6", 12, "center");
      rect(ctx, VIEW_W / 2 - 30, 20, 60, 2, "rgba(255,255,255,0.16)");
      rect(ctx, VIEW_W / 2 - 30, 20, 60 * s.orders.fraction(worst), 2, urgent ? P.red : P.greenLight);
    }

    const right = VIEW_W - 28;
    text(ctx, `${s.money} kr`, right, 12, "#ffe1a0", 10, "right");
    const pipW = 5;
    const px0 = right - s.capacity * (pipW + 1);
    for (let i = 0; i < s.capacity; i++) {
      rect(ctx, px0 + i * (pipW + 1), 16, pipW, 5, i < s.carried ? "#c99a52" : "rgba(255,255,255,0.16)");
    }
  }

  private drawPrompt(prompt: string): void {
    const ctx = this.ctx;
    const w = prompt.length * 4.2 + 22;
    const x = VIEW_W / 2 - w / 2;
    const y = VIEW_H - 26;
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
