// Downscale/recompress image uploads in the browser before the form submits, so room-inspection
// photos (F-005) stay small — big phone photos become ~a few hundred KB instead of multiple MB.
// No-op on pages without an image file input. Server keeps a hard size cap as a backstop.
const MAX_DIM = 1600; // longest edge, px
const QUALITY = 0.82; // JPEG quality

/** Downscale one image to MAX_DIM/QUALITY, returning the original if there is nothing to gain.
 *
 * Exported because opslagstavlen uploads via fetch rather than a form submit, so it cannot use
 * hookImageForms below — and a second canvas downscaler with its own parameters is exactly the
 * drift worth avoiding. */
export async function downscaleImage(file: File): Promise<File> {
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

// ONE delegated listener on the document, in the CAPTURE phase. Both halves of that matter.
//
// Capture, because htmx also listens for `submit` — on the form itself — as soon as a form carries
// hx-post, which Den Hurtige's reply form now does. Two at-target listeners fire in registration
// order, and htmx processes the node when it enters the DOM while this module runs at import: htmx
// would win, and send the full-size phone photo before the downscale ever ran. A capture listener
// on an ancestor always precedes at-target listeners, whoever registered first.
//
// Delegated, because the forms are rebuilt constantly — the feed morphs every five seconds and the
// thread panel swaps in and out. Per-form hooking needed a re-arm after every swap plus a
// data-img-hooked marker to stop listeners stacking up, and the marker then had to be protected
// from the morph. A document-level listener sees forms that did not exist when it was registered,
// so all of that machinery is gone.
document.addEventListener(
  "submit",
  async (event: SubmitEvent) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.dataset.imgReady === "1") {
      // Second pass, after the downscale. Clear the flag rather than leaving it set: a form that
      // survives its own submit — the thread panel's, which htmx posts and then resets — would
      // otherwise skip downscaling for every photo after the first.
      delete form.dataset.imgReady;
      return;
    }
    const inputs = Array.from(
      form.querySelectorAll<HTMLInputElement>('input[type="file"][accept^="image"]'),
    );
    if (!inputs.some((i) => i.files && i.files.length)) return; // nothing picked
    event.preventDefault();
    event.stopPropagation(); // keep htmx from posting this pass
    for (const input of inputs) {
      if (!input.files || !input.files.length) continue;
      const dt = new DataTransfer();
      for (const f of Array.from(input.files)) dt.items.add(await downscaleImage(f));
      input.files = dt.files;
    }
    form.dataset.imgReady = "1";
    form.requestSubmit();
  },
  true,
);

/** Kept as a no-op for callers that used to re-arm forms after a swap.
 *
 * The delegated listener above needs no rescan, so there is nothing to do — but the export stays
 * so an out-of-tree caller does not break, and so this note is findable from the call site. */
export function hookImageForms(_root: ParentNode = document): void {
  /* nothing to do: submit is handled by the delegated capture listener above */
}
