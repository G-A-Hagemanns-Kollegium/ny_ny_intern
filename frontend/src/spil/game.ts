/** The simulation: input, movement, obstacles, events, experience and the run clock.
 *
 *  A run is fifteen minutes. Kroner are the score and cannot be spent; everything you unlock comes
 *  from levelling, and levels come from delivering *fast*.
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
  MAX_ACCEPTED,
  BASE_SPEED,
  BODY_H,
  BODY_W,
  BUMP_SECONDS,
  BUMP_SLOW,
  CARRY_PENALTY_MAX,
  CARRY_PENALTY_PER_ITEM,
  COMBO_WINDOW,
  DASH_COOLDOWN,
  DASH_SECONDS,
  DASH_SPEED,
  FLOOR_COUNT,
  HAZARD_SLOW,
  JUMP_SECONDS,
  KIOSK_FLOOR,
  LEVEL_FX_SECONDS,
  LIFT_BOARD_SECONDS,
  LIFT_PER_FLOOR_SECONDS,
  NPC_SPEED,
  RUN_MINUTES,
  RUN_SECONDS,
  SPARKS_PER_BURST,
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
  SKILLS,
  canDash,
  canJump,
  canRun,
  artOf,
  capacity,
  clearSave,
  comboMultiplier,
  dashCooldownFactor,
  defaultSave,
  hasMap,
  loadSave,
  newRun,
  perkOf,
  record,
  skillLevel,
  sprintFactor,
  sureFooted,
  walkFactor,
  writeSave,
  xpNeeded,
  type Run,
  type Save,
  type SkillId,
} from "./progress";
import { Renderer, type NpcView, type Pop, type Puff, type Scene, type Spark } from "./render";
import { Ui, type Action } from "./ui";

type Mode = "select" | "playing" | "paused" | "console" | "over";

interface Travel {
  to: number;
  at: { x: number; y: number };
  total: number;
  elapsed: number;
  label: string;
}

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
const near = (ax: number, ay: number, bx: number, by: number, r: number): boolean =>
  Math.abs(ax - bx) < r && Math.abs(ay - by) < r;
const overlaps = (r: Rect, x: number, y: number, hw: number, hh: number): boolean =>
  x + hw > r.x && x - hw < r.x + r.w && y > r.y && y - hh < r.y + r.h;

export class Game {
  private renderer: Renderer;
  private ui: Ui;
  private console: DevConsole;
  private building: Building;
  private book: OrderBook;
  private events: EventDirector;
  private save: Save;
  private run: Run;

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
  private bump = 0;
  private npcs: Npc[] = [];
  /** Dash and jump timers. */
  private dashLeft = 0;
  private dashCool = 0;
  private dashDir: { x: number; y: number } = { x: 1, y: 0 };
  private jumpLeft = 0;
  /** Kroner popups over the bud's head. */
  private pops: Pop[] = [];
  private speedCheat = 1;
  /** Set when a level lands; the panel opens once the fireworks have had their moment. */
  /** Fireworks, in screen space, and the dust the dash kicks up, in world space. */
  private sparks: Spark[] = [];
  private puffs: Puff[] = [];
  private levelBanner = 0;
  private levelBannerText = "";

  constructor(
    private frame: HTMLElement,
    private canvas: HTMLCanvasElement,
    serverRooms: ServerRoom[],
    goods: string[],
  ) {
    this.building = buildBuilding(serverRooms);
    this.book = new OrderBook(this.building, goods);
    this.events = new EventDirector(this.book, this.building);
    this.save = loadSave();
    this.run = newRun(RUN_SECONDS, perkOf(this.save.character));
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
    this.ui.showTitle(this.save);
    this.loop(performance.now());
  }

  setAtlas(atlas: Atlas): void {
    this.renderer.setAtlas(atlas);
    this.ui.setAtlas(atlas, CHARACTERS, this.save);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
  }

  private placeToolbox(): void {
    for (const f of this.building.floors) {
      const ws = f.cells.find((c) => c.kind === "workshop");
      if (!ws) continue;
      const r = rectPx(ws);
      this.toolbox = { floor: f.index, x: r.x + r.w / 2, y: r.y + r.h - 22 };
      return;
    }
  }

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
      if (this.mode === "playing") this.mode = "console";
      this.console.open();
      return;
    }
    if (k === "escape") {
      if (this.mode === "playing") this.pause();
      else if (this.mode === "paused") this.resume();
      return;
    }
    if (this.mode !== "playing") return;
    if (k === "e" || k === "enter") {
      this.interact();
      return;
    }
    if (k === " ") {
      this.tryJump();
      return;
    }
    if (k === "q" || k === "control") {
      this.tryDash();
      return;
    }
    if (k === "k") {
      // Same as clicking the button on the side — spend a point without breaking stride.
      if (this.run.points > 0) this.onAction({ type: "skills" });
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

  // -------------------------------------------------------------------------------- run flow
  private startRun(): void {
    this.ui.close();
    this.run = newRun(RUN_SECONDS, perkOf(this.save.character));
    this.book.clear();
    this.events.clear();
    this.placeToolbox();
    this.spawnNpcs();
    this.floor = KIOSK_FLOOR;
    this.px = this.building.start.x;
    this.py = this.building.start.y;
    this.travel = null;
    this.pops = [];
    this.nextSpawn = 6;
    this.sparks = [];
    this.puffs = [];
    this.levelBanner = 0;
    // Open with something to do downstairs. Starting in the cellar with every order on 4. sal is a
    // miserable first thirty seconds, and the upward bias used to make that the common case.
    for (let i = 0; i < 3; i++) this.book.spawn(true, 2);
    this.book.spawn(true, 3);
    this.mode = "playing";
    this.ui.showHud(true);
    this.canvas.focus();
    this.ui.toast(`${RUN_MINUTES} minutter. Bank på hos dem der har lys.`);
  }

  private endRun(): void {
    this.mode = "over";
    this.keys.clear();
    const place = record(this.save, this.run);
    this.ui.showHud(false);
    this.ui.showGameOver(this.run, this.save, place);
  }

  private pause(): void {
    if (this.mode !== "playing") return;
    this.mode = "paused";
    this.keys.clear();
    this.ui.showPause(this.run);
  }

  private resume(): void {
    this.ui.close();
    if (this.mode === "select" || this.mode === "over") return;
    this.mode = "playing";
    this.canvas.focus();
  }

  private onAction = (a: Action): void => {
    switch (a.type) {
      // Title → tutorial → pick a bud → run. "En gang til" skips all three.
      case "play":
        this.ui.showTutorial();
        break;
      case "start":
        this.ui.showSelect(CHARACTERS);
        break;
      case "character":
        this.save.character = a.id;
        writeSave(this.save);
        this.startRun();
        break;
      case "resume":
        this.resume();
        break;
      case "skills":
        if (this.mode !== "playing" && this.mode !== "paused") break;
        this.mode = "paused";
        this.ui.showSkills(this.run);
        break;
      case "spend":
        this.spend(a.id);
        break;
      case "lift":
        this.rideLift(a.floor);
        break;
      case "again":
        this.startRun();
        break;
      case "menu":
        this.ui.close();
        this.mode = "select";
        this.ui.showHud(false);
        this.ui.showTitle(this.save);
        break;
      case "reset":
        clearSave();
        this.save = defaultSave();
        this.mode = "select";
        this.ui.showHud(false);
        this.ui.showTitle(this.save);
        break;
    }
  };

  private spend(id: SkillId): void {
    const skill = SKILLS.find((s) => s.id === id);
    if (!skill || this.run.points <= 0) return;
    if (skillLevel(this.run.skills, id) >= skill.max) return;
    if (skill.needs && skillLevel(this.run.skills, skill.needs.id) < skill.needs.level) return;
    this.run.skills[id] = skillLevel(this.run.skills, id) + 1;
    this.run.points -= 1;
    this.ui.toast(`${skill.name} — ${skill.note}`, "is-good");
    if (this.run.points > 0) this.ui.showSkills(this.run);
    else this.resume();
  }

  // ------------------------------------------------------------------------------ interaction
  private get currentFloor(): Floor {
    return this.building.floors[this.floor];
  }

  private carriedCount(): number {
    return this.book.carrying.reduce((a, o) => a + o.count, 0);
  }

  private pickupCandidates(): Order[] {
    return this.book.active.filter((o) => o.phase === "taken");
  }

  private target(): Target | null {
    const f = this.currentFloor;
    for (const c of f.cells) {
      if (c.kind === "kiosk" && near(this.px, this.py, c.doorX, c.doorY, 26) && this.py > c.doorY) {
        return { kind: "kiosk", cell: c };
      }
      if (!this.book.atCell(c).length) continue;
      if (c.open) {
        // A party in festsalen: you have to be standing in it.
        const r = rectPx(c);
        if (this.px > r.x && this.px < r.x + r.w && this.py > r.y && this.py < r.y + r.h) {
          return { kind: "door", cell: c };
        }
        continue;
      }
      const outside = c.doorSide === "top" ? this.py < c.doorY : this.py > c.doorY;
      if (outside && near(this.px, this.py, c.doorX, c.doorY, 16)) return { kind: "door", cell: c };
    }
    if (this.toolbox && !this.run.tools && this.toolbox.floor === this.floor) {
      if (near(this.px, this.py, this.toolbox.x, this.toolbox.y, 16)) return { kind: "tools" };
    }
    for (const st of f.stairs) {
      if (near(this.px, this.py, st.upAt.x, st.upAt.y, 15) && this.floor < FLOOR_COUNT - 1) {
        return { kind: "stair", well: st, dir: 1 };
      }
      if (near(this.px, this.py, st.downAt.x, st.downAt.y, 15) && this.floor > 0) {
        return { kind: "stair", well: st, dir: -1 };
      }
      if (near(this.px, this.py, st.liftAt.x, st.liftAt.y, 16)) return { kind: "lift", well: st };
    }
    return null;
  }

  private promptFor(t: Target | null): string | null {
    if (!t) return null;
    switch (t.kind) {
      case "door": {
        const o = this.book.nextAtCell(t.cell);
        if (!o) return null;
        const who = o.room ? occupantOf(t.cell) : o.cell.label;
        if (o.phase === "carrying") return `Levér til ${who}`;
        if (o.phase === "pending") {
          return this.book.running.length >= MAX_ACCEPTED ? "Hænderne er fulde" : `Bank på hos ${who}`;
        }
        return `${who} venter på varerne fra kælderen`;
      }
      case "kiosk":
        return this.pickupCandidates().length ? "Hent varer over disken" : "Ølkælderens disk";
      case "stair":
        return t.dir > 0 ? `Op til ${FLOOR_NAMES[this.floor + 1]}` : `Ned til ${FLOOR_NAMES[this.floor - 1]}`;
      case "lift":
        if (this.run.lift) return "Tag elevatoren";
        return this.run.tools ? "Reparér elevatoren" : "Elevatoren er i stykker";
      case "tools":
        return "Tag værktøjskassen";
    }
  }

  private interact(): void {
    const t = this.target();
    if (!t) return;
    switch (t.kind) {
      case "door": {
        const o = this.book.nextAtCell(t.cell);
        if (!o) return;
        if (o.phase === "pending") this.takeOrder(o);
        else if (o.phase === "carrying") this.deliver(o);
        else this.ui.toast("Varerne ligger stadig i kælderen.", "is-bad");
        break;
      }
      case "kiosk": {
        const waiting = this.pickupCandidates();
        if (waiting.length) this.pickUp(waiting);
        else this.ui.toast("Ingen bestillinger at hente. Bank på først.", "is-bad");
        break;
      }
      case "tools":
        this.run.tools = true;
        this.ui.toast("Værktøjskasse! Gå hen til en elevatordør og reparér den.", "is-good");
        break;
      case "stair":
        this.useStairs(t.well, t.dir);
        break;
      case "lift":
        if (this.run.lift) {
          this.mode = "paused";
          this.ui.showLift(this.floor);
        } else if (this.run.tools) {
          this.run.lift = true;
          this.ui.toast("Elevatoren kører igen!", "is-good");
        } else {
          this.ui.toast("Værktøjet ligger i Værkstedet på 4. sal.", "is-bad");
        }
        break;
    }
  }

  private takeOrder(o: Order): void {
    if (this.book.running.length >= MAX_ACCEPTED) {
      this.ui.toast(`Du har ${MAX_ACCEPTED} ordrer i forvejen — lever en først.`, "is-bad");
      return;
    }
    this.book.accept(o);
    this.ui.toast(`${o.who}: ${summarise(o)} — ${o.quote} kr`);
  }

  private pickUp(waiting: Order[]): void {
    const free = capacity(this.run) - this.carriedCount();
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
    const run = this.run;
    // Streak: keep delivering and both kroner and experience are multiplied.
    run.combo = run.comboLeft > 0 ? run.combo + 1 : 1;
    run.comboLeft = COMBO_WINDOW;
    run.bestCombo = Math.max(run.bestCombo, run.combo);
    const mult = comboMultiplier(run);

    const pay = Math.round(this.book.payout(o) * mult);
    const xp = Math.round(this.book.experience(o) * mult);
    this.book.complete(o);
    run.money += pay;
    run.delivered += 1;
    this.pop(`+${pay} kr`, true, true);
    this.gainXp(xp);

    const bonus = this.events.onDelivered(o);
    if (bonus) {
      run.money += bonus;
      run.events += 1;
      this.gainXp(Math.round(bonus / 2));
      this.pop(`BONUS +${bonus} kr`, true, true);
      this.ui.toast(`Opgaven klaret — bonus ${bonus} kr!`, "is-good");
    } else if (run.combo > 1) {
      this.ui.toast(`${run.combo}× i træk — ×${mult.toFixed(2)}`, "is-good");
    }
  }

  private gainXp(amount: number): void {
    const run = this.run;
    const before = run.level;
    run.xp += amount;
    run.xpInLevel += amount;
    while (run.xpInLevel >= xpNeeded(run)) {
      run.xpInLevel -= xpNeeded(run);
      run.level += 1;
      run.points += 1;
    }
    if (run.level > before) {
      // Fireworks and a glowing skill button, and nothing else. Opening the panel on its own used
      // to stop the run mid-stride — a level should land as a moment, not as a menu. The point
      // keeps until the player asks for it with K or the side button.
      this.celebrate(run.level);
      this.ui.toast(`Level ${run.level} — du har et færdighedspoint (K)`, "is-good");
    }
  }

  private pop(text: string, good: boolean, big = false): void {
    this.pops.push({ text, x: this.px, y: this.py - 24, life: big ? 2 : 1.5, good, big });
  }

  /** Three bursts of sparks across the top of the view, plus a banner. Screen space, so they do not
   *  scroll away with the building. */
  private celebrate(level: number): void {
    this.levelBanner = LEVEL_FX_SECONDS + 0.4;
    this.levelBannerText = `LEVEL ${level}!`;
    for (let burst = 0; burst < 3; burst++) {
      const cx = 90 + Math.random() * 250;
      const cy = 70 + Math.random() * 70;
      const hue = ["#ffd9a0", "#d9b566", "#6aa87c", "#e2a0ff", "#ff9e7a"][burst % 5];
      for (let i = 0; i < SPARKS_PER_BURST; i++) {
        const a = (i / SPARKS_PER_BURST) * Math.PI * 2 + Math.random() * 0.3;
        const speed = 40 + Math.random() * 70;
        this.sparks.push({
          x: cx,
          y: cy,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          life: 0.8 + Math.random() * 0.7,
          max: 1.5,
          delay: burst * 0.32,
          colour: hue,
        });
      }
    }
  }

  // ----------------------------------------------------------------------------------- travel
  private startTravel(to: number, at: { x: number; y: number }, seconds: number): void {
    this.travel = { to, at, total: seconds, elapsed: 0, label: FLOOR_NAMES[to] };
    this.keys.clear();
  }

  private useStairs(well: Stairwell, dir: 1 | -1): void {
    const to = this.floor + dir;
    if (to < 0 || to >= FLOOR_COUNT) return;
    this.startTravel(to, dir > 0 ? well.upAt : well.downAt, STAIR_SECONDS);
  }

  private rideLift(to: number): void {
    if (to === this.floor) {
      this.resume();
      return;
    }
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
    const dt = Math.max(0, Math.min(0.05, (t - this.lastTime) / 1000 || 0));
    this.lastTime = t;
    this.anim += dt;
    for (let i = this.pops.length - 1; i >= 0; i--) {
      this.pops[i].life -= dt;
      this.pops[i].y -= dt * (this.pops[i].big ? 20 : 14);
      if (this.pops[i].life <= 0) this.pops.splice(i, 1);
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const k = this.sparks[i];
      if (k.delay > 0) {
        k.delay -= dt;
        continue;
      }
      k.x += k.vx * dt;
      k.y += k.vy * dt;
      k.vy += 92 * dt; // gravity
      k.vx *= 1 - dt * 1.1;
      k.life -= dt;
      if (k.life <= 0) this.sparks.splice(i, 1);
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const u = this.puffs[i];
      u.x += u.vx * dt;
      u.y += u.vy * dt;
      u.vx *= 1 - dt * 3;
      u.vy *= 1 - dt * 3;
      u.r += dt * 6;
      u.life -= dt;
      if (u.life <= 0) this.puffs.splice(i, 1);
    }
    if (this.levelBanner > 0) this.levelBanner -= dt;
    if (this.mode === "playing") this.update(dt);
    this.renderer.draw(this.scene());
  };

  private update(dt: number): void {
    const run = this.run;
    this.ui.showSkillButton(run.points);
    run.left -= dt;
    if (run.left <= 0) {
      run.left = 0;
      this.endRun();
      return;
    }
    if (run.comboLeft > 0) {
      run.comboLeft -= dt;
      if (run.comboLeft <= 0) run.combo = 0;
    }

    this.dashCool = Math.max(0, this.dashCool - dt);
    this.dashLeft = Math.max(0, this.dashLeft - dt);
    this.jumpLeft = Math.max(0, this.jumpLeft - dt);
    this.bump = Math.max(0, this.bump - dt);

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

    this.moveNpc(dt);

    this.nextSpawn -= dt;
    if (this.nextSpawn <= 0) {
      this.book.spawn();
      this.nextSpawn = SPAWN_SECONDS * (0.6 + Math.random() * 0.8);
    }

    for (const lost of this.book.tick(dt)) {
      run.failed += 1;
      run.combo = 0;
      run.comboLeft = 0;
      if (this.events.onLost(lost)) this.ui.toast("Opgaven røg — for sent.", "is-bad");
      else this.ui.toast(`For sent — ${lost.who} afbestilte.`, "is-bad");
    }

    const before = this.events.active;
    if (this.events.tick(dt, run.delivered) === "lost") this.ui.toast("Opgaven løb ud.", "is-bad");
    if (!before && this.events.active) {
      const ev = this.events.active;
      this.ui.toast(`${ev.name} — ${ev.where}`, "is-good");
    }

  }

  // -------------------------------------------------------------------------------- movement
  private canStand(x: number, y: number): boolean {
    const hw = BODY_W / 2;
    const f = this.currentFloor;
    const inside =
      inAnyRect(f.walk, x - hw, y) &&
      inAnyRect(f.walk, x + hw, y) &&
      inAnyRect(f.walk, x - hw, y - BODY_H) &&
      inAnyRect(f.walk, x + hw, y - BODY_H);
    if (!inside) return false;
    if (this.jumpLeft > 0) return true; // airborne: obstacles pass under you
    return !f.obstacles.some((o) => overlaps(o.hit ?? o, x, y, hw, BODY_H));
  }

  private onHazard(): boolean {
    if (this.jumpLeft > 0) return false;
    return this.currentFloor.hazards.some((h) => overlaps(h, this.px, this.py, BODY_W / 2, BODY_H));
  }

  private tryJump(): void {
    if (!canJump(this.run) || this.jumpLeft > 0 || this.travel) return;
    this.jumpLeft = JUMP_SECONDS;
  }

  private tryDash(): void {
    if (!canDash(this.run) || this.dashCool > 0 || this.travel) return;
    this.dashLeft = DASH_SECONDS;
    this.dashCool = DASH_COOLDOWN * dashCooldownFactor(this.run);
    const d = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[this.facing];
    this.dashDir = { x: d[0], y: d[1] };
    // A kick of dust off the heels, thrown the way you came from.
    for (let i = 0; i < 7; i++) {
      this.puffs.push({
        x: this.px - d[0] * 4 + (Math.random() * 6 - 3),
        y: this.py - 2 + (Math.random() * 5 - 2.5),
        vx: -d[0] * (12 + Math.random() * 26) + (Math.random() * 10 - 5),
        vy: -d[1] * (10 + Math.random() * 18) + (Math.random() * 8 - 6),
        r: 1.4 + Math.random() * 2,
        life: 0.35 + Math.random() * 0.3,
        max: 0.65,
      });
    }
  }

  private move(dt: number): void {
    let dx = 0;
    let dy = 0;
    if (this.held("a", "arrowleft")) dx -= 1;
    if (this.held("d", "arrowright")) dx += 1;
    if (this.held("w", "arrowup")) dy -= 1;
    if (this.held("s", "arrowdown")) dy += 1;

    if (this.dashLeft > 0) {
      const step = DASH_SPEED * dt;
      if (this.canStand(this.px + this.dashDir.x * step, this.py)) this.px += this.dashDir.x * step;
      if (this.canStand(this.px, this.py + this.dashDir.y * step)) this.py += this.dashDir.y * step;
      this.moving = true;
      return;
    }

    this.moving = dx !== 0 || dy !== 0;
    if (!this.moving) return;

    const carried = this.carriedCount();
    const load = 1 - Math.min(CARRY_PENALTY_MAX, carried * CARRY_PENALTY_PER_ITEM);
    const speed =
      BASE_SPEED *
      walkFactor(this.run) *
      (this.sprinting ? sprintFactor(this.run) : 1) *
      load *
      (this.onHazard() && !sureFooted(this.run) ? HAZARD_SLOW : 1) *
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
    return canRun(this.run) && this.held("shift");
  }

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
    // Fredo walks straight past people; everyone else stops to apologise.
    const shouldBump =
      this.bump <= 0 && this.jumpLeft <= 0 && !sureFooted(this.run) && near(this.px, this.py, n.x, n.y, 11);
    if (shouldBump) {
      this.bump = BUMP_SECONDS;
      this.ui.toast("Undskyld!");
    }
  }

  // ------------------------------------------------------------------------------- cheats
  /** Commands that only look at the run. Everything else voids it — see `dispatch` below. */
  private static readonly READ_ONLY = new Set(["hjælp", "hjaelp", "help", "?", "status"]);

  private static unknown(name: string): string {
    return `? ukendt kommando "${name}" — prøv hjælp`;
  }

  /** The console, wrapped: anything that is not a plain read marks the shift as cheated, and a
   *  cheated shift cannot reach the leaderboard. Enforcing it here rather than in each case means a
   *  command added later is disqualifying by default, which is the safe direction to be wrong in. */
  private command = (name: string, args: string[]): string => {
    const out = this.dispatch(name, args);
    const read = Game.READ_ONLY.has(name) || out === Game.unknown(name);
    if (!read && !this.run.cheated) {
      this.run.cheated = true;
      this.ui.toast("Konsollen er brugt — vagten tæller ikke på ranglisten.", "is-bad");
    }
    return out;
  };

  private dispatch(name: string, args: string[]): string {
    const run = this.run;
    const num = (i: number, fallback = NaN): number => {
      const v = Number(args[i]);
      return Number.isFinite(v) ? v : fallback;
    };
    switch (name) {
      case "hjælp":
      case "hjaelp":
      case "help":
      case "?":
        return [
          "penge <n>          læg n kr på scoren",
          "xp <n>             giv erfaring (og dermed levels)",
          "point <n>          giv n skillpoints",
          "skill <id> [n]     " + SKILLS.map((s) => s.id).join(", "),
          "alt                alle skills på max",
          "tid <n>            sæt sekunder tilbage af vagten",
          "etage <0-5>        hop til etage",
          "rum <nnn>          hop hen foran en dør",
          "ordre [n]          fremtving n nye bestillinger",
          "event [" + this.events.kinds.join("|") + "]",
          "værktøj / elevator kortslut elevator-opgaven",
          "fart <x>           gangfart ×x",
          "ryd                fjern bestillinger og opgaver",
          "slut               afslut vagten nu",
          "nulstil            slet ranglisten",
          "status             hvad står der lige nu",
        ].join("\n");
      case "status":
        return [
          `score ${run.money} kr · level ${run.level} (${run.xpInLevel}/${xpNeeded(run)}) · point ${run.points}`,
          `leveret ${run.delivered} · tabt ${run.failed} · opgaver ${run.events} · combo ${run.combo}`,
          `skills ${SKILLS.map((s) => `${s.id}:${skillLevel(run.skills, s.id)}`).join(" ")}`,
          `tid tilbage ${Math.round(run.left)}s · etage ${this.floor} · x=${Math.round(this.px)} y=${Math.round(this.py)}`,
        ].join("\n");
      case "penge":
      case "money":
        run.money = Math.max(0, run.money + num(0, 1000));
        return `score ${run.money} kr`;
      case "xp":
        this.gainXp(Math.max(1, num(0, 200)));
        return `level ${run.level}, ${run.points} point`;
      case "point":
        run.points += Math.max(1, num(0, 1));
        return `${run.points} point`;
      case "skill": {
        const skill = SKILLS.find((s) => s.id === args[0]);
        if (!skill) return `? kender ${SKILLS.map((s) => s.id).join(", ")}`;
        run.skills[skill.id] = clamp(num(1, skill.max), 0, skill.max);
        return `${skill.name} på level ${run.skills[skill.id]}`;
      }
      case "alt":
      case "all":
        for (const s of SKILLS) run.skills[s.id] = s.max;
        run.tools = true;
        run.lift = true;
        return "alle skills på max, elevator repareret";
      case "tid":
      case "time":
        run.left = Math.max(1, num(0, 60));
        return `${Math.round(run.left)}s tilbage`;
      case "slut":
      case "end":
        run.left = 0.001;
        return "vagten slutter nu";
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
        const hit = this.building.rooms.find((r) => r.room === num(0));
        if (!hit) return `? kender ikke værelse ${args[0]}`;
        this.travel = null;
        this.floor = hit.floor;
        this.px = hit.cell.doorX;
        this.py = hit.cell.doorY + (hit.cell.doorSide === "top" ? -14 : 14);
        return `${hit.room} på ${FLOOR_NAMES[hit.floor]}`;
      }
      case "ordre":
      case "order": {
        const n = clamp(num(0, 1), 1, 20);
        let made = 0;
        for (let i = 0; i < n; i++) if (this.book.spawn(true)) made += 1;
        return made ? `${made} nye bestillinger` : "? ingen ledige værelser";
      }
      case "event": {
        const want = args[0];
        if (want && !this.events.kinds.includes(want)) return `? kender ${this.events.kinds.join(", ")}`;
        return this.events.force(want)
          ? `opgave i gang: ${this.events.active?.name}`
          : "? kunne ikke placere opgaven";
      }
      case "værktøj":
      case "vaerktoej":
      case "tools":
        run.tools = true;
        return "værktøjskassen er i tasken";
      case "elevator":
      case "lift":
        run.tools = true;
        run.lift = true;
        return "elevatoren kører";
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
        return "ryddet";
      case "nulstil":
      case "reset":
        this.onAction({ type: "reset" });
        return "ranglisten er slettet";
      default:
        return Game.unknown(name);
    }
  }

  private scene(): Scene {
    const t = this.mode === "playing" && !this.travel ? this.target() : null;
    const fade = this.travel ? 1 - Math.abs(this.travel.elapsed / this.travel.total - 0.5) * 2 : 0;
    const n = this.npcs[this.floor];
    const npc: NpcView | null = n
      ? { x: n.x, y: n.y, dir: n.dir, anim: n.anim, moving: n.pause <= 0 }
      : null;
    const jump = this.jumpLeft > 0 ? Math.sin((1 - this.jumpLeft / JUMP_SECONDS) * Math.PI) : 0;
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
        sprinting: this.sprinting || this.dashLeft > 0,
        jump,
      },
      npc,
      party: this.events.party,
      orders: this.book,
      event: this.events.active,
      run: this.run,
      running: this.book.running,
      capacity: capacity(this.run),
      art: artOf(this.save.character),
      showMap: hasMap(this.run),
      prompt: this.promptFor(t),
      pops: this.pops,
      sparks: this.sparks,
      puffs: this.puffs,
      banner: this.levelBanner > 0 ? this.levelBannerText : null,
      toolbox: this.toolbox,
      fade,
      fadeLabel: this.travel?.label ?? "",
    };
  }
}
