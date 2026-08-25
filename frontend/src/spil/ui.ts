/** The DOM half of the game: the order rail, the toast line, and three panels — character select,
 *  the kiosk shop and the lift.
 *
 *  There is deliberately no info screen and no help page. Everything a player needs to know is on
 *  screen while they play: the lit doors, the bubbles, the prompt bar and the rail.
 */

import { clockText, summarise, type OrderBook } from "./orders";
import { eventFraction, type EventDirector } from "./events";
import { FLOOR_NAMES } from "./building";
import { CRATE_TIERS, PRICES, SHOE_TIERS, capacity, type Progress } from "./progress";

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

const kr = (n: number): string => `${Math.round(n)} kr`;

export type Action =
  | { type: "character"; id: string }
  | { type: "resume" }
  | { type: "shop" }
  | { type: "buy"; item: string }
  | { type: "lift"; floor: number }
  | { type: "reset" };

interface Character {
  id: string;
  name: string;
  blurb: string;
  unlocked: boolean;
}

export class Ui {
  private modal: HTMLElement;
  private box: HTMLElement;
  private rail: HTMLElement;
  private list: HTMLElement;
  private banner: HTMLElement;
  private toastEl: HTMLElement;
  private toastTimer = 0;
  private handler: (a: Action) => void = () => {};

  constructor(root: HTMLElement) {
    this.modal = root.querySelector<HTMLElement>("#spil-modal")!;
    this.box = root.querySelector<HTMLElement>("#spil-modal-box")!;
    this.rail = root.querySelector<HTMLElement>("#spil-orders")!;
    this.list = root.querySelector<HTMLElement>("#spil-orders-list")!;
    this.banner = root.querySelector<HTMLElement>("#spil-event")!;
    this.toastEl = root.querySelector<HTMLElement>("#spil-toast")!;

    this.box.addEventListener("click", (ev) => {
      const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-act]");
      if (!el) return;
      const type = el.dataset.act as Action["type"];
      if (type === "character") this.handler({ type, id: el.dataset.id ?? "" });
      else if (type === "buy") this.handler({ type, item: el.dataset.item ?? "" });
      else if (type === "lift") this.handler({ type, floor: Number(el.dataset.floor ?? 0) });
      else this.handler({ type } as Action);
    });
  }

  onAction(fn: (a: Action) => void): void {
    this.handler = fn;
  }

  // ------------------------------------------------------------------------------- order rail
  showRail(show: boolean): void {
    this.rail.hidden = !show;
    if (!show) this.banner.hidden = true;
  }

  renderOrders(book: OrderBook, hasPhone: boolean, floor: number, events: EventDirector): void {
    const ev = events.active;
    if (ev) {
      const pct = Math.round(eventFraction(ev) * 100);
      this.banner.hidden = false;
      this.banner.className = `spil-event${eventFraction(ev) < 0.3 ? " is-urgent" : ""}`;
      this.banner.innerHTML = `
        <div class="spil-event-top"><b>${esc(ev.name)}</b><span>${clockText(ev.left)}</span></div>
        <div class="spil-event-sub">${esc(ev.blurb)} — bonus ${kr(ev.bonus)}</div>
        <div class="spil-event-pips">${Array.from(
          { length: ev.need },
          (_, i) => `<i class="${i < ev.done ? "is-done" : ""}"></i>`,
        ).join("")}</div>
        <div class="spil-o-bar"><i style="width:${pct}%"></i></div>`;
    } else {
      this.banner.hidden = true;
    }

    // Event orders are always listed: "three floors at once" is not a challenge if you cannot see
    // which three.
    const mine = book.active
      .filter((o) => o.phase !== "pending" || hasPhone || events.isEventOrder(o))
      .sort((a, b) => book.fraction(a) - book.fraction(b));

    if (!mine.length) {
      this.list.innerHTML = `<li class="spil-orders-empty">Ingen bestillinger. Bank på dørene — der er lys hos dem, der mangler noget.</li>`;
      return;
    }

    this.list.innerHTML = mine
      .map((o) => {
        const star = events.isEventOrder(o);
        const cls = [
          o.phase === "carrying" ? "is-carried" : book.isUrgent(o) ? "is-urgent" : "",
          star ? "is-event" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const where = o.floor === floor ? "" : ` · ${FLOOR_NAMES[o.floor]}`;
        const what =
          o.phase === "pending"
            ? "vil bestille noget"
            : o.phase === "taken"
              ? `hent: ${summarise(o)}`
              : `lever: ${summarise(o)}`;
        const timer = o.phase === "pending" ? "" : ` · ${clockText(o.left)}`;
        const bar =
          o.phase === "pending"
            ? ""
            : `<span class="spil-o-bar"><i style="width:${Math.round(book.fraction(o) * 100)}%"></i></span>`;
        return `<li class="${cls}">
          <b>${star ? "★ " : ""}${String(o.room).padStart(3, "0")} · ${esc(o.who)}</b>
          <span class="spil-o-sub">${esc(what)}${where} — ${kr(o.quote)}${timer}</span>
          ${bar}
        </li>`;
      })
      .join("");
  }

  // ------------------------------------------------------------------------------------ toast
  toast(message: string, kind: "" | "is-good" | "is-bad" = ""): void {
    this.toastEl.textContent = message;
    this.toastEl.className = `spil-toast ${kind}`;
    this.toastEl.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.hidden = true;
    }, 2600);
  }

  // ----------------------------------------------------------------------------------- panels
  close(): void {
    this.modal.hidden = true;
    this.box.innerHTML = "";
  }

  private open(html: string): void {
    this.box.innerHTML = html;
    this.modal.hidden = false;
    this.box.scrollTop = 0;
    this.box.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  }

  /** The one screen before play: pick your bud. */
  showSelect(characters: readonly Character[], p: Progress): void {
    const cards = characters
      .map(
        (c) => `<button class="spil-card spil-char${c.unlocked ? "" : " is-locked"}" data-act="character"
            data-id="${esc(c.id)}"${c.unlocked ? "" : " disabled"}>
          <span class="spil-portrait${c.unlocked ? "" : " is-locked"}"></span>
          <b>${esc(c.name)}</b><small>${esc(c.blurb)}</small>
        </button>`,
      )
      .join("");
    this.open(`
      <h2>Vælg dit bud</h2>
      <div class="spil-grid spil-grid-chars">${cards}</div>
      ${
        p.delivered
          ? `<div class="spil-stats">
               <div><span>Kasse</span><strong>${kr(p.money)}</strong></div>
               <div><span>Leveret</span><strong>${p.delivered}</strong></div>
               <div><span>Opgaver</span><strong>${p.events}</strong></div>
             </div>`
          : ""
      }
      <div class="spil-actions"><button class="spil-btn is-ghost" data-act="reset">Nulstil alt</button></div>`);
  }

  showShop(p: Progress): void {
    const card = (item: string, title: string, note: string, price: number, owned: boolean): string => {
      if (owned) {
        return `<div class="spil-card is-owned"><b>${esc(title)}</b><small>${esc(note)}</small>
          <small class="spil-price">Ejet</small></div>`;
      }
      return `<button class="spil-card" data-act="buy" data-item="${esc(item)}"${p.money >= price ? "" : " disabled"}>
        <b>${esc(title)}</b><small>${esc(note)}</small>
        <small class="spil-price">${kr(price)}</small></button>`;
    };

    const nextCrate = CRATE_TIERS[p.crate + 1];
    const nextShoe = SHOE_TIERS[p.shoes + 1];
    const cards = [
      nextShoe
        ? card(
            "shoes",
            nextShoe.name,
            `${nextShoe.note} (nu: ${SHOE_TIERS[p.shoes].name})`,
            nextShoe.price,
            false,
          )
        : card("shoes", SHOE_TIERS[p.shoes].name, "Der findes ikke hurtigere sko", 0, true),
      nextCrate
        ? card("crate", nextCrate.name, `${nextCrate.note} (nu ${capacity(p)})`, nextCrate.price, false)
        : card("crate", CRATE_TIERS[p.crate].name, "Største bæreudstyr", 0, true),
      card("phone", "Telefonliste", "Se bestillinger på alle etager", PRICES.phone, p.phone),
      card("cart", "Sækkevogn", "Ingen fartstraf når du er fuldt lastet", PRICES.cart, p.cart),
    ].join("");

    // The lift is the one thing not for sale.
    const lift = p.lift
      ? `<div class="spil-card is-owned"><b>Vareelevator</b><small>Repareret</small><small class="spil-price">Kører</small></div>`
      : p.tools
        ? `<div class="spil-card is-quest"><b>Vareelevator</b><small>Du har værktøjet — gå hen til en elevatordør og reparér den</small><small class="spil-price">Opgave</small></div>`
        : `<div class="spil-card is-quest"><b>Vareelevator</b><small>I stykker. Værktøjet ligger i Værkstedet på 4. sal</small><small class="spil-price">Låst</small></div>`;

    this.open(`
      <h2>Ølkælderens lager</h2>
      <p class="spil-dim">Kasse: <b class="spil-price">${kr(p.money)}</b></p>
      <div class="spil-grid">${cards}${lift}</div>
      <div class="spil-actions"><button class="spil-btn" data-act="resume">Tilbage</button></div>`);
  }

  showLift(current: number): void {
    const buttons = FLOOR_NAMES.map((name, i) =>
      i === current
        ? `<div class="spil-card is-owned"><b>${esc(name)}</b><small>Du står her</small></div>`
        : `<button class="spil-card" data-act="lift" data-floor="${i}"><b>${esc(name)}</b>
             <small>${Math.abs(i - current)} etage${Math.abs(i - current) === 1 ? "" : "r"}</small></button>`,
    ).join("");
    this.open(`
      <h2>Vareelevator</h2>
      <div class="spil-grid">${buttons}</div>
      <div class="spil-actions"><button class="spil-btn is-ghost" data-act="resume">Fortryd</button></div>`);
  }

  showPause(p: Progress): void {
    this.open(`
      <h2>Pause</h2>
      <div class="spil-stats">
        <div><span>Kasse</span><strong>${kr(p.money)}</strong></div>
        <div><span>Leveret</span><strong>${p.delivered}</strong></div>
        <div><span>Opgaver</span><strong>${p.events}</strong></div>
      </div>
      <div class="spil-actions">
        <button class="spil-btn" data-act="resume">Fortsæt</button>
        <button class="spil-btn is-ghost" data-act="shop">Kiosken</button>
        <button class="spil-btn is-ghost" data-act="reset">Nulstil alt</button>
      </div>`);
  }
}
