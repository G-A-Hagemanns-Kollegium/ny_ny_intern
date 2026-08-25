/** Random events — the bits of a shift you tell people about afterwards.
 *
 *  An event grabs a handful of the orders on the board (or spawns its own), marks them, puts one
 *  clock over the lot and pays a lump sum if you clear them in time. Failing costs nothing beyond
 *  the bonus: an event should feel like an opportunity, never a punishment for being somewhere else.
 *
 *  Event orders are always visible in the rail even without the Telefonliste — otherwise "three
 *  floors at once" would just be three rooms you happen not to have walked past.
 */

import { EVENT_COOLDOWN, EVENT_COOLDOWN_JITTER, EVENT_MIN_DELIVERIES } from "./config";
import type { Order, OrderBook } from "./orders";

export interface ActiveEvent {
  id: string;
  name: string;
  blurb: string;
  orders: number[]; // order ids
  need: number;
  done: number;
  limit: number;
  left: number;
  bonus: number;
}

type Kind = {
  id: string;
  name: string;
  blurb: (n: number) => string;
  /** How many fresh orders to conjure, and how they must be spread across floors. */
  count: number;
  distinctFloors: boolean;
  seconds: number;
  bonus: number;
};

const KINDS: Kind[] = [
  {
    id: "trappe",
    name: "TRAPPERÆS",
    blurb: (n) => `${n} bestillinger på ${n} etager — tag dem alle`,
    count: 3,
    distinctFloors: true,
    seconds: 190,
    bonus: 220,
  },
  {
    id: "fest",
    name: "FEST I FESTSALEN",
    blurb: (n) => `${n} tørstige på samme etage`,
    count: 4,
    distinctFloors: false,
    seconds: 165,
    bonus: 260,
  },
  {
    id: "storkunde",
    name: "STORKUNDE",
    blurb: () => "Én stor bestilling, dobbelt betaling",
    count: 1,
    distinctFloors: false,
    seconds: 120,
    bonus: 150,
  },
];

export class EventDirector {
  active: ActiveEvent | null = null;
  /** Set for one frame when something worth announcing happened. */
  private cooldown = 25;

  constructor(private readonly book: OrderBook) {}

  /** Advance the clock. Returns "won" / "lost" on the frame an event resolves. */
  tick(dt: number, delivered: number): "won" | "lost" | null {
    if (!this.active) {
      this.cooldown -= dt;
      if (this.cooldown <= 0 && delivered >= EVENT_MIN_DELIVERIES) this.start();
      return null;
    }
    this.active.left -= dt;
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
    this.cooldown = 25;
  }

  /** Names the cheat console accepts. */
  get kinds(): string[] {
    return KINDS.map((k) => k.id);
  }

  /** Start one now, by id or at random. Returns false if there was no room to place its orders. */
  force(id?: string): boolean {
    this.active = null;
    this.start(KINDS.find((k) => k.id === id));
    return !!this.active;
  }

  private release(): void {
    this.active = null;
    this.cooldown = EVENT_COOLDOWN + Math.random() * EVENT_COOLDOWN_JITTER;
  }

  private start(want?: Kind): void {
    const kind = want ?? KINDS[Math.floor(Math.random() * KINDS.length)];
    const orders: Order[] = [];
    const floors = new Set<number>();

    // Spawn fresh requests rather than hijacking existing ones: an event you did not notice
    // starting should not silently eat the order you were already running.
    for (let attempt = 0; attempt < 40 && orders.length < kind.count; attempt++) {
      const o = this.book.spawn(true);
      if (!o) break;
      if (kind.distinctFloors && floors.has(o.floor)) {
        this.book.complete(o); // wrong floor — put it back and try again
        continue;
      }
      floors.add(o.floor);
      orders.push(o);
    }
    if (orders.length < kind.count) {
      for (const o of orders) this.book.complete(o);
      this.cooldown = 20;
      return;
    }

    if (kind.id === "storkunde") {
      // One fat order: double the goods and double the quote.
      const o = orders[0];
      o.count *= 2;
      for (const l of o.lines) l.qty *= 2;
      o.quote *= 2;
    }

    this.active = {
      id: kind.id,
      name: kind.name,
      blurb: kind.blurb(orders.length),
      orders: orders.map((o) => o.id),
      need: orders.length,
      done: 0,
      limit: kind.seconds,
      left: kind.seconds,
      bonus: kind.bonus,
    };
  }
}

export const eventFraction = (e: ActiveEvent): number => Math.max(0, e.left / e.limit);
