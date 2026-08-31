/** The DOM half of the game: the order rail, the toast line, and the panels.
 *
 *  Every panel is keyboard-driven — arrows or WASD move the selection, Enter picks, Esc backs out —
 *  because you reach all of them mid-run with your hands already on the movement keys.
 */

import { EMPTY_ATLAS, type Atlas } from "./art";
import { FLOOR_NAMES } from "./building";
import { RUN_MINUTES } from "./config";
import { clockText } from "./orders";
import {
  SKILLS,
  canSpend,
  capacity,
  skillLevel,
  TRACKS,
  xpNeeded,
  type Run,
  type Save,
  type SkillId,
} from "./progress";

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

const kr = (n: number): string => `${Math.round(n).toLocaleString("da-DK")} kr`;

export type Action =
  | { type: "character"; id: string }
  | { type: "play" }
  | { type: "start" }
  | { type: "resume" }
  | { type: "skills" }
  | { type: "spend"; id: SkillId }
  | { type: "lift"; floor: number }
  | { type: "again" }
  | { type: "menu" }
  | { type: "reset" };

interface Character {
  id: string;
  name: string;
  blurb: string;
  unlocked: boolean;
  /** The passive, shown under the blurb so the choice is an informed one. */
  perk?: { blurb: string };
  /** Atlas frame to show on the select screen. Locked characters have none. */
  sprite?: string;
}

export class Ui {
  private modal: HTMLElement;
  private box: HTMLElement;
  private toastEl: HTMLElement;
  private skillBtn: HTMLButtonElement;
  private skillBtnN: HTMLElement;
  private skillArrow: HTMLElement;
  private shownPoints = -1;
  private hudOn = false;
  private toastTimer = 0;
  private handler: (a: Action) => void = () => {};
  private atlas: Atlas = EMPTY_ATLAS;
  /** Which panel is up, so the select screen can be redrawn when the sprite sheet lands. */
  private screen = "";

  constructor(root: HTMLElement) {
    this.modal = root.querySelector<HTMLElement>("#spil-modal")!;
    this.box = root.querySelector<HTMLElement>("#spil-modal-box")!;
    this.toastEl = root.querySelector<HTMLElement>("#spil-toast")!;
    this.skillBtn = root.querySelector<HTMLButtonElement>("#spil-skillbtn")!;
    this.skillBtnN = root.querySelector<HTMLElement>("#spil-skillbtn-n")!;
    this.skillArrow = root.querySelector<HTMLElement>("#spil-skillarrow")!;
    this.box.tabIndex = -1;

    this.skillBtn.addEventListener("click", () => this.handler({ type: "skills" }));

    this.box.addEventListener("click", (ev) => {
      const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-act]");
      if (el) this.fire(el);
    });
    this.box.addEventListener("keydown", (ev) => this.onKey(ev));
  }

  onAction(fn: (a: Action) => void): void {
    this.handler = fn;
  }

  private fire(el: HTMLElement): void {
    if (el.hasAttribute("disabled")) return;
    const type = el.dataset.act as Action["type"];
    if (type === "character") this.handler({ type, id: el.dataset.id ?? "" });
    else if (type === "spend") this.handler({ type, id: el.dataset.id as SkillId });
    else if (type === "lift") this.handler({ type, floor: Number(el.dataset.floor ?? 0) });
    else this.handler({ type } as Action);
  }

  /** Arrows or WASD walk the choices; Enter takes one. The same hands that were driving the bud. */
  private onKey(ev: KeyboardEvent): void {
    const k = ev.key.toLowerCase();
    const items = [...this.box.querySelectorAll<HTMLElement>("[data-nav]:not([disabled])")];
    if (!items.length) return;
    const at = items.findIndex((el) => el.classList.contains("is-sel"));
    const step = ["arrowright", "arrowdown", "d", "s"].includes(k)
      ? 1
      : ["arrowleft", "arrowup", "a", "w"].includes(k)
        ? -1
        : 0;
    if (step) {
      ev.preventDefault();
      ev.stopPropagation();
      const next = (at + step + items.length) % items.length;
      items.forEach((el, i) => el.classList.toggle("is-sel", i === next));
      items[next].scrollIntoView({ block: "nearest" });
      return;
    }
    if (k === "enter" || k === " " || k === "e") {
      ev.preventDefault();
      ev.stopPropagation();
      if (at >= 0) this.fire(items[at]);
    }
  }

  // -------------------------------------------------------------------------- the event banner
  /** Shows/hides the in-run overlays as a set. */
  showHud(show: boolean): void {
    this.hudOn = show;
    if (!show) this.showSkillButton(0);
  }

  /** The unspent-points button, bottom right. Hidden at zero; otherwise it pulses and an arrow
   *  bounces at it, because a point you never notice is a point you never spend. */
  showSkillButton(points: number): void {
    if (points === this.shownPoints) return;
    this.shownPoints = points;
    const hide = points <= 0 || !this.hudOn;
    this.skillBtn.hidden = hide;
    this.skillArrow.hidden = hide;
    this.skillBtnN.textContent = String(points);
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
    this.screen = "";
    this.modal.hidden = true;
    this.box.innerHTML = "";
  }

  private open(html: string): void {
    this.box.innerHTML = html;
    this.modal.hidden = false;
    this.box.scrollTop = 0;
    // A panel may pre-select a row; only fall back to the first if none did.
    if (!this.box.querySelector("[data-nav].is-sel")) {
      this.box.querySelector<HTMLElement>("[data-nav]:not([disabled])")?.classList.add("is-sel");
    }
    this.box.focus({ preventScroll: true });
  }

  /** The atlas arrives a moment after the menu does, so the select screen is redrawn once it lands
   *  — see `setAtlas`. Until then, and if the sheet fails to load, the CSS portrait stands in. */
  private portrait(name: string | undefined): string {
    return this.chipStyle(name, 0.22);
  }

  /** An atlas frame as an inline background, sized in `em` so it scales with the frame. Returns a
   *  ` style="…"` attribute, or "" when the sheet has not loaded — the CSS fallback then shows. */
  private chipStyle(name: string | undefined, z: number): string {
    const frame = name ? this.atlas.frames[name] : undefined;
    const src = this.atlas.image?.src;
    if (!frame || !src) return "";
    const at = (n: number): string => `${(n * z).toFixed(3)}em`;
    return ` style="width:${at(frame.w)};height:${at(frame.h)};image-rendering:pixelated;` +
      `background:url(${encodeURI(src)}) -${at(frame.x)} -${at(frame.y)}/` +
      `${at(this.atlas.image?.naturalWidth ?? 0)} ${at(this.atlas.image?.naturalHeight ?? 0)} no-repeat;` +
      `box-shadow:none"`;
  }

  /** A sprite inline in a step, sized by how tall it should *end up* rather than by a scale
   *  factor — sprites here range from a 14 px bottle to a 32 px bud, and a shared factor makes one
   *  of them wrong every time. */
  private chip(name: string, em = 2.4): string {
    const frame = this.atlas.frames[name];
    return `<span class="spil-chip"${this.chipStyle(name, frame ? em / frame.h : 0.1)}></span>`;
  }

  /** Handed the sheet as soon as it loads. Every menu that draws sprites is built before the sheet
   *  arrives, so redraw whichever one is up. */
  setAtlas(atlas: Atlas, characters: readonly Character[], save: Save): void {
    this.atlas = atlas;
    if (this.screen === "select") this.showSelect(characters);
    else if (this.screen === "tutorial") this.showTutorial();
    else if (this.screen === "title") this.showTitle(save);
  }

  /** The front door: the logo and one button. Everything else is a screen behind it. */
  showTitle(save: Save): void {
    this.screen = "title";
    this.open(`
      <div class="spil-title">
        <span class="spil-title-the">The</span>
        <span class="spil-title-main">Lords of the ØK</span>
        <span class="spil-title-sub">The Game</span>
      </div>
      <div class="spil-actions spil-title-actions">
        <button class="spil-btn spil-btn-big" data-nav data-act="play">Spil</button>
      </div>
      ${this.boardHtml(save, -1)}
      <div class="spil-actions"><button class="spil-btn is-ghost" data-act="reset">Slet rangliste</button></div>`);
  }

  /** Shown once between picking a bud and the clock starting. Four lines, because anything longer
   *  than that does not get read — the rest of the game teaches itself through the on-screen
   *  prompts. "En gang til" skips straight past this. */
  showTutorial(): void {
    this.screen = "tutorial";
    const step = (n: number, art: string, title: string, body: string): string => `
      <li class="spil-step">
        <span class="spil-step-n">${n}</span>
        <span class="spil-step-art">${art}</span>
        <b>${title}</b>
        <small>${body}</small>
      </li>`;
    const key = (k: string): string => `<kbd>${esc(k)}</kbd>`;

    this.open(`
      <h2>Sådan er vagten</h2>
      <ol class="spil-how">
        ${step(1, this.chip("door_front_open", 3.2) + this.chip("res_idle_down_0", 2.9),
          "Bank på",
          `Døre med lys i og et <b>?</b> over venter på en ordre. Stil dig i døren og tryk ${key("E")}.`)}
        ${step(2, this.chip("counter", 1.8) + this.chip("item_beer", 2.3) + this.chip("item_soda", 2.3),
          "Hent varerne",
          `Ned i Ølkælderen og ${key("E")} ved disken. Varerne lægger sig i bæltet nederst på skærmen.`)}
        ${step(3, this.chip("alb_idle_down_0", 3.2) + this.chip("door_front", 3.2),
          "Lever igen",
          `Tilbage til døren og ${key("E")}. Jo hurtigere, jo flere kroner — og leverer du flere i træk, stiger bonussen.`)}
        ${step(4, this.chip("lift_broken", 3.2) + this.chip("toolbox", 2.2),
          "Fiks elevatoren",
          `Trapperne æder tiden. Værktøjskassen står i <b>Værkstedet på 4. sal</b> — hent den, så kører elevatoren.`)}
      </ol>

      <h3>Styring</h3>
      <div class="spil-keys">
        <span class="spil-keyrow"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><i>eller piletaster</i><b>Gå</b></span>
        <span class="spil-keyrow"><kbd>E</kbd><b>Bank på · hent · lever</b></span>
        <span class="spil-keyrow"><kbd>Shift</kbd><b>Løb</b><i>når du har løbesko</i></span>
        <span class="spil-keyrow"><kbd>K</kbd><b>Færdigheder</b></span>
      </div>

      <div class="spil-actions">
        <button class="spil-btn" data-nav data-act="start">Vælg dit bud</button>
      </div>`);
  }

  showSelect(characters: readonly Character[]): void {
    this.screen = "select";
    const cards = characters
      .map(
        (c) => `<button class="spil-card spil-char${c.unlocked ? "" : " is-locked"}"
            ${c.unlocked ? "data-nav" : ""} data-act="character" data-id="${esc(c.id)}"${c.unlocked ? "" : " disabled"}>
          <span class="spil-portrait${c.unlocked ? "" : " is-locked"}"${this.portrait(c.sprite)}></span>
          <b>${esc(c.name)}</b><small>${esc(c.blurb)}</small>
          ${c.perk?.blurb ? `<small class="spil-perk">${esc(c.perk.blurb)}</small>` : ""}
        </button>`,
      )
      .join("");
    this.open(`
      <h2>Vælg dit bud</h2>
      <p class="spil-dim">${RUN_MINUTES} minutters vagt. Jo hurtigere du leverer, jo mere erfaring — og jo større score.</p>
      <div class="spil-grid spil-grid-chars">${cards}</div>`);
  }

  /** Færdigheder. One row per skill, and one card per *level* of it, so a four-level skill reads as
   *  a line you extend rather than a box with pips in it. Rows are grouped under their track. */
  showSkills(run: Run): void {
    const rows = TRACKS.map((t) => {
      const lines = SKILLS.filter((s) => s.track === t.id).map((s) => {
        const lv = skillLevel(run.skills, s.id);
        const need = s.needs && skillLevel(run.skills, s.needs.id) < s.needs.level ? s.needs : null;
        const buyable = canSpend(run.skills, s) && run.points > 0;

        const cards = Array.from({ length: s.max }, (_, i) => {
          const n = i + 1;
          const owned = lv >= n;
          // Exactly one card is for sale: the next level up, and only if it is affordable.
          const next = buyable && n === lv + 1;
          const link = i
            ? `<span class="spil-track-link${lv >= n - 1 && lv > 0 ? " is-on" : ""}" aria-hidden="true"></span>`
            : "";
          return `${link}<button class="spil-lvl${owned ? " is-owned" : ""}${next ? " is-next" : ""}"
              ${next ? "data-nav" : ""} data-act="spend" data-id="${s.id}"${next ? "" : " disabled"}>
            <span class="spil-lvl-n">${n}</span>
            ${next ? '<span class="spil-lvl-buy">Køb</span>' : ""}
          </button>`;
        }).join("");

        const state = need
          ? `<small class="spil-locked">Kræver ${esc(SKILLS.find((x) => x.id === need.id)!.name)} ${need.level}</small>`
          : lv >= s.max
            ? `<small class="spil-maxed">Maks</small>`
            : `<small class="spil-cost">${lv}/${s.max}</small>`;

        return `
          <div class="spil-skillrow${need ? " is-blocked" : ""}">
            <span class="spil-skillrow-icon"${this.chipStyle(s.icon, 0.15)}></span>
            <b>${esc(s.name)}</b>
            <small class="spil-skillrow-note">${esc(s.note)}${s.key ? ` <kbd>${esc(s.key)}</kbd>` : ""}</small>
            <span class="spil-track-line">${cards}</span>
            ${state}
          </div>`;
      }).join("");
      return `
        <section class="spil-track">
          <header><b>${esc(t.name)}</b><small>${esc(t.note)}</small></header>
          ${lines}
        </section>`;
    }).join("");

    this.open(`
      <h2>Level ${run.level}</h2>
      <p class="spil-dim">Du har <b class="spil-price">${run.points}</b> point at bruge.
        Piletaster vælger, Enter køber.</p>
      ${rows}
      <div class="spil-actions">
        <button class="spil-btn is-ghost" data-act="resume">${run.points > 0 ? "Gem pointet" : "Videre"}</button>
      </div>`);
  }

  showLift(current: number): void {
    // A lift panel reads like the shaft it drives: 4. sal at the top, Kælderen at the bottom. The
    // buttons are emitted in that order too, so ArrowUp and ArrowDown move the way the cage will.
    const rows = FLOOR_NAMES.map((name, i) => {
      const gap = i - current;
      const note = gap === 0
        ? "Du står her"
        : `${Math.abs(gap)} etage${Math.abs(gap) === 1 ? "" : "r"} ${gap > 0 ? "op" : "ned"}`;
      // Start on a neighbour of the floor you are on, so one press of an arrow picks it.
      const sel = Math.abs(gap) === 1 && (gap === 1 || current === FLOOR_NAMES.length - 1);
      return gap === 0
        ? `<div class="spil-floor is-here"><span class="spil-floor-n">${i}</span>
             <b>${esc(name)}</b><small>${note}</small></div>`
        : `<button class="spil-floor${sel ? " is-sel" : ""}" data-nav data-act="lift" data-floor="${i}">
             <span class="spil-floor-n">${i}</span><b>${esc(name)}</b><small>${note}</small>
           </button>`;
    });
    this.open(`
      <h2>Vareelevator</h2>
      <p class="spil-dim">Vælg etage med ↑ og ↓, Enter kører.</p>
      <div class="spil-shaft">${rows.reverse().join("")}</div>
      <div class="spil-actions"><button class="spil-btn is-ghost" data-act="resume">Fortryd</button></div>`);
  }

  showPause(run: Run): void {
    this.open(`
      <h2>Pause</h2>
      <div class="spil-stats">
        <div><span>Score</span><strong>${kr(run.money)}</strong></div>
        <div><span>Level</span><strong>${run.level}</strong></div>
        <div><span>Leveret</span><strong>${run.delivered}</strong></div>
        <div><span>Tid</span><strong>${clockText(run.left)}</strong></div>
      </div>
      <div class="spil-actions">
        <button class="spil-btn" data-nav data-act="resume">Fortsæt</button>
        <button class="spil-btn is-ghost" data-nav data-act="skills">Evner${run.points ? ` (${run.points})` : ""}</button>
        <button class="spil-btn is-ghost" data-nav data-act="menu">Afslut</button>
      </div>`);
  }

  showGameOver(run: Run, save: Save, place: number): void {
    this.open(`
      <h2>Vagten er slut</h2>
      <div class="spil-final">${kr(run.money)}</div>
      ${place ? `<p class="spil-dim">Nr. <b class="spil-price">${place}</b> på ranglisten.</p>` : ""}
      <div class="spil-stats">
        <div><span>Leveret</span><strong>${run.delivered}</strong></div>
        <div><span>For sent</span><strong>${run.failed}</strong></div>
        <div><span>Level</span><strong>${run.level}</strong></div>
        <div><span>Bedste stime</span><strong>${run.bestCombo}×</strong></div>
      </div>
      ${this.boardHtml(save, place)}
      <div class="spil-actions">
        <button class="spil-btn" data-nav data-act="again">En gang til</button>
        <button class="spil-btn is-ghost" data-nav data-act="menu">Til menuen</button>
      </div>`);
  }

  private boardHtml(save: Save, place: number): string {
    if (!save.board.length) return "";
    const rows = save.board
      .map(
        (e, i) => `<li class="${i + 1 === place ? "is-you" : ""}">
          <span class="spil-board-n">${i + 1}</span>
          <b>${kr(e.score)}</b>
          <small>level ${e.level} · ${e.delivered} leveringer</small>
        </li>`,
      )
      .join("");
    return `<h3>Rangliste</h3><ol class="spil-board">${rows}</ol>`;
  }
}
