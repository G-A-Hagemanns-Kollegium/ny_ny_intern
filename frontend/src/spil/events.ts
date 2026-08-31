/** Random events — the bits of a run you tell people about afterwards.
 *
 *  An event spawns its own handful of orders, marks them, puts one clock over the lot and pays a
 *  lump sum if you clear them in time. Failing costs nothing beyond the bonus: an event should feel
 *  like an opportunity, never a punishment for being somewhere else.
 *
 *  Event orders are called out by name when they open, so "three floors at once" is a plan rather
 *  than three rooms you happen not to have walked past.
 */

import type { Building, Cell } from "./building";
import { FLOOR_NAMES, rectPx } from "./building";
import { EVENT_COOLDOWN, EVENT_COOLDOWN_JITTER, EVENT_MIN_DELIVERIES } from "./config";
import type { Order, OrderBook } from "./orders";

export interface Guest {
  x: number;
  y: number;
  dir: -1 | 1;
  anim: number;
}

/** A party in progress: where it is, and who is standing around at it. */
export interface Party {
  cell: Cell;
  floor: number;
  guests: Guest[];
}

export interface ActiveEvent {
  id: string;
  name: string;
  blurb: string;
  /** Where to actually go, spelled out — "Festsalen · Kælderen", or the three floors of a race.
   *  An event you cannot find is an event you ignore. */
  where: string;
  /** Floors the event wants something on, for the minikort's per-floor tally. */
  floors: number[];
  orders: number[];
  need: number;
  done: number;
  limit: number;
  left: number;
  bonus: number;
}

export class EventDirector {
  active: ActiveEvent | null = null;
  party: Party | null = null;
  private cooldown = 25;

  constructor(
    private readonly book: OrderBook,
    private readonly building: Building,
  ) {}

  tick(dt: number, delivered: number): "lost" | null {
    if (!this.active) {
      this.cooldown -= dt;
      if (this.cooldown <= 0 && delivered >= EVENT_MIN_DELIVERIES) this.start();
      return null;
    }
    this.active.left -= dt;
    for (const g of this.party?.guests ?? []) g.anim += dt;
    if (this.active.left <= 0) {
      this.release();
      return "lost";
    }
    return null;
  }

  /** Call on every delivery. Returns the bonus when the delivery completes an event. */
  onDelivered(order: Order): number {
    const ev = this.active;
    if (!ev || !ev.orders.includes(order.id)) return 0;
    ev.done += 1;
    if (ev.done < ev.need) return 0;
    const bonus = ev.bonus;
    this.release();
    return bonus;
  }

  /** Call when an event order runs out of time — the whole event goes with it. */
  onLost(order: Order): boolean {
    if (!this.active || !this.active.orders.includes(order.id)) return false;
    this.release();
    return true;
  }

  isEventOrder(order: Order): boolean {
    return !!this.active?.orders.includes(order.id);
  }

  clear(): void {
    this.active = null;
    this.party = null;
    this.cooldown = 25;
  }

  get kinds(): string[] {
    return ["trappe", "fest", "storkunde"];
  }

  force(id?: string): boolean {
    this.active = null;
    this.party = null;
    this.start(id);
    return !!this.active;
  }

  private release(): void {
    this.active = null;
    this.party = null;
    this.cooldown = EVENT_COOLDOWN + Math.random() * EVENT_COOLDOWN_JITTER;
  }

  private begin(
    id: string,
    name: string,
    blurb: string,
    where: string,
    orders: Order[],
    seconds: number,
    bonus: number,
  ): void {
    this.active = {
      id,
      name,
      blurb,
      where,
      floors: [...new Set(orders.map((o) => o.floor))].sort((a, b) => a - b),
      orders: orders.map((o) => o.id),
      need: orders.length,
      done: 0,
      limit: seconds,
      left: seconds,
      bonus,
    };
  }

  private start(want?: string): void {
    const id = want ?? ["trappe", "fest", "storkunde"][Math.floor(Math.random() * 3)];
    if (id === "fest") this.startParty();
    else if (id === "storkunde") this.startBigOrder();
    else this.startStairRace();
    if (!this.active) this.cooldown = 20;
  }

  /** Three orders on three different floors. */
  private startStairRace(): void {
    const orders: Order[] = [];
    const floors = new Set<number>();
    for (let attempt = 0; attempt < 40 && orders.length < 3; attempt++) {
      const o = this.book.spawn(true);
      if (!o) break;
      if (floors.has(o.floor)) {
        this.book.complete(o); // same floor — put it back and try again
        continue;
      }
      floors.add(o.floor);
      orders.push(o);
    }
    if (orders.length < 3) {
      for (const o of orders) this.book.complete(o);
      return;
    }
    const where = orders
      .slice()
      .sort((a, b) => a.floor - b.floor)
      .map((o) => `${o.label} · ${FLOOR_NAMES[o.floor]}`)
      .join("   ");
    this.begin("trappe", "TRAPPERÆS", "3 bestillinger på 3 etager — tag dem alle", where, orders, 190, 220);
  }

  /** A party in festsalen or a gangkøkken: four guests, four rounds, one address.
   *
   *  This is the whole point of addressing orders to a *cell* rather than a room number — a party
   *  happens where people actually gather, not in four unrelated bedrooms. */
  private startParty(): void {
    const spots = this.building.partySpots;
    if (!spots.length) return;
    const spot = spots[Math.floor(Math.random() * spots.length)];
    const where = spot.cell.label || "festen";

    const names = ["Fest-Freja", "Fest-Bo", "Fest-Ida", "Fest-Emil"];
    const orders: Order[] = [];
    for (let i = 0; i < 4; i++) {
      orders.push(this.book.spawnAt(spot.cell, spot.floor, where, names[i], 1 + Math.floor(Math.random() * 3)));
    }

    // Four of them, standing about in the middle of the room.
    const r = rectPx(spot.cell);
    const guests: Guest[] = [];
    for (let i = 0; i < 4; i++) {
      guests.push({
        x: r.x + r.w / 2 + (i - 1.5) * 17,
        y: r.y + r.h - 22 + (i % 2) * 7,
        dir: i % 2 ? 1 : -1,
        anim: i * 0.7,
      });
    }
    this.party = { cell: spot.cell, floor: spot.floor, guests };
    this.begin(
      "fest",
      "FEST",
      `Fire tørstige i ${where} — hold festen i gang`,
      `${where} · ${FLOOR_NAMES[spot.floor]}`,
      orders,
      200,
      280,
    );
  }

  /** One fat order at double pay. */
  private startBigOrder(): void {
    const o = this.book.spawn(true);
    if (!o) return;
    o.count *= 2;
    for (const l of o.lines) l.qty *= 2;
    o.quote *= 2;
    this.begin(
      "storkunde",
      "STORKUNDE",
      "Én stor bestilling, dobbelt betaling",
      `${o.label} · ${FLOOR_NAMES[o.floor]} · ${o.count} varer`,
      [o],
      120,
      150,
    );
  }
}

export const eventFraction = (e: ActiveEvent): number => Math.max(0, e.left / e.limit);
