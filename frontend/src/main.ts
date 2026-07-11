import "./styles.css";
import "htmx.org";
import Alpine from "alpinejs";
import "./charts"; // interactive charts on /nyintern/statistik/ (no-op elsewhere)
import "./imageupload"; // downscale room-inspection photo uploads client-side (no-op elsewhere)

// Alpine for small client-only interactions; HTMX (imported above) auto-wires hx-* attributes.
(window as unknown as { Alpine: typeof Alpine }).Alpine = Alpine;

// --- Ølkælder till (kiosk) basket island ---
interface KioskProduct { id: number; name: string; price_ore: number; img: string }
interface KioskShopper { id: number; rid: number; name: string }

const readJson = <T,>(id: string): T[] => {
  const el = document.getElementById(id);
  return el ? (JSON.parse(el.textContent ?? "[]") as T[]) : [];
};
const kr = (ore: number): string =>
  (ore / 100).toLocaleString("da-DK", { minimumFractionDigits: 2 }) + " kr";

Alpine.data("kiosk", () => ({
  products: [] as KioskProduct[],
  shoppers: [] as KioskShopper[],
  cart: {} as Record<number, number>, // productId -> qty
  chosen: [] as number[], // selected shopper ids
  filter: "",
  kr,
  init() {
    this.products = readJson<KioskProduct>("kiosk-products");
    this.shoppers = readJson<KioskShopper>("kiosk-shoppers");
  },
  qty(id: number): number {
    return this.cart[id] ?? 0;
  },
  add(id: number) {
    this.cart[id] = this.qty(id) + 1;
  },
  sub(id: number) {
    const q = this.qty(id) - 1;
    if (q <= 0) delete this.cart[id];
    else this.cart[id] = q;
  },
  toggle(id: number) {
    const i = this.chosen.indexOf(id);
    if (i < 0) this.chosen.push(id);
    else this.chosen.splice(i, 1);
  },
  isChosen(id: number): boolean {
    return this.chosen.includes(id);
  },
  get shownShoppers(): KioskShopper[] {
    const f = this.filter.toLowerCase().trim();
    return this.shoppers.filter(
      (s) => s.name.toLowerCase().includes(f) || String(s.rid).includes(f),
    );
  },
  get totalOre(): number {
    return this.products.reduce((sum, p) => sum + (this.cart[p.id] ?? 0) * p.price_ore, 0);
  },
  get perPersonOre(): number {
    return this.chosen.length ? Math.round(this.totalOre / this.chosen.length) : 0;
  },
  get canSubmit(): boolean {
    return this.chosen.length > 0 && this.totalOre > 0;
  },
}));

Alpine.start();
