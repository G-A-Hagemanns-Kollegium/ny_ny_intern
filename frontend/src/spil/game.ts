/** The simulation: input, movement, interaction, obstacles, events and the economy.
 *
 *  There is no shift and no clock. The only timers are the one on a delivery you have accepted and
 *  the one on an active event.
 *
 *  Keyboard is bound to the canvas, not to `window`, so the game only ever sees keys while it has
 *  focus — arrow keys still scroll the page everywhere else on the site.
 */

import { EMPTY_ATLAS, type Atlas } from "./art";
import {
  FLOOR_NAMES,
  FLOOR_TW,
  WORLD_W,
  buildBuilding,
  inAnyRect,
  occupantOf,
  rectPx,
  type Building,
  type Cell,
  type Floor,
  type Rect,
  type ServerRoom,
  type Stairwell,
} from "./building";
import {
  BASE_SPEED,
  BODY_H,
  BODY_W,
  BUMP_SECONDS,
  BUMP_SLOW,
  CARRY_PENALTY_MAX,
  CARRY_PENALTY_PER_ITEM,
  FLOOR_COUNT,
  HAZARD_SLOW,
  KIOSK_FLOOR,
  LIFT_BOARD_SECONDS,
  LIFT_PER_FLOOR_SECONDS,
  NPC_SPEED,
  SPAWN_SECONDS,
  STAIR_SECONDS,
  TILE,
  VIEW_W,
} from "./config";
import { DevConsole, OPENS_CONSOLE } from "./console";
import { EventDirector } from "./events";
import { OrderBook, summarise, type Order } from "./orders";
import {
  CHARACTERS,
  CRATE_TIERS,
  PRICES,
  SHOE_TIERS,
  canRun,
  capacity,
  clearProgress,
  defaultProgress,
  loadProgress,
  saveProgress,
  sprintFactor,
  type Progress,
} from "./progress";
import { Renderer, type NpcView, type Scene } from "./render";
import { Ui, type Action } from "./ui";

type Mode = "select" | "playing" | "paused" | "console";

interface Travel {
  to: number;
  at: { x: number; y: number };
  total: number;
  elapsed: number;
  label: string;
}

/** A GAHK'er wandering their own floor's Gang. Pure obstacle — they want nothing from you. */
interface Npc {
  x: number;
  y: number;
  dir: -1 | 1;
  anim: number;
  pause: number;
  minX: number;
  maxX: number;
}

type Target =
  | { kind: "door"; cell: Cell }
  | { kind: "kiosk"; cell: Cell }
  | { kind: "stair"; well: Stairwell; dir: 1 | -1 }
  | { kind: "lift"; well: Stairwell }
  | { kind: "tools" };

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const roomLabel = (n: number): string => String(n).padStart(3, "0");
const near = (ax: number, ay: number, bx: number, by: number, r: number): boolean =>
  Math.abs(ax - bx) < r && Math.abs(ay - by) < r;
const overlaps = (r: Rect, x: number, y: number, hw: number, hh: number): boolean =>
  x + hw > r.x && x - hw < r.x + r.w && y > r.y && y - hh < r.y + r.h;

export class Game {
  private renderer: Renderer;
  private ui: Ui;
  private building: Building;
  private book: OrderBook;
  private events: EventDirector;
  private progress: Progress;

  private mode: Mode = "select";
  private keys = new Set<string>();
  private lastTime = 0;
  private raf = 0;

  private floor = KIOSK_FLOOR;
  private px = 0;
  private py = 0;
  private facing: "up" | "down" | "left" | "right" = "down";
  private moving = false;
  private anim = 0;
  private nextSpawn = 1.5;
  private travel: Travel | null = null;
  private toolbox: { floor: number; x: number; y: number } | null = null;
  /** Seconds of stumble left after walking into somebody. */
  private bump = 0;
  private npcs: Npc[] = [];
  private console: DevConsole;
  /** Walking-speed multiplier, only ever changed from the cheat console. */
  private speedCheat = 1;

  constructor(
    private frame: HTMLElement,
    private canvas: HTMLCanvasElement,
    serverRooms: ServerRoom[],
    goods: string[],
  ) {
    this.building = buildBuilding(serverRooms);
    this.book = new OrderBook(this.building, goods);
    this.events = new EventDirector(this.book);
    this.progress = loadProgress();
    this.renderer = new Renderer(canvas, EMPTY_ATLAS);
    this.ui = new Ui(frame);
    this.px = this.building.start.x;
    this.py = this.building.start.y;
    this.placeToolbox();
    this.spawnNpcs();

    this.canvas.tabIndex = 0;
    this.canvas.addEventListener("keydown", this.onKeyDown);
    this.canvas.addEventListener("keyup", this.onKeyUp);
    this.canvas.addEventListener("blur", () => this.keys.clear());
    this.canvas.addEventListener("pointerdown", () => this.canvas.focus());
    window.addEventListener("resize", () => this.renderer.resize());

    this.console = new DevConsole(frame);
    this.console.onCommand(this.command);
    this.console.onClose(() => {
      if (this.mode === "console") this.mode = "playing";
      this.canvas.focus();
    });

    this.ui.onAction(this.onAction);
    this.renderer.resize();
    this.ui.showSelect(CHARACTERS, this.progress);
    this.loop(performance.now());
  }

  setAtlas(atlas: Atlas): void {
    this.renderer.setAtlas(atlas);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
  }

  private placeToolbox(): void {
    for (const f of this.building.floors) {
      const ws = f.cells.find((c) => c.kind === "workshop");
      if (!ws) continue;
      const r = rectPx(ws);
      this.toolbox = { floor: f.index, x: r.x + r.w / 2, y: r.y + r.h - 16 };
      return;
    }
  }

  /** One wanderer per floor, pacing their stretch of the Gang. */
  private spawnNpcs(): void {
    this.npcs = this.building.floors.map((f, i) => {
      const minX = TILE * 10;
      const maxX = TILE * (FLOOR_TW - 10);
      return {
        x: minX + ((i * 197) % (maxX - minX)),
        y: this.building.start.y,
        dir: i % 2 ? 1 : -1,
        anim: i,
        pause: 0,
        minX,
        maxX,
      };
    });
  }

  // ------------------------------------------------------------------------------------- input
  private onKeyDown = (ev: KeyboardEvent): void => {
    const k = ev.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " ", "tab"].includes(k)) ev.preventDefault();
    if (OPENS_CONSOLE.has(k)) {
      ev.preventDefault();
      this.keys.clear();
      if (this.mode === "playing") this.mode = "console"; // pause while you type
      this.console.open();
      return;
    }
    if (k === "escape") {
      if (this.mode === "playing") this.pause();
      else if (this.mode === "paused") this.resume();
      return;
    }
    if (this.mode !== "playing") return;
    if (k === "e" || k === " " || k === "enter") {
      this.interact();
      return;
    }
    this.keys.add(k);
  };

  private onKeyUp = (ev: KeyboardEvent): void => {
    this.keys.delete(ev.key.toLowerCase());
  };

  private held(...names: string[]): boolean {
    return names.some((n) => this.keys.has(n));
  }

  // -------------------------------------------------------------------------------- game state
  private start(): void {
    this.ui.close();
    this.mode = "playing";
    this.ui.showRail(true);
    this.canvas.focus();
    this.ui.toast("Bank på hos dem der har lys — så kender du bestillingen.");
  }

  private pause(): void {
    if (this.mode !== "playing") return;
    this.mode = "paused";
    this.keys.clear();
    this.ui.showPause(this.progress);
  }

  private resume(): void {
    this.ui.close();
    if (this.mode === "select") return;
    this.mode = "playing";
    this.canvas.focus();
  }

  private onAction = (a: Action): void => {
    switch (a.type) {
      case "character":
        this.progress.character = a.id;
        saveProgress(this.progress);
        this.start();
        break;
      case "resume":
        this.resume();
        break;
      case "shop":
        this.mode = "paused";
        this.ui.showShop(this.progress);
        break;
      case "buy":
        this.buy(a.item);
        break;
      case "lift":
        this.rideLift(a.floor);
        break;
      case "reset":
        clearProgress();
        this.progress = defaultProgress();
        this.book.clear();
        this.events.clear();
        this.placeToolbox();
        this.spawnNpcs();
        this.floor = KIOSK_FLOOR;
        this.px = this.building.start.x;
        this.py = this.building.start.y;
        this.mode = "select";
        this.ui.showRail(false);
        this.ui.showSelect(CHARACTERS, this.progress);
        break;
    }
  };

  private buy(item: string): void {
    const p = this.progress;
    const pay = (price: number): boolean => {
      if (p.money < price) {
        this.ui.toast("Ikke råd endnu.", "is-bad");
        return false;
      }
      p.money -= price;
      return true;
    };
    if (item === "crate") {
      const next = CRATE_TIERS[p.crate + 1];
      if (next && pay(next.price)) p.crate += 1;
    } else if (item === "shoes") {
      const next = SHOE_TIERS[p.shoes + 1];
      if (next && pay(next.price)) {
        p.shoes += 1;
        if (p.shoes === 1) this.ui.toast("Hold Shift for at løbe!", "is-good");
        else this.ui.toast(`${next.name} — mærkbart hurtigere.`, "is-good");
      }
    } else if (item === "phone") {
      if (!p.phone && pay(PRICES.phone)) p.phone = true;
    } else if (item === "cart") {
      if (!p.cart && pay(PRICES.cart)) p.cart = true;
    }
    saveProgress(p);
    this.ui.showShop(p);
  }

  // ------------------------------------------------------------------------------ interaction
  private get currentFloor(): Floor {
    return this.building.floors[this.floor];
  }

  private carriedCount(): number {
    return this.book.active.filter((o) => o.phase === "carrying").reduce((a, o) => a + o.count, 0);
  }

  private pickupCandidates(): Order[] {
    return this.book.active.filter((o) => o.phase === "taken");
  }

  private target(): Target | null {
    const f = this.currentFloor;
    for (const c of f.cells) {
      if (c.open) continue;
      if (c.kind !== "room" && c.kind !== "kiosk") continue;
      const outside = c.doorSide === "top" ? this.py < c.doorY : this.py > c.doorY;
      if (!outside) continue;
      if (near(this.px, this.py, c.doorX, c.doorY, c.kind === "kiosk" ? 26 : 16)) {
        return c.kind === "kiosk" ? { kind: "kiosk", cell: c } : { kind: "door", cell: c };
      }
    }
    if (this.toolbox && !this.progress.tools && this.toolbox.floor === this.floor) {
      if (near(this.px, this.py, this.toolbox.x, this.toolbox.y, 16)) return { kind: "tools" };
    }
    for (const st of f.stairs) {
      if (near(this.px, this.py, st.upAt.x, st.upAt.y, 15) && this.floor < FLOOR_COUNT - 1) {
        return { kind: "stair", well: st, dir: 1 };
      }
      if (near(this.px, this.py, st.downAt.x, st.downAt.y, 15) && this.floor > 0) {
        return { kind: "stair", well: st, dir: -1 };
      }
      if (near(this.px, this.py, st.liftAt.x, st.liftAt.y, 15)) return { kind: "lift", well: st };
    }
    return null;
  }

  private promptFor(t: Target | null): string | null {
    if (!t) return null;
    switch (t.kind) {
      case "door": {
        const o = this.book.byRoom(t.cell.room);
        if (!o) return null;
        const who = occupantOf(t.cell);
        if (o.phase === "pending") return `Bank på hos ${who} (${roomLabel(t.cell.room)})`;
        if (o.phase === "carrying") return `Levér til ${who}`;
        return `${who} venter på varerne fra kælderen`;
      }
      case "kiosk":
        return this.pickupCandidates().length ? "Hent varer over disken" : "Ølkælderens lager";
      case "stair":
        return t.dir > 0 ? `Op til ${FLOOR_NAMES[this.floor + 1]}` : `Ned til ${FLOOR_NAMES[this.floor - 1]}`;
      case "lift":
        if (this.progress.lift) return "Tag elevatoren";
        return this.progress.tools ? "Reparér elevatoren" : "Elevatoren er i stykker";
      case "tools":
        return "Tag værktøjskassen";
    }
  }

  private interact(): void {
    const t = this.target();
    if (!t) return;
    switch (t.kind) {
      case "door": {
        const o = this.book.byRoom(t.cell.room);
        if (!o) return;
        if (o.phase === "pending") this.takeOrder(o);
        else if (o.phase === "carrying") this.deliver(o);
        else this.ui.toast("Varerne ligger stadig i kælderen.", "is-bad");
        break;
      }
      case "kiosk": {
        const waiting = this.pickupCandidates();
        if (waiting.length) {
          this.pickUp(waiting);
        } else {
          this.mode = "paused";
          this.ui.showShop(this.progress);
        }
        break;
      }
      case "tools":
        this.progress.tools = true;
        saveProgress(this.progress);
        this.ui.toast("Værktøjskasse! Nu kan elevatoren repareres.", "is-good");
        break;
      case "stair":
        this.useStairs(t.well, t.dir);
        break;
      case "lift":
        if (this.progress.lift) {
          this.mode = "paused";
          this.ui.showLift(this.floor);
        } else if (this.progress.tools) {
          this.progress.lift = true;
          saveProgress(this.progress);
          this.ui.toast("Elevatoren kører igen!", "is-good");
        } else {
          this.ui.toast("Du mangler værktøj. Prøv Værkstedet på 4. sal.", "is-bad");
        }
        break;
    }
  }

  private takeOrder(o: Order): void {
    this.book.accept(o);
    this.ui.toast(`${o.who} bestiller ${summarise(o)} — ca. ${o.quote} kr`);
  }

  private pickUp(waiting: Order[]): void {
    const free = capacity(this.progress) - this.carriedCount();
    let taken = 0;
    for (const o of waiting) {
      if (o.count <= free - taken) {
        o.phase = "carrying";
        taken += o.count;
      }
    }
    if (!taken) {
      this.ui.toast("Du kan ikke bære mere. Lever noget først.", "is-bad");
      return;
    }
    this.ui.toast(`Hentede ${taken} vare${taken === 1 ? "" : "r"}.`, "is-good");
  }

  private deliver(o: Order): void {
    const pay = this.book.payout(o);
    this.book.complete(o);
    this.progress.money += pay;
    this.progress.delivered += 1;
    this.progress.earned += pay;
    const bonus = this.events.onDelivered(o);
    if (bonus) {
      this.progress.money += bonus;
      this.progress.earned += bonus;
      this.progress.events += 1;
      this.ui.toast(`BONUS +${bonus} kr — hele opgaven klaret!`, "is-good");
    } else {
      this.ui.toast(`+${pay} kr fra ${o.who}`, "is-good");
    }
    saveProgress(this.progress);
  }

  // ----------------------------------------------------------------------------------- travel
  private startTravel(to: number, at: { x: number; y: number }, seconds: number): void {
    this.travel = { to, at, total: seconds, elapsed: 0, label: FLOOR_NAMES[to] };
    this.keys.clear();
  }

  private useStairs(well: Stairwell, dir: 1 | -1): void {
    const to = this.floor + dir;
    if (to < 0 || to >= FLOOR_COUNT) return;
    // You come out at the same flight you went in by, so holding E climbs floor after floor.
    this.startTravel(to, dir > 0 ? well.upAt : well.downAt, STAIR_SECONDS);
  }

  private rideLift(to: number): void {
    if (to === this.floor) return;
    this.ui.close();
    this.mode = "playing";
    this.canvas.focus();
    const well = this.currentFloor.stairs.reduce((a, b) =>
      Math.abs(a.liftAt.x - this.px) < Math.abs(b.liftAt.x - this.px) ? a : b,
    );
    this.startTravel(
      to,
      well.liftAt,
      LIFT_BOARD_SECONDS + Math.abs(to - this.floor) * LIFT_PER_FLOOR_SECONDS,
    );
  }

  // ------------------------------------------------------------------------------------- loop
  private loop = (t: number): void => {
    this.raf = requestAnimationFrame(this.loop);
    // Clamped at both ends: the upper bound stops a backgrounded tab from teleporting the bud, the
    // lower bound guards a timestamp that goes backwards (it happens across a tab restore, and a
    // negative dt runs every timer in reverse).
    const dt = Math.max(0, Math.min(0.05, (t - this.lastTime) / 1000 || 0));
    this.lastTime = t;
    this.anim += dt;
    if (this.mode === "playing") this.update(dt);
    this.renderer.draw(this.scene());
  };

  private update(dt: number): void {
    if (this.travel) {
      this.travel.elapsed += dt;
      const half = this.travel.total / 2;
      if (this.travel.elapsed >= half && this.floor !== this.travel.to) {
        this.floor = this.travel.to;
        this.px = this.travel.at.x;
        this.py = this.travel.at.y;
      }
      if (this.travel.elapsed >= this.travel.total) this.travel = null;
    } else {
      this.move(dt);
    }

    this.bump = Math.max(0, this.bump - dt);
    this.moveNpc(dt);

    this.nextSpawn -= dt;
    if (this.nextSpawn <= 0) {
      const o = this.book.spawn();
      if (o && this.progress.phone) this.ui.toast(`Ny bestilling: ${roomLabel(o.room)} · ${o.who}`);
      this.nextSpawn = SPAWN_SECONDS * (0.6 + Math.random() * 0.8);
    }

    for (const lost of this.book.tick(dt)) {
      this.progress.failed += 1;
      if (this.events.onLost(lost)) this.ui.toast("Opgaven røg — for sent.", "is-bad");
      else this.ui.toast(`For sent — ${lost.who} (${roomLabel(lost.room)}) afbestilte.`, "is-bad");
    }

    const before = this.events.active;
    const outcome = this.events.tick(dt, this.progress.delivered);
    if (outcome === "lost") this.ui.toast("Opgaven løb ud.", "is-bad");
    if (!before && this.events.active) {
      this.ui.toast(`${this.events.active.name}: ${this.events.active.blurb}`, "is-good");
    }

    saveProgress(this.progress);
    this.ui.renderOrders(this.book, this.progress.phone, this.floor, this.events);
  }

  // -------------------------------------------------------------------------------- movement
  /** Inside the walkable area, and not inside anything standing in it. */
  private canStand(x: number, y: number): boolean {
    const hw = BODY_W / 2;
    const f = this.currentFloor;
    const inside =
      inAnyRect(f.walk, x - hw, y) &&
      inAnyRect(f.walk, x + hw, y) &&
      inAnyRect(f.walk, x - hw, y - BODY_H) &&
      inAnyRect(f.walk, x + hw, y - BODY_H);
    if (!inside) return false;
    return !f.obstacles.some((o) => overlaps(o, x, y, hw, BODY_H));
  }

  private onHazard(): boolean {
    return this.currentFloor.hazards.some((h) => overlaps(h, this.px, this.py, BODY_W / 2, BODY_H));
  }

  private move(dt: number): void {
    let dx = 0;
    let dy = 0;
    if (this.held("a", "arrowleft")) dx -= 1;
    if (this.held("d", "arrowright")) dx += 1;
    if (this.held("w", "arrowup")) dy -= 1;
    if (this.held("s", "arrowdown")) dy += 1;

    this.moving = dx !== 0 || dy !== 0;
    if (!this.moving) return;

    const carried = this.carriedCount();
    const load = this.progress.cart
      ? 1
      : 1 - Math.min(CARRY_PENALTY_MAX, carried * CARRY_PENALTY_PER_ITEM);
    const speed =
      BASE_SPEED *
      (this.sprinting ? sprintFactor(this.progress) : 1) *
      load *
      (this.onHazard() ? HAZARD_SLOW : 1) *
      (this.bump > 0 ? BUMP_SLOW : 1) *
      this.speedCheat;

    const len = Math.hypot(dx, dy) || 1;
    const stepX = (dx / len) * speed * dt;
    const stepY = (dy / len) * speed * dt;

    if (stepX && this.canStand(this.px + stepX, this.py)) this.px += stepX;
    if (stepY && this.canStand(this.px, this.py + stepY)) this.py += stepY;

    if (dx !== 0 && Math.abs(dx) >= Math.abs(dy)) this.facing = dx > 0 ? "right" : "left";
    else if (dy !== 0) this.facing = dy > 0 ? "down" : "up";
  }

  private get sprinting(): boolean {
    return canRun(this.progress) && this.held("shift");
  }

  /** Only the wanderer on the floor you are standing on moves — nobody can see the others. */
  private moveNpc(dt: number): void {
    const n = this.npcs[this.floor];
    if (!n) return;
    n.anim += dt;
    if (n.pause > 0) {
      n.pause -= dt;
      return;
    }
    n.x += n.dir * NPC_SPEED * dt;
    if (n.x < n.minX || n.x > n.maxX) {
      n.x = clamp(n.x, n.minX, n.maxX);
      n.dir = n.dir > 0 ? -1 : 1;
      n.pause = 0.6 + Math.random() * 1.6;
    }
    if (this.bump <= 0 && near(this.px, this.py, n.x, n.y, 11)) {
      this.bump = BUMP_SECONDS;
      this.ui.toast("Undskyld!", "");
    }
  }

  // ------------------------------------------------------------------------------- cheats
  /** One command from the developer console. Returns what to print; a line starting with "?" is
   *  shown as an error. Everything here goes through the same state ordinary play uses, so a cheat
   *  cannot put the save into a shape the game could not reach on its own. */
  private command = (name: string, args: string[]): string => {
    const p = this.progress;
    const num = (i: number, fallback = NaN): number => {
      const v = Number(args[i]);
      return Number.isFinite(v) ? v : fallback;
    };
    const flag = (i: number): boolean => args[i] !== "0" && args[i] !== "fra" && args[i] !== "off";
    const done = (msg: string): string => {
      saveProgress(p);
      this.ui.showRail(true);
      return msg;
    };

    switch (name) {
      case "hjælp":
      case "hjaelp":
      case "help":
      case "?":
        return [
          "penge <n>          læg n kr i kassen (negativt trækker fra)",
          "sko <0-4>          fodtøj: " + SHOE_TIERS.map((t) => t.name).join(", "),
          "kasse <0-3>        bæreudstyr: " + CRATE_TIERS.map((t) => t.value + " varer").join(", "),
          "telefon [0|1]      Telefonliste",
          "vogn [0|1]         Sækkevogn",
          "værktøj [0|1]      værktøjskassen fra Værkstedet",
          "elevator [0|1]     reparér (eller ødelæg) elevatoren",
          "alt                alt udstyr + 9999 kr",
          "etage <0-5>        hop til etage",
          "rum <nnn>          hop hen foran en dør",
          "ordre [n]          fremtving n nye bestillinger (standard 1)",
          "event [" + this.events.kinds.join("|") + "]  start en opgave nu",
          "fart <x>           gangfart ×x (1 = normal)",
          "ryd                fjern alle bestillinger og opgaver",
          "nulstil            slet alt fremskridt",
          "status             hvad står der i gemmet",
        ].join("\n");

      case "status":
        return [
          `kasse ${p.money} kr · leveret ${p.delivered} · tabt ${p.failed} · opgaver ${p.events}`,
          `sko ${p.shoes} (${SHOE_TIERS[p.shoes].name}) · kasse ${p.crate} (${capacity(p)} varer)`,
          `telefon ${p.phone} · vogn ${p.cart} · værktøj ${p.tools} · elevator ${p.lift}`,
          `etage ${this.floor} (${FLOOR_NAMES[this.floor]}) · x=${Math.round(this.px)} y=${Math.round(this.py)}`,
        ].join("\n");

      case "penge":
      case "money": {
        const n = num(0, 1000);
        p.money = Math.max(0, p.money + n);
        return done(`kassen er nu ${p.money} kr`);
      }

      case "sko":
      case "shoes": {
        const n = num(0);
        if (!Number.isFinite(n) || n < 0 || n >= SHOE_TIERS.length) {
          return `? sko 0-${SHOE_TIERS.length - 1}`;
        }
        p.shoes = n;
        return done(`fodtøj: ${SHOE_TIERS[n].name}`);
      }

      case "kasse":
      case "crate": {
        const n = num(0);
        if (!Number.isFinite(n) || n < 0 || n >= CRATE_TIERS.length) {
          return `? kasse 0-${CRATE_TIERS.length - 1}`;
        }
        p.crate = n;
        return done(`bæreudstyr: ${CRATE_TIERS[n].name} (${capacity(p)} varer)`);
      }

      case "telefon":
      case "phone":
        p.phone = flag(0);
        return done(`telefonliste ${p.phone ? "til" : "fra"}`);

      case "vogn":
      case "cart":
        p.cart = flag(0);
        return done(`sækkevogn ${p.cart ? "til" : "fra"}`);

      case "værktøj":
      case "vaerktoej":
      case "tools":
        p.tools = flag(0);
        return done(`værktøjskasse ${p.tools ? "i tasken" : "tilbage i Værkstedet"}`);

      case "elevator":
      case "lift":
        p.lift = flag(0);
        if (p.lift) p.tools = true;
        return done(`elevatoren ${p.lift ? "kører" : "er i stykker"}`);

      case "alt":
      case "all":
        p.money = 9999;
        p.shoes = SHOE_TIERS.length - 1;
        p.crate = CRATE_TIERS.length - 1;
        p.phone = true;
        p.cart = true;
        p.tools = true;
        p.lift = true;
        return done("alt udstyr og 9999 kr");

      case "etage":
      case "floor": {
        const n = num(0);
        if (!Number.isFinite(n) || n < 0 || n >= FLOOR_COUNT) return `? etage 0-${FLOOR_COUNT - 1}`;
        this.travel = null;
        this.floor = n;
        const well = this.currentFloor.stairs[0];
        this.px = well.liftAt.x;
        this.py = well.liftAt.y;
        return `du står på ${FLOOR_NAMES[n]}`;
      }

      case "rum":
      case "room": {
        const n = num(0);
        const hit = this.building.rooms.find((r) => r.room === n);
        if (!hit) return `? kender ikke værelse ${args[0]}`;
        this.travel = null;
        this.floor = hit.floor;
        this.px = hit.cell.doorX;
        // Just outside the door, on the Gang side of it.
        this.py = hit.cell.doorY + (hit.cell.doorSide === "top" ? -14 : 14);
        return `${roomLabel(n)} på ${FLOOR_NAMES[hit.floor]}`;
      }

      case "ordre":
      case "order": {
        const n = Math.max(1, Math.min(20, num(0, 1)));
        let made = 0;
        for (let i = 0; i < n; i++) if (this.book.spawn(true)) made += 1;
        return made ? `${made} nye bestillinger` : "? ingen ledige værelser";
      }

      case "event": {
        const want = args[0];
        if (want && !this.events.kinds.includes(want)) {
          return `? kender kun ${this.events.kinds.join(", ")}`;
        }
        return this.events.force(want)
          ? `opgave i gang: ${this.events.active?.name}`
          : "? kunne ikke placere opgavens bestillinger";
      }

      case "fart":
      case "speed": {
        const x = num(0, 1);
        if (!(x > 0 && x <= 12)) return "? fart 0.1-12";
        this.speedCheat = x;
        return `gangfart ×${x}`;
      }

      case "ryd":
      case "clear":
        this.book.clear();
        this.events.clear();
        return "bestillinger og opgaver ryddet";

      case "nulstil":
      case "reset":
        this.onAction({ type: "reset" });
        return "alt fremskridt slettet";

      default:
        return `? ukendt kommando "${name}" — prøv hjælp`;
    }
  };

  private scene(): Scene {
    const t = this.mode === "playing" && !this.travel ? this.target() : null;
    const fade = this.travel ? 1 - Math.abs(this.travel.elapsed / this.travel.total - 0.5) * 2 : 0;
    const n = this.npcs[this.floor];
    const npc: NpcView | null = n
      ? { x: n.x, y: n.y, dir: n.dir, anim: n.anim, moving: n.pause <= 0 }
      : null;
    return {
      floor: this.currentFloor,
      camX: clamp(this.px - VIEW_W / 2, 0, Math.max(0, WORLD_W - VIEW_W)),
      player: {
        x: this.px,
        y: this.py,
        facing: this.facing,
        moving: this.moving && this.mode === "playing",
        anim: this.anim,
        carrying: this.carriedCount() > 0,
        sprinting: this.sprinting,
      },
      npc,
      orders: this.book,
      event: this.events.active,
      money: this.progress.money,
      carried: this.carriedCount(),
      capacity: capacity(this.progress),
      prompt: this.promptFor(t),
      hasPhone: this.progress.phone,
      hasLift: this.progress.lift,
      hasTools: this.progress.tools,
      toolbox: this.toolbox,
      fade,
      fadeLabel: this.travel?.label ?? "",
    };
  }
}
