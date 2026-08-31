/** Lords of the ØK: The Game — entry point for the `spil` bundle.
 *
 *  Loaded only by app/templates/spil/spil.html. It bails out silently on every other page, so even
 *  if the file is ever pulled in somewhere else it does nothing at all.
 */

import { loadAtlas } from "./art";
import type { ServerRoom } from "./building";
import { Game } from "./game";

function readJson<T>(id: string, fallback: T): T {
  const el = document.getElementById(id);
  if (!el?.textContent) return fallback;
  try {
    return JSON.parse(el.textContent) as T;
  } catch {
    return fallback;
  }
}

function boot(): void {
  const frame = document.getElementById("spil-frame");
  const canvas = document.getElementById("spil-canvas");
  if (!frame || !(canvas instanceof HTMLCanvasElement)) return;

  const rooms = readJson<ServerRoom[]>("spil-rooms", []);
  const goods = readJson<string[]>("spil-goods", ["Øl", "Sodavand", "Chips", "Slik"]);

  const game = new Game(frame, canvas, rooms, goods);

  // Real pixel art, when there is any: static/spil/atlas.png + atlas.json. Until then the renderer
  // draws everything procedurally, so a missing atlas is not an error.
  const base = canvas.dataset.assets ?? "/static/spil/";
  void loadAtlas(base).then((atlas) => game.setAtlas(atlas));

  const fs = document.getElementById("spil-fullscreen");
  fs?.addEventListener("click", () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void frame.requestFullscreen?.().then(() => canvas.focus());
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
