/** The cheat console — a developer tool, opened with `/` (or `½` / F2) while the game has focus.
 *
 *  It exists so a change can be tested without playing up to it: give yourself the lift, jump to
 *  4. sal, force an event, and see the thing you just wrote. It only ever touches the local save,
 *  which is this browser's alone — there is no score to inflate and no server to lie to.
 *
 *  The console owns nothing but the DOM and the history; every command is executed by the game
 *  itself, which keeps the cheats honest (they go through the same setters ordinary play uses).
 */

export type CommandRunner = (name: string, args: string[]) => string;

const PROMPT = "&gt;";

export class DevConsole {
  private root: HTMLElement;
  private log: HTMLElement;
  private input: HTMLInputElement;
  private history: string[] = [];
  private historyAt = 0;
  private run: CommandRunner = () => "";
  private closed: () => void = () => {};

  constructor(frame: HTMLElement) {
    this.root = frame.querySelector<HTMLElement>("#spil-console")!;
    this.log = frame.querySelector<HTMLElement>("#spil-console-log")!;
    this.input = frame.querySelector<HTMLInputElement>("#spil-console-input")!;

    this.input.addEventListener("keydown", (ev) => {
      ev.stopPropagation(); // never let a cheat leak through as movement
      if (ev.key === "Escape") {
        ev.preventDefault();
        this.close();
        return;
      }
      if (ev.key === "Enter") {
        ev.preventDefault();
        this.submit();
        return;
      }
      if (ev.key === "ArrowUp" || ev.key === "ArrowDown") {
        ev.preventDefault();
        if (!this.history.length) return;
        this.historyAt = Math.max(
          0,
          Math.min(this.history.length, this.historyAt + (ev.key === "ArrowUp" ? -1 : 1)),
        );
        this.input.value = this.history[this.historyAt] ?? "";
      }
    });
  }

  onCommand(fn: CommandRunner): void {
    this.run = fn;
  }

  onClose(fn: () => void): void {
    this.closed = fn;
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    if (this.isOpen) return;
    this.root.hidden = false;
    if (!this.log.childElementCount) this.print("Skriv `hjælp` for kommandoer. Esc lukker.", "dim");
    this.input.value = "";
    this.input.focus();
  }

  close(): void {
    this.root.hidden = true;
    this.input.blur();
    this.closed();
  }

  print(text: string, kind: "dim" | "ok" | "bad" | "echo" = "dim"): void {
    const line = document.createElement("div");
    line.className = `spil-console-line is-${kind}`;
    line.textContent = kind === "echo" ? `> ${text}` : text;
    this.log.appendChild(line);
    while (this.log.childElementCount > 60) this.log.removeChild(this.log.firstChild!);
    this.log.scrollTop = this.log.scrollHeight;
  }

  private submit(): void {
    const line = this.input.value.trim();
    this.input.value = "";
    if (!line) return;
    this.history.push(line);
    this.historyAt = this.history.length;
    this.print(line, "echo");

    const [name, ...args] = line.split(/\s+/);
    let out: string;
    try {
      out = this.run(name.toLowerCase(), args);
    } catch (err) {
      out = `fejl: ${String(err)}`;
    }
    for (const l of out.split("\n")) {
      if (l) this.print(l, l.startsWith("?") ? "bad" : "ok");
    }
  }
}

/** The keys that summon it. `/` is Shift-7 on a Danish layout, so `½` and F2 are there too. */
export const OPENS_CONSOLE = new Set(["/", "½", "§", "`", "~", "f2"]);
