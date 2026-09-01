/** The art layer.
 *
 *  Every sprite goes through `sprite()`, which blits a named frame out of the sheet at
 *  `app/static/spil/atlas.png` (+ `atlas.json`) and returns false when that frame is missing, so
 *  callers can fall back to a plain block. That means the art can be replaced one frame at a time:
 *  repaint `bed`, reload, and only the beds change.
 *
 *  atlas.json is the plain Aseprite / TexturePacker "hash" shape:
 *
 *      { "frames": { "bed": { "frame": { "x": 0, "y": 0, "w": 14, "h": 20 } }, … } }
 *
 *  Everything is authored on a 16 px grid at 1x and scaled up by the renderer, so keep the source
 *  art small — a 14x20 bed, not a 56x80 one. See ASSETS.md.
 */

export interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Atlas {
  image: HTMLImageElement | null;
  frames: Record<string, Frame>;
}

export const EMPTY_ATLAS: Atlas = { image: null, frames: {} };

interface AtlasJson {
  frames?: Record<string, { frame?: Frame } | Frame>;
}

function normaliseFrames(json: AtlasJson): Record<string, Frame> {
  const out: Record<string, Frame> = {};
  for (const [name, entry] of Object.entries(json.frames ?? {})) {
    const f = "frame" in entry && entry.frame ? entry.frame : (entry as Frame);
    if (typeof f.x === "number" && typeof f.w === "number") out[name] = f;
  }
  return out;
}

/** Never rejects: a missing atlas is the normal state until somebody draws one. */
export async function loadAtlas(baseUrl: string): Promise<Atlas> {
  try {
    const res = await fetch(`${baseUrl}atlas.json`, { cache: "no-cache" });
    if (!res.ok) return EMPTY_ATLAS;
    const frames = normaliseFrames((await res.json()) as AtlasJson);
    if (!Object.keys(frames).length) return EMPTY_ATLAS;
    const image = await new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = `${baseUrl}atlas.png`;
    });
    return image ? { image, frames } : EMPTY_ATLAS;
  } catch {
    return EMPTY_ATLAS;
  }
}

/** Blit a named frame. Returns false when the atlas has no such frame, so the caller can fall back
 *  to its procedural version. */
export function sprite(
  ctx: CanvasRenderingContext2D,
  atlas: Atlas,
  name: string,
  x: number,
  y: number,
  w?: number,
  h?: number,
): boolean {
  const f = atlas.frames[name];
  if (!f || !atlas.image) return false;
  ctx.drawImage(atlas.image, f.x, f.y, f.w, f.h, Math.round(x), Math.round(y), w ?? f.w, h ?? f.h);
  return true;
}

// ------------------------------------------------------------------------------- draw helpers
/** Pixel-snapped rect — the whole scene is authored on integer coordinates so nothing blurs. */
export function rect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
): void {
  ctx.fillStyle = fill;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** Rounded panel used for every bubble, sign and HUD chip. */
export function panel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  stroke?: string,
  radius = 3,
): void {
  ctx.beginPath();
  ctx.roundRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h), radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

export function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  fill: string,
  size = 7,
  align: CanvasTextAlign = "left",
  weight = "700",
): void {
  ctx.font = `${weight} ${size}px "Ubuntu", system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = fill;
  ctx.fillText(s, Math.round(x), Math.round(y));
}

/** Text with a dark halo, for anything that has to stay legible over the world rather than over a
 *  panel — the kroner popups and the level-up banner. */
export function textOut(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  fill: string,
  size = 7,
  align: CanvasTextAlign = "center",
): void {
  ctx.font = `700 ${size}px "Ubuntu", system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, size / 3);
  ctx.strokeStyle = "rgba(10,7,15,0.9)";
  ctx.strokeText(s, Math.round(x), Math.round(y));
  ctx.fillStyle = fill;
  ctx.fillText(s, Math.round(x), Math.round(y));
}

/** Draw a sprite standing on the floor at (x, y): centred horizontally, feet on the point. Lets the
 *  renderer stay ignorant of how tall a character sheet happens to be. */
export function spriteFoot(
  ctx: CanvasRenderingContext2D,
  atlas: Atlas,
  name: string,
  x: number,
  y: number,
  flip = false,
): boolean {
  const f = atlas.frames[name];
  if (!f || !atlas.image) return false;
  const dx = Math.round(x - f.w / 2);
  const dy = Math.round(y - f.h + 2);
  if (!flip) return sprite(ctx, atlas, name, dx, dy);
  ctx.save();
  ctx.translate(Math.round(x) * 2, 0);
  ctx.scale(-1, 1);
  sprite(ctx, atlas, name, dx, dy);
  ctx.restore();
  return true;
}

/** Repeat a frame across a rectangle — floors and wall runs. */
export function tileFill(
  ctx: CanvasRenderingContext2D,
  atlas: Atlas,
  name: string,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  const f = atlas.frames[name];
  if (!f || !atlas.image) return false;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  // Anchor to the world grid, not to the rect, so neighbouring rooms line up.
  const x0 = Math.floor(x / f.w) * f.w;
  const y0 = Math.floor(y / f.h) * f.h;
  for (let ty = y0; ty < y + h; ty += f.h) {
    for (let tx = x0; tx < x + w; tx += f.w) {
      ctx.drawImage(atlas.image, f.x, f.y, f.w, f.h, tx, ty, f.w, f.h);
    }
  }
  ctx.restore();
  return true;
}
