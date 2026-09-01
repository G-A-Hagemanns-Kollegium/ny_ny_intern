/** Orders: who wants what, how long you have to get back, and what it is worth.
 *
 *  Life cycle: pending → taken → carrying → paid.
 *
 *  A *pending* request has no clock on it. The single timer starts the moment you take the order at
 *  the door, and it decides everything: kroner (the score) get a speed bonus, and experience is
 *  almost entirely how much of the deadline you had left.
 *
 *  An order is addressed to a **cell**, not to a room number. Most of the time that cell is
 *  somebody's room; during a party it is festsalen or a gangkøkken, where nobody lives.
 */

import type { Building, Cell } from "./building";
import { occupantOf } from "./building";
import {
  DEADLINE_BASE,
  DEADLINE_PER_FLOOR,
  DEADLINE_PER_ITEM,
  MAX_PENDING,
  ORDER_MAX_ITEMS,
  ORDER_MIN_ITEMS,
  PAY_BASE,
  PAY_JITTER,
  PAY_PER_FLOOR,
  PAY_PER_ITEM,
  SPEED_BONUS_MAX,
  URGENT_FRACTION,
  XP_BASE,
  XP_PER_FLOOR,
  XP_PER_ITEM,
  XP_SPEED,
} from "./config";

export type OrderPhase = "pending" | "taken" | "carrying";

export interface OrderLine {
  name: string;
  qty: number;
}

export interface Order {
  id: number;
  /** Room number, or 0 for a delivery to somewhere nobody lives (a party). */
  room: number;
  floor: number;
  cell: Cell;
  who: string;
  /** "205" or "Festsalen" — what the rail and the crate tag show. */
  label: string;
  lines: OrderLine[];
  count: number;
  phase: OrderPhase;
  limit: number;
  left: number;
  quote: number;
}

/** Which icon a product gets in the belt. The names come from the real Ølkælder list, so this
 *  matches on what is *in* them rather than on a fixed menu, and anything new falls back to a
 *  crate. Order matters: "Sodavand" contains "vand", so soft drinks are tested before water. */
const ICONS: [RegExp, string][] = [
  [/sodavand|cola|fanta|sprite|squash|soda|faxe/, "item_soda"],
  [/vand|water|kildevand/, "item_water"],
  [/øl|oel|beer|tuborg|carlsberg|pilsner|classic|hof|ipa|guld/, "item_beer"],
  [/snaps|vodka|gin|rom|whisky|spiritus|shot|bitter|likør|drink/, "item_spirit"],
  [/chips|snack|popcorn|peanut|nødder|saltstang|kiks|pizza/, "item_snack"],
  [/slik|chokolade|candy|bland|lakrids|vingummi|karamel|is\b/, "item_candy"],
];

export function goodIcon(name: string): string {
  const n = name.toLowerCase();
  return ICONS.find(([re]) => re.test(n))?.[1] ?? "item_misc";
}

const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
const jitter = (amount: number): number => 1 + (Math.random() * 2 - 1) * amount;

export class OrderBook {
  readonly active: Order[] = [];
  private nextId = 1;

  constructor(
    private readonly building: Building,
    private readonly goods: string[],
  ) {}

  pendingCount(): number {
    return this.active.filter((o) => o.phase === "pending").length;
  }

  /** Every order addressed to this cell — a room has at most one, a party has several. */
  atCell(cell: Cell): Order[] {
    return this.active.filter((o) => o.cell === cell);
  }

  /** The one the player would mean by pressing E here: something to hand over first, then something
   *  to knock for, then the one still waiting on the cellar. */
  nextAtCell(cell: Cell): Order | undefined {
    const here = this.atCell(cell);
    return (
      here.find((o) => o.phase === "carrying") ??
      here.find((o) => o.phase === "pending") ??
      here[0]
    );
  }

  get running(): Order[] {
    return this.active.filter((o) => o.phase !== "pending");
  }

  get carrying(): Order[] {
    return this.active.filter((o) => o.phase === "carrying");
  }

  private build(cell: Cell, floor: number, room: number, label: string, who: string, count: number): Order {
    const lines: OrderLine[] = [];
    for (let i = 0; i < count; i++) {
      const name = pick(this.goods);
      const line = lines.find((l) => l.name === name);
      if (line) line.qty += 1;
      else lines.push({ name, qty: 1 });
    }
    const limit = DEADLINE_BASE + DEADLINE_PER_ITEM * count + DEADLINE_PER_FLOOR * floor;
    const quote = Math.round(
      (PAY_BASE + PAY_PER_ITEM * count + PAY_PER_FLOOR * floor) * jitter(PAY_JITTER),
    );
    const order: Order = {
      id: this.nextId++,
      room,
      floor,
      cell,
      who,
      label,
      lines,
      count,
      phase: "pending",
      limit,
      left: limit,
      quote,
    };
    this.active.push(order);
    return order;
  }

  /** One new request at a random free room.
   *
   *  `force` skips the waiting-orders cap. `maxFloor` keeps it low in the building — the run opens
   *  with a few of these, because starting in the cellar with every order five flights up is a
   *  miserable first thirty seconds.
   */
  spawn(force = false, maxFloor = 5): Order | null {
    if (!force && this.pendingCount() >= MAX_PENDING) return null;
    const busy = new Set(this.active.map((o) => o.cell));
    const free = this.building.rooms.filter((r) => !busy.has(r.cell) && r.floor <= maxFloor);
    if (!free.length) return null;

    // Two draws, keeping the higher floor *half* the time. A straight max-of-two biases so hard
    // that Stuen and 1. sal go quiet, which is the opposite of what a new player needs.
    const a = pick(free);
    const b = pick(free);
    const target = b.floor > a.floor && Math.random() < 0.5 ? b : a;
    const count = ORDER_MIN_ITEMS + Math.floor(Math.random() * (ORDER_MAX_ITEMS - ORDER_MIN_ITEMS + 1));
    return this.build(
      target.cell,
      target.floor,
      target.room,
      String(target.room).padStart(3, "0"),
      occupantOf(target.cell),
      count,
    );
  }

  /** An order addressed somewhere nobody lives — used by the party event. */
  spawnAt(cell: Cell, floor: number, label: string, who: string, count: number): Order {
    return this.build(cell, floor, 0, label, who, count);
  }

  tick(dt: number): Order[] {
    const lost: Order[] = [];
    for (let i = this.active.length - 1; i >= 0; i--) {
      const o = this.active[i];
      if (o.phase === "pending") continue;
      o.left -= dt;
      if (o.left <= 0) lost.push(...this.active.splice(i, 1));
    }
    return lost;
  }

  accept(o: Order): void {
    o.phase = "taken";
    o.left = o.limit;
  }

  fraction(o: Order): number {
    return o.phase === "pending" ? 1 : Math.max(0, o.left / o.limit);
  }

  isUrgent(o: Order): boolean {
    return o.phase !== "pending" && this.fraction(o) < URGENT_FRACTION;
  }

  /** The quote plus a bonus for every second of the deadline still unspent. */
  payout(o: Order): number {
    return Math.max(1, Math.round(o.quote * (1 + this.fraction(o) * SPEED_BONUS_MAX)));
  }

  /** Experience is mostly speed — the flat part is small on purpose. */
  experience(o: Order): number {
    return Math.round(
      XP_BASE + XP_SPEED * this.fraction(o) + XP_PER_FLOOR * o.floor + XP_PER_ITEM * o.count,
    );
  }

  complete(o: Order): void {
    const i = this.active.indexOf(o);
    if (i >= 0) this.active.splice(i, 1);
  }

  clear(): void {
    this.active.length = 0;
  }
}

export const summarise = (o: Order): string =>
  o.lines.map((l) => (l.qty > 1 ? `${l.qty}× ${l.name}` : l.name)).join(", ");

export const clockText = (seconds: number): string => {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
