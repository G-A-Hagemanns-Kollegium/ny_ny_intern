// Downscale/recompress image uploads in the browser before the form submits, so room-inspection
// photos (F-005) stay small — big phone photos become ~a few hundred KB instead of multiple MB.
// No-op on pages without an image file input. Server keeps a hard size cap as a backstop.
const MAX_DIM = 1600; // longest edge, px
const QUALITY = 0.82; // JPEG quality

async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return file; // unsupported/undecodable → let the server handle it
  }
  const scale = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 800_000) return file; // already small enough
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", QUALITY));
  if (!blob || blob.size >= file.size) return file; // no gain → keep original
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
}

function hook(form: HTMLFormElement) {
  form.addEventListener("submit", async (e) => {
    if (form.dataset.imgReady === "1") return; // second pass — allow normal submit
    const inputs = Array.from(
      form.querySelectorAll<HTMLInputElement>('input[type="file"][accept^="image"]'),
    );
    if (!inputs.some((i) => i.files && i.files.length)) return; // nothing picked
    e.preventDefault();
    for (const input of inputs) {
      if (!input.files || !input.files.length) continue;
      const dt = new DataTransfer();
      for (const f of Array.from(input.files)) dt.items.add(await shrink(f));
      input.files = dt.files;
    }
    form.dataset.imgReady = "1";
    form.requestSubmit();
  });
}

/** Hook every not-yet-hooked image form under `root`.
 *
 * Exported because Den Hurtige rebuilds its reply forms on every 20s poll; without a rescan those
 * new forms would upload full-size phone photos. Idempotent, so calling it again is free. */
export function hookImageForms(root: ParentNode = document): void {
  for (const form of Array.from(root.querySelectorAll<HTMLFormElement>("form"))) {
    if (form.dataset.imgHooked === "1") continue;
    if (!form.querySelector('input[type="file"][accept^="image"]')) continue;
    form.dataset.imgHooked = "1";
    hook(form);
  }
}

hookImageForms();
