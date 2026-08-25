/** Orders: who wants what, and — once you have knocked — how long you have to get back.
 *
 *  Life cycle: pending → taken → carrying → paid.
 *
 *  A *pending* request has no clock on it at all. Residents wait as long as it takes; the game has
 *  no shift, no closing time and no rush hour. The single timer starts the moment you take the order
 *  at the door, and it is the whole difficulty curve: run down to Ølkælderen, load up, and be back
 *  before it expires.
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
} from "./config";

export type OrderPhase = "pending" | "taken" | "carrying";

export interface OrderLine {
  name: string;
  qty: number;
}

export interface Order {
  id: number;
  room: number;
  floor: number;
  cell: Cell;
  who: string;
  lines: OrderLine[];
  /** Total units — this is what costs inventory space. */
  count: number;
  phase: OrderPhase;
  /** Seconds allowed once taken, and how many are left. Both meaningless while pending. */
  limit: number;
  left: number;
  /** Kroner promised at the door; the payout adds a speed bonus on top. */
  quote: number;
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

  byRoom(room: number): Order | undefined {
    return this.active.find((o) => o.room === room);
  }

  get running(): Order[] {
    return this.active.filter((o) => o.phase !== "pending");
  }

  /** One new request, if there is room for one. Biased upwards: the long climbs pay best, so they
   *  should also turn up often enough to be worth buying a lift for.
   *
   *  `force` skips the waiting-orders cap — events conjure their own requests and must not be
   *  refused just because the board happens to be busy. */
  spawn(force = false): Order | null {
    if (!force && this.pendingCount() >= MAX_PENDING) return null;
    const busy = new Set(this.active.map((o) => o.room));
    const free = this.building.rooms.filter((r) => !busy.has(r.room));
    if (!free.length) return null;

    const a = pick(free);
    const b = pick(free);
    const target = b.floor > a.floor ? b : a;

    const count = ORDER_MIN_ITEMS + Math.floor(Math.random() * (ORDER_MAX_ITEMS - ORDER_MIN_ITEMS + 1));
    const lines: OrderLine[] = [];
    for (let i = 0; i < count; i++) {
      const name = pick(this.goods);
      const line = lines.find((l) => l.name === name);
      if (line) line.qty += 1;
      else lines.push({ name, qty: 1 });
    }

    const limit = DEADLINE_BASE + DEADLINE_PER_ITEM * count + DEADLINE_PER_FLOOR * target.floor;
    const quote = Math.round(
      (PAY_BASE + PAY_PER_ITEM * count + PAY_PER_FLOOR * target.floor) * jitter(PAY_JITTER),
    );

    const order: Order = {
      id: this.nextId++,
      room: target.room,
      floor: target.floor,
      cell: target.cell,
      who: occupantOf(target.cell),
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

  /** Tick the clock on everything already accepted. Returns the orders that just ran out. */
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
